"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { holdBookingAction, type HoldBookingState } from "@/app/(public)/venues/[slug]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DaySummaryStrip, SlotGrid, type SlotSelection } from "@/components/booking/slot-grid";
import { timeRangeLabel } from "@/lib/date";
import { formatVnd } from "@/lib/slots";
import type { DayAvailability } from "@/services/availability.service";

/**
 * Lưới chọn khung giờ + thanh tóm tắt + form đặt.
 *
 * ---
 * THANH TÓM TẮT DÍNH ĐÁY MÀN HÌNH
 *
 * Trên điện thoại, lưới 10 sân × 34 khung dài hơn màn hình nhiều lần. Nút
 * "Đặt sân" nằm dưới cùng trang thì người dùng chọn xong phải cuộn đi tìm — và
 * trong lúc cuộn thì không còn thấy mình vừa chọn gì. Thanh dính đáy giữ cả
 * hai thứ trước mắt: đã chọn gì, và bấm gì tiếp theo.
 *
 * ---
 * GIÁ HIỂN THỊ Ở ĐÂY LÀ GIÁ TẠM
 *
 * Nó cộng từ dữ liệu lưới mà trình duyệt đang giữ, có thể đã cũ vài phút.
 * Số tiền THẬT do `bookingService.hold()` tính lại ở máy chủ. Hai chỗ không
 * được phép lệch, nên tầng dưới KHÔNG nhận số tiền từ form.
 */
export function SelectAndBook({
  day,
  venueId,
  date,
}: {
  day: DayAvailability;
  venueId: string;
  date: string;
}) {
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const [state, formAction] = useActionState<HoldBookingState, FormData>(holdBookingAction, {});

  const court = selection
    ? day.courts.find((court) => court.courtId === selection.courtId)
    : undefined;

  const estimate = selection
    ? (court?.slots ?? [])
        .filter((slot) => slot.minute >= selection.startMinute && slot.minute < selection.endMinute)
        .reduce((sum, slot) => sum + slot.price, 0)
    : 0;

  return (
    <>
      <DaySummaryStrip day={day} className="mb-3" />

      <SlotGrid day={day} onSelect={setSelection} />

      {state.error && (
        <p role="alert" className="alert alert-danger mt-3">
          {state.error}
        </p>
      )}

      {selection && (
        <form
          action={formAction}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur sm:static sm:mt-4 sm:rounded-token-lg sm:border sm:shadow-none"
        >
          <input type="hidden" name="venueId" value={venueId} />
          <input type="hidden" name="courtId" value={selection.courtId} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="startMinute" value={selection.startMinute} />
          <input type="hidden" name="endMinute" value={selection.endMinute} />

          <div className="mx-auto max-w-3xl">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-semibold text-content">
                {court?.courtName} · {timeRangeLabel(selection.startMinute, selection.endMinute)}
              </p>
              <p className="text-lg font-bold text-brand">{formatVnd(estimate)}</p>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="customerName" className="sr-only">
                  Tên của bạn
                </label>
                <Input
                  id="customerName"
                  name="customerName"
                  placeholder="Tên của bạn"
                  required
                  maxLength={80}
                  autoComplete="name"
                  aria-describedby={state.fields?.customerName ? "failed-ten" : undefined}
                />
                {state.fields?.customerName && (
                  <p id="failed-ten" className="mt-1 text-xs text-danger">
                    {state.fields.customerName[0]}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="customerPhone" className="sr-only">
                  Số điện thoại
                </label>
                <Input
                  id="customerPhone"
                  name="customerPhone"
                  type="tel"
                  inputMode="numeric"
                  placeholder="Số điện thoại"
                  required
                  autoComplete="tel"
                  aria-describedby={state.fields?.customerPhone ? "failed-sdt" : undefined}
                />
                {state.fields?.customerPhone && (
                  <p id="failed-sdt" className="mt-1 text-xs text-danger">
                    {state.fields.customerPhone[0]}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelection(null)}
                className="shrink-0"
              >
                Bỏ chọn
              </Button>
              <SubmitBookingButton />
            </div>

            <p className="mt-2 text-center text-xs text-muted">
              Chỗ được giữ 10 phút để bạn thanh toán. Chưa trừ tiền ở bước này.
            </p>
          </div>
        </form>
      )}

      {/* Chừa chỗ cho thanh dính đáy, nếu không nó che mất hàng cuối của lưới. */}
      {selection && <div className="h-64 sm:hidden" aria-hidden />}
    </>
  );
}

/**
 * Nút gửi tách riêng vì `useFormStatus` chỉ đọc được trạng thái khi nó nằm
 * TRONG `<form>` — gọi ở component chứa form thì luôn trả `pending: false`.
 */
function SubmitBookingButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="flex-1">
      {pending ? "Đang giữ chỗ…" : "Đặt sân"}
    </Button>
  );
}
