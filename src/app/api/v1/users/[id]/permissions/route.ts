import { clientIp, requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { setUserPermissionSchema } from "@/schemas/user.schema";
import { auditService } from "@/services/audit.service";
import { permissionService } from "@/services/permission.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ngoại lệ quyền cho TỪNG người, đè lên quyền đến từ vai trò.
 *
 * Đây là câu trả lời cho "hai tài khoản cùng vai trò nhưng admin muốn cho một
 * người thêm quyền": không phải tạo vai trò mới cho một người, mà thêm một
 * dòng ngoại lệ.
 *
 * Thứ tự áp dụng: hợp mọi vai trò → cộng phần `isGranted: true` → TRỪ phần
 * `isGranted: false`. Cấm luôn thắng, kể cả khi một vai trò khác đang cho.
 *
 * Chốt ở service: không đụng người ngang/trên bậc mình, và CẤP thì người cấp
 * phải đang có đúng quyền đó (`PermissionNotHeldError`).
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    await requireApiPermission(request, "user:read");

    // `explainFor` nói rõ từng quyền ĐẾN TỪ ĐÂU (vai trò nào, hay ngoại lệ
    // riêng). Màn phân quyền không có thông tin đó thì admin chỉ thấy một danh
    // sách quyền và không hiểu vì sao nó như vậy.
    return apiOk({ permissions: await permissionService.explainFor(id) });
  } catch (error) {
    return handleApiError(error, { route: "GET /api/v1/users/[id]/permissions", request });
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:update");
    const body = await parseJsonBody(request, setUserPermissionSchema);

    await userService.setUserPermission(id, body.permissionKey, body.isGranted, {
      actorId: session.sub,
      expiresAt: body.expiresAt ?? null,
    });

    await auditService.record({
      action: AUDIT_ACTIONS.USER_PERMISSION_OVERRIDDEN,
      entity: "user",
      entityId: id,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: {
        permission: body.permissionKey,
        isGranted: body.isGranted,
        expiresAt: body.expiresAt?.toISOString() ?? null,
      },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    return apiOk({ permissions: await permissionService.explainFor(id) });
  } catch (error) {
    return handleApiError(error, { route: "PUT /api/v1/users/[id]/permissions", request });
  }
}
