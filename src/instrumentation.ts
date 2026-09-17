import type { Instrumentation } from "next";

/**
 * Móc lỗi phía máy chủ của Next — hiện chỉ dùng cho MỘT việc ở môi trường dev.
 *
 * ---
 * NHẮC KHỞI ĐỘNG LẠI `pnpm dev` KHI PRISMA CLIENT TRONG BỘ NHỚ ĐÃ CŨ
 *
 * Đổi `schema.prisma` rồi `prisma generate` xong, server dev ĐANG CHẠY vẫn giữ
 * Prisma Client cũ trong bộ nhớ: `@prisma/client` là package ngoài, hot reload
 * không nạp lại nó. Code mới gửi cột mới, client cũ không biết cột đó, và lỗi
 * hiện ra là `Unknown argument \`checkoutCode\`` — trông y như code viết sai.
 *
 * Đã mất hai vòng hỏi đáp vì đúng lỗi này (docs/GOTCHAS.md #18): migration đã
 * áp, typecheck xanh, e2e xanh, mà bấm đặt sân trên `pnpm dev` vẫn hỏng. Dòng
 * nhắc này nằm ngay dưới lỗi trong terminal, chỗ người ta đang nhìn.
 *
 * Không làm gì ở production: `pnpm build && pnpm start` luôn nạp client mới nhất.
 */
export const onRequestError: Instrumentation.onRequestError = (error) => {
  if (process.env.NODE_ENV === "production") return;
  if (!(error instanceof Error) || !/Unknown (argument|field) `/.test(error.message)) return;

  console.warn(
    [
      "",
      "⚠️  Prisma báo không biết trường/cột này.",
      "   Nếu vừa sửa schema.prisma hoặc chạy prisma generate: server dev đang giữ Prisma Client CŨ",
      "   trong bộ nhớ — dừng `pnpm dev` (Ctrl+C) rồi chạy lại. Code không sai. Xem docs/GOTCHAS.md #18.",
      "   Nếu không đổi schema: kiểm lại tên trường trong câu truy vấn.",
      "",
    ].join("\n"),
  );
};
