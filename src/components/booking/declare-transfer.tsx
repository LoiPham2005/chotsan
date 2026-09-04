"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  declareTransferAction,
  type DeclareTransferState,
} from "@/app/(public)/bookings/[code]/actions";
import { Button } from "@/components/ui/button";

/**
 * Nút "Tôi đã chuyển khoản".
 *
 * Câu chữ nói rõ điều gì XẢY RA TIẾP THEO, không chỉ nói đã bấm: khách vừa
 * chuyển tiền thật, và im lặng ở bước này là lúc họ gọi điện cho sân.
 */
export function DeclareTransfer({ code }: { code: string }) {
  const [state, formAction] = useActionState<DeclareTransferState, FormData>(
    declareTransferAction,
    {},
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="code" value={code} />

      {state.error && (
        <p role="alert" className="alert alert-danger mb-2">
          {state.error}
        </p>
      )}

      <Nut />

      <p className="mt-2 text-center text-xs text-muted">
        Sân sẽ đối chiếu với ngân hàng rồi xác nhận. Bạn nhận được thông báo ngay khi xong.
      </p>
    </form>
  );
}

function Nut() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      {pending ? "Đang gửi…" : "Tôi đã chuyển khoản"}
    </Button>
  );
}
