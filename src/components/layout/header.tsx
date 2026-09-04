import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { apiPath } from "@/lib/api/version";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";

/**
 * Thanh điều hướng.
 *
 * Dùng token màu của dự án (`surface`, `line`, `muted`) thay cho cặp nền-trắng
 * kèm biến thể `dark:` như trước. Nhánh `dark:` đó không bao giờ được kích hoạt
 * — không chỗ nào đặt class `dark` lên `<html>` — nên header hiện màu trắng đè
 * lên nền tối của toàn trang.
 */
/** Các trang trong khu quản trị. Union để `typedRoutes` bắt lỗi đường dẫn sai. */
type AdminRoute = "/venue-approvals" | "/users" | "/roles";

export async function Header() {
  const user = await getCurrentUser();

  // Chỉ hiện mục quản trị cho người thật sự vào được. Link dẫn tới trang 404
  // không phải "bảo mật kém" (trang vẫn tự kiểm quyền), nhưng là giao diện tệ:
  // người dùng bấm vào thứ trông như dùng được rồi nhận trang không tìm thấy.
  // `can()` nhận USER ID, không phải tên vai trò. Trước đây chỗ này truyền
  // `user.roles.join(", ")` — một chuỗi không khớp id nào, nên câu hỏi luôn trả
  // false và mục quản trị KHÔNG BAO GIỜ hiện với ai, kể cả SUPER_ADMIN.
  const [canSeeUsers, canSeeRoles, canApproveVenues, venues] = user
    ? await Promise.all([
        permissionService.can(user.id, "user:read"),
        permissionService.can(user.id, "role:read"),
        permissionService.can(user.id, "venue:approve"),
        venueService.listForUser(user.id),
      ])
    : [false, false, false, []];

  const adminEntry: AdminRoute | null = canApproveVenues
    ? "/venue-approvals"
    : canSeeUsers
      ? "/users"
      : canSeeRoles
        ? "/roles"
        : null;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8">
        {/* Khoảng cách hẹp lại trên điện thoại: ở 390px, `gap-8` + `gap-3` làm
            header rộng 409px và đẩy tràn CẢ TRANG sang ngang. */}
        <div className="flex items-center gap-2 sm:gap-8">
          <Logo />

          {/*
            "Tìm sân" hiện ở MỌI khổ màn, kể cả điện thoại — đó là việc duy
            nhất người mở app muốn làm, giấu nó sau menu ba gạch là chặn đúng
            đường đi chính.
          */}
          <nav className="flex items-center gap-1">
            <NavLink href="/venues">Tìm sân</NavLink>

            {/* Chỉ hiện với người thật sự quản lý sân — bày mục dẫn tới trang
                trống là hứa một thứ không có. */}
            {venues.length > 0 && <NavLink href="/manage">Quản lý sân</NavLink>}
            {user && <NavLink href="/account/bookings">Lượt đặt</NavLink>}

            {/*
              MỘT lối vào khu quản trị, không liệt kê từng trang ở đây — việc đó
              do sidebar trong `(admin)/layout.tsx` lo. Bày cả hai chỗ cùng một
              danh sách chỉ tạo ra hai nơi phải sửa mỗi lần thêm trang.

              Trỏ tới trang ĐẦU TIÊN người này thật sự vào được: một người chỉ
              có `role:read` mà bị dẫn tới `/users` sẽ nhận 404 ngay ở cú bấm
              đầu tiên.
            */}
            {adminEntry && <NavLink href={adminEntry}>Quản trị</NavLink>}
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          {user ? (
            <>
              {/* Tên người dùng dẫn thẳng tới màn quản lý thiết bị — đó là
                  chỗ người ta tìm khi nghi ngờ tài khoản bị đăng nhập lạ. */}
              <Link
                href="/sessions"
                className="hidden text-sm text-muted transition-colors hover:text-content sm:inline"
              >
                {user.fullName ?? user.email}
              </Link>
              <form action={apiPath("/auth/logout")} method="POST">
                <Button size="sm" variant="outline" type="submit">
                  Đăng xuất
                </Button>
              </form>
            </>
          ) : (
            <>
              {/* `px-2` ở khổ nhỏ nhất: ở 360px (iPhone SE và nhiều máy
                  Android) đệm mặc định làm header rộng hơn màn hình và đẩy
                  tràn ngang cả trang. */}
              <Button asChild size="sm" variant="ghost" className="px-2 sm:px-3">
                <Link href="/login">Đăng nhập</Link>
              </Button>
              <Button asChild size="sm" className="px-2 sm:px-3">
                <Link href="/register">Đăng ký</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href:
    "/" | "/venues" | "/manage" | "/account/bookings" | "/venue-approvals" | "/users" | "/roles";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-token-md px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-elevated hover:text-content sm:px-3"
    >
      {children}
    </Link>
  );
}
