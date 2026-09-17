import "server-only";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { Permission } from "@/lib/permissions";
import {
  clientIpFromHeaders,
  ipRateLimitKey,
  rateLimit,
  type RateLimitBucket,
  type RateLimitOptions,
  type RateLimitResult,
} from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/session";
import { permissionService } from "@/services/permission.service";

/**
 * Bọc Server Action lại, biến việc kiểm quyền từ KỶ LUẬT thành RÀNG BUỘC KIỂU.
 *
 * ---
 * VẤN ĐỀ NÓ GIẢI QUYẾT
 *
 * Mỗi Server Action là một HTTP endpoint công khai. Trang chứa nó nằm sau lớp
 * bảo vệ nào không quan trọng — ai cũng POST thẳng tới action id được. Nên mọi
 * action đều PHẢI tự kiểm quyền.
 *
 * Trước file này, luật đó được giữ bằng cách nhớ viết hai dòng ở đầu mỗi hàm:
 *
 *     const denied = await denyUnlessPermitted("role:update");
 *     if (denied) return denied;
 *
 * Quên hai dòng đó thì KHÔNG có gì báo: TypeScript không biết, test khác vẫn
 * xanh, trang vẫn chạy. Lỗ hổng chỉ lộ ra khi có người thử. Làm việc theo đội
 * thì review bắt được; làm một mình thì không.
 *
 * Với `defineAction`, không khai báo quyền là **không biên dịch được** — quyền
 * là tham số bắt buộc, và `Permission` là union nên gõ sai tên cũng bị bắt.
 *
 * ---
 * NÓ KHÔNG THAY THẾ ĐIỀU GÌ
 *
 * Đây vẫn là lớp kiểm quyền của TẦNG ACTION. Ba lớp còn lại giữ nguyên:
 * proxy chặn người chưa đăng nhập vào trang, trang tự gọi `requirePermission`,
 * và route handler của REST API tự kiểm. Xem README mục "Mô hình bảo mật".
 *
 * ---
 * "ĐÃ ĐĂNG NHẬP" NGHĨA LÀ GÌ Ở ĐÂY
 *
 * Mọi wrapper đọc phiên qua `getSession()`: cookie đúng chữ ký VÀ tài khoản
 * vẫn ACTIVE, chưa xoá, chưa đổi mật khẩu kể từ lúc cấp cookie. Người vừa bị
 * khoá bị chặn ngay ở action kế tiếp, không đợi cookie hết hạn.
 */

/**
 * Hình dạng tối thiểu của state mà một action trả về.
 *
 * Mọi state của action trong dự án đều có `error?: string` — đó là cách giao
 * diện hiển thị lỗi. `defineAction` dựa vào đúng trường này để báo "bị từ
 * chối" mà không cần thêm một kiểu riêng lọt ra call site.
 */
export type ActionState = { error?: string };

/**
 * Ngữ cảnh truyền vào phần thân action.
 *
 * Có sẵn `session` để không phải gọi `getSession()` lần nữa — `defineAction` đã
 * đọc rồi, và `getSession` được bọc `cache()` nên gọi lại cũng không tốn thêm
 * truy vấn, nhưng truyền thẳng vào thì rõ ràng hơn.
 */
export type ActionContext = {
  session: SessionPayload;
  /** Id người đang thao tác. Viết tắt của `session.sub` vì dùng rất nhiều. */
  actorId: string;
};

/** Như `ActionContext`, kèm sân mà quyền vừa được kiểm trên đó. */
export type VenueActionContext = ActionContext & { venueId: string };

/**
 * Ngữ cảnh của action công khai. Khác `ActionContext` ở chỗ **có thể không có
 * ai đăng nhập** — nên `session` và `actorId` đều nullable, và TypeScript buộc
 * nơi gọi phải xử lý trường hợp đó.
 */
export type PublicActionContext = {
  session: SessionPayload | null;
  actorId: string | null;
  ip: string;
};

/**
 * IP người gọi Server Action — CÙNG luật đọc header với REST API
 * (`clientIpFromHeaders`, `TRUSTED_PROXY_HOPS`). Hai bản đọc IP khác nhau là
 * hai xô đếm khác nhau cho cùng một người.
 */
export async function actionClientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

/**
 * Rate limit theo IP cho Server Action viết trần (luồng đăng nhập công khai).
 *
 * Đi qua `ipRateLimitKey` như `enforceRateLimit` của API, nên cùng một luồng
 * trên web và trên API đếm vào CÙNG một xô — kẻ dò không nhân đôi được số lần
 * thử bằng cách luân phiên hai cửa.
 *
 * @returns Kết quả kèm `key` — để `resetRateLimit(key)` sau khi thành công.
 */
export async function rateLimitAction(
  bucket: RateLimitBucket,
  options: RateLimitOptions,
): Promise<RateLimitResult & { key: string }> {
  const key = ipRateLimitKey(bucket, await actionClientIp());
  return { ...(await rateLimit(key, options)), key };
}

/**
 * Tạo một Server Action đã tự kiểm quyền.
 *
 * @param permission Quyền bắt buộc phải có. Đây là lý do hàm này tồn tại —
 * không có cách nào tạo action mà bỏ qua tham số này.
 *
 * @example
 * export const deleteRoleAction = defineAction(
 *   "role:delete",
 *   async (ctx, key: string) => {
 *     // `actorId` thật — không có nó thì chốt `Role.level` không chạy.
 *     await roleService.remove(key, { actorId: ctx.actorId });
 *     revalidatePath("/roles");
 *     return {};
 *   },
 * );
 */
export function defineAction<TArgs extends unknown[], TState extends ActionState>(
  permission: Permission,
  handler: (ctx: ActionContext, ...args: TArgs) => Promise<TState>,
): (...args: TArgs) => Promise<TState> {
  return async (...args: TArgs) => {
    const session = await getSession();

    if (!session) {
      return denied<TState>("Bạn cần đăng nhập để thực hiện thao tác này.");
    }

    if (!(await permissionService.can(session.sub, permission))) {
      // Ghi log MỌI lần bị từ chối. Một tài khoản hợp lệ gõ cửa action nó không
      // có quyền là tín hiệu đáng chú ý — có thể là lỗi giao diện (hiện nút cho
      // người không đủ quyền), cũng có thể là ai đó đang dò.
      logger.warn("Server Action bị từ chối vì thiếu quyền", {
        userId: session.sub,
        roles: session.roles,
        permission,
      });
      return denied<TState>("Bạn không có quyền thực hiện thao tác này.");
    }

    return handler({ session, actorId: session.sub }, ...args);
  };
}

/**
 * Dựng giá trị "bị từ chối" mang kiểu state của chính action đó.
 *
 * Ép kiểu ở đây là CÓ CHỦ ĐÍCH, và đánh đổi được ghi rõ: `TState` chỉ được
 * ràng buộc là có `error?: string`, nên về lý thuyết nó có thể mang thêm
 * trường BẮT BUỘC mà nhánh từ chối không điền.
 *
 * Chấp nhận vì hai lẽ. Một: mọi state của form trong dự án đều toàn trường
 * tuỳ chọn — đó là bản chất của form state, nó phải biểu diễn được cả lúc
 * chưa gửi gì. Hai: giữ đúng kiểu trả về khiến nơi gọi không phải xử lý một
 * union lạ, mà chính sự phiền phức đó là lý do người ta lười bọc action.
 *
 * ⚠️ Thêm trường bắt buộc vào state của một action thì phải tự trả nó ở nhánh
 * lỗi — hoặc tốt hơn, để trường đó tuỳ chọn.
 */
function denied<TState extends ActionState>(message: string): TState {
  return { error: message } as TState;
}

/**
 * Bản dành cho action chỉ cần ĐĂNG NHẬP, không cần quyền cụ thể.
 *
 * Tách thành hàm riêng thay vì cho `permission` thành tuỳ chọn: nếu tham số đó
 * bỏ trống được thì việc quên nó lại trở thành lỗi im lặng — đúng thứ file này
 * sinh ra để chặn. Muốn không cần quyền thì phải nói ra bằng một cái tên khác.
 */
export function defineAuthedAction<TArgs extends unknown[], TState extends ActionState>(
  handler: (ctx: ActionContext, ...args: TArgs) => Promise<TState>,
): (...args: TArgs) => Promise<TState> {
  return async (...args: TArgs) => {
    const session = await getSession();

    if (!session) {
      return denied<TState>("Bạn cần đăng nhập để thực hiện thao tác này.");
    }

    return handler({ session, actorId: session.sub }, ...args);
  };
}

/**
 * Server Action mà NGƯỜI CHƯA ĐĂNG NHẬP gọi được.
 *
 * ---
 * VÌ SAO PHẢI CÓ HÀM RIÊNG THAY VÌ VIẾT MỘT HÀM TRẦN
 *
 * Có những việc người chưa đăng nhập phải làm được (gửi liên hệ, tra cứu công
 * khai…). Hiện chưa action nào cần — đặt sân và khai chuyển khoản đều bắt đăng
 * nhập. Nhưng khi cần, một action không bọc gì trông y hệt một action mà người
 * viết QUÊN kiểm quyền, và đó chính là lỗi im lặng cả file này sinh ra để chặn.
 *
 * Hàm này biến "công khai" thành một quyết định phải nói ra:
 *
 *   - `reason` bắt buộc, và nó đứng ngay đầu lời gọi — đọc code là biết vì sao
 *     action này không cần đăng nhập. Nó cũng đi vào log mỗi lần action bị
 *     chặn vì gọi quá dày (không log ở lần gọi bình thường — sẽ ngập log).
 *   - Luôn có rate limit: theo người dùng nếu đã đăng nhập, theo IP nếu chưa.
 *     Endpoint công khai KHÔNG có trần là một endpoint chờ bị dội.
 *   - `grep definePublicAction src/` liệt kê đủ mọi bề mặt công khai.
 */
export function definePublicAction<TArgs extends unknown[], TState extends ActionState>(
  reason: string,
  options: { key: string; limit: number; windowSeconds: number },
  handler: (ctx: PublicActionContext, ...args: TArgs) => Promise<TState>,
): (...args: TArgs) => Promise<TState> {
  return async (...args: TArgs) => {
    const session = await getSession();

    /*
     * Định danh người gọi để đếm: đã đăng nhập thì theo user, chưa thì theo IP.
     *
     * IP đọc qua `actionClientIp` — phần tử `X-Forwarded-For` do proxy TIN CẬY
     * thêm vào, không phải phần tử đầu do client tự gửi. Đọc phần tử đầu thì kẻ
     * dội chỉ cần đổi header mỗi request là mỗi lần một xô đếm mới.
     */
    const ip = await actionClientIp();

    const identity = session?.sub ?? `ip:${ip}`;
    const result = await rateLimit(`action:${options.key}:${identity}`, {
      limit: options.limit,
      windowSeconds: options.windowSeconds,
    });

    if (!result.success) {
      logger.warn("Server Action công khai bị chặn vì quá nhiều lần gọi", {
        action: options.key,
        reason,
        identity,
      });
      return denied<TState>("Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại giúp bạn nhé.");
    }

    return handler({ session, actorId: session?.sub ?? null, ip }, ...args);
  };
}

/**
 * Server Action thao tác trên MỘT SÂN cụ thể.
 *
 * ---
 * VÌ SAO CÓ HÀM RIÊNG THAY VÌ TỰ KIỂM TRONG THÂN ACTION
 *
 * `defineAction("booking:cancel", …)` chỉ hỏi "có quyền huỷ booking không" —
 * câu hỏi thiếu vế quan trọng nhất: **huỷ của sân nào**. Bản cũ của dự án chỉ
 * kiểm phạm vi sân ở 2/29 service, nghĩa là nhân viên sân A huỷ được booking
 * sân B nếu tìm đúng endpoint.
 *
 * Ở đây `venueId` là THAM SỐ ĐẦU TIÊN bắt buộc, nên không có cách nào viết một
 * action venue-scoped mà quên kiểm sân — nó sẽ không biên dịch được.
 *
 * ```ts
 * export const cancelBookingAction = defineVenueAction(
 *   "booking:cancel",
 *   async (ctx, bookingId: string) => { … },   // ctx.venueId đã được kiểm
 * );
 * // Gọi: cancelBookingAction(venueId, bookingId)
 * ```
 */
export function defineVenueAction<TArgs extends unknown[], TState extends ActionState>(
  permission: Permission,
  handler: (ctx: VenueActionContext, ...args: TArgs) => Promise<TState>,
): (venueId: string, ...args: TArgs) => Promise<TState> {
  return async (venueId: string, ...args: TArgs) => {
    const session = await getSession();

    if (!session) {
      return denied<TState>("Bạn cần đăng nhập để thực hiện thao tác này.");
    }

    if (!(await permissionService.canOnVenue(session.sub, permission, venueId))) {
      // Ghi log MỌI lần bị từ chối kèm `venueId`: một người có quyền ở sân này
      // gõ cửa sân khác là tín hiệu đáng chú ý hơn hẳn thiếu quyền thông thường.
      logger.warn("Server Action bị từ chối vì thiếu quyền trên sân", {
        userId: session.sub,
        venueId,
        permission,
      });
      return denied<TState>("Bạn không có quyền thực hiện thao tác này trên sân này.");
    }

    return handler({ session, actorId: session.sub, venueId }, ...args);
  };
}
