"use client";

import { useActionState } from "react";
import Link from "next/link";
import { verifyEmailAction, type AuthFormState } from "../actions";
import { AUTH_FORM_CLASS } from "../auth-form";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

const initialState: AuthFormState = {};

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(verifyEmailAction, initialState);

  if (state.success) {
    return (
      <>
        <Notice tone="success" role="status">
          {state.success}
        </Notice>
        <p className="mt-5 text-sm text-muted">
          <Link href="/login">Đăng nhập</Link>
        </p>
      </>
    );
  }

  return (
    <form action={formAction} className={AUTH_FORM_CLASS}>
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      )}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? "Đang xác thực…" : "Xác thực email của tôi"}
      </Button>
    </form>
  );
}
