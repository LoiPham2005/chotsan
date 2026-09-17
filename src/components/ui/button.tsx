import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/*
 * Nút theo SKILL.md §5: cao 44px, bo 8px, chữ nói rõ việc sẽ xảy ra.
 *
 * Màu lấy từ token của dự án (`brand`, `surface`, `line`…) chứ không phải thang
 * màu của Tailwind — đổi tông sau này chỉ sửa `globals.css`.
 *
 * ---
 * BỐN LOẠI CỦA SKILL ↔ VARIANT
 *
 *   Chính      `default`      nền xanh, chữ trắng đậm. MỖI MÀN MỘT NÚT.
 *   Phụ        `outline`      nền trắng, viền 1.5px đậm.
 *   Nguy hiểm  `destructive`  nền trắng, viền đỏ nhạt, chữ đỏ — KHÔNG đặc đỏ:
 *                             nút đặc đỏ cạnh nút đặc xanh là hai "hành động
 *                             chính" tranh nhau.
 *   Mờ         `default` khi `disabled` — nền xám, chữ nhạt. Nút mờ phải nói
 *                             cần làm gì để bấm được ("Chọn giờ trước").
 *
 * ---
 * CAO 44px Ở MỌI CỠ — `sm` CHỈ NHỎ PHẦN NHÌN THẤY
 *
 * Chủ sân bấm trên máy tính bảng ở quầy, một tay cầm điện thoại. `sm` (36px)
 * dành cho bảng dày đặc: phần vẽ ra nhỏ, còn VÙNG BẤM được nới thêm 6px trên
 * dưới bằng một lớp giả trong suốt (`after:`) — không làm dòng cao lên. 6px chứ
 * không 4px: lớp giả tính từ MÉP TRONG viền, nên nút viền 1.5px nới 4px chỉ được
 * 41px (đã đo bằng `elementFromPoint`); 6px cho 45px với nút viền, 48px với nút
 * không viền. Chiều cao là `min-h`, không phải `h`: nhãn dài trên màn 320px xuống
 * dòng trong nút thay vì đẩy tràn ngang cả trang.
 *
 * (Cố ý KHÔNG viết tên class cũ ra đây: bộ quét của Tailwind đọc cả comment,
 * nên một tên class nằm trong chú thích cũng đủ để sinh ra CSS thừa.)
 */
const buttonVariants = cva(
  "relative inline-flex max-w-full cursor-pointer select-none items-center justify-center gap-2 rounded-token-control text-center text-sm font-semibold leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default:
          "bg-brand font-bold text-white hover:bg-brand-hover disabled:bg-line disabled:text-subtle",
        destructive:
          "border-[1.5px] border-danger-line bg-surface text-danger-text hover:border-danger hover:bg-danger-tint disabled:opacity-50",
        outline:
          "border-[1.5px] border-line-strong bg-surface text-content hover:bg-elevated disabled:opacity-50",
        secondary: "bg-elevated text-content hover:bg-line disabled:opacity-50",
        ghost: "text-muted hover:bg-elevated hover:text-content disabled:opacity-50",
        link: "text-brand-text underline-offset-4 hover:underline disabled:opacity-50",
      },
      size: {
        default: "min-h-11 px-4 py-2",
        sm: "min-h-9 px-3 py-1.5 after:absolute after:inset-x-0 after:-inset-y-1.5",
        lg: "min-h-12 px-6 py-2.5 text-base",
        icon: "h-11 w-11 p-0",
        "icon-sm": "h-9 w-9 p-0 after:absolute after:-inset-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
