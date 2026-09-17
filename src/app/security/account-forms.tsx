"use client";

import { useActionState, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import {
  changePasswordAction,
  requestEmailChangeAction,
  resendVerificationEmailAction,
  type SecurityFormState,
} from "./actions";

/**
 * Ba form tự phục vụ trên `/security`: đổi mật khẩu, gửi lại email xác thực,
 * đổi email.
 *
 * Mỗi form tự import action của nó và đưa THẲNG vào `useActionState` (không
 * bọc hàm, không nhận qua prop) — cùng lý do với `auth-form.tsx`: có vậy React
 * mới nhúng được action vào HTML và form chạy cả khi JS chưa tải xong.
 *
 * Nút đều là nút VIỀN: trang này đã có hành động chính (bật 2FA/passkey), và
 * mỗi màn chỉ một nút đặc.
 *
 * Báo lỗi thì ô "Email mới" dựng lại bằng chữ vừa gõ (`state.values`) — React 19
 * xoá trắng form sau action. Ô MẬT KHẨU thì để trống lại: mật khẩu không đi ngược
 * từ máy chủ về trình duyệt.
 */

const initialState: SecurityFormState = {};

function FormMessage({ state }: { state: SecurityFormState }) {
  if (state.error) {
    return (
      <Notice tone="danger" role="alert">
        {state.error}
      </Notice>
    );
  }
  if (state.success) {
    return (
      <Notice tone="success" role="status">
        {state.success}
      </Notice>
    );
  }
  return null;
}

function Field({
  id,
  label,
  error,
  ...props
}: {
  id: string;
  label: string;
  error?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-content">
        {label}
      </label>
      <Input id={id} error={error} {...props} />
    </div>
  );
}

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="grid max-w-md gap-3">
      <FormMessage state={state} />

      <Field
        id="currentPassword"
        name="currentPassword"
        type="password"
        label="Mật khẩu hiện tại"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.currentPassword?.[0]}
      />
      <Field
        id="newPassword"
        name="newPassword"
        type="password"
        label="Mật khẩu mới"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.newPassword?.[0]}
      />

      <div>
        <Button type="submit" variant="outline" disabled={isPending}>
          {isPending ? "Đang đổi…" : "Đổi mật khẩu"}
        </Button>
      </div>
    </form>
  );
}

export function ResendVerificationButton() {
  const [state, formAction, isPending] = useActionState(
    resendVerificationEmailAction,
    initialState,
  );

  return (
    // Form không có ô nào: địa chỉ nhận lấy từ tài khoản ở máy chủ.
    <form action={formAction} className="grid gap-2">
      <FormMessage state={state} />
      <div>
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? "Đang gửi…" : "Gửi lại email xác thực"}
        </Button>
      </div>
    </form>
  );
}

export function ChangeEmailForm() {
  const [state, formAction, isPending] = useActionState(requestEmailChangeAction, initialState);

  return (
    <form action={formAction} className="grid max-w-md gap-3">
      <FormMessage state={state} />

      <Field
        id="newEmail"
        name="newEmail"
        type="email"
        label="Email mới"
        autoComplete="email"
        required
        defaultValue={state.values?.newEmail}
        error={state.fieldErrors?.newEmail?.[0]}
      />
      <Field
        id="emailChangePassword"
        name="password"
        type="password"
        label="Mật khẩu hiện tại"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password?.[0]}
      />

      <div>
        <Button type="submit" variant="outline" disabled={isPending}>
          {isPending ? "Đang gửi…" : "Gửi liên kết xác nhận"}
        </Button>
      </div>
    </form>
  );
}
