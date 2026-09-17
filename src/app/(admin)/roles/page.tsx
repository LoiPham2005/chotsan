import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS, PERMISSION_METADATA, type Permission } from "@/lib/permissions";
import { permissionService } from "@/services/permission.service";
import { roleService } from "@/services/role.service";
import { RoleCreateForm } from "./role-create-form";
import { RoleDeleteButton } from "./role-delete-button";
import { RolePermissionForm } from "./role-permission-form";

export const metadata: Metadata = { title: "Vai trò & phân quyền" };
export const dynamic = "force-dynamic";

/**
 * Màn hình phân quyền — thứ biến lời hứa "sửa được lúc chạy" thành sự thật.
 *
 * Trước trang này, ba bảng `roles`/`permissions`/`role_permissions` không có
 * đường ghi nào từ ứng dụng: muốn đổi phân quyền phải gõ SQL tay.
 *
 * Danh mục quyền hiển thị ở đây đến từ CODE (`src/lib/permissions.ts`), không
 * phải từ database. Cho phép tạo quyền mới từ giao diện sẽ sinh ra những ô
 * tick không ràng buộc điều gì — người quản trị tưởng đã cấm được, mà không
 * dòng mã nào kiểm tra tới.
 */
export default async function RolesPage() {
  const currentUser = await requirePermission("role:read", "/roles");

  const [roles, canUpdate, canCreate, canDelete] = await Promise.all([
    roleService.list(),
    permissionService.can(currentUser.id, "role:update"),
    permissionService.can(currentUser.id, "role:create"),
    permissionService.can(currentUser.id, "role:delete"),
  ]);

  const options = PERMISSIONS.map((key) => ({
    key,
    description: PERMISSION_METADATA[key].description,
  }));

  return (
    // Lề và khoảng đệm do `(admin)/layout.tsx` lo — trang chỉ giới hạn bề rộng chữ.
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">
        Vai trò &amp; phân quyền
      </h1>
      {/* Quyền tra lại từ database ở mọi request (cache tối đa 60 giây, xoá ngay
          khi lưu) — không nằm trong token, nên không có "vai trò cũ còn sống tới
          khi phiên hết hạn". */}
      <p className="mt-1 text-sm text-muted">
        Thay đổi có hiệu lực ngay với mọi người đang đăng nhập. Bạn chỉ sửa được vai trò có bậc thấp
        hơn bậc của mình, và chỉ cấp được quyền mà chính bạn đang có.
      </p>

      {canCreate && (
        <section
          aria-labelledby="new-role-heading"
          className="mt-6 rounded-token-lg border border-line bg-surface p-4 sm:p-5"
        >
          <h2 id="new-role-heading" className="text-lg font-bold text-content">
            Tạo vai trò mới
          </h2>
          <p className="mb-4 mt-1 text-sm text-muted">
            Vai trò mới bắt đầu KHÔNG có quyền nào — tick quyền cho nó ở danh sách bên dưới.
          </p>
          <RoleCreateForm />
        </section>
      )}

      <div className="mt-6 space-y-4">
        {roles.map((role) => (
          <section
            key={role.key}
            aria-labelledby={`role-${role.key}`}
            className="rounded-token-lg border border-line bg-surface p-4 sm:p-5"
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id={`role-${role.key}`}
                  className="flex flex-wrap items-center gap-2 text-lg font-bold text-content"
                >
                  {role.name}
                  <code className="rounded-token-sm bg-elevated px-1.5 py-0.5 font-mono text-xs font-semibold text-muted">
                    {role.key}
                  </code>
                  {role.isSystem && (
                    <span className="rounded-full bg-elevated px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-line">
                      Hệ thống
                    </span>
                  )}
                </h2>
                {role.description && <p className="mt-1 text-sm text-muted">{role.description}</p>}
                <p className="mt-1 text-xs text-muted">
                  {role.userCount} người dùng · {role.permissions.length}/{PERMISSIONS.length} quyền
                </p>
              </div>

              {/*
                Vai trò hệ thống không hiện nút xoá. Không phải để "làm gọn giao
                diện" — xoá mất ADMIN là khoá cửa cả hệ thống và không còn ai đủ
                quyền tạo lại. Service vẫn chặn lần nữa dù nút có bị gọi thẳng.
              */}
              {canDelete && !role.isSystem && (
                <RoleDeleteButton roleKey={role.key} userCount={role.userCount} />
              )}
            </div>

            <RolePermissionForm
              roleKey={role.key}
              granted={role.permissions as Permission[]}
              options={options}
              disabled={!canUpdate}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
