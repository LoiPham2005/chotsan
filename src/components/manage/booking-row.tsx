"use client";

import { createContext, useActionState, useContext } from "react";
import { useFormStatus } from "react-dom";
import {
  cancelBookingAction,
  checkInAction,
  type ManageState,
} from "@/app/(manage)/manage/[venueId]/actions";
import { Button } from "@/components/ui/button";
import { timeOfDay } from "@/lib/date";
import { formatVnd } from "@/lib/slots";

/** Nhãn + màu cho từng trạng thái lượt đặt. Màu KHÔNG mang thông tin một mình. */
const STATUS: Record<string, { text: string; className: string }> = {
  HOLDING: { text: "Chờ trả tiền", className: "bg-peak-tint text-peak-text ring-peak-line" },
  CONFIRMED: { text: "Đã trả tiền", className: "bg-brand-tint text-brand-hover ring-brand-line" },
  CHECKED_IN: { text: "Đã tới sân", className: "bg-sky-50 text-sky-700 ring-sky-200" },
  COMPLETED: { text: "Xong", className: "bg-elevated text-muted ring-line" },
  CANCELLED: { text: "Đã huỷ", className: "bg-elevated text-subtle ring-line" },
  EXPIRED: { text: "Hết hạn giữ", className: "bg-elevated text-subtle ring-line" },
  NO_SHOW: { text: "Không tới", className: "bg-red-50 text-red-700 ring-red-200" },
};

export type BookingRowData = {
  id: string;
  code: string;
  courtName: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  total: number;
};

/**
 * Một dòng lượt đặt trên lịch của chủ sân.
 *
 * ---
 * SỐ ĐIỆN THOẠI LÀ LINK GỌI, KHÔNG PHẢI CHỮ
 *
 * Người trực sân cầm điện thoại. Việc họ làm nhiều nhất với một lượt đặt là
 * gọi cho khách — bắt họ chọn-rồi-chép số là thêm bốn thao tác cho việc xảy ra
 * hàng chục lần mỗi ngày.
 */
/**
 * `venueId` lấy từ context thay vì truyền xuống từng dòng.
 *
 * Một ngày bận có ~200 lượt đặt; truyền cùng một chuỗi vào 200 component là
 * 200 chỗ có thể truyền nhầm sân — mà nhầm sân ở đây nghĩa là huỷ nhầm lượt
 * đặt của sân khác.
 */
const VenueIdContext = createContext<string>("");

export function VenueIdProvider({
  venueId,
  children,
}: {
  venueId: string;
  children: React.ReactNode;
}) {
  return <VenueIdContext.Provider value={venueId}>{children}</VenueIdContext.Provider>;
}

function useVenueId(): string {
  return useContext(VenueIdContext);
}

export function BookingRow({ booking }: { booking: BookingRowData }) {
  const status = STATUS[booking.status] ?? {
    text: booking.status,
    className: "bg-elevated text-muted ring-line",
  };

  const canCheckIn = booking.status === "CONFIRMED";
  const canCancel = ["HOLDING", "CONFIRMED"].includes(booking.status);

  return (
    <li className="flex flex-col gap-3 rounded-token-lg border border-line bg-surface p-3 shadow-nang-1 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <div className="w-[104px] shrink-0">
          <p className="text-base font-bold tabular-nums leading-tight text-content">
            {timeOfDay(new Date(booking.startAt))}
          </p>
          <p className="text-xs tabular-nums text-muted">→ {timeOfDay(new Date(booking.endAt))}</p>
        </div>

        <span className="rounded-token-sm bg-elevated px-2 py-1 text-xs font-bold text-content">
          {booking.courtName}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-content">{booking.customerName}</p>
        <p className="text-sm text-muted">
          <a
            href={`tel:${booking.customerPhone}`}
            className="font-medium text-brand hover:underline"
          >
            {booking.customerPhone}
          </a>
          <span className="mx-1.5 text-subtle" aria-hidden>
            ·
          </span>
          <span className="font-mono text-xs">{booking.code}</span>
          {booking.source === "COUNTER" && (
            <>
              <span className="mx-1.5 text-subtle" aria-hidden>
                ·
              </span>
              <span className="text-xs">tại quầy</span>
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-3 sm:shrink-0">
        <p className="font-bold tabular-nums text-content">{formatVnd(booking.total)}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${status.className}`}
        >
          {status.text}
        </span>
      </div>

      {(canCheckIn || canCancel) && (
        <div className="flex gap-2 sm:shrink-0">
          {canCheckIn && <CheckInForm bookingId={booking.id} />}
          {canCancel && <CancelForm bookingId={booking.id} />}
        </div>
      )}
    </li>
  );
}

function CheckInForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useActionState<ManageState, FormData>(
    // `defineVenueAction` đặt `venueId` làm tham số đầu — `bind` gắn nó vào,
    // để lại đúng chữ ký mà `useActionState` cần.
    checkInAction.bind(null, useVenueId()),
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <SubmitButton label="Khách tới" pendingLabel="Đang ghi…" />
      {state.error && <ErrorText>{state.error}</ErrorText>}
    </form>
  );
}

function CancelForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useActionState<ManageState, FormData>(
    cancelBookingAction.bind(null, useVenueId()),
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <SubmitButton label="Huỷ" pendingLabel="Đang huỷ…" variant="outline" />
      {state.error && <ErrorText>{state.error}</ErrorText>}
      {state.ok && (
        <p role="status" className="mt-1 text-xs text-brand-hover">
          {state.ok}
        </p>
      )}
    </form>
  );
}

function SubmitButton({
  label,
  pendingLabel,
  variant = "default",
}: {
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-1 max-w-[14rem] text-xs text-danger">
      {children}
    </p>
  );
}
