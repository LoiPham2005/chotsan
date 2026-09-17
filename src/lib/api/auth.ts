import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession, type SessionPayload } from "@/lib/session";
import {
  clientIpFromHeaders,
  ipRateLimitKey,
  rateLimit,
  type RateLimitBucket,
} from "@/lib/rate-limit";
import type { Permission } from "@/lib/permissions";
import { permissionService } from "@/services/permission.service";
import { securityStampService } from "@/services/security-stamp.service";
import { apiErrors } from "./response";

/**
 * Xác thực cho route handler.
 *
 * Khác với `@/lib/auth` (chỉ đọc cookie, dành cho web), file này ưu tiên header
 * `Authorization: Bearer` vì client mobile không dùng cookie. Vẫn fallback về
 * cookie để cùng một endpoint phục vụ được cả web lẫn app mà không cần tách
 * đôi route.
 *
 * NHẮC LẠI: Proxy cố tình không chạy trên /api (xem `src/proxy.ts`), nên đây
 * là lớp kiểm quyền DUY NHẤT cho REST API. Mọi route handler phải gọi
 * `requireApiUser`, `requireApiPermission` hoặc `requireVenuePermission`.
 */

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;

  return token;
}

/**
 * Phiên của request: token đúng chữ ký VÀ chưa bị thu hồi.
 *
 * Access token mobile chỉ sống 15 phút, nhưng 15 phút đó là đúng lúc cần chặn:
 * tài khoản vừa bị khoá, vừa bị xoá, hoặc chủ thật vừa đổi mật khẩu vì nghi bị
 * chiếm. Cùng phép kiểm với `getSession()` của web — xem `securityStampService`.
 */
export async function getApiSession(request: Request): Promise<SessionPayload | null> {
  const session =
    (await verifySession(bearerToken(request))) ??
    (await verifySession((await cookies()).get(SESSION_COOKIE_NAME)?.value));

  if (!session) return null;

  return (await securityStampService.isTokenStillValid(session.sub, session.iat)) ? session : null;
}

/** Ném ApiError 401 nếu chưa đăng nhập. */
export async function requireApiUser(request: Request): Promise<SessionPayload> {
  const session = await getApiSession(request);
  if (!session) throw apiErrors.unauthenticated();
  return session;
}

/**
 * Ném ApiError 401 nếu chưa đăng nhập, 403 nếu thiếu quyền.
 *
 * Quyền LUÔN được tra lại từ database (có cache), KHÔNG đọc từ token. Ký quyền
 * vào token nghĩa là sửa phân quyền không có tác dụng cho tới khi token hết hạn
 * — người vừa bị tước quyền vẫn thao tác thêm được, đúng lúc cần chặn ngay.
 *
 * Cái giá là một lần đọc cache mỗi request có yêu cầu quyền; `permissionService`
 * dùng Redis khi có `REDIS_URL`, RAM khi không.
 */
export async function requireApiPermission(
  request: Request,
  permission: Permission,
): Promise<SessionPayload> {
  const session = await requireApiUser(request);
  if (!(await permissionService.can(session.sub, permission))) throw apiErrors.forbidden();
  return session;
}

/**
 * Như `requireApiPermission`, nhưng hỏi kèm SÂN.
 *
 * `venueId` đến từ URL hoặc body nên người gọi tự đặt được — vì vậy phép kiểm
 * phải nhận nó làm tham số, không được suy ra từ phiên đăng nhập.
 *
 * Trả 404 chứ không 403 khi thiếu quyền trên sân: phân biệt "sân không tồn tại"
 * với "sân có thật nhưng bạn không được vào" là xác nhận cho người đang dò biết
 * id đó có thật.
 */
export async function requireVenuePermission(
  request: Request,
  venueId: string,
  permission: Permission,
): Promise<SessionPayload> {
  const session = await requireApiUser(request);

  if (!(await permissionService.canOnVenue(session.sub, permission, venueId))) {
    throw apiErrors.notFound("Không tìm thấy sân");
  }

  return session;
}

/**
 * IP của client — CÙNG một hàm với Server Action (`clientIpFromHeaders`), nên
 * web và API luôn đếm một người vào cùng một xô. Xem `TRUSTED_PROXY_HOPS`.
 */
export function clientIp(request: Request): string {
  return clientIpFromHeaders(request.headers);
}

/**
 * Giới hạn tần suất theo IP; ném ApiError 429 (kèm `Retry-After`) khi vượt ngưỡng.
 *
 * @param bucket Tên xô đếm. Luồng nào có cả bản web lẫn bản API thì truyền
 * đúng hằng trong `RATE_LIMIT_BUCKETS` — hai cửa chung một xô, ngưỡng không bị
 * nhân đôi. Chuỗi tự do chỉ dành cho luồng CHỈ có ở API (ví dụ `api:upload`).
 *
 * @returns Khoá vừa đếm — để `resetRateLimit` sau khi đăng nhập thành công.
 */
export async function enforceRateLimit(
  request: Request,
  bucket: RateLimitBucket | (string & {}),
  options: { limit: number; windowSeconds: number },
): Promise<string> {
  const key = ipRateLimitKey(bucket as RateLimitBucket, clientIp(request));
  const result = await rateLimit(key, options);

  if (!result.success) throw apiErrors.rateLimited(result.retryAfterSeconds);

  return key;
}
