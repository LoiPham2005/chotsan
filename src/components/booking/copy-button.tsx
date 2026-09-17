"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Sao chép một chuỗi — số tài khoản và nội dung chuyển khoản, hai thứ khách phải
 * gõ lại vào app ngân hàng. Gõ sai nội dung là tiền vào tài khoản mà không ai
 * biết của lượt đặt nào.
 *
 * ---
 * TRANG MỞ QUA HTTP THÌ KHÔNG CÓ `navigator.clipboard`
 *
 * Trình duyệt chỉ cấp Clipboard API cho HTTPS và `localhost`. Mở bản dev bằng IP
 * LAN (`http://192.168.x.x:3000`, cách đang thử trên điện thoại) là không có nó
 * — và bản trước gọi `navigator.clipboard?.writeText` rồi IM LẶNG: bấm "Chép"
 * không có phản hồi gì. Nay thử lần lượt:
 *
 *   1. Clipboard API.
 *   2. Textarea ẩn + `document.execCommand("copy")` — đường cũ vẫn chạy trên HTTP.
 *   3. Không được nữa thì BÔI CHỌN chính dòng chữ trên trang và nói khách tự
 *      nhấn giữ để chép.
 *
 * Mọi nhánh đều có phản hồi nhìn thấy được.
 */

export type CopyOutcome = "copied" | "manual";

/** Đường cũ: chọn chữ trong một textarea ẩn rồi ra lệnh chép. Chạy được trên HTTP. */
function copyWithTextarea(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  // `readonly` để bàn phím ảo trên điện thoại không bật lên; nằm ngoài tầm nhìn
  // nhưng không `display: none` — phần tử ẩn hẳn thì không chọn chữ được.
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  textarea.select();
  textarea.setSelectionRange(0, value.length); // iOS bỏ qua `select()`

  let copied: boolean;
  try {
    copied = typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    // Một số trình duyệt ném thay vì trả `false` khi không cho chép.
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

/**
 * Chép `value`, trả về cách đã làm được. Tách khỏi component để test được cả ba
 * nhánh mà không cần trình duyệt thật.
 */
export async function copyText(value: string): Promise<CopyOutcome> {
  // Không có Clipboard API: thử đường cũ NGAY, khi cú bấm vẫn còn được tính là
  // thao tác của người dùng — chờ thêm một nhịp là trình duyệt từ chối lệnh chép.
  if (!navigator.clipboard) return copyWithTextarea(value) ? "copied" : "manual";

  try {
    await navigator.clipboard.writeText(value);
    return "copied";
  } catch {
    return copyWithTextarea(value) ? "copied" : "manual";
  }
}

/** Bôi chọn dòng chữ đang hiện trên trang để khách tự chép. */
function selectOnPage(targetId: string | undefined): void {
  const element = targetId ? document.getElementById(targetId) : null;
  const selection = window.getSelection();
  if (!element || !selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function CopyButton({
  value,
  label,
  targetId,
}: {
  value: string;
  label: string;
  /** `id` của phần tử đang hiện `value` — không chép tự động được thì bôi chọn nó. */
  targetId?: string;
}) {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  return (
    <span className="inline-flex shrink-0 flex-col items-end">
      <button
        type="button"
        onClick={async () => {
          const result = await copyText(value);
          if (result === "manual") selectOnPage(targetId);

          setOutcome(result);
          clearTimeout(resetTimer.current);
          // "Đã chép" tự lui sau 2 giây; lời nhắc chép tay thì giữ tới lần bấm sau.
          if (result === "copied") resetTimer.current = setTimeout(() => setOutcome(null), 2000);
        }}
        // Nút chữ nhỏ cạnh dòng thông tin; vùng bấm nới đủ 44px bằng `after:`.
        className="relative rounded-token-control px-2 py-1 text-xs font-semibold text-brand-text transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5 hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label={`Sao chép ${label}`}
      >
        {outcome === "copied" ? "Đã chép ✓" : "Chép"}
      </button>

      <span
        role="status"
        className={
          outcome === "manual"
            ? "mt-1 max-w-[14rem] text-right text-xs text-danger-text"
            : "sr-only"
        }
      >
        {outcome === "copied"
          ? `Đã chép ${label}`
          : outcome === "manual"
            ? "Không chép tự động được — hãy nhấn giữ để chép"
            : ""}
      </span>
    </span>
  );
}
