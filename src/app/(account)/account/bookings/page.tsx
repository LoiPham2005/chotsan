import type { Metadata } from "next";
import Link from "next/link";
import { BookingCard, type MyBooking } from "@/components/account/booking-card";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { bookingService } from "@/services/booking.service";

export const metadata: Metadata = { title: "Lượt đặt của tôi", robots: { index: false } };

/**
 * Lượt đặt của người đang đăng nhập.
 *
 * "Sắp tới" đứng trước và không gấp lại; "đã qua" xuống dưới. Người dùng vào
 * đây gần như luôn để tra một lượt sắp diễn ra — bắt họ cuộn qua lịch sử là
 * đặt sai thứ tự ưu tiên.
 */
export default async function MyBookingsPage() {
  const user = await requireUser("/account/bookings");
  const { upcoming, past } = await bookingService.listForUser(user.id);

  const toCard = (booking: (typeof upcoming)[number]): MyBooking => ({
    id: booking.id,
    code: booking.code,
    status: booking.status,
    // `Date` không đi qua ranh giới Server → Client được.
    startAt: booking.startAt.toISOString(),
    endAt: booking.endAt.toISOString(),
    total: booking.total,
    courtName: booking.court.name,
    venueSlug: booking.venue.slug,
    venueName: booking.venue.name,
    venueAddress: `${booking.venue.address}, ${booking.venue.ward}, ${booking.venue.province}`,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <h1 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">
        Lượt đặt của tôi
      </h1>

      {upcoming.length === 0 && past.length === 0 ? (
        <div className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-lg font-medium text-content">Bạn chưa đặt sân nào</p>
          <p className="mt-1 text-sm text-muted">Tìm sân gần bạn và đặt trong 30 giây.</p>
          <Button asChild className="mt-5">
            <Link href="/venues">Tìm sân</Link>
          </Button>
        </div>
      ) : (
        <>
          <section className="mt-6" aria-labelledby="sap-toi">
            <h2 id="sap-toi" className="text-lg font-bold text-content">
              Sắp tới
              {upcoming.length > 0 && (
                <span className="ml-2 text-sm font-medium text-muted">({upcoming.length})</span>
              )}
            </h2>

            {upcoming.length === 0 ? (
              <p className="mt-3 rounded-token-lg border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
                Không có lượt nào sắp tới.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {upcoming.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={toCard(booking)}
                    canCancel={["HOLDING", "CONFIRMED"].includes(booking.status)}
                    canReview={false}
                  />
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <section className="mt-8" aria-labelledby="da-qua">
              <h2 id="da-qua" className="text-lg font-bold text-content">
                Đã qua
              </h2>
              <ul className="mt-3 space-y-3">
                {past.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={toCard(booking)}
                    canCancel={false}
                    // Chỉ lượt ĐÃ CHƠI mới đánh giá được, và mỗi lượt một lần.
                    canReview={
                      ["CHECKED_IN", "COMPLETED"].includes(booking.status) && !booking.review
                    }
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
