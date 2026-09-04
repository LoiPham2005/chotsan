"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createReviewAction,
  type ReviewState,
} from "@/app/(account)/account/bookings/review-actions";
import { Button } from "@/components/ui/button";

/**
 * Chấm sao cho một lượt đặt đã chơi.
 *
 * ---
 * SAO LÀ NÚT, KHÔNG PHẢI Ô CHỌN
 *
 * Năm nút cạnh nhau, bấm một cái là xong — thao tác một chạm. Dropdown "chọn
 * 1–5" cũng đúng về dữ liệu nhưng tốn ba chạm, và trên điện thoại thì mở cả một
 * bảng chọn che mất thứ đang đánh giá.
 *
 * Ô nhận xét KHÔNG bắt buộc: phần lớn người ta chỉ muốn chấm sao rồi đi, ép
 * viết là mất luôn cả đánh giá.
 */
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [rating, setRating] = useState(0);
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ReviewState, FormData>(createReviewAction, {});

  if (state.ok) {
    return (
      <p role="status" className="mt-3 text-sm font-medium text-brand-hover">
        {state.ok}
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Đánh giá sân
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="mt-3 w-full rounded-token-md border border-line bg-elevated p-3"
    >
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="rating" value={rating} />

      <fieldset>
        <legend className="text-sm font-semibold text-content">Sân này thế nào?</legend>

        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              aria-label={`${star} sao`}
              aria-pressed={rating === star}
              className="rounded p-1 transition hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-8 w-8 ${star <= rating ? "fill-amber-400" : "fill-slate-200"}`}
                aria-hidden
              >
                <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9L12 2.6Z" />
              </svg>
            </button>
          ))}
        </div>
      </fieldset>

      <label htmlFor={`cmt-${bookingId}`} className="mt-3 block text-sm text-muted">
        Nhận xét thêm (không bắt buộc)
      </label>
      <textarea
        id={`cmt-${bookingId}`}
        name="comment"
        rows={2}
        maxLength={1000}
        placeholder="Mặt sân, đèn, chỗ để xe…"
        className="mt-1 w-full rounded-token-md border border-line bg-surface p-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
      />

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <SubmitReview disabled={rating === 0} />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Thôi
        </Button>
      </div>
    </form>
  );
}

function SubmitReview({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? "Đang gửi…" : "Gửi đánh giá"}
    </Button>
  );
}
