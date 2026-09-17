import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionNoticeProvider } from "@/components/booking/action-notice";
import { DateStrip } from "@/components/booking/date-strip";
import { BookingRow, BookingRowsProvider } from "@/components/manage/booking-row";
import { ManageNav } from "@/components/manage/manage-nav";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { dateKey, fullDateLabel, parseDateKey } from "@/lib/date";
import { requireVenueAccess } from "@/lib/auth";
import { formatVnd } from "@/lib/slots";
import { bookingService } from "@/services/booking.service";
import { courtService } from "@/services/court.service";
import { paymentService } from "@/services/payment.service";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = { title: "Lịch sân", robots: { index: false } };

/** Lượt đã chốt tiền — thứ DUY NHẤT được cộng vào tiền của ngày. */
const SOLD = ["CONFIRMED", "CHECKED_IN", "COMPLETED"];

/** Lượt đã huỷ/hết hạn — vẫn hiện để tra, nhưng xếp cuối và mờ đi. */
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
 *
 * ---
 * TIỀN CỦA NGÀY CHỈ CỘNG LƯỢT ĐÃ CHỐT
 *
 * Bản trước cộng cả lượt đang giữ chỗ chưa trả đồng nào — con số lệch với sao
 * kê và với màn doanh thu (chỉ tính lượt đã xác nhận trở lên). Nay "chờ thanh
 * toán" đứng riêng, và chỗ giữ đã QUÁ HẠN không được tính ở đâu cả: lịch trống
 * đã bán lại chỗ đó cho người khác.
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

  // Ngày nào cũng xem được, kể cả ngày đã qua — tra lại ai đã đá hôm qua là việc
  // hằng ngày của người trực sân.
  const date = parseDateKey(query.date);

  const [venue, bookings, courts, canSeeMoney, canCancel, canCheckIn] = await Promise.all([
    venueService.forManage(venueId),
    bookingService.listForVenueDay(venueId, date),
    courtService.listForVenue(venueId),
    permissionService.canOnVenue(user.id, "payment:confirm", venueId),
    permissionService.canOnVenue(user.id, "booking:cancel", venueId),
    permissionService.canOnVenue(user.id, "booking:checkin", venueId),
  ]);

  if (!venue) notFound();

  const pending = canSeeMoney ? await paymentService.pendingApprovals(venueId) : [];

  const courtName = new Map(courts.map((court) => [court.id, court.name]));

  const isDead = (booking: (typeof bookings)[number]) =>
    DEAD.includes(booking.status) || booking.holdExpired;

  // Huỷ/hết hạn xuống cuối: chúng vẫn cần tra được, nhưng không phải thứ người
  // trực sân đang tìm.
  const sorted = [...bookings].sort(
    (a, b) => Number(isDead(a)) - Number(isDead(b)) || a.startAt.getTime() - b.startAt.getTime(),
  );

  const sold = bookings.filter((booking) => SOLD.includes(booking.status));
  const awaitingPayment = bookings.filter(
    (booking) => booking.status === "HOLDING" && !booking.holdExpired,
  );
  const liveCount = bookings.filter((booking) => !isDead(booking)).length;
  const revenue = sold.reduce((sum, booking) => sum + booking.total, 0);
  const awaitingTotal = awaitingPayment.reduce((sum, booking) => sum + booking.total, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        {/* `?all=1`: chủ MỘT cơ sở bấm "/manage" trần sẽ bị chuyển ngược về đúng
            trang này — link quay lại thành vòng lặp. */}
        <Link
          href="/manage?all=1"
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
        >
          ← Sân của bạn
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          {venue.name}
        </h1>
      </header>

      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="schedule" />
      </div>

      {(venue.status === "DRAFT" || venue.status === "PENDING") && (
        // Cơ sở chưa mở bán thì lịch luôn trống — nói lý do và chỉ chỗ làm tiếp,
        // thay vì để chủ sân tưởng không ai đặt.
        <Link
          href={`/manage/${venueId}/settings`}
          className="mt-4 flex items-center justify-between gap-3 rounded-token-lg border border-line bg-surface p-3 transition hover:border-brand"
        >
          <p className="text-sm font-semibold text-content">
            {venue.status === "DRAFT"
              ? "Cơ sở chưa gửi duyệt nên khách chưa đặt được. Hoàn tất hồ sơ và gửi duyệt ở trang Cài đặt."
              : "Cơ sở đang chờ ChốtSân duyệt. Khách đặt được ngay khi hồ sơ được duyệt."}
          </p>
          <span className="shrink-0 text-sm font-bold text-brand-text" aria-hidden>
            →
          </span>
        </Link>
      )}

      {/*
        Việc CẦN LÀM hôm nay — nền xanh nhạt (màu của thứ bấm được, và của tin
        tốt: tiền đã về). KHÔNG cam: cam chỉ nói "giờ vàng, giá cao hơn".
      */}
      {pending.length > 0 && (
        <Link
          href={`/manage/${venueId}/payments`}
          className="mt-4 flex min-h-11 items-center justify-between gap-3 rounded-token-lg border border-brand-line bg-brand-tint p-3 transition-colors hover:border-brand"
        >
          <p className="text-sm font-semibold text-brand-text">
            {pending.length} khách báo đã chuyển khoản, đang chờ bạn đối chiếu
          </p>
          <span className="shrink-0 text-sm font-bold text-brand-text" aria-hidden>
            →
          </span>
        </Link>
      )}

      <div className="mt-5">
        <DateStrip basePath={`/manage/${venueId}`} selected={date} dayCount={14} />
      </div>

      {/*
        Dải ngày chỉ đi TỚI (14 ngày từ hôm nay) — đúng cho khách đặt sân, nhưng
        chủ sân còn cần LÙI lại. Ô chọn ngày là form GET thuần: URL chia sẻ được,
        chạy cả khi JavaScript chưa tải, và không thêm link `?date=` nào vào dải.
      */}
      <form
        method="get"
        action={`/manage/${venueId}`}
        className="mt-2 flex flex-wrap items-end gap-2"
      >
        <label htmlFor="schedule-date" className="sr-only">
          Xem ngày khác
        </label>
        <input
          id="schedule-date"
          type="date"
          name="date"
          defaultValue={dateKey(date)}
          required
          className={cn(fieldClassName, "h-11 w-auto")}
        />
        <Button type="submit" variant="outline">
          Xem ngày này
        </Button>
      </form>

      <section className="mt-4" aria-labelledby="schedule-day">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="schedule-day" className="text-lg font-bold text-content">
            {fullDateLabel(date)}
          </h2>

          <p className="text-sm text-muted">
            {liveCount} lượt
            {awaitingPayment.length > 0 && (
              <>
                {" · "}
                {/* Đỏ như nhãn "Chờ thanh toán" của từng lượt (SKILL.md §2) — cùng
                    một trạng thái, cùng một màu. */}
                <span className="font-semibold text-danger-text">
                  {awaitingPayment.length} chờ thanh toán ({formatVnd(awaitingTotal)})
                </span>
              </>
            )}
            {" · "}
            <span className="font-semibold text-content">{formatVnd(revenue)} đã chốt</span>
          </p>
        </div>

        <ActionNoticeProvider>
          {sorted.length === 0 ? (
            <p className="mt-4 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center text-muted">
              Chưa có lượt đặt nào cho ngày này.
            </p>
          ) : (
            <BookingRowsProvider venueId={venueId} canCancel={canCancel} canCheckIn={canCheckIn}>
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
                      customerNote: booking.customerNote,
                      // `Date` không đi qua ranh giới Server → Client được, đổi
                      // sang chuỗi ISO ngay tại đây.
                      startAt: booking.startAt.toISOString(),
                      endAt: booking.endAt.toISOString(),
                      status: booking.status,
                      holdExpired: booking.holdExpired,
                      source: booking.source,
                      total: booking.total,
                    }}
                  />
                ))}
              </ul>
            </BookingRowsProvider>
          )}
        </ActionNoticeProvider>
      </section>
    </div>
  );
}
