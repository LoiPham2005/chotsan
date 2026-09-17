"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export type AdminNavItem = {
  href: "/venue-approvals" | "/invoices" | "/users" | "/roles";
  label: string;
};

/**
 * Thanh điều hướng khu quản trị — NỀN TỐI (SKILL.md §2: thanh điều hướng khu
 * `(admin)` nền `#0F172A` để biết ngay đang ở khu khác; vùng nội dung vẫn sáng).
 *
 * Là client component chỉ để đọc `usePathname()`: layout KHÔNG dựng lại khi
 * chuyển giữa các trang con, nên mục "đang mở" tính ở máy chủ sẽ đứng yên ở
 * trang đầu tiên.
 *
 * Điện thoại: một dải cuộn ngang (`min-w-0` + `overflow-x-auto` — thiếu `min-w-0`
 * thì dải đẩy rộng cả trang). Từ `lg`: cột dọc bên trái.
 */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const stripRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  /*
   * Điện thoại: dải cuộn ngang mở ở ĐẦU dải, mục đang mở ("Vai trò & phân quyền")
   * có thể nằm khuất bên phải. Kéo nó vào giữa dải — gán `scrollLeft` thẳng trên
   * dải (không `scrollIntoView`, thứ có thể cuộn cả trang), không `setState`.
   * Đo bằng `getBoundingClientRect`: `offsetLeft` tính theo phần tử định vị gần
   * nhất, không theo dải.
   */
  useEffect(() => {
    const strip = stripRef.current;
    const link = activeRef.current;
    if (!strip || !link || strip.scrollWidth <= strip.clientWidth) return;

    const offset = link.getBoundingClientRect().left - strip.getBoundingClientRect().left;
    strip.scrollLeft += offset - (strip.clientWidth - link.clientWidth) / 2;
  }, [pathname]);

  return (
    <nav
      ref={stripRef}
      aria-label="Khu quản trị"
      className="scrollbar-thin flex min-w-0 gap-1 overflow-x-auto rounded-token-lg bg-admin-nav p-1.5 lg:flex-col lg:overflow-visible"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            ref={active ? activeRef : undefined}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-token-md px-3 text-sm font-semibold transition-colors",
              active ? "bg-surface text-content" : "text-subtle hover:bg-white/10 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
