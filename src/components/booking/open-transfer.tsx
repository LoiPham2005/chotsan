"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { openTransferAction, type OpenTransferState } from "@/app/(public)/bookings/[code]/actions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/**
 * Nút "Tạo mã chuyển khoản" — khi lần đặt còn lượt chưa có giao dịch sống.
 *
 * Màn thanh toán chỉ ĐỌC: mở trang không ghi gì vào database (trình xem trước
 * link hay bot cũng "mở trang"). Nên khi thiếu giao dịch — chủ sân vừa từ chối
 * lần khai trước, hay mở giao dịch lúc giữ chỗ bị hỏng — khách bấm một lần để
 * tạo lại mã, thay vì trang tự tạo sau lưng họ.
 */
export function OpenTransfer({ code }: { code: string }) {
  const [state, formAction] = useActionState<OpenTransferState, FormData>(openTransferAction, {});

  return (
    <form action={formAction} className="mt-5">
      <input type="hidden" name="code" value={code} />

      {state.error && (
        <Notice tone="danger" role="alert" className="mb-2">
          {state.error}
        </Notice>
      )}

      <SubmitOpenButton />
    </form>
  );
}

function SubmitOpenButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      {pending ? "Đang tạo mã…" : "Tạo mã chuyển khoản"}
    </Button>
  );
}
