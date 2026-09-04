"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { cancelOwnBookingAction, type CancelState } from "@/app/(account)/account/bookings/actions";
import { ReviewForm } from "@/components/account/review-form";
import { Button } from "@/components/ui/button";
import { fullDateLabel, timeOfDay } from "@/lib/date";
import { formatVnd } from "@/lib/slots";

const STATUS: Record<string, { text: string; className: string }> = {
  HOLDING: { text: "Chờ thanh toán", className: "bg-peak-tint text-peak-text ring-peak-line" },
  CONFIRMED: { text: "Đã xác nhận", className: "bg-brand-tint text-brand-hover ring-brand-line" },
  CHECKED_IN: { text: "Đã tới sân", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  COMPLETED: { text: "Hoàn tất", className: "bg-elevated text-muted ring-line" },
  CANCELLED: { text: "Đã huỷ", className: "bg-elevated text-subtle ring-line" },
  EXPIRED: { text: "Hết hạn giữ chỗ", className: "bg-elevated text-subtle ring-line" },
  NO_SHOW: { text: "Không tới", className: "bg-red-50 text-red-700 ring-red-200" },
};

export type MyBooking = {
  id: string;
  code: string;
  status: string;
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
  const [state, action] = useActionState<CancelState, FormData>(cancelOwnBookingAction, {});
  const status = STATUS[booking.status] ?? {
    text: booking.status,
    className: "bg-elevated text-muted ring-line",
  };

  const past = ["CANCELLED", "EXPIRED", "COMPLETED", "NO_SHOW"].includes(booking.status);

  return (
    <li
      className={`rounded-token-lg border border-line bg-surface p-4 shadow-nang-1 ${past ? "opacity-75" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/venues/${booking.venueSlug}`}
            className="font-semibold text-content hover:text-brand"
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
          <p className="text-sm text-muted">{fullDateLabel(new Date(booking.startAt))}</p>
          <p className="text-lg font-bold tabular-nums text-content">
            {timeOfDay(new Date(booking.startAt))} – {timeOfDay(new Date(booking.endAt))}
            <span className="ml-2 text-sm font-medium text-muted">{booking.courtName}</span>
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-wide text-subtle">Mã đặt sân</p>
          <p className="font-mono text-xl font-bold tracking-widest text-content">{booking.code}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-bold tabular-nums text-content">{formatVnd(booking.total)}</p>

        <div className="flex gap-2">
          {booking.status === "HOLDING" && (
            <Button asChild size="sm">
              <Link href={`/bookings/${booking.code}`}>Thanh toán</Link>
            </Button>
          )}
          {canCancel && (
            <form action={action}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <CancelButton />
            </form>
          )}
          {canReview && <ReviewForm bookingId={booking.id} />}
        </div>
      </div>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mt-2 text-sm font-medium text-brand-hover">
          {state.ok}
        </p>
      )}
    </li>
  );
}

function CancelButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? "Đang huỷ…" : "Huỷ lượt đặt"}
    </Button>
  );
}
