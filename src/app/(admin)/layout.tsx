import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { AdminNav, type AdminNavItem } from "./admin-nav";

/**
 * Khung chung của khu quản trị.
 *
 * ---
 * ⚠️ LAYOUT KHÔNG PHẢI RANH GIỚI BẢO MẬT
 *
 * Đây là điều quan trọng nhất phải nhớ khi sửa file này. `requireUser()` bên
 * dưới CHỈ chặn được người chưa đăng nhập mở TRANG. Nó không chặn được:
 *
 *   - Server Action: mỗi action là một HTTP endpoint công khai, request gửi
 *     thẳng tới action id không hề đi qua layout nào.
 *   - Route handler trong `src/app/api/**`: proxy còn cố tình không chạy ở đó.
 *
 * Vì vậy hai lớp sau vẫn giữ nguyên và KHÔNG được lược bớt:
 *
 *   1. Mỗi trang tự gọi `requirePermission(...)` với đúng quyền của nó —
 *      layout không thể biết `/users` cần `user:read` còn `/roles` cần
 *      `role:read`.
 *   2. Mỗi Server Action tự kiểm quyền. Đây mới là lớp chặn thật.
 *
 * Layout chỉ làm hai việc: bớt lặp phần khung, và lo phần nhìn.
 *
 * ---
 * KHUNG TRANG DO LAYOUT LO
 *
 * Lề và độ rộng tối đa đặt MỘT lần ở đây; trang con không tự bọc
 * `mx-auto px-4 py-6` nữa (trước đây hai lớp đệm chồng nhau). Và không có
 * `<main>` ở đây — layout gốc đã có đúng một `<main>` cho mọi trang.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Chưa đăng nhập thì đá về /login kèm ?next=<ĐÚNG trang đang mở> — không
  // truyền đường dẫn nào: `requireUser` đọc nó từ header proxy gắn. Bản cũ viết
  // cứng `/users`, nên người mở `/invoices` đăng nhập xong bị đưa sang trang
  // khác (và thường là 404). Kiểm tra QUYỀN vẫn nằm ở từng trang.
  const user = await requireUser();

  // MỘT lần đọc tập quyền (có cache) cho cả bốn mục. `permissionsFor()` nhận
  // USER ID, không phải tên vai trò — truyền `user.roles.join()` là hỏi quyền
  // của một id không tồn tại, thanh điều hướng KHÔNG BAO GIỜ hiện mục nào, kể
  // cả với SUPER_ADMIN. Lỗi đó đã có thật ở đây và ở `header.tsx`.
  const granted = await permissionService.permissionsFor(user.id);
  const canSeeUsers = granted.has("user:read");
  const canSeeRoles = granted.has("role:read");
  const canApproveVenues = granted.has("venue:approve");
  const canSeeInvoices = granted.has("invoice:manage");

  // Người chỉ có quyền duyệt cơ sở vẫn phải vào được khu này.
  if (!canSeeUsers && !canSeeRoles && !canApproveVenues && !canSeeInvoices) {
    notFound();
  }

  const items: (AdminNavItem & { visible: boolean })[] = [
    { href: "/venue-approvals", label: "Duyệt cơ sở", visible: canApproveVenues },
    { href: "/invoices", label: "Hoá đơn hoa hồng", visible: canSeeInvoices },
    { href: "/users", label: "Người dùng", visible: canSeeUsers },
    { href: "/roles", label: "Vai trò & phân quyền", visible: canSeeRoles },
  ];

  const visibleItems = items
    .filter((item) => item.visible)
    .map(({ href, label }) => ({ href, label }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:flex-row lg:gap-8 lg:px-8">
      {/*
        Chỉ dựng thanh điều hướng khi có từ 2 mục trở lên. Một menu chỉ có đúng
        một dòng không giúp điều hướng gì cả, nó chỉ lấy mất chỗ của nội dung.
      */}
      {visibleItems.length > 1 && (
        <aside className="min-w-0 lg:w-56 lg:shrink-0">
          <AdminNav items={visibleItems} />
        </aside>
      )}

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
