"use client";

import { useActionState } from "react";
import { updateRolePermissionsAction, type RoleFormState } from "./actions";
import type { Permission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

const initialState: RoleFormState = {};

export type PermissionOption = { key: Permission; description: string };

/**
 * Bảng tick quyền của một vai trò. Lưu CẢ bảng một lần — xem
 * `updateRolePermissionsAction`.
 *
 * Mỗi ô là cả một nhãn bấm được (≥44px), không chỉ cái hộp tick 16px.
 */
export function RolePermissionForm({
  roleKey,
  granted,
  options,
  disabled,
}: {
  roleKey: string;
  granted: readonly Permission[];
  options: readonly PermissionOption[];
  /** true khi người đang xem không có quyền `role:update` — chỉ được nhìn. */
  disabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(updateRolePermissionsAction, initialState);
  const grantedSet = new Set(granted);

  return (
    <form action={formAction}>
      <input type="hidden" name="key" value={roleKey} />

      <fieldset>
        <legend className="sr-only">Quyền của vai trò {roleKey}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.key}
              className={`flex min-h-11 items-start gap-2.5 rounded-token-md border border-line p-2.5 ${
                disabled || isPending
                  ? "cursor-default opacity-70"
                  : "cursor-pointer hover:border-brand-line hover:bg-brand-tint/40"
              }`}
            >
              <input
                type="checkbox"
                name="permissions"
                value={option.key}
                defaultChecked={grantedSet.has(option.key)}
                disabled={disabled || isPending}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              />
              <span className="min-w-0">
                <code className="block break-all font-mono text-xs font-semibold text-content">
                  {option.key}
                </code>
                <span className="block text-xs text-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {state.error}
        </Notice>
      )}

      {state.success && (
        <Notice tone="success" role="status" className="mt-3">
          {state.success}
        </Notice>
      )}

      {!disabled && (
        <Button type="submit" variant="outline" disabled={isPending} className="mt-3">
          {isPending ? "Đang lưu…" : "Lưu phân quyền"}
        </Button>
      )}
    </form>
  );
}
