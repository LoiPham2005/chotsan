"use client";

import { useActionState } from "react";
import Link from "next/link";
import { cancelOwnBookingAction, type CancelState } from "@/app/(account)/account/bookings/actions";
import { ReviewForm } from "@/components/account/review-form";
import { useActionNotice } from "@/components/booking/action-notice";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { bookingStatusBadge } from "@/lib/booking-status";
import { fullDateLabel, timeOfDay } from "@/lib/date";
import { formatVnd } from "@/lib/slots";

export type MyBooking = {
  id: string;
  code: string;
  /** Mã của lần đặt chung (đặt nhiều sân một lần). `null` = lượt đứng riêng. */
  checkoutCode: string | null;
  status: string;
  /** Chỗ giữ đã quá hạn mà cron chưa đổi trạng thái — tính ở service. */
  holdExpired: boolean;
  startAt: string;
  endAt: string;
  total: number;
  courtName: string;
  venueSlug: string;
  venueName: string;
  venueAddress: string;
};

/**
 * Một lượt đặt trong màn "Lượt đặt của tôi".
 *
 * ---
 * MÃ ĐẶT SÂN LÀ THỨ QUAN TRỌNG NHẤT TRÊN THẺ NÀY
 *
 * Khách tới sân rồi đọc mã đó — đó là toàn bộ việc họ làm với thẻ này. Nên mã
 * đứng riêng một khối, cỡ chữ lớn, kiểu chữ đơn cách để không lẫn 0 với O lúc
 * đọc to cho nhân viên.
 *
 * ---
 * HUỶ CÓ BƯỚC XÁC NHẬN, CÂU KẾT QUẢ ĐI LÊN THÔNG BÁO CỦA TRANG
 *
 * Huỷ là không lấy lại được (chỗ nhả cho người khác ngay), nên bấm lần đầu chỉ
 * mở bước xác nhận. Huỷ xong thì thẻ chuyển từ "Sắp tới" xuống "Đã qua" — một
 * component KHÁC — nên câu "đã huỷ, hoàn bao nhiêu" phải nằm ở thông báo của
 * trang (`ActionNoticeProvider`), không nằm trong thẻ sắp bị gỡ.
 */
export function BookingCard({
  booking,
  canCancel,
  canReview,
}: {
  booking: MyBooking;
  canCancel: boolean;
  canReview: boolean;
}) {
  const notify = useActionNotice();
  const [state, action] = useActionState<CancelState, FormData>(async (previous, formData) => {
    const result = await cancelOwnBookingAction(previous, formData);
    if (result.ok) notify(result.ok);
    return result;
  }, {});

  const status = bookingStatusBadge(booking.status, booking.holdExpired);
  const faded =
    booking.holdExpired ||
    ["CANCELLED", "EXPIRED", "COMPLETED", "NO_SHOW"].includes(booking.status);
  const payable = booking.status === "HOLDING" && !booking.holdExpired;

  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);

  return (
    <li
      className={`rounded-token-lg border border-line bg-surface p-4 ${faded ? "opacity-75" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/venues/${booking.venueSlug}`}
            className="font-semibold text-content hover:text-brand-text hover:underline"
          >
            {booking.venueName}
          </Link>
          <p className="truncate text-sm text-muted">{booking.venueAddress}</p>
        </div>

        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${status.className}`}
        >
          {status.text}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
        <div>
          <p className="text-sm text-muted">{fullDateLabel(start)}</p>
          <p className="text-lg font-bold tabular-nums text-content">
            {timeOfDay(start)} – {timeOfDay(end)}
            <span className="ml-2 text-sm font-medium text-muted">{booking.courtName}</span>
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-subtle">Mã đặt sân</p>
          <p className="font-mono text-xl font-bold tracking-widest text-content">{booking.code}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <p className="font-bold tabular-nums text-content">{formatVnd(booking.total)}</p>

        <div className="flex min-w-0 flex-wrap justify-end gap-2">
          {payable && (
            <Button asChild size="sm">
              {/* Đặt nhiều sân một lần thì thanh toán CHUNG — mở màn của cả lần đặt. */}
              <Link href={`/bookings/${booking.checkoutCode ?? booking.code}`}>Thanh toán</Link>
            </Button>
          )}
          {canCancel && (
            <form action={action} className="max-w-full">
              <input type="hidden" name="bookingId" value={booking.id} />
              <ConfirmButton
                label="Huỷ lượt đặt"
                prompt={`Huỷ lượt ${timeOfDay(start)}–${timeOfDay(end)} ở ${booking.courtName}? Chỗ được nhả cho người khác ngay và không lấy lại được.`}
                confirmLabel="Xác nhận huỷ"
                pendingLabel="Đang huỷ…"
              />
            </form>
          )}
          {canReview && <ReviewForm bookingId={booking.id} />}
        </div>
      </div>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {state.error}
        </p>
      )}
    </li>
  );
}
