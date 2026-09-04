import Link from "next/link";
import { permissionService } from "@/services/permission.service";

/**
 * Điều hướng trong khu quản lý một sân.
 *
 * Chỉ hiện mục người này thật sự vào được. Link dẫn tới trang 404 không phải
 * lỗ hổng (trang tự kiểm quyền), nhưng là giao diện tệ: bày ra thứ trông như
 * dùng được rồi trả về "không tìm thấy".
 */
export async function ManageNav({
  venueId,
  userId,
  active,
}: {
  venueId: string;
  userId: string;
  active: "schedule" | "payments" | "courts" | "staff" | "settings" | "revenue";
}) {
  const [canSeePayments, canSeeCourts, canManageStaff, canEditVenue, canSeeReports] =
    await Promise.all([
      permissionService.canOnVenue(userId, "payment:confirm", venueId),
      permissionService.canOnVenue(userId, "court:read", venueId),
      permissionService.canOnVenue(userId, "member:manage", venueId),
      permissionService.canOnVenue(userId, "venue:update", venueId),
      permissionService.canOnVenue(userId, "report:read", venueId),
    ]);

  const items = [
    { key: "schedule" as const, href: `/manage/${venueId}`, label: "Lịch sân", show: true },
    {
      key: "payments" as const,
      href: `/manage/${venueId}/payments`,
      label: "Chờ duyệt tiền",
      show: canSeePayments,
    },
    {
      key: "courts" as const,
      href: `/manage/${venueId}/courts`,
      label: "Sân & giá",
      show: canSeeCourts,
    },
    {
      key: "revenue" as const,
      href: `/manage/${venueId}/revenue`,
      label: "Doanh thu",
      show: canSeeReports,
    },
    {
      key: "staff" as const,
      href: `/manage/${venueId}/staff`,
      label: "Nhân sự",
      show: canManageStaff,
    },
    {
      key: "settings" as const,
      href: `/manage/${venueId}/settings`,
      label: "Cài đặt sân",
      show: canEditVenue,
    },
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto" aria-label="Khu quản lý">
      {items
        .filter((item) => item.show)
        .map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === active ? "page" : undefined}
            className={`whitespace-nowrap rounded-token-md px-3 py-2 text-sm font-semibold transition-colors ${
              item.key === active
                ? "bg-brand-tint text-brand-hover"
                : "text-muted hover:bg-elevated hover:text-content"
            }`}
          >
            {item.label}
          </Link>
        ))}
    </nav>
  );
}
