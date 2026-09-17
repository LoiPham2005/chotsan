"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { verifyTwoFactorAction, type AuthFormState } from "../actions";
import { AUTH_FORM_CLASS } from "../auth-form";

const initialState: AuthFormState = {};

/**
 * Bước 2 của đăng nhập: nhập mã từ app xác thực.
 *
 * MỘT ô nhập cho cả mã TOTP 6 số lẫn mã khôi phục 10 ký tự — người dùng ở màn
 * hình này không nên phải tự phân loại thứ mình đang dán vào. `TwoFactorService`
 * phân biệt bằng độ dài sau khi chuẩn hoá.
 *
 * Import action TRỰC TIẾP thay vì nhận qua prop — cùng lý do ghi ở
 * `auth-form.tsx`: action đi qua prop thì React không nhúng được `$ACTION_ID`
 * vào HTML, và form không gửi được khi JS chưa tải xong.
 *
 * ---
 * Ô MÃ CÓ KIỂM SOÁT — MÃ KHÔNG ĐI QUA MÁY CHỦ ĐỂ QUAY LẠI
 *
 * React 19 xoá trắng form sau khi action báo lỗi. Gõ nhầm một ký tự của mã khôi
 * phục 10 ký tự mà phải gõ lại cả mã là đủ để người ta bỏ cuộc. Mã giữ trong
 * state của trình duyệt — action KHÔNG trả mã về (mã xác thực không được nằm
 * trong phản hồi của máy chủ). Báo lỗi thì chữ trong ô được bôi chọn sẵn: gõ
 * mã mới là đè lên luôn, còn sửa một ký tự thì bấm vào vị trí đó.
 */
export function TwoFactorForm({
  challengeToken,
  nextPath,
}: {
  /**
   * Vé của luồng MẬT KHẨU (`loginAction` vừa trả về). Bỏ trống ở luồng OAuth:
   * vé nằm trong cookie httpOnly, action tự đọc — nó không bao giờ ra tới HTML.
   */
  challengeToken?: string;
  nextPath?: string;
}) {
  const [state, formAction, isPending] = useActionState(verifyTwoFactorAction, initialState);
  const [code, setCode] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const ticket = state.twoFactorToken ?? challengeToken;

  useEffect(() => {
    if (state.error) codeRef.current?.select();
  }, [state]);

  return (
    <form action={formAction} className={AUTH_FORM_CLASS}>
      <p className="text-sm text-muted">
        Mở ứng dụng xác thực và nhập mã 6 số. Mất thiết bị thì dùng một trong các{" "}
        <strong className="font-semibold text-content">mã khôi phục</strong> đã lưu.
      </p>

      {/* Vé đi kèm request, không lưu ở trình duyệt: nó chỉ dùng đúng một lần
          cho đúng một bước, và không nên sống lâu hơn form này. */}
      {ticket && <input type="hidden" name="twoFactorToken" value={ticket} />}
      {nextPath && <input type="hidden" name="next" value={nextPath} />}

      <div>
        <label
          htmlFor="two-factor-code"
          className="mb-1.5 block text-sm font-semibold text-content"
        >
          Mã xác thực
        </label>
        <Input
          ref={codeRef}
          id="two-factor-code"
          name="code"
          required
          autoFocus
          // `one-time-code` để iOS/Android tự điền mã từ thông báo.
          autoComplete="one-time-code"
          inputMode="text"
          placeholder="123456"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-invalid={state.error ? true : undefined}
          className="font-mono tracking-widest"
        />
      </div>

      {state.error && (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      )}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? "Đang xác minh…" : "Xác minh"}
      </Button>
    </form>
  );
}
