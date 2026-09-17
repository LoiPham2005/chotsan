import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Hộp báo một câu: lỗi, kết quả, hay lời nhắc.
 *
 * ---
 * BA GIỌNG, MỖI GIỌNG MỘT MÀU CỦA SKILL
 *
 *   `danger`   đỏ nhạt — lỗi, thao tác hỏng, việc phải sửa (SKILL.md: đỏ = huỷ, lỗi, sắp hết)
 *   `success`  xanh nhạt — việc đã xong ("nền hộp thông báo tích cực")
 *   `neutral`  xám — thông tin, trạng thái ĐANG CHỜ, lời nhắc. Không phải lỗi.
 *
 * KHÔNG có giọng "cảnh báo" màu vàng/cam: cam chỉ được nói "giờ vàng", và một
 * màu vàng đứng cạnh nó thì người dùng không phân biệt nổi. Chuyện đáng lo thật
 * (sai số tài khoản là mất tiền) là `danger`; chuyện chỉ cần biết là `neutral`.
 *
 * Vai trò trợ năng do nơi dùng quyết: `role="alert"` cho lỗi vừa xảy ra,
 * `role="status"` cho kết quả vừa xong, bỏ trống cho lời nhắc đứng yên.
 */
const TONES = {
  danger: "border-danger-line bg-danger-tint text-danger-text",
  success: "border-brand-line bg-brand-tint text-brand-text",
  neutral: "border-line bg-elevated text-content",
} as const;

export type NoticeTone = keyof typeof TONES;

type NoticeProps = React.HTMLAttributes<HTMLElement> & {
  tone: NoticeTone;
  /** `p` cho một câu; `div`/`section` khi bên trong có tiêu đề hay danh sách. */
  as?: "p" | "div" | "section";
};

export function Notice({ tone, as: Tag = "p", className, ...props }: NoticeProps) {
  return (
    <Tag
      className={cn(
        "rounded-token-md border px-3 py-2.5 text-sm leading-relaxed",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
