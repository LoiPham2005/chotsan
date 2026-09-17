import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeader } from "../auth-form";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Quên mật khẩu" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeader title="Quên mật khẩu">
        Nhập email đã đăng ký. Chúng tôi sẽ gửi liên kết đặt lại mật khẩu.
      </AuthHeader>

      <ForgotPasswordForm />

      <p className="mt-5 text-sm text-muted">
        Nhớ ra rồi? <Link href="/login">Quay lại đăng nhập</Link>
      </p>
    </>
  );
}
