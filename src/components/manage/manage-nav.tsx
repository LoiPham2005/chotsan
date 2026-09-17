import Link from "next/link";
import { permissionService } from "@/services/permission.service";

/**
 * Điều hướng trong khu quản lý một sân.
 *
 * Chỉ hiện mục người này thật sự vào được — mỗi mục hỏi ĐÚNG quyền mà trang
 * đích đòi (`requireVenueAccess` của trang đó). Link dẫn tới trang 404 không phải
 * lỗ hổng (trang tự kiểm quyền), nhưng là giao diện tệ: bày ra thứ trông như
 * dùng được rồi trả về "không tìm thấy".
 *
 * Hỏi quyền MỘT lần (`venuePermissions`) rồi tra tập, thay vì sáu lần
 * `canOnVenue` — thanh này nằm trên mọi trang quản lý sân.
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
  const granted = await permissionService.venuePermissions(userId, venueId);
  const canSeeSchedule = granted.has("booking:read");
  const canSeePayments = granted.has("payment:confirm");
  const canSeeCourts = granted.has("court:read");
  const canManageStaff = granted.has("member:manage");
  const canEditVenue = granted.has("venue:update");
  const canSeeReports = granted.has("report:read");

  const items = [
    {
      key: "schedule" as const,
      href: `/manage/${venueId}`,
      label: "Lịch sân",
      show: canSeeSchedule,
    },
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
    <nav className="scrollbar-thin flex min-w-0 gap-1 overflow-x-auto" aria-label="Khu quản lý">
      {items
        .filter((item) => item.show)
        .map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === active ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-token-md px-3 text-sm font-semibold transition-colors ${
              item.key === active
                ? "bg-brand-tint text-brand-text"
                : "text-muted hover:bg-elevated hover:text-content"
            }`}
          >
            {item.label}
          </Link>
        ))}
    </nav>
  );
}
