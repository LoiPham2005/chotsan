import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Trang 404 — cho đường dẫn không có thật VÀ cho trang không có quyền xem.
 *
 * Hai trường hợp cố ý chung một câu: trả "không có quyền" là xác nhận trang (hay
 * sân, hay lượt đặt) đó có thật. Vì vậy câu chữ nói cả hai khả năng, và đưa
 * ngay hai lối đi tiếp thay vì để người dùng đứng ở ngõ cụt.
 *
 * Nằm TRONG layout gốc (đã có header, footer và `<main>`) — ở đây chỉ dựng phần
 * nội dung. Khu quản trị dùng lại tệp này (`(admin)/not-found.tsx`).
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center sm:py-24">
      <p className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-bold uppercase tracking-wide text-muted">
        Lỗi 404
      </p>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-content sm:text-3xl">
        Không tìm thấy trang
      </h1>
      <p className="mt-2 text-muted">Đường dẫn không tồn tại, hoặc bạn không có quyền truy cập.</p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button asChild>
          <Link href="/">Về trang chủ</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/venues">Tìm sân</Link>
        </Button>
      </div>
    </div>
  );
}
