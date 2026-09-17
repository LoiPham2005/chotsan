import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManageNav } from "@/components/manage/manage-nav";
import { VenueReviewPanel, VenueSettings } from "@/components/manage/venue-settings";
import { requireVenueAccess } from "@/lib/auth";
import { BANK_BINS } from "@/lib/vietqr";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Cài đặt sân", robots: { index: false } };

/**
 * Cài đặt cơ sở. Với cơ sở MỚI ĐĂNG KÝ (bản nháp), đây cũng là nơi hoàn tất hồ
 * sơ và gửi duyệt — `/manage/new` chuyển thẳng tới đây sau khi tạo.
 */
export default async function SettingsPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "venue:update");
  const venue = await venueService.forManage(venueId);

  if (!venue) notFound();

  // Danh sách việc cần làm chỉ có nghĩa với bản nháp; đọc riêng để các trạng
  // thái khác không tốn thêm truy vấn đếm.
  const review = venue.status === "DRAFT" ? await venueService.readiness(venueId) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Cài đặt sân
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="settings" />
      </div>

      {["DRAFT", "PENDING", "ADMIN_LOCKED"].includes(venue.status) && (
        <div className="mt-6">
          <VenueReviewPanel
            venueId={venueId}
            status={venue.status}
            inactiveNote={venue.inactiveNote}
            items={review?.items ?? []}
            ready={review?.ready ?? false}
          />
        </div>
      )}

      <div className="mt-6">
        <VenueSettings
          venueId={venueId}
          banks={Object.keys(BANK_BINS)}
          hours={venue.hours}
          venue={{
            name: venue.name,
            description: venue.description,
            address: venue.address,
            ward: venue.ward,
            province: venue.province,
            phone: venue.phone,
            amenities: venue.amenities,
            holdMinutes: venue.holdMinutes,
            freeCancelHours: venue.freeCancelHours,
            cancelFeePercent: venue.cancelFeePercent,
            bankName: venue.bankName,
            bankAccountNumber: venue.bankAccountNumber,
            bankAccountName: venue.bankAccountName,
          }}
        />
      </div>
    </div>
  );
}
