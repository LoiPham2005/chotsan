"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  declareTransferAction,
  type DeclareTransferState,
} from "@/app/(public)/bookings/[code]/actions";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";

/**
 * Nút "Tôi đã chuyển khoản", kèm ô ghi chú tuỳ chọn cho sân.
 *
 * Câu chữ nói rõ điều gì XẢY RA TIẾP THEO, không chỉ nói đã bấm: khách vừa
 * chuyển tiền thật, và im lặng ở bước này là lúc họ gọi điện cho sân.
 *
 * Ô ghi chú dùng cho những chuyện sân cần biết để đối chiếu ("chuyển từ tài
 * khoản của vợ", "chuyển hai lần") — thiếu nó thì chủ sân không tìm thấy dòng
 * khớp tên và bấm "Không thấy tiền" oan cho khách. Ô có KIỂM SOÁT: React tự
 * xoá form sau action kể cả khi action báo lỗi, và khách không phải gõ lại.
 */
export function DeclareTransfer({ code }: { code: string }) {
  const [state, formAction] = useActionState<DeclareTransferState, FormData>(
    declareTransferAction,
    {},
  );
  const [note, setNote] = useState("");

  return (
    <form action={formAction}>
      <input type="hidden" name="code" value={code} />

      <label htmlFor="transfer-note-input" className="mb-1 block text-sm text-muted">
        Ghi chú cho sân (không bắt buộc)
      </label>
      <textarea
        id="transfer-note-input"
        name="note"
        rows={2}
        maxLength={300}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Ví dụ: chuyển từ tài khoản tên Trần Thị B"
        className={cn(fieldClassName, "mb-3 py-2")}
      />

      {state.error && (
        <Notice tone="danger" role="alert" className="mb-2">
          {state.error}
        </Notice>
      )}

      <SubmitDeclareButton />

      <p className="mt-2 text-center text-xs text-muted">
        Sân sẽ đối chiếu với ngân hàng rồi xác nhận. Bạn nhận được thông báo ngay khi xong.
      </p>
    </form>
  );
}

function SubmitDeclareButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      {pending ? "Đang gửi…" : "Tôi đã chuyển khoản"}
    </Button>
  );
}
