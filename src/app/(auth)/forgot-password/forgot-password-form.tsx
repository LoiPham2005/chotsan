"use client";

import { useActionState } from "react";
import { Notice } from "@/components/ui/notice";
import { forgotPasswordAction, type AuthFormState } from "../actions";
import { AUTH_FORM_CLASS, AuthFields, type Field } from "../auth-form";

const initialState: AuthFormState = {};

const FIELDS: Field[] = [
  {
    name: "email",
    label: "Email",
    type: "email",
    placeholder: "you@example.com",
    required: true,
    autoComplete: "email",
  },
];

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, initialState);

  // Gửi xong thì thay hẳn form bằng thông điệp, không để lại nút bấm.
  // Người dùng không nhận được thư sẽ bấm lại liên tục, mà mỗi lần bấm là một
  // token mới làm token cũ hết hiệu lực — họ tự vô hiệu hoá đúng cái link vừa
  // tới nơi.
  if (state.success) {
    return (
      <Notice tone="success" role="status">
        {state.success}
      </Notice>
    );
  }

  return (
    <form action={formAction} className={AUTH_FORM_CLASS}>
      <AuthFields
        fields={FIELDS}
        state={state}
        isPending={isPending}
        submitLabel="Gửi hướng dẫn đặt lại"
        pendingLabel="Đang gửi…"
      />
    </form>
  );
}
