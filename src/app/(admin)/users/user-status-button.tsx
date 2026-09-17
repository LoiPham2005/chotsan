"use client";

import { useState, useTransition } from "react";
import { setUserStatusAction, unlockUserAction } from "./actions";
import type { UserStatus } from "@/schemas/user.schema";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";

/**
 * Khoá / mở khoá một tài khoản, và mở khoá TẠM (do sai mật khẩu liên tiếp).
 *
 * Hỏi lại ngay tại dòng (`ConfirmButton`) thay cho `window.confirm`, lỗi hiện
 * ngay dưới nút thay cho `window.alert` — trình duyệt nhúng có lúc tắt hộp thoại,
 * và hộp thoại chặn cả trang thì không nói được hậu quả bằng tiếng Việt.
 */
export function UserStatusButton({
  id,
  email,
  status,
  lockedUntil,
}: {
  id: string;
  email: string;
  status: UserStatus;
  /** ISO string nếu đang bị khoá tạm do sai mật khẩu liên tiếp — xem `AuthService`. */
  lockedUntil: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isLockedNow = lockedUntil !== null && new Date(lockedUntil) > new Date();
  const banned = status === "BANNED";

  const unlock = () => {
    setError(null);
    startTransition(async () => {
      const res = await unlockUserAction(id);
      if (res.error) setError(res.error);
    });
  };

  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      {isLockedNow && (
        <Button
          type="button"
          onClick={unlock}
          disabled={isPending}
          variant="outline"
          size="sm"
          title="Đăng nhập sai quá nhiều lần — mở khoá sớm thay vì đợi tự hết hạn"
        >
          {isPending ? "Đang mở…" : "Mở khoá tạm"}
        </Button>
      )}

      <form
        className="max-w-full"
        action={async () => {
          setError(null);
          const res = await setUserStatusAction(id, { status: banned ? "ACTIVE" : "BANNED" });
          if (res.error) setError(res.error);
        }}
      >
        <ConfirmButton
          label={banned ? "Mở khoá" : "Khoá"}
          prompt={
            banned
              ? `Mở khoá tài khoản ${email}? Người này đăng nhập lại được ngay.`
              : `Khoá tài khoản ${email}? Người này bị đăng xuất khỏi mọi thiết bị và không đăng nhập được nữa.`
          }
          confirmLabel={banned ? "Xác nhận mở khoá" : "Xác nhận khoá"}
          pendingLabel={banned ? "Đang mở khoá…" : "Đang khoá…"}
          variant={banned ? "outline" : "destructive"}
        />
      </form>

      {error && (
        <p role="alert" className="w-full text-sm text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
