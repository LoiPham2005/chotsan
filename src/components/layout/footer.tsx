import { Logo } from "@/components/layout/logo";

/**
 * Chân trang.
 *
 * Không có link "Chính sách bảo mật" / "Điều khoản sử dụng": hai trang đó chưa
 * có nội dung thật, và một link dẫn tới trang 404 ở chân MỌI trang còn tệ hơn
 * không có link. Văn bản pháp lý phải do người có trách nhiệm viết — thêm lại
 * link cùng lúc với trang.
 */
export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-line bg-canvas">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-center sm:flex-row sm:px-6 sm:text-left lg:px-8">
        <Logo size="sm" />

        <p className="text-xs text-muted">
          &copy; {currentYear} ChốtSân. Đặt sân thể thao nhanh, rõ giá.
        </p>
      </div>
    </footer>
  );
}
