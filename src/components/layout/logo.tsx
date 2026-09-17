import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Biểu tượng ChốtSân: khung sân nhìn từ trên xuống, vạch giữa, và một tam giác
 * "chơi" ở giữa.
 *
 * Vẽ tay bằng SVG chứ không lấy từ bộ biểu tượng dùng chung: đây là dấu hiệu
 * nhận diện của sản phẩm, không phải một biểu tượng chức năng. Lấy `Layers`
 * của lucide (như bản khung để lại) thì logo trông giống mọi app khác dùng
 * cùng bộ biểu tượng đó.
 */
function ChotSanMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden focusable="false">
      {/* Khung sân */}
      <rect x="2.5" y="5" width="19" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      {/* Vạch giữa sân */}
      <path d="M12 5v14" stroke="currentColor" strokeWidth="1.4" opacity="0.55" />
      {/* Tam giác "chơi" */}
      <path d="M10 9.4 15.4 12 10 14.6V9.4Z" fill="currentColor" />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  /**
   * Khổ màn dưới đó chỉ còn biểu tượng. Mặc định 360px (SKILL.md: màn hẹp nhất
   * thì ẩn chữ, giữ biểu tượng). Header của khách dùng 400px — xem `Header`.
   */
  textFrom?: 360 | 400;
  title?: string;
  href?: string;
}

/** Chuỗi class viết đủ để Tailwind quét thấy — không ghép chuỗi động. */
const HIDE_TEXT_BELOW = { 360: "max-[359px]:hidden", 400: "max-[399px]:hidden" } as const;

export function Logo({
  className,
  size = "md",
  showText = true,
  textFrom = 360,
  title = "ChốtSân",
  href = "/",
}: LogoProps) {
  const sizes = {
    sm: { icon: "h-4 w-4", box: "p-1.5 rounded-token-control", text: "text-base font-bold" },
    md: { icon: "h-5 w-5", box: "p-2 rounded-token-md", text: "text-lg font-bold" },
    lg: { icon: "h-6 w-6", box: "p-2.5 rounded-token-md", text: "text-xl font-extrabold" },
  };

  return (
    // `min-h-11`: logo là link về trang chủ — cũng là một ô bấm, cũng cần đủ 44px.
    // Không đổ bóng, không phóng to khi rê chuột: logo là dấu nhận diện, không
    // phải nút kêu gọi bấm.
    // `aria-label`: khi chữ bị ẩn ở màn hẹp, biểu tượng (aria-hidden) không còn
    // gì để trình đọc màn hình đọc — link về trang chủ thành link không tên.
    <Link
      href={href}
      aria-label={title}
      className={cn("flex min-h-11 select-none items-center gap-2.5 rounded-token-md", className)}
    >
      <div className={cn("flex items-center justify-center bg-brand text-white", sizes[size].box)}>
        <ChotSanMark className={sizes[size].icon} />
      </div>
      {showText && (
        /*
          Màn hẹp chỉ còn biểu tượng.

          iPhone SE đời cũ rộng 320px; ở đó logo + "Tìm sân" + hai nút tài khoản
          rộng hơn màn hình và đẩy tràn ngang CẢ TRANG. Biểu tượng một mình vẫn
          nhận ra được app, còn trang tràn ngang thì không cứu được bằng gì.
        */
        <span
          className={cn("tracking-tight text-content", HIDE_TEXT_BELOW[textFrom], sizes[size].text)}
        >
          {title}
        </span>
      )}
    </Link>
  );
}
