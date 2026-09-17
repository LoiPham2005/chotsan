"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createRoleAction, type RoleFormState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

const initialState: RoleFormState = {};

/**
 * Form tạo vai trò.
 *
 * Báo lỗi (mã sai dạng, mã đã có) thì các ô dựng lại bằng chữ vừa gõ
 * (`state.values`) — React 19 xoá trắng form sau khi action chạy xong. Tạo xong
 * thì không có `values`: form trống để tạo tiếp.
 */
export function RoleCreateForm() {
  const [state, formAction] = useActionState(createRoleAction, initialState);
  const values = state.values;

  return (
    <form action={formAction} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor="new-role-key" className="mb-1.5 block text-sm font-semibold text-content">
            Mã vai trò
          </label>
          <Input
            id="new-role-key"
            name="key"
            placeholder="KE_TOAN"
            required
            defaultValue={values?.key}
            error={state.fieldErrors?.key?.[0]}
            hint="CHỮ HOA, số, gạch dưới. Không đổi được sau khi tạo."
            className="font-mono uppercase"
          />
        </div>

        <div className="min-w-0">
          <label
            htmlFor="new-role-name"
            className="mb-1.5 block text-sm font-semibold text-content"
          >
            Tên hiển thị
          </label>
          <Input
            id="new-role-name"
            name="name"
            placeholder="Kế toán"
            required
            defaultValue={values?.name}
            error={state.fieldErrors?.name?.[0]}
          />
        </div>

        <div className="min-w-0">
          <label
            htmlFor="new-role-description"
            className="mb-1.5 block text-sm font-semibold text-content"
          >
            Mô tả <span className="font-normal text-muted">(không bắt buộc)</span>
          </label>
          <Input
            id="new-role-description"
            name="description"
            placeholder="Đối soát hoá đơn hằng tháng"
            defaultValue={values?.description}
            error={state.fieldErrors?.description?.[0]}
          />
        </div>
      </div>

      {state.error && (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      )}

      {state.success && (
        <Notice tone="success" role="status">
          {state.success}
        </Notice>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Đang tạo…" : "Tạo vai trò"}
    </Button>
  );
}
