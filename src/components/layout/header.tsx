import Link from "next/link";
import { logoutAction } from "@/app/logout-action";
import { getCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import type { Permission } from "@/lib/permissions";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";

/** Các trang trong khu quản trị. Union để `typedRoutes` bắt lỗi đường dẫn sai. */
type AdminRoute = "/venue-approvals" | "/invoices" | "/users" | "/roles";

/**
 * Lối vào khu quản trị, xét từ hẹp tới rộng — CÙNG thứ tự với `landingPathFor`
 * và thanh điều hướng của `(admin)/layout.tsx`. Mỗi mục trỏ đúng trang người đó
 * vào được.
 */
const ADMIN_ENTRIES = [
  ["venue:approve", "/venue-approvals"],
  ["invoice:manage", "/invoices"],
  ["user:read", "/users"],
  ["role:read", "/roles"],
] as const satisfies ReadonlyArray<readonly [Permission, AdminRoute]>;

/**
 * Thanh điều hướng.
 *
 * ---
 * ĐIỆN THOẠI: HAI HÀNG, KHÔNG MENU BA GẠCH
 *
 * Đã đo ở 390px: chủ sân có logo + 3 mục + "Đăng xuất" thì trang rộng thêm
 * 101px, quản trị viên 77px — header đẩy tràn ngang CẢ TRANG. Gấp các mục vào
 * menu ba gạch thì hết tràn, nhưng giấu đúng việc làm hằng ngày (SKILL.md §1,
 * luật 2: "không giấu sau dấu ba chấm").
 *
 * Nên khi đã đăng nhập, dưới `md` header tách làm hai hàng:
 *   hàng 1 — logo, tên người dùng, "Đăng xuất" (việc hiếm)
 *   hàng 2 — các mục điều hướng (việc hằng ngày), đủ chỗ cho cả 4 mục; màn hẹp
 *            hơn nữa thì hàng này tự cuộn ngang, mép phải để lộ mục kế tiếp.
 *
 * Cuộn trang xuống thì hàng 1 trôi đi, hàng 2 DÍNH lại ở mép trên (`-top-14`
 * = trừ đúng chiều cao hàng 1): trên điện thoại chỉ tốn 48px cố định thay vì
 * cả header 104px, mà các mục vẫn một chạm là tới.
 *
 * Khách chưa đăng nhập chỉ có "Tìm sân" + hai nút tài khoản — vừa một hàng.
 *
 * Từ `md` (máy tính bảng 834px) trở lên: một hàng. Giữa `md` và `lg` chỗ chỉ
 * đủ cho logo + 4 mục + "Đăng xuất", nên tên người dùng tạm ẩn — nó chỉ là lối
 * tắt tới trang thiết bị, không phải việc hằng ngày.
 */
export async function Header() {
  const user = await getCurrentUser();

  // Chỉ hiện mục quản trị cho người thật sự vào được. Link dẫn tới trang 404
  // không phải "bảo mật kém" (trang vẫn tự kiểm quyền), nhưng là giao diện tệ:
  // người dùng bấm vào thứ trông như dùng được rồi nhận trang không tìm thấy.
  //
  // MỘT lần đọc tập quyền (có cache) cho mọi mục, theo USER ID. Trước đây chỗ
  // này truyền `user.roles.join(", ")` — một chuỗi không khớp id nào, nên mục
  // quản trị KHÔNG BAO GIỜ hiện với ai, kể cả SUPER_ADMIN. Người chỉ có
  // `invoice:manage` cũng từng không thấy mục "Quản trị" vì danh sách thiếu
  // `/invoices`.
  const [granted, venues] = user
    ? await Promise.all([
        permissionService.permissionsFor(user.id),
        venueService.listForUser(user.id),
      ])
    : [new Set<Permission>(), []];

  const adminEntry: AdminRoute | null =
    ADMIN_ENTRIES.find(([permission]) => granted.has(permission))?.[1] ?? null;

  return (
    <header
      className={cn(
        "sticky z-40 w-full border-b border-line bg-canvas/95 backdrop-blur-md",
        user ? "-top-14 md:top-0" : "top-0",
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center gap-x-2 px-4 sm:px-6 md:h-16 md:gap-x-6 lg:px-8",
          user && "flex-wrap md:flex-nowrap",
        )}
      >
        <div className="flex h-14 shrink-0 items-center md:h-auto">
          {/* Khách: logo + "Tìm sân" + hai nút tài khoản chỉ vừa một hàng khi
              bỏ chữ "ChốtSân" dưới 400px — đã đo, 360px (khổ Android phổ biến
              nhất) tràn 25px nếu giữ chữ. */}
          <Logo textFrom={user ? 360 : 400} />
        </div>

        {/*
          "Tìm sân" hiện ở MỌI khổ màn, kể cả điện thoại — đó là việc duy nhất
          người mở app muốn làm, giấu nó sau menu ba gạch là chặn đúng đường đi
          chính.

          `min-w-0` + `overflow-x-auto`: thiếu `min-w-0` thì hàng mục đẩy rộng
          cả trang thay vì tự cuộn (SKILL.md, mục `min-w-0`).
        */}
        <nav
          aria-label="Điều hướng chính"
          className={cn(
            "flex min-w-0 items-center gap-1",
            user &&
              "scrollbar-thin order-last -mx-4 basis-[calc(100%+2rem)] overflow-x-auto px-4 pb-1 sm:-mx-6 sm:basis-[calc(100%+3rem)] sm:px-6 md:order-none md:mx-0 md:shrink-0 md:basis-auto md:overflow-visible md:px-0 md:pb-0",
          )}
        >
          <NavLink href="/venues">Tìm sân</NavLink>

          {/* Chỉ hiện với người thật sự quản lý sân — bày mục dẫn tới trang
              trống là hứa một thứ không có. */}
          {venues.length > 0 && <NavLink href="/manage">Quản lý sân</NavLink>}
          {user && <NavLink href="/account/bookings">Lượt đặt</NavLink>}

          {/*
            MỘT lối vào khu quản trị, không liệt kê từng trang ở đây — việc đó
            do thanh điều hướng trong `(admin)/layout.tsx` lo. Bày cả hai chỗ
            cùng một danh sách chỉ tạo ra hai nơi phải sửa mỗi lần thêm trang.

            Trỏ tới trang ĐẦU TIÊN người này thật sự vào được: một người chỉ
            có `role:read` mà bị dẫn tới `/users` sẽ nhận 404 ngay ở cú bấm
            đầu tiên.
          */}
          {adminEntry && <NavLink href={adminEntry}>Quản trị</NavLink>}
        </nav>

        {/* `basis-0 flex-1`: khối tài khoản CO LẠI (tên cắt bớt) thay vì rớt
            xuống hàng riêng khi tên người dùng dài. */}
        <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1 md:gap-2">
          {user ? (
            <>
              {/* Tên người dùng dẫn thẳng tới màn quản lý thiết bị — đó là
                  chỗ người ta tìm khi nghi ngờ tài khoản bị đăng nhập lạ. Tên
                  dài thì cắt bớt: nó không được đẩy nút "Đăng xuất" ra ngoài
                  màn hình. */}
              <Link
                href="/sessions"
                className="flex min-h-11 min-w-0 items-center rounded-token-control px-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-content md:hidden lg:flex"
              >
                <span className="max-w-[9rem] truncate sm:max-w-[16rem] lg:max-w-[14rem]">
                  {user.fullName ?? user.email}
                </span>
              </Link>
              {/*
                Server Action, KHÔNG phải `/api/v1/auth/logout`. Endpoint đó là
                của mobile: nó đòi body JSON kèm refresh token, còn form HTML
                gửi lên rỗng — kết quả là người dùng nhìn thấy một trang JSON
                báo lỗi và vẫn đang đăng nhập.
              */}
              <form action={logoutAction} className="shrink-0">
                <Button size="sm" variant="outline" type="submit">
                  Đăng xuất
                </Button>
              </form>
            </>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost" className="shrink-0 px-2 sm:px-3">
                <Link href="/login">Đăng nhập</Link>
              </Button>
              <Button asChild size="sm" className="shrink-0 px-2.5 sm:px-3">
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
  href: "/" | "/venues" | "/manage" | "/account/bookings" | AdminRoute;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-token-control px-2.5 text-sm font-semibold text-muted transition-colors hover:bg-elevated hover:text-content sm:px-3"
    >
      {children}
    </Link>
  );
}
