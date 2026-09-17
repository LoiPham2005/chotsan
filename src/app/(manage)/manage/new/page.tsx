import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { sportService } from "@/services/sport.service";
import { NewVenueForm } from "./new-venue-form";

export const metadata: Metadata = { title: "Đăng ký cơ sở mới", robots: { index: false } };

/** Ba bước người đăng ký phải biết trước — không ai thích bị bất ngờ ở bước hai. */
const STEPS = [
  "Điền thông tin cơ bản — tạo bản nháp, khách chưa thấy.",
  "Khai sân con, bảng giá, giờ mở cửa và tài khoản nhận tiền.",
  "Gửi duyệt. ChốtSân xem hồ sơ rồi mở bán cho bạn.",
];

/**
 * Đăng ký cơ sở mới — lối vào của nút "Đăng ký chủ sân".
 *
 * Tự kiểm đăng nhập bằng `requireUser("/manage/new")` để đăng nhập xong quay về
 * ĐÚNG trang này (khu `/manage` không còn layout chặn chung — layout không biết
 * đường dẫn đang mở nên chỉ đá được về `/manage`).
 */
export default async function NewVenuePage() {
  await requireUser("/manage/new");
  const sports = await sportService.listActive();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href="/manage?all=1"
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
        >
          ← Sân của bạn
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">
          Đăng ký cơ sở mới
        </h1>
      </header>

      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className="flex gap-2 rounded-token-md border border-line bg-surface p-3 text-sm text-muted"
          >
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                index === 0 ? "bg-brand text-white" : "bg-elevated text-muted"
              }`}
            >
              {index + 1}
            </span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>

      <NewVenueForm sports={sports.map((sport) => ({ id: sport.id, name: sport.name }))} />
    </div>
  );
}
