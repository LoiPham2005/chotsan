"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/observability";

/**
 * Bắt lỗi xảy ra ngay trong root layout — trường hợp `error.tsx` không cứu
 * được, vì lúc đó layout chưa render xong. Phải tự render `<html>`/`<body>`.
 *
 * ---
 * TỰ CHỨA: KHÔNG CÓ CSS CỦA ỨNG DỤNG
 *
 * Trang này THAY layout gốc, nên `globals.css`, font Be Vietnam Pro và mọi class
 * Tailwind đều không có mặt. Kiểu dáng viết thẳng bằng `style`, lấy đúng giá trị
 * của bảng màu trong `globals.css` — giao diện SÁNG, nút chính xanh emerald cao
 * 44px — để người dùng vẫn thấy đây là ChốtSân chứ không phải một trang lạ.
 * Đổi token trong `globals.css` thì sửa tay các mã màu dưới đây.
 */
const COLORS = {
  canvas: "#f8fafc",
  surface: "#ffffff",
  line: "#e2e8f0",
  content: "#0f172a",
  muted: "#64748b",
  brand: "#10b981",
  dangerTint: "#fef2f2",
  dangerLine: "#fca5a5",
  dangerText: "#b91c1c",
} as const;

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Lỗi tới được đây nghĩa là root layout đã hỏng — nghiêm trọng hơn hẳn
    // `error.tsx`, và gần như chắc chắn ảnh hưởng MỌI người dùng. Đây là loại
    // lỗi cần biết ngay, không phải đợi ai đó báo.
    captureException(error, { digest: error.digest, boundary: "global" });
  }, [error]);

  return (
    <html lang="vi">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: COLORS.canvas,
          color: COLORS.content,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          lineHeight: 1.6,
        }}
      >
        {/* Trang lỗi thay cả layout gốc — `metadata` không dùng được ở đây. */}
        <title>Sự cố · ChốtSân</title>
        <main
          style={{
            boxSizing: "border-box",
            width: "100%",
            maxWidth: 440,
            margin: 16,
            padding: 24,
            textAlign: "center",
            background: COLORS.surface,
            border: `1px solid ${COLORS.line}`,
            borderRadius: 14,
          }}
        >
          <p
            style={{
              display: "inline-block",
              margin: 0,
              padding: "2px 12px",
              borderRadius: 999,
              border: `1px solid ${COLORS.dangerLine}`,
              background: COLORS.dangerTint,
              color: COLORS.dangerText,
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            Lỗi nghiêm trọng
          </p>
          <h1
            style={{
              margin: "16px 0 8px",
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          >
            ChốtSân đang gặp sự cố
          </h1>
          <p style={{ margin: 0, color: COLORS.muted, fontSize: 15 }}>
            Trang không tải được. Bấm tải lại — vẫn lỗi thì quay lại sau ít phút giúp bạn nhé.
          </p>

          {error.digest && (
            <p style={{ margin: "12px 0 0", color: COLORS.muted, fontSize: 12 }}>
              Mã lỗi: <code style={{ color: COLORS.content }}>{error.digest}</code>
            </p>
          )}

          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 24,
              minHeight: 44,
              padding: "0 20px",
              border: "none",
              borderRadius: 8,
              background: COLORS.brand,
              color: "#ffffff",
              fontSize: 15,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Tải lại
          </button>
        </main>
      </body>
    </html>
  );
}
