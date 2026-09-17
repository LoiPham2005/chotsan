import { clientIp, requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { PERMISSIONS, PERMISSION_METADATA } from "@/lib/permissions";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { createRoleSchema } from "@/schemas/role.schema";
import { auditService } from "@/services/audit.service";
import { roleService } from "@/services/role.service";

export const dynamic = "force-dynamic";

/**
 * Danh sách vai trò kèm bảng phân quyền.
 *
 * Trả kèm cả DANH MỤC quyền tồn tại (`permissions`), không chỉ những quyền đã
 * được gán. Giao diện phân quyền cần biết đầy đủ các ô tick có thể có; nếu chỉ
 * trả về quyền đã gán thì không có cách nào dựng được ô cho quyền chưa gán.
 *
 * Danh mục này đến từ code chứ không phải database — xem `src/lib/permissions.ts`.
 * Mỗi quyền CÙNG hình dạng với `GET /permissions` (`key`, `name`, `category`,
 * `description` là chuỗi) — bản cũ trả cả object metadata vào `description`.
 */
export async function GET(request: Request) {
  try {
    await requireApiPermission(request, "role:read");

    const roles = await roleService.list();

    return apiOk({
      roles,
      permissions: PERMISSIONS.map((key) => ({ key, ...PERMISSION_METADATA[key] })),
    });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/roles", request });
  }
}

/**
 * Tạo vai trò. Chốt ở service (nhờ `actorId`): không tạo vai trò ngang/trên bậc
 * mình, không đưa vào quyền mà chính mình không có.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "role:create");

    const body = await parseJsonBody(request, createRoleSchema);
    const role = await roleService.create(body, { actorId: session.sub });

    await auditService.record({
      action: AUDIT_ACTIONS.ROLE_CREATED,
      entity: "role",
      entityId: body.key,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { level: body.level, permissions: body.permissions, surface: "api" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ role }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/roles", request });
  }
}
