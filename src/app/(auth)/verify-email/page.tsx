import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { AuthHeader } from "../auth-form";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = { title: "Xác thực email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return token ? (
    <>
      {/*
        Trang này KHÔNG tự xác thực khi mở. Token chỉ dùng được một lần, mà bộ
        quét link của Gmail/Outlook tự mở mọi URL trong thư để kiểm tra an toàn
        — nếu tiêu thụ token ngay lúc GET thì nó bị đốt trước khi người dùng
        kịp bấm, và họ nhận được thông báo "liên kết đã hết hạn" cho một liên
        kết vừa gửi xong.
      */}
      <AuthHeader title="Xác thực email">
        Nhấn nút bên dưới để xác nhận địa chỉ email này là của bạn.
      </AuthHeader>
      <VerifyEmailForm token={token} />
    </>
  ) : (
    <>
      <AuthHeader title="Xác thực email" />
      <Notice tone="danger" role="alert">
        Liên kết không hợp lệ hoặc đã hết hạn.
      </Notice>
      {/* Nút gửi lại nằm ở /security. Trang đó cần đăng nhập — chưa đăng nhập
          thì được đưa qua /login rồi quay lại đúng chỗ. */}
      <p className="mt-5 text-sm text-muted">
        Gửi lại email xác thực ở trang <Link href="/security">Bảo mật tài khoản</Link>.
      </p>
    </>
  );
}
