import { clientIp, requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Mở khoá sớm — xoá `lockedUntil` do brute-force thay vì đợi tự hết hạn.
 *
 * `actorId` bắt buộc: mở khoá tạm cũng là thao tác lên tài khoản người khác,
 * chịu cùng chốt bậc vai trò — ADMIN không gỡ được lệnh khoá tạm đang bảo vệ
 * tài khoản SUPER_ADMIN khỏi một đợt dò mật khẩu.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:update");

    const user = await userService.unlock(id, { actorId: session.sub });

    await auditService.record({
      action: AUDIT_ACTIONS.USER_UNLOCKED,
      entity: "user",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { surface: "api" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/users/[id]/unlock", request });
  }
}
