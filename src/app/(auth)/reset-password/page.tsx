import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { AuthHeader } from "../auth-form";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Đặt lại mật khẩu" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return token ? (
    <>
      <AuthHeader title="Đặt lại mật khẩu">
        Nhập mật khẩu mới. Mọi thiết bị đang đăng nhập sẽ bị đăng xuất.
      </AuthHeader>
      <ResetPasswordForm token={token} />
    </>
  ) : (
    /*
     * Thiếu token nghĩa là người dùng vào thẳng đường dẫn này chứ không đi từ
     * email. Không dựng form ở đây: một ô mật khẩu không gắn với tài khoản nào
     * chỉ khiến họ gõ xong rồi nhận lỗi khó hiểu.
     */
    <>
      <AuthHeader title="Đặt lại mật khẩu" />
      <Notice tone="danger" role="alert">
        Liên kết không hợp lệ hoặc đã hết hạn.
      </Notice>
      <p className="mt-5 text-sm text-muted">
        <Link href="/forgot-password">Yêu cầu gửi lại liên kết</Link>
      </p>
    </>
  );
}
