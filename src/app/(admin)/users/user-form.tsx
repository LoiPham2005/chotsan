"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createUserAction, type CreateUserState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

const initialState: CreateUserState = {};

/**
 * Form thêm người dùng.
 *
 * Báo lỗi (trùng email, tên đăng nhập sai dạng…) thì các ô dựng lại bằng đúng
 * chữ vừa gõ (`state.values`) — React 19 đã xoá trắng form sau khi action chạy
 * xong. Thêm thành công thì action không trả `values`: React tự xoá form, ô trống
 * để thêm người tiếp theo.
 */
export function UserForm() {
  const [state, formAction] = useActionState(createUserAction, initialState);
  const values = state.values;

  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="new-user-email" label="Email">
          <Input
            id="new-user-email"
            name="email"
            type="email"
            placeholder="user@example.com"
            required
            defaultValue={values?.email}
            error={state.fieldErrors?.email?.[0]}
          />
        </Field>

        <Field id="new-user-fullname" label="Họ và tên" optional>
          <Input
            id="new-user-fullname"
            name="fullName"
            placeholder="Nguyễn Văn A"
            defaultValue={values?.fullName}
            error={state.fieldErrors?.fullName?.[0]}
          />
        </Field>

        <Field id="new-user-username" label="Tên đăng nhập" optional>
          <Input
            id="new-user-username"
            name="username"
            placeholder="nguyenvana"
            defaultValue={values?.username}
            error={state.fieldErrors?.username?.[0]}
          />
        </Field>
      </div>

      {state.error && (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-content">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(không bắt buộc)</span>}
      </label>
      {children}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Đang thêm…" : "Thêm người dùng"}
    </Button>
  );
}
