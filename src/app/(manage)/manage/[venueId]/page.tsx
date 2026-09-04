import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateStrip } from "@/components/booking/date-strip";
import { BookingRow, VenueIdProvider } from "@/components/manage/booking-row";
import { ManageNav } from "@/components/manage/manage-nav";
import { fullDateLabel, parseDateKey } from "@/lib/date";
import { requireVenueAccess } from "@/lib/auth";
import { formatVnd } from "@/lib/slots";
import { bookingService } from "@/services/booking.service";
import { courtService } from "@/services/court.service";
import { paymentService } from "@/services/payment.service";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Lịch sân", robots: { index: false } };

/** Lượt đặt đã bị huỷ/hết hạn — vẫn hiện, nhưng xếp cuối và mờ đi. */
const DEAD = ["CANCELLED", "EXPIRED"];

/**
 * Lịch trong ngày của một cơ sở — màn chủ sân mở nhiều nhất.
 *
 * ---
 * DÒNG THEO GIỜ, KHÔNG PHẢI LƯỚI
 *
 * Lưới sân × khung giờ là để KHÁCH tìm chỗ trống. Chủ sân hỏi câu khác: "sắp
 * tới ai đến, đã trả tiền chưa, gọi số nào". Câu đó trả lời bằng một danh sách
 * xếp theo giờ — mắt chạy dọc một cột thay vì quét cả mặt phẳng.
 */
export default async function VenueSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ venueId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ venueId }, query] = await Promise.all([params, searchParams]);
  const user = await requireVenueAccess(venueId, "booking:read");

  const date = parseDateKey(query.date);

  const [venue, bookings, courts, canSeeMoney] = await Promise.all([
    venueService.forManage(venueId),
    bookingService.listForVenueDay(venueId, date),
    courtService.listForVenue(venueId),
    permissionService.canOnVenue(user.id, "payment:confirm", venueId),
  ]);

  if (!venue) notFound();

  const pending = canSeeMoney ? await paymentService.pendingApprovals(venueId) : [];

  const courtName = new Map(courts.map((court) => [court.id, court.name]));

  // Huỷ/hết hạn xuống cuối: chúng vẫn cần tra được, nhưng không phải thứ người
  // trực sân đang tìm.
  const sorted = [...bookings].sort((a, b) => {
    const aDead = DEAD.includes(a.status) ? 1 : 0;
    const bDead = DEAD.includes(b.status) ? 1 : 0;
    return aDead - bDead || a.startAt.getTime() - b.startAt.getTime();
  });

  const live = sorted.filter((booking) => !DEAD.includes(booking.status));
  const revenue = live.reduce((sum, booking) => sum + booking.total, 0);
  const unpaid = live.filter((booking) => booking.status === "HOLDING").length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link href="/manage" className="text-sm font-medium text-muted hover:text-content">
          ← Sân của bạn
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          {venue.name}
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="schedule" />
      </div>

      {pending.length > 0 && (
        <Link
          href={`/manage/${venueId}/payments`}
          className="mt-4 flex items-center justify-between gap-3 rounded-token-lg border border-peak-line bg-peak-tint p-3 transition hover:shadow-nang-1"
        >
          <p className="text-sm font-semibold text-peak-text">
            {pending.length} khách báo đã chuyển khoản, đang chờ bạn đối chiếu
          </p>
          <span className="shrink-0 text-sm font-bold text-peak-text" aria-hidden>
            →
          </span>
        </Link>
      )}

      <div className="mt-5">
        <DateStrip basePath={`/manage/${venueId}`} selected={date} dayCount={14} />
      </div>

      <section className="mt-4" aria-labelledby="lich">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="lich" className="text-lg font-bold text-content">
            {fullDateLabel(date)}
          </h2>

          <p className="text-sm text-muted">
            {live.length} lượt
            {unpaid > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-peak-text">{unpaid} chưa trả tiền</span>
              </>
            )}
            {" · "}
            <span className="font-semibold text-content">{formatVnd(revenue)}</span>
          </p>
        </div>

        {sorted.length === 0 ? (
          <p className="mt-4 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center text-muted">
            Chưa có lượt đặt nào cho ngày này.
          </p>
        ) : (
          <VenueIdProvider venueId={venueId}>
            <ul className="mt-3 space-y-2">
              {sorted.map((booking) => (
                <BookingRow
                  key={booking.id}
                  booking={{
                    id: booking.id,
                    code: booking.code,
                    courtName: courtName.get(booking.courtId) ?? "—",
                    customerName: booking.customerName,
                    customerPhone: booking.customerPhone,
                    // `Date` không đi qua ranh giới Server → Client được, đổi
                    // sang chuỗi ISO ngay tại đây.
                    startAt: booking.startAt.toISOString(),
                    endAt: booking.endAt.toISOString(),
                    status: booking.status,
                    source: booking.source,
                    total: booking.total,
                  }}
                />
              ))}
            </ul>
          </VenueIdProvider>
        )}
      </section>
    </div>
  );
}
