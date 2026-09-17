"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/observability";

/**
 * Error boundary cho toàn bộ route tree. Không có file này, một exception chưa
 * bắt trong Server Component sẽ trả về trang lỗi trắng mặc định của Next.js.
 *
 * Nằm TRONG layout gốc — header và footer vẫn còn, người dùng vẫn đi tiếp được.
 *
 * ---
 * "THỬ LẠI" DÙNG `retry`, KHÔNG PHẢI `reset`
 *
 * Next 16.3: `reset()` chỉ dựng lại phần giao diện với DỮ LIỆU CŨ — lỗi do
 * Server Component (database chập chờn, hết thời gian chờ) bấm bao nhiêu lần
 * cũng ra đúng lỗi đó. `retry()` xin lại dữ liệu từ máy chủ rồi mới dựng, nên
 * lỗi thoáng qua thật sự có cơ hội tự hết.
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // `digest` là mã Next.js gán cho lỗi phía server, dùng để tra lại đúng
    // stack trace trong log — thông điệp gốc bị ẩn khỏi client trên
    // production, cố ý như vậy.
    //
    // Không dùng `logger` ở đây: file này chạy trên TRÌNH DUYỆT, còn logger là
    // module server-side. `captureException` thì chạy được cả hai phía —
    // chưa cắm nhà cung cấp thì nó là hàm rỗng (xem src/lib/observability.ts).
    captureException(error, { digest: error.digest, boundary: "route" });
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center sm:py-24">
      <p className="rounded-full border border-danger-line bg-danger-tint px-3 py-1 text-xs font-bold uppercase tracking-wide text-danger-text">
        Lỗi hệ thống
      </p>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-content sm:text-3xl">
        Đã có sự cố xảy ra
      </h1>
      <p className="mt-2 text-muted">
        Yêu cầu của bạn chưa hoàn tất. Bấm thử lại — vẫn lỗi thì quay lại sau ít phút giúp bạn nhé.
      </p>

      {error.digest && (
        // Mã lỗi để người dùng đọc lại khi gọi hỗ trợ — không phải thông điệp gốc.
        <p className="mt-3 text-xs text-muted">
          Mã lỗi: <code className="font-mono text-content">{error.digest}</code>
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={() => retry()}>
          Thử lại
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Về trang chủ</Link>
        </Button>
      </div>
    </div>
  );
}
