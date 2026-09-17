import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { AuthHeader } from "../auth-form";
import { OAuthButtons } from "../oauth-buttons";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Đăng ký" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // `next` phải đi qua ĐỦ mọi lối ra của trang: form, nút mạng xã hội, và cả
  // link "Đăng nhập" — người bấm nhầm sang đây rồi quay lại vẫn về đúng chỗ.
  const { next } = await searchParams;

  // Đã đăng nhập THẬT thì về `next` — kiểm ở đây, không ở proxy, vì proxy không
  // biết phiên đã bị thu hồi (xem ghi chú ở trang /login).
  if (await getSession()) redirect(safeRedirectPath(next, "/"));

  return (
    <>
      {/* Câu dẫn nói điều người đăng ký quan tâm — đặt sân, xem lại, huỷ — chứ
          không nói tên vai trò kỹ thuật ("quyền USER") mà khách không hiểu. */}
      <AuthHeader title="Tạo tài khoản">
        Để đặt sân, xem lại và tự huỷ lượt đặt của bạn bất cứ lúc nào.
      </AuthHeader>

      <OAuthButtons next={next} />

      <RegisterForm nextPath={next} />

      <p className="mt-5 text-sm text-muted">
        Đã có tài khoản?{" "}
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Đăng nhập</Link>
      </p>
    </>
  );
}
