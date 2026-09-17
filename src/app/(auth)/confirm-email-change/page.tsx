import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { AuthHeader } from "../auth-form";
import { ConfirmEmailChangeForm } from "./confirm-email-change-form";

export const metadata: Metadata = { title: "Xác nhận đổi email" };

export default async function ConfirmEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return token ? (
    <>
      {/*
        Như /verify-email: KHÔNG tự xác nhận khi mở trang. Token dùng một lần,
        mà bộ quét link của Gmail/Outlook tự mở mọi URL trong thư — tiêu thụ
        token ngay lúc GET thì nó bị đốt trước khi người dùng kịp bấm.
      */}
      <AuthHeader title="Xác nhận đổi email">
        Nhấn nút bên dưới để chuyển tài khoản sang địa chỉ email mới. Địa chỉ cũ sẽ không còn đăng
        nhập được.
      </AuthHeader>
      <ConfirmEmailChangeForm token={token} />
    </>
  ) : (
    <>
      <AuthHeader title="Xác nhận đổi email" />
      <Notice tone="danger" role="alert">
        Liên kết không hợp lệ hoặc đã hết hạn.
      </Notice>
      <p className="mt-5 text-sm text-muted">
        Đăng nhập rồi yêu cầu đổi email lại. <Link href="/login">Đăng nhập</Link>
      </p>
    </>
  );
}
