import { clientIp, requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError } from "@/lib/api/response";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { permissionService } from "@/services/permission.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; permissionKey: string }> };

/**
 * Gỡ ngoại lệ, trả người dùng về đúng quyền của vai trò họ đang mang.
 *
 * Gỡ một lệnh TƯỚC quyền là trả lại quyền đó — nên cũng chịu chốt bậc vai trò
 * (`actorId`). Lỗi thật trước đây: không truyền `actorId`, ADMIN gỡ được lệnh
 * tước đặt trên ADMIN khác hay trên SUPER_ADMIN.
 */
export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id, permissionKey } = await params;
    const session = await requireApiPermission(request, "user:update");
    const key = decodeURIComponent(permissionKey);

    await userService.clearUserPermission(id, key, { actorId: session.sub });

    await auditService.record({
      action: AUDIT_ACTIONS.USER_PERMISSION_OVERRIDDEN,
      entity: "user",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { permission: key, cleared: true },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ permissions: await permissionService.explainFor(id) });
  } catch (error) {
    return handleApiError(error, {
      route: "DELETE /api/v1/users/[id]/permissions/[permissionKey]",
      request,
    });
  }
}
