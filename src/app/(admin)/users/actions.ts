"use server";
import { DomainError, DuplicateFieldError } from "@/lib/errors";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClientIp, defineAction } from "@/lib/define-action";
import { formErrorMap } from "@/lib/form-errors";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import {
  createUserSchema,
  setUserStatusSchema,
  type SetUserStatusInput,
} from "@/schemas/user.schema";
import { userService } from "@/services/user.service";

/**
 * Mỗi Server Action là một HTTP endpoint công khai.
 *
 * Việc trang gọi nó nằm sau proxy KHÔNG bảo vệ được action: ai cũng POST thẳng
 * tới action id được, không cần đi qua trang. Vì vậy mọi action ở đây tự kiểm
 * quyền, không tin vào bất cứ lớp nào phía trên.
 *
 * `defineAction` biến luật đó thành ràng buộc kiểu — quyền là tham số bắt
 * buộc. Xem `src/lib/define-action.ts`.
 *
 * ---
 * ĐỔI TỪ "role === ADMIN" SANG KIỂM THEO QUYỀN
 *
 * Bản trước dùng `denyIfNotAdmin()`, tức là gắn cứng vào vai trò ADMIN. Điều
 * đó mâu thuẫn với chính tính năng của dự án: quản trị viên tạo được vai trò
 * mới lúc chạy và tick quyền `user:create` cho nó, nhưng action vẫn chặn vì
 * vai trò đó không tên là ADMIN. Người dùng thấy nút, bấm vào, và bị từ chối —
 * không hiểu vì sao.
 *
 * Kiểm theo quyền thì bảng phân quyền trên `/roles` mới thật sự có tác dụng.
 */

export type CreateUserState = {
  error?: string;
  /**
   * Khoá phải trùng tên trường trong `createUserSchema` — đó vừa là thứ
   * `z.flattenError` trả về, vừa là `name=` của các ô trong form. Union cũ còn
   * ghi `name`/`role`, hai trường không tồn tại trong schema, nên lỗi trả về
   * không bao giờ tìm được ô để hiển thị.
   */
  fieldErrors?: Partial<Record<"email" | "username" | "fullName" | "password", string[]>>;
  /**
   * Chữ vừa gõ, trả lại KÈM LỖI — React 19 xoá trắng form sau action kể cả khi
   * báo lỗi; quản trị viên gõ trùng tên đăng nhập không phải gõ lại cả ba ô.
   */
  values?: { email: string; fullName: string; username: string };
};

/** Tên ô người dùng nhìn thấy trên form — để câu lỗi nói đúng ô nào sai. */
const USER_FIELD_LABELS = {
  email: "Email",
  fullName: "Họ và tên",
  username: "Tên đăng nhập",
} as const;

/** Nhãn tiếng Việt của trạng thái — cho câu lỗi, không cho logic. */
const STATUS_LABEL = { ACTIVE: "Hoạt động", INACTIVE: "Tạm ngưng", BANNED: "Khoá" } as const;

export const createUserAction = defineAction(
  "user:create",
  async (ctx, _prevState: CreateUserState, formData: FormData): Promise<CreateUserState> => {
    // `roleKey` cố ý KHÔNG đọc từ formData. Nếu đọc, bất kỳ ai gửi được form
    // cũng tự phong mình làm ADMIN — leo thang đặc quyền chỉ bằng một field ẩn.
    // Muốn gán vai trò thì đi qua REST API, nơi người gọi được xác thực bằng
    // token chứ không phải bằng nội dung form.
    //
    // Tên trường phải là `fullName`, không phải `name`: Zod strip im lặng khoá
    // lạ, nên gửi sai tên không hề báo lỗi — parse vẫn thành công, chỉ có dữ
    // liệu người dùng vừa nhập là biến mất trước khi tới database.
    const text = (key: string) => {
      const value = formData.get(key);
      return typeof value === "string" ? value : "";
    };
    const values = { email: text("email"), fullName: text("fullName"), username: text("username") };

    const parsed = createUserSchema.safeParse(
      {
        email: formData.get("email"),
        username: formData.get("username") || undefined,
        fullName: formData.get("fullName") || undefined,
      },
      { error: formErrorMap(USER_FIELD_LABELS) },
    );

    if (!parsed.success) {
      return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
    }

    let created;
    try {
      // `actorId` bắt buộc — form web không gửi vai trò (luôn USER), nhưng chốt
      // bậc vẫn phải chạy đúng người thao tác.
      created = await userService.create(parsed.data, { actorId: ctx.actorId });
    } catch (error) {
      /*
       * `DuplicateFieldError` mang theo TÊN TRƯỜNG bị trùng trong `fields`, nên
       * thông báo hiện ngay dưới đúng ô nhập. Trước đây mỗi trường một lớp lỗi
       * riêng, và thêm một trường unique nghĩa là thêm một nhánh `if` — quên
       * nhánh đó thì admin chỉ nhận được một câu chung chung.
       */
      if (error instanceof DuplicateFieldError) {
        return { fieldErrors: error.fields, error: error.message, values };
      }
      if (error instanceof DomainError) return { error: error.message, values };
      logger.error("Create user failed", error, { email: parsed.data.email });
      return { error: "Không thể tạo người dùng lúc này. Vui lòng thử lại.", values };
    }

    await auditService.record({
      action: AUDIT_ACTIONS.USER_CREATED,
      entity: "user",
      entityId: created.id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      // Ghi email của tài khoản MỚI để sau này tra được, nhưng không ghi mật
      // khẩu hay bất cứ thứ gì nhạy cảm.
      metadata: { email: created.email, surface: "web" },
      ip: await actionClientIp(),
    });

    revalidatePath("/users");
    return {};
  },
);

/**
 * Khoá / mở khoá tài khoản.
 *
 * Nút gửi `{ status }` — nên parse bằng `setUserStatusSchema` (object). Lỗi thật
 * trước đây: action parse bằng `userStatusSchema` (enum, chỉ nhận CHUỖI), mọi
 * lần bấm đều báo "Trạng thái không hợp lệ" và không ai khoá được ai từ web.
 *
 * Khoá có hiệu lực NGAY: service thu hồi refresh token và xoá ảnh phiên, nên
 * cookie web của người bị khoá bị từ chối ở request kế tiếp.
 */
export const setUserStatusAction = defineAction(
  "user:update",
  async (ctx, id: string, input: SetUserStatusInput): Promise<{ error?: string }> => {
    const parsed = setUserStatusSchema.safeParse(input);
    if (!parsed.success) {
      // Nút trên trang không bao giờ gửi giá trị lạ — tới được đây là trang cũ còn
      // mở trong tab hoặc request tự chế. Nói rõ giá trị nào nhận được và làm gì.
      return {
        error: `Không đổi được trạng thái: chỉ nhận ${Object.values(STATUS_LABEL).join(", ")}. Tải lại trang rồi bấm lại giúp bạn nhé.`,
      };
    }

    let previousStatus;
    try {
      // `ctx.actorId` do defineAction cung cấp — không phải gọi lại getSession
      // rồi xử lý trường hợp null như bản trước (chỗ đó từng truyền chuỗi rỗng
      // khi không có session, khiến luật "không tự khoá mình" hụt).
      ({ previousStatus } = await userService.setStatus(id, parsed.data.status, {
        actorId: ctx.actorId,
      }));
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Set user status failed", error, { targetUserId: id, input });
      return { error: "Không thể đổi trạng thái lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      entity: "user",
      entityId: id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      // `{ from, to }` chứ không phải "banned"/"unbanned": bản cũ ghi đặt
      // INACTIVE thành "user.unbanned" — nhật ký nói ngược sự thật.
      metadata: { from: previousStatus, to: parsed.data.status, surface: "web" },
      ip: await actionClientIp(),
    });

    revalidatePath("/users");
    return {};
  },
);

/** Mở khoá sớm — bỏ qua thời gian còn lại của `lockedUntil` (khoá tự động do brute-force). */
export const unlockUserAction = defineAction(
  "user:update",
  async (ctx, id: string): Promise<{ error?: string }> => {
    try {
      await userService.unlock(id, { actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Unlock user failed", error, { targetUserId: id });
      return { error: "Không thể mở khoá lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: AUDIT_ACTIONS.USER_UNLOCKED,
      entity: "user",
      entityId: id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { surface: "web" },
      ip: await actionClientIp(),
    });

    revalidatePath("/users");
    return {};
  },
);

export const deleteUserAction = defineAction(
  "user:delete",
  async (ctx, id: string): Promise<{ error?: string }> => {
    try {
      // Luật "không tự xoá chính mình" nằm trong service, không nằm ở đây —
      // nếu chép lại tại từng cửa vào thì sớm muộn hai bên cũng lệch nhau.
      await userService.softDelete(id, { actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Delete user failed", error, { targetUserId: id });
      return { error: "Không thể xoá người dùng lúc này. Vui lòng thử lại." };
    }

    await auditService.record({
      action: AUDIT_ACTIONS.USER_DELETED,
      entity: "user",
      entityId: id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { surface: "web" },
      ip: await actionClientIp(),
    });

    revalidatePath("/users");
    return {};
  },
);
