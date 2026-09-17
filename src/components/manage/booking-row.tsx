"use client";

import { createContext, useActionState, useContext, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  cancelBookingAction,
  checkInAction,
  type ManageState,
} from "@/app/(manage)/manage/[venueId]/actions";
import { useActionNotice } from "@/components/booking/action-notice";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { bookingStatusBadge } from "@/lib/booking-status";
import { timeOfDay } from "@/lib/date";
import { formatVnd } from "@/lib/slots";

export type BookingRowData = {
  id: string;
  code: string;
  courtName: string;
  customerName: string;
  customerPhone: string;
  customerNote: string | null;
  startAt: string;
  endAt: string;
  status: string;
  /** Chỗ giữ đã quá hạn mà cron chưa đổi trạng thái — tính ở service. */
  holdExpired: boolean;
  source: string;
  total: number;
};

/**
 * Sân đang xem + quyền thao tác của người đang xem — chung cho mọi dòng.
 *
 * Lấy từ context thay vì truyền xuống từng dòng: một ngày bận có ~200 lượt
 * đặt; truyền cùng một chuỗi vào 200 component là 200 chỗ có thể truyền nhầm
 * sân — mà nhầm sân ở đây nghĩa là huỷ nhầm lượt đặt của sân khác.
 *
 * Quyền do TRANG tính (`canOnVenue`) rồi đưa xuống: nhân viên không có
 * `booking:cancel` mà vẫn thấy nút "Huỷ" là bấm vào chỉ để đọc "không có
 * quyền". Action vẫn tự kiểm lại — đây chỉ là không bày ra thứ không dùng được.
 */
type RowsContext = { venueId: string; canCancel: boolean; canCheckIn: boolean };

const BookingRowsContext = createContext<RowsContext>({
  venueId: "",
  canCancel: false,
  canCheckIn: false,
});

export function BookingRowsProvider({
  children,
  ...value
}: RowsContext & { children: React.ReactNode }) {
  return <BookingRowsContext.Provider value={value}>{children}</BookingRowsContext.Provider>;
}

/**
 * Một dòng lượt đặt trên lịch của chủ sân.
 *
 * ---
 * SỐ ĐIỆN THOẠI LÀ LINK GỌI, KHÔNG PHẢI CHỮ
 *
 * Người trực sân cầm điện thoại. Việc họ làm nhiều nhất với một lượt đặt là
 * gọi cho khách — bắt họ chọn-rồi-chép số là thêm bốn thao tác cho việc xảy ra
 * hàng chục lần mỗi ngày.
 *
 * ---
 * NHÃN TRẠNG THÁI DÙNG CHUNG BỘ CỦA KHÁCH
 *
 * Bản trước có bộ nhãn riêng ("Chờ trả tiền", "Đã trả tiền") khác hẳn chữ khách
 * đọc ("Chờ thanh toán", "Đã xác nhận") — chủ sân và khách nói về cùng một lượt
 * bằng hai tên. Xem `BOOKING_STATUS`.
 */
export function BookingRow({ booking }: { booking: BookingRowData }) {
  const permissions = useContext(BookingRowsContext);
  const status = bookingStatusBadge(booking.status, booking.holdExpired);

  const canCheckIn = permissions.canCheckIn && booking.status === "CONFIRMED";
  const canCancel =
    permissions.canCancel &&
    !booking.holdExpired &&
    ["HOLDING", "CONFIRMED"].includes(booking.status);

  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);

  return (
    <li className="flex flex-col gap-3 rounded-token-lg border border-line bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <div className="w-[104px] shrink-0">
          <p className="text-base font-bold tabular-nums leading-tight text-content">
            {timeOfDay(start)}
          </p>
          <p className="text-xs tabular-nums text-muted">→ {timeOfDay(end)}</p>
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
            className="font-semibold text-brand-text hover:underline"
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
        {/* Điều khách dặn khi đặt — người trực sân phải đọc được ngay trên dòng. */}
        {booking.customerNote && (
          <p className="mt-0.5 text-xs text-muted">
            Khách ghi: <span className="text-content">{booking.customerNote}</span>
          </p>
        )}
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
        <div className="flex min-w-0 flex-wrap gap-2 sm:shrink-0">
          {canCheckIn && <CheckInForm bookingId={booking.id} />}
          {canCancel && (
            <CancelForm
              bookingId={booking.id}
              label={`${timeOfDay(start)}–${timeOfDay(end)} ${booking.courtName} của ${booking.customerName}`}
            />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Bọc action theo sân để câu THÀNH CÔNG đi lên thông báo của trang: nhận sân
 * hay huỷ xong là nút biến mất khỏi dòng (trạng thái đổi), câu nằm cạnh nút sẽ
 * bị gỡ theo. Câu LỖI thì trả về cho dòng tự hiện — dòng còn nguyên.
 */
function useRowAction(
  action: (venueId: string, previous: ManageState, formData: FormData) => Promise<ManageState>,
) {
  const { venueId } = useContext(BookingRowsContext);
  const notify = useActionNotice();

  return useActionState<ManageState, FormData>(async (previous, formData) => {
    const result = await action(venueId, previous, formData);
    if (result.ok) notify(result.ok);
    return result;
  }, {});
}

function CheckInForm({ bookingId }: { bookingId: string }) {
  const [state, action] = useRowAction(checkInAction);

  return (
    <form action={action}>
      <input type="hidden" name="bookingId" value={bookingId} />
      <SubmitButton label="Khách tới" pendingLabel="Đang ghi…" />
      {state.error && <ErrorText>{state.error}</ErrorText>}
    </form>
  );
}

function CancelForm({ bookingId, label }: { bookingId: string; label: string }) {
  const [state, action] = useRowAction(cancelBookingAction);
  // Có kiểm soát: React tự xoá form sau action kể cả khi báo lỗi — lý do vừa
  // gõ không được mất chỉ vì huỷ không thành.
  const [reason, setReason] = useState("");
  const reasonId = `cancel-reason-${bookingId}`;

  return (
    <form action={action} className="max-w-full sm:max-w-sm">
      <input type="hidden" name="bookingId" value={bookingId} />
      <ConfirmButton
        label="Huỷ"
        prompt={`Huỷ lượt ${label}? Chỗ được nhả cho người khác ngay.`}
        confirmLabel="Xác nhận huỷ"
        pendingLabel="Đang huỷ…"
      >
        <label htmlFor={reasonId} className="mb-1 block text-xs text-muted">
          Lý do (khách sẽ đọc — không bắt buộc)
        </label>
        <Input
          id={reasonId}
          name="reason"
          maxLength={300}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ví dụ: sân mất điện"
          className="bg-surface"
        />
      </ConfirmButton>
      {state.error && <ErrorText>{state.error}</ErrorText>}
    </form>
  );
}

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-1 max-w-[14rem] text-xs text-danger-text">
      {children}
    </p>
  );
}
