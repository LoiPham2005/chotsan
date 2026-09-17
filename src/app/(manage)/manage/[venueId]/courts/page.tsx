import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CourtManager } from "@/components/manage/court-manager";
import { Notice } from "@/components/ui/notice";
import { ManageNav } from "@/components/manage/manage-nav";
import { PriceRuleEditor } from "@/components/manage/price-rule-editor";
import { requireVenueAccess } from "@/lib/auth";
import { formatHhMm } from "@/lib/slots";
import { courtService } from "@/services/court.service";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Sân & bảng giá", robots: { index: false } };

const WEEKDAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** "Mọi ngày" hoặc "T2, T3, CN" — `weekdays` đã theo thứ tự Thứ 2 → Chủ nhật. */
function daysText(weekdays: number[]): string {
  return weekdays.length === 7 ? "Mọi ngày" : weekdays.map((day) => WEEKDAY_NAMES[day]).join(", ");
}

/**
 * Sân con và bảng giá — hai thứ phải khai xong thì cơ sở mới mở bán được.
 *
 * Trang mở cho người có `court:read`; ĐIỀU KHIỂN SỬA chỉ hiện khi có đúng quyền
 * của thao tác đó (`court:update`, `pricing:update`) — nhân viên mặc định chỉ
 * xem. Action vẫn tự kiểm lại quyền.
 */
export default async function CourtsPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "court:read");

  const [venue, courts, rules, gaps, canEditCourts, canEditPricing] = await Promise.all([
    venueService.forManage(venueId),
    courtService.listForVenue(venueId),
    courtService.listPriceRules(venueId),
    courtService.pricingGaps(venueId),
    permissionService.canOnVenue(user.id, "court:update", venueId),
    permissionService.canOnVenue(user.id, "pricing:update", venueId),
  ]);

  if (!venue) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Sân &amp; bảng giá
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="courts" />
      </div>

      <div className="mt-6">
        <CourtManager
          venueId={venueId}
          canEdit={canEditCourts}
          courts={courts.map((court) => ({
            id: court.id,
            name: court.name,
            surface: court.surface,
            isIndoor: court.isIndoor,
            isActive: court.isActive,
          }))}
        />
      </div>

      {/* Đỏ nhạt: khung mở cửa mà chưa có giá là khách KHÔNG đặt được — việc phải
          sửa, không phải lời nhắc. Không cam: cam chỉ nói giờ vàng. */}
      {rules.length > 0 && gaps.length > 0 && (
        <Notice
          tone="danger"
          as="section"
          aria-labelledby="pricing-gaps-heading"
          className="mt-8 p-4"
        >
          <h2 id="pricing-gaps-heading" className="font-bold">
            Khung giờ mở cửa chưa có giá
          </h2>
          <p className="mt-1">
            Khách không đặt được các khung dưới đây vì chưa luật giá nào phủ tới. Thêm luật hoặc nới
            giờ của luật có sẵn (tính theo bảng giá ĐÃ LƯU).
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {gaps.map((gap) => (
              <li
                key={`${gap.weekdays.join()}-${gap.startMinute}-${gap.endMinute}-${gap.courtNames?.join() ?? ""}`}
              >
                {daysText(gap.weekdays)} · {formatHhMm(gap.startMinute)}–{formatHhMm(gap.endMinute)}{" "}
                · {gap.courtNames ? gap.courtNames.join(", ") : "mọi sân"}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <PriceRuleEditor
        venueId={venueId}
        canEdit={canEditPricing}
        courts={courts.map((court) => ({ id: court.id, name: court.name }))}
        initial={rules}
      />
    </div>
  );
}
