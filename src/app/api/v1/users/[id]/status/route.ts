import { clientIp, requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { setUserStatusSchema } from "@/schemas/user.schema";
import { auditService } from "@/services/audit.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Khoá/mở khoá thủ công — xem enum `UserStatus`. Khác `POST .../unlock` (khoá tạm tự động). */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:update");
    const body = await parseJsonBody(request, setUserStatusSchema);

    const { user, previousStatus } = await userService.setStatus(id, body.status, {
      actorId: session.sub,
    });

    await auditService.record({
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      entity: "user",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { from: previousStatus, to: body.status, surface: "api" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ user });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/users/[id]/status", request });
  }
}
