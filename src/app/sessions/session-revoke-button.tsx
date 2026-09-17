"use client";

import { useState } from "react";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { revokeSessionAction } from "./actions";

/**
 * Đăng xuất MỘT thiết bị khác.
 *
 * Hỏi lại ngay tại dòng (`ConfirmButton`) vì thao tác này KHÔNG hoàn tác được —
 * không dùng `window.confirm`/`window.alert`: trình duyệt nhúng trong Zalo hay
 * Facebook có lúc tắt hộp thoại, nút thành im lặng; lỗi cũng hiện ngay dưới nút.
 *
 * Câu hỏi nói đúng sự thật: thu hồi chặn việc GIA HẠN phiên, còn access token
 * thiết bị kia đang cầm vẫn chạy tới hết hạn. Hứa "đăng xuất ngay" thì người
 * đang bị chiếm tài khoản sẽ yên tâm sai — muốn cắt ngay mọi nơi thì đổi mật khẩu.
 *
 * @param accessTokenMinutes Hạn access token (`ACCESS_TOKEN_TTL_MINUTES`) — để
 * câu xác nhận nói đúng thiết bị kia còn dùng được bao lâu.
 */
export function SessionRevokeButton({
  sessionId,
  label,
  accessTokenMinutes,
}: {
  sessionId: string;
  label: string;
  accessTokenMinutes: number;
}) {
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="max-w-full"
      action={async () => {
        setError(null);
        const result = await revokeSessionAction(sessionId);
        if (result.error) setError(result.error);
      }}
    >
      <ConfirmButton
        label="Đăng xuất thiết bị này"
        prompt={`Đăng xuất khỏi ${label}? Thiết bị đó phải đăng nhập lại chậm nhất sau ${accessTokenMinutes} phút. Muốn cắt ngay mọi thiết bị thì đổi mật khẩu.`}
        confirmLabel="Xác nhận đăng xuất"
        pendingLabel="Đang đăng xuất…"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}
