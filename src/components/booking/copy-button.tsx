"use client";

import { useState } from "react";

/**
 * Sao chép một chuỗi vào clipboard.
 *
 * Dùng cho số tài khoản và nội dung chuyển khoản — hai thứ khách phải gõ lại
 * vào app ngân hàng, và gõ sai nội dung là tiền vào tài khoản mà không ai biết
 * của lượt đặt nào.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setDaChep] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        // `navigator.clipboard` không tồn tại trên HTTP không phải localhost.
        // Không có nó thì nút im lặng không làm gì, nên phải bắt lỗi tử tế.
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setDaChep(true);
            setTimeout(() => setDaChep(false), 2000);
          })
          .catch(() => setDaChep(false));
      }}
      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-brand transition hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      aria-label={`Sao chép ${label}`}
    >
      {copied ? "Đã chép ✓" : "Chép"}
    </button>
  );
}
