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
  title?: string;
  href?: string;
}

export function Logo({
  className,
  size = "md",
  showText = true,
  title = "ChốtSân",
  href = "/",
}: LogoProps) {
  const sizes = {
    sm: { icon: "h-4 w-4", box: "p-1.5 rounded-lg", text: "text-base font-bold" },
    md: { icon: "h-5 w-5", box: "p-2 rounded-xl", text: "text-lg font-bold" },
    lg: { icon: "h-6 w-6", box: "p-2.5 rounded-xl", text: "text-xl font-extrabold" },
  };

  return (
    <Link href={href} className={cn("flex items-center gap-2.5 group select-none", className)}>
      <div
        className={cn(
          "flex items-center justify-center bg-brand text-white shadow-md shadow-brand/20 transition-transform group-hover:scale-105",
          sizes[size].box,
        )}
      >
        <ChotSanMark className={sizes[size].icon} />
      </div>
      {showText && (
        /*
          Dưới 360px chỉ còn biểu tượng.
          
          iPhone SE đời cũ rộng 320px; ở đó logo + "Tìm sân" + hai nút tài khoản
          rộng hơn màn hình và đẩy tràn ngang CẢ TRANG. Biểu tượng một mình vẫn
          nhận ra được app, còn trang tràn ngang thì không cứu được bằng gì.
        */
        <span className={cn("tracking-tight text-content max-[359px]:hidden", sizes[size].text)}>
          {title}
        </span>
      )}
    </Link>
  );
}
