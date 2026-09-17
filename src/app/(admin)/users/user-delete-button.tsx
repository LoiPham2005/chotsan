"use client";

import { useState } from "react";
import { deleteUserAction } from "./actions";
import { ConfirmButton } from "@/components/ui/confirm-button";

/**
 * Xoá (mềm) một tài khoản. Hỏi lại ngay tại dòng, lỗi hiện ngay dưới nút — xem
 * `UserStatusButton` về lý do không dùng `window.confirm`/`window.alert`.
 */
export function UserDeleteButton({ id, email }: { id: string; email: string }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="max-w-full"
      action={async () => {
        setError(null);
        const res = await deleteUserAction(id);
        if (res.error) setError(res.error);
      }}
    >
      <ConfirmButton
        label="Xoá"
        prompt={`Xoá người dùng ${email}? Tài khoản không đăng nhập được nữa và biến khỏi danh sách.`}
        confirmLabel="Xác nhận xoá"
        pendingLabel="Đang xoá…"
        variant="destructive"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}
