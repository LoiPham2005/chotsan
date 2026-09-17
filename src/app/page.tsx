import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fieldClassName, Input } from "@/components/ui/input";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { VenueCard } from "@/components/venue/venue-card";
import { cn } from "@/lib/cn";
import { sportService } from "@/services/sport.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = {
  title: "ChốtSân — Đặt sân thể thao nhanh, rõ giá",
  description:
    "Xem sân nào còn trống, giá bao nhiêu, đặt trong 30 giây. Cầu lông, bóng đá, pickleball, tennis.",
};

/**
 * Trang chủ.
 *
 * ---
 * Ô TÌM KIẾM ĐỨNG ĐẦU, KHÔNG PHẢI LỜI GIỚI THIỆU
 *
 * Người mở trang này đã biết mình cần gì: một sân, tối nay, gần nhà. Họ không
 * cần đọc app làm được gì. Nên thứ đầu tiên chạm tới là ô tìm — và ngay dưới
 * là sân thật, không phải ba khối "tính năng nổi bật".
 *
 * ---
 * PHẲNG, KHÔNG TRANG TRÍ
 *
 * Không nền chuyển sắc, không quầng sáng mờ, không chữ tô gradient, không đổ
 * bóng (SKILL.md §4, §7): người dùng đứng ngoài sân giữa ban ngày — độ tương
 * phản và chữ rõ quan trọng hơn cảm giác "bóng bẩy".
 *
 * Thẻ sân ở đây KHÔNG tải ảnh ngay (khác `/venues`): trên điện thoại khối tìm
 * kiếm đã chiếm trọn màn hình đầu, phần tử lớn nhất lúc mở trang là tiêu đề chứ
 * không phải ảnh sân.
 */
export default async function HomePage() {
  const [sports, featured] = await Promise.all([
    sportService.listActive(),
    venueService.search({ limit: 6 }),
  ]);

  return (
    <div>
      <section className="border-b border-line bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6 sm:py-20">
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-brand-line bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-text">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              {/* `motion-safe:`: người bật "giảm chuyển động" thì chấm đứng yên. */}
              <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            Đang nhận đặt sân hôm nay
          </p>

          <h1 className="text-4xl font-extrabold leading-[1.15] tracking-tight text-content sm:text-6xl">
            Đặt sân thể thao
            <br />
            <span className="text-brand-text">nhanh, rõ giá</span>
          </h1>

          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Xem sân nào còn trống theo từng 30 phút, biết trước giá, đặt xong trong 30 giây. Không
            cần gọi điện hỏi.
          </p>

          {/*
            `<form method="get">` thuần, không JavaScript: kết quả có URL chia
            sẻ được, nút quay lại hoạt động đúng, và tìm được cả khi mạng 3G
            ngoài sân chưa tải xong bundle.
          */}
          <form
            action="/venues"
            method="get"
            className="mx-auto mt-8 grid max-w-2xl gap-2 text-left sm:grid-cols-[1fr_11rem_auto]"
          >
            <Input
              type="search"
              name="q"
              placeholder="Tên sân hoặc địa chỉ…"
              aria-label="Tìm theo tên sân hoặc địa chỉ"
              className="h-12"
            />

            <select
              name="mon"
              aria-label="Môn thể thao"
              className={cn(fieldClassName, "h-12 cursor-pointer")}
            >
              <option value="">Tất cả môn</option>
              {sports.map((sport) => (
                <option key={sport.key} value={sport.key}>
                  {sport.name}
                </option>
              ))}
            </select>

            <Button type="submit" size="lg">
              Tìm sân
            </Button>
          </form>

          {/* Lối tắt theo môn — kèm biểu tượng để mắt bắt được ngay, không
              phải đọc từng chữ. Tham số `?mon=` giữ nguyên: link cũ đã chia sẻ
              vẫn phải mở đúng kết quả. */}
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {sports.slice(0, 6).map((sport) => (
              <li key={sport.key}>
                <Link
                  href={`/venues?mon=${sport.key}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-4 text-sm font-medium text-content transition-colors hover:border-brand-line hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <SportIcon
                    sportKey={sport.key}
                    className={`h-4 w-4 ${sportStyle(sport.key).text}`}
                  />
                  {sport.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-2xl font-bold tracking-tight text-content sm:text-3xl">
            Sân đang nhận đặt
          </h2>
          <Link
            href="/venues"
            className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-brand-text hover:underline"
          >
            Xem tất cả →
          </Link>
        </div>

        {featured.items.length === 0 ? (
          <p className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center text-muted">
            Chưa có sân nào đang mở bán. Quay lại sau giúp bạn nhé.
          </p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.items.map((venue) => (
              // `Decimal` của Prisma không đi qua ranh giới Server → Client
              // được — đổi sang số ngay tại đây.
              <VenueCard key={venue.id} venue={{ ...venue, ratingAvg: Number(venue.ratingAvg) }} />
            ))}
          </div>
        )}
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="text-center text-2xl font-bold tracking-tight text-content sm:text-3xl">
            Đặt sân trong ba bước
          </h2>

          <ol className="mt-9 grid gap-8 sm:grid-cols-3 sm:gap-6">
            <HowToStep
              step={1}
              title="Chọn sân và giờ"
              description="Lưới sân × khung 30 phút cho thấy ngay sân nào trống, giờ nào giá cao hơn."
            />
            <HowToStep
              step={2}
              title="Chuyển khoản"
              description="Quét mã QR bằng app ngân hàng. Chỗ được giữ trong lúc bạn thanh toán."
            />
            <HowToStep
              step={3}
              title="Tới sân, đọc mã"
              description="Sân xác nhận xong bạn nhận thông báo. Tới nơi chỉ cần đọc mã đặt sân."
            />
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6 sm:py-16">
        <h2 className="text-xl font-bold text-content sm:text-2xl">Bạn là chủ sân?</h2>
        <p className="mx-auto mt-2 max-w-lg text-muted">
          Đưa sân lên ChốtSân để nhận đặt online, tự quản lịch và bảng giá, xem doanh thu theo ngày.
          Không mất phí đăng ký.
        </p>
        <Button asChild size="lg" variant="outline" className="mt-5">
          {/* Chưa đăng nhập thì `/manage/new` tự chuyển sang đăng nhập rồi quay lại. */}
          <Link href="/manage/new">Đăng ký chủ sân</Link>
        </Button>
      </section>
    </div>
  );
}

/**
 * Một bước trong "Đặt sân trong ba bước". Số bước là ô VIỀN trung tính, không
 * phải khối xanh đặc: nó không bấm được, mà xanh đặc là màu của thứ bấm được.
 */
function HowToStep({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <li className="text-center sm:text-left">
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-line-strong bg-surface text-base font-bold text-content"
        aria-hidden
      >
        {step}
      </span>
      <h3 className="mt-4 font-semibold text-content">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p>
    </li>
  );
}
