"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createReviewAction,
  type ReviewState,
} from "@/app/(account)/account/bookings/review-actions";
import { useActionNotice } from "@/components/booking/action-notice";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { cn } from "@/lib/cn";

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
 *
 * ---
 * CÂU CẢM ƠN ĐI LÊN THÔNG BÁO CỦA TRANG
 *
 * Gửi xong thì lượt đặt đã có đánh giá, trang dựng lại và form này bị gỡ —
 * câu cảm ơn nằm trong form thì biến mất trước khi ai đọc được. Lời nhận xét
 * giữ trong state: React tự xoá form sau action kể cả khi báo lỗi, và viết lại
 * một đoạn nhận xét là lý do đủ để bỏ không đánh giá nữa.
 */
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(false);
  const notify = useActionNotice();
  const [state, action] = useActionState<ReviewState, FormData>(async (previous, formData) => {
    const result = await createReviewAction(previous, formData);
    if (result.ok) notify(result.ok);
    return result;
  }, {});

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
              // 44px mỗi sao (SKILL.md §1, luật 5) — sao 32px + đệm 6px.
              className="rounded-token-control p-1.5 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-8 w-8 ${star <= rating ? "fill-rating" : "fill-line"}`}
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
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Mặt sân, đèn, chỗ để xe…"
        className={cn(fieldClassName, "mt-1 py-2")}
      />

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
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
