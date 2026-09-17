import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { userService } from "@/services/user.service";
import type { Permission } from "./permissions";
import { permissionService } from "@/services/permission.service";
import { securityStampService } from "@/services/security-stamp.service";
import { safeRedirectPath } from "./safe-redirect";
import {
  CURRENT_PATH_HEADER,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Đọc session từ cookie: chữ ký hợp lệ VÀ phiên chưa bị thu hồi.
 *
 * Chữ ký đúng chưa đủ: cookie sống `SESSION_MAX_AGE_DAYS`, và trong quãng đó
 * tài khoản có thể đã bị khoá, bị xoá, hoặc vừa đổi mật khẩu vì nghi bị chiếm.
 * `securityStampService` đối chiếu với một ảnh nhỏ của tài khoản (cache ≤60
 * giây, xoá ngay khi đổi) — nên đây vẫn là một lần đọc cache, không phải một
 * truy vấn database mỗi request.
 *
 * Mọi thứ phía sau đều đi qua đây — `getCurrentUser`, `requireUser`, và cả
 * bốn wrapper Server Action — nên thu hồi có hiệu lực ở mọi cửa cùng lúc.
 *
 * `cache()` đảm bảo nhiều component trong cùng một request chỉ kiểm một lần.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!session) return null;

  return (await securityStampService.isTokenStillValid(session.sub, session.iat)) ? session : null;
});

/**
 * Lấy user từ database theo session.
 *
 * Vì sao không dùng thẳng dữ liệu trong token: token sống nhiều ngày. Trong
 * khoảng đó user có thể bị xoá hoặc bị hạ quyền, mà token cũ vẫn hợp lệ về chữ
 * ký. Mọi quyết định phân quyền phải dựa trên dữ liệu đọc từ database.
 */
export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;

  // Đi qua `userService` thay vì tự viết `select`: cột `password` và
  // `twoFactorSecret` không bao giờ được đọc lên ở đây, và luật đó chỉ tồn tại
  // ở đúng một chỗ (`USER_SELECT`).
  return userService.findById(session.sub);
});

/**
 * Dùng trong trang/layout. Chưa đăng nhập thì đá về `/login?next=<trang này>`.
 *
 * @param returnTo Đích sau khi đăng nhập. Bỏ trống = đúng trang đang mở (kèm
 * truy vấn), đọc từ header `x-pathname` mà proxy gắn — nên layout dùng chung
 * cho nhiều trang không phải viết cứng một đường dẫn. Mọi giá trị đều qua
 * `safeRedirectPath`, kể cả header: request đi vòng qua proxy tự đặt được nó.
 */
export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const next = safeRedirectPath(returnTo ?? (await headers()).get(CURRENT_PATH_HEADER), "");
    redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  return user;
}

/**
 * Dùng trong trang/layout cần một quyền hạn cụ thể.
 *
 * Kiểm theo QUYỀN, không theo tên vai trò: thêm vai trò mới chỉ phải sửa bảng
 * phân quyền, không phải đi lùng từng chỗ đang so `role === "ADMIN"` — mà so
 * như vậy còn chặn nhầm cả SUPER_ADMIN.
 *
 * Người đã đăng nhập nhưng không đủ quyền nhận 404 chứ không phải 403: 403 xác
 * nhận cho họ biết tài nguyên đó có tồn tại.
 */
export async function requirePermission(
  permission: Permission,
  returnTo?: string,
): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!(await permissionService.can(user.id, permission))) notFound();
  return user;
}

/**
 * Dùng trong trang/layout của khu quản lý MỘT SÂN cụ thể.
 *
 * ---
 * TRẢ 404, KHÔNG PHẢI 403
 *
 * `venueId` đến từ URL nên ai cũng gõ được. Trả 403 là xác nhận "sân này có
 * thật, chỉ là bạn không có quyền" — đủ để dò xem nền tảng có những sân nào.
 * 404 không nói gì cả.
 *
 * ⚠️ Đây vẫn chỉ là lớp cho GIAO DIỆN. Server Action không đi qua trang, nên
 * mỗi action vẫn phải tự kiểm bằng `defineVenueAction`.
 */
export async function requireVenueAccess(
  venueId: string,
  permission: Permission,
  returnTo?: string,
): Promise<CurrentUser> {
  // Không viết cứng `/manage/<id>`: người mở `/manage/<id>/payments` từ thông
  // báo phải quay lại đúng trang duyệt tiền sau khi đăng nhập.
  const user = await requireUser(returnTo);
  if (!(await permissionService.canOnVenue(user.id, permission, venueId))) notFound();
  return user;
}

/**
 * Trình duyệt đang cầm một cookie phiên ĐÚNG chữ ký nhưng đã bị thu hồi (đổi
 * mật khẩu ở nơi khác, tài khoản bị khoá/xoá).
 *
 * Trang đăng nhập dùng để nói rõ vì sao người dùng phải đăng nhập lại, thay
 * vì để họ tưởng hệ thống tự đăng xuất vô cớ. Không xoá được cookie ở đây:
 * Server Component không ghi cookie — lần đăng nhập kế tiếp sẽ ghi đè nó.
 */
export async function hasRevokedSessionCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  const signed = await verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  return signed !== null && (await getSession()) === null;
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    ...sessionCookieOptions,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", { ...sessionCookieOptions, maxAge: 0 });
}
