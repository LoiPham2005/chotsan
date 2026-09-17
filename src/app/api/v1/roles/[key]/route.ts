import { clientIp, requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { updateRoleSchema } from "@/schemas/role.schema";
import { auditService } from "@/services/audit.service";
import { roleService } from "@/services/role.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { key } = await params;
    await requireApiPermission(request, "role:read");

    // Không có thì service ném `RoleNotFoundError` → 404.
    return apiOk({ role: await roleService.findByKey(key) });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/roles/[key]", request });
  }
}

/**
 * Đổi tên/mô tả và/hoặc thay toàn bộ danh sách quyền của vai trò.
 *
 * `permissions` mang ngữ nghĩa THAY THẾ TOÀN BỘ, không phải thêm vào — đó là
 * thứ giao diện tick-chọn cần, vì bỏ tick phải thực sự gỡ được quyền.
 *
 * ⚠️ Đây là endpoint nguy hiểm nhất của hệ thống: ai gọi được nó thì tự cấp
 * cho mình mọi quyền còn lại bằng vài request. Vì vậy nó đứng sau quyền
 * `role:update` riêng, và `actorId` truyền xuống để service áp chốt: không sửa
 * vai trò ngang/trên bậc mình, không thêm quyền mình không có. Lỗi thật trước
 * đây: route không truyền `actorId`, ADMIN tick được quyền của SUPER_ADMIN cho
 * chính vai trò ADMIN.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { key } = await params;
    const session = await requireApiPermission(request, "role:update");

    const body = await parseJsonBody(request, updateRoleSchema);
    const role = await roleService.update(key, body, { actorId: session.sub });

    await auditService.record({
      action: AUDIT_ACTIONS.ROLE_UPDATED,
      entity: "role",
      entityId: key,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { ...body, surface: "api" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ role });
  } catch (error) {
    return handleApiError(error, { route: "PATCH /api/v1/roles/[key]", request });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { key } = await params;
    const session = await requireApiPermission(request, "role:delete");

    // Luật "không xoá vai trò hệ thống", "không xoá vai trò còn người dùng" và
    // chốt bậc vai trò do service giữ; handleApiError đổi chúng thành 409/403.
    await roleService.remove(key, { actorId: session.sub });

    await auditService.record({
      action: AUDIT_ACTIONS.ROLE_DELETED,
      entity: "role",
      entityId: key,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { surface: "api" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ key });
  } catch (error) {
    return handleApiError(error, { route: "DELETE /api/v1/roles/[key]", request });
  }
}
