import type { Metadata } from "next";
import Link from "next/link";
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

  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <div className="card">
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>Tạo tài khoản</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 24 }}>
          Tài khoản mới luôn được tạo với quyền USER.
        </p>

        <OAuthButtons next={next} />

        <RegisterForm nextPath={next} />

        <p style={{ marginTop: 20, fontSize: "0.9rem", color: "var(--text-muted)" }}>
          Đã có tài khoản?{" "}
          <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>Đăng nhập</Link>
        </p>
      </div>
    </main>
  );
}
