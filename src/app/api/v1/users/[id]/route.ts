import { z } from "zod";
import { clientIp, requireApiPermission, requireApiUser } from "@/lib/api/auth";
import { ApiError, apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { permissionService } from "@/services/permission.service";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { updateProfileSchema, updateUserSchema } from "@/schemas/user.schema";
import { auditService } from "@/services/audit.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);

    // Người dùng thường chỉ xem được chính mình; ADMIN xem được tất cả.
    // Đọc được hồ sơ người khác cần quyền `user:read`; hồ sơ của chính mình
    // thì chỉ cần `profile:read:own`. Luật gói trong canActOnResource để không
    // bị chép lại — và chép sai — ở từng route.
    const allowed = await permissionService.canActOnResource(session.sub, id, {
      any: "user:read",
      own: "profile:read:own",
    });

    if (!allowed) {
      throw apiErrors.forbidden();
    }

    const user = await userService.findById(id);
    if (!user) throw apiErrors.notFound("Không tìm thấy người dùng");

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/users/[id]", request });
  }
}

/**
 * Trường KHÔNG tự sửa được qua endpoint này, kèm câu chỉ đúng luồng.
 *
 * Mỗi thứ có chốt riêng mà sửa thẳng ở đây sẽ bỏ qua: email phải xác nhận qua
 * hộp thư MỚI (giữ nguyên dấu "đã xác thực" là mở cửa chiếm tài khoản qua
 * OAuth), số điện thoại phải qua OTP, mật khẩu phải nhập mật khẩu hiện tại.
 * Trả 422 thay vì lặng lẽ bỏ qua: client tưởng đã đổi mà thật ra không.
 */
const SELF_FORBIDDEN_FIELDS: Record<string, string> = {
  email: "Đổi email phải xác nhận qua hộp thư mới: dùng POST /api/v1/auth/change-email.",
  phone:
    "Đổi số điện thoại phải xác thực bằng mã OTP: dùng POST /api/v1/auth/phone/request-otp rồi POST /api/v1/auth/phone/verify.",
  password: "Đổi mật khẩu phải nhập mật khẩu hiện tại: dùng POST /api/v1/auth/change-password.",
  username: "Tên đăng nhập không tự đổi được.",
  status: "Bạn không tự đổi trạng thái tài khoản của mình được.",
  roleKeys: "Bạn không tự đổi vai trò của mình được.",
};

/**
 * Sửa hồ sơ người dùng.
 *
 * ---
 * HAI NHÁNH TÁCH HẲN NHAU
 *
 * • Sửa CHÍNH MÌNH: cần `profile:update:own`, chỉ nhận trường hồ sơ
 *   (`updateProfileSchema`), đi qua `userService.updateProfile`. Không đi qua
 *   `update` vì chốt bậc vai trò ở đó chặn thao tác lên người NGANG bậc —
 *   kể cả chính mình — nên bản cũ trả 403 cho MỌI lần tự sửa.
 * • Sửa NGƯỜI KHÁC: cần `user:update`, đi qua `userService.update` kèm
 *   `actorId` để chốt `Role.level` và "không tự đổi vai trò" chạy.
 *
 * Tách thay vì "bỏ chốt cho trường hợp tự sửa": `updateUserSchema` có email,
 * số điện thoại, trạng thái, vai trò — bỏ chốt là mọi người tự đổi được những
 * thứ đó của chính mình.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiUser(request);

    const raw = await parseJsonBody(request, z.record(z.string(), z.unknown()));
    const userAgent = request.headers.get("user-agent");
    const ip = clientIp(request);

    if (id === session.sub) {
      // `Object.hasOwn`, không phải `in`: `in` thấy cả khoá của prototype, nên
      // body `{ "constructor": 1 }` sẽ bị coi là trường cấm với câu báo là một hàm.
      const forbidden = Object.keys(raw).filter((key) => Object.hasOwn(SELF_FORBIDDEN_FIELDS, key));
      if (forbidden.length > 0) {
        const fields = Object.fromEntries(
          forbidden.map((key) => [key, [SELF_FORBIDDEN_FIELDS[key]!]]),
        );
        throw new ApiError(422, "VALIDATION_ERROR", SELF_FORBIDDEN_FIELDS[forbidden[0]!]!, fields);
      }

      if (!(await permissionService.can(session.sub, "profile:update:own"))) {
        throw apiErrors.forbidden();
      }

      const parsed = updateProfileSchema.safeParse(raw);
      if (!parsed.success) throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);

      const user = await userService.updateProfile(session.sub, parsed.data);

      await auditService.record({
        action: AUDIT_ACTIONS.USER_UPDATED,
        entity: "user",
        entityId: session.sub,
        actorId: session.sub,
        actorEmail: session.email,
        metadata: { self: true, fields: Object.keys(parsed.data) },
        ip,
        userAgent,
      });

      return apiOk({ user });
    }

    if (!(await permissionService.can(session.sub, "user:update"))) throw apiErrors.forbidden();

    const parsed = updateUserSchema.safeParse(raw);
    if (!parsed.success) throw apiErrors.validation(z.flattenError(parsed.error).fieldErrors);

    const user = await userService.update(id, parsed.data, { actorId: session.sub });

    await auditService.record({
      action: AUDIT_ACTIONS.USER_UPDATED,
      entity: "user",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { fields: Object.keys(parsed.data), ...parsed.data },
      ip,
      userAgent,
    });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/users/[id]", request });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:delete");

    // Xoá MỀM. Luật "không tự xoá chính mình" (`SelfActionForbiddenError`, 409)
    // và chốt bậc vai trò do service giữ; service cũng thu hồi mọi refresh token
    // và xoá ảnh phiên, nên cookie/access token đang cầm bị từ chối ngay.
    await userService.softDelete(id, { actorId: session.sub });

    await auditService.record({
      action: AUDIT_ACTIONS.USER_DELETED,
      entity: "user",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { surface: "api" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ id });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/users/[id]", request });
  }
}
