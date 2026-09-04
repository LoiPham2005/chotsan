import Link from "next/link";
import { Logo } from "@/components/layout/logo";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-line bg-canvas">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <Logo size="sm" />

          <p className="text-xs text-muted">
            &copy; {currentYear} Bản quyền thuộc về hệ thống. Đã đăng ký bản quyền.
          </p>

          <div className="flex gap-6 text-xs">
            <Link href="/privacy" className="text-muted transition-colors hover:text-content">
              Chính sách bảo mật
            </Link>
            <Link href="/terms" className="text-muted transition-colors hover:text-content">
              Điều khoản sử dụng
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
