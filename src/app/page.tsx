import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { VenueCard } from "@/components/venue/venue-card";
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
 */
export default async function HomePage() {
  const [sports, featured] = await Promise.all([
    sportService.listActive(),
    venueService.search({ limit: 6 }),
  ]);

  return (
    <div>
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-brand-tint via-brand-tint/40 to-canvas">
        {/*
          Hai quầng sáng mờ phía sau. Chúng KHÔNG mang thông tin gì — chỉ để nền
          không phẳng lì như một ô màu. `blur-3xl` + độ mờ thấp nên chúng không
          bao giờ tranh chấp độ tương phản với chữ nằm trên.
        */}
        <div
          className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand/15 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-20 top-10 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl"
          aria-hidden
        />

        <div className="relative mx-auto max-w-4xl px-4 py-14 text-center sm:px-6 sm:py-24">
          <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-brand-line bg-surface/70 px-3 py-1 text-xs font-semibold text-brand backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
            </span>
            Đang nhận đặt sân hôm nay
          </p>

          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-content sm:text-6xl">
            Đặt sân thể thao
            <br />
            <span className="bg-gradient-to-r from-brand to-emerald-500 bg-clip-text text-transparent">
              nhanh, rõ giá
            </span>
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
            className="mx-auto mt-8 grid max-w-2xl gap-2 rounded-token-xl border border-line bg-surface/80 p-2 shadow-nang-2 backdrop-blur-sm sm:grid-cols-[1fr_11rem_auto]"
          >
            <Input
              type="search"
              name="q"
              placeholder="Tên sân hoặc địa chỉ…"
              aria-label="Tìm theo tên sân hoặc địa chỉ"
              className="h-12 border-transparent bg-transparent text-base shadow-none focus-visible:border-line"
            />

            <select
              name="mon"
              aria-label="Môn thể thao"
              className="h-12 cursor-pointer rounded-token-md border border-transparent bg-transparent px-3 text-base text-content focus-visible:border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <option value="">Tất cả môn</option>
              {sports.map((mon) => (
                <option key={mon.key} value={mon.key}>
                  {mon.name}
                </option>
              ))}
            </select>

            <Button type="submit" size="lg" className="h-12 shadow-selection">
              Tìm sân
            </Button>
          </form>

          {/* Lối tắt theo môn — kèm biểu tượng để mắt bắt được ngay, không
              phải đọc từng chữ. */}
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {sports.slice(0, 6).map((mon) => (
              <li key={mon.key}>
                <Link
                  href={`/venues?mon=${mon.key}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/80 py-1.5 pl-2.5 pr-3.5 text-sm font-medium text-content shadow-nang-1 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-brand-line hover:shadow-nang-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <SportIcon sportKey={mon.key} className={`h-4 w-4 ${sportStyle(mon.key).mau}`} />
                  {mon.name}
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
            className="group shrink-0 text-sm font-semibold text-brand hover:underline"
          >
            Xem tất cả{" "}
            <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>

        {featured.items.length === 0 ? (
          <p className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center text-muted">
            Chưa có sân nào đang mở bán. Quay lại sau giúp bạn nhé.
          </p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.items.map((court) => (
              // `Decimal` của Prisma không đi qua ranh giới Server → Client
              // được — đổi sang số ngay tại đây.
              <VenueCard key={court.id} court={{ ...court, ratingAvg: Number(court.ratingAvg) }} />
            ))}
          </div>
        )}
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <h2 className="text-center text-2xl font-bold tracking-tight text-content sm:text-3xl">
            Đặt sân trong ba bước
          </h2>

          {/* Đường nối chỉ vẽ ở khổ có ba cột nằm ngang — dọc thì nó nối nhầm hướng. */}
          <ol className="relative mt-9 grid gap-8 sm:grid-cols-3 sm:gap-6">
            <div
              className="pointer-events-none absolute left-[16.67%] right-[16.67%] top-5 hidden h-px bg-gradient-to-r from-brand-line via-brand-line to-transparent sm:block"
              aria-hidden
            />
            <HowToStep
              so={1}
              tieuDe="Chọn sân và giờ"
              mo="Lưới sân × khung 30 phút cho thấy ngay sân nào trống, giờ nào giá cao hơn."
            />
            <HowToStep
              so={2}
              tieuDe="Chuyển khoản"
              mo="Quét mã QR bằng app ngân hàng. Chỗ được giữ 10 phút để bạn thanh toán."
            />
            <HowToStep
              so={3}
              tieuDe="Tới sân, đọc mã"
              mo="Sân xác nhận xong bạn nhận thông báo. Tới nơi chỉ cần đọc mã đặt sân."
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
          <Link href="/register">Đăng ký chủ sân</Link>
        </Button>
      </section>
    </div>
  );
}

function HowToStep({ so, tieuDe, mo }: { so: number; tieuDe: string; mo: string }) {
  return (
    <li className="relative text-center sm:text-left">
      <span
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand to-emerald-600 text-base font-bold text-white shadow-selection ring-4 ring-surface"
        aria-hidden
      >
        {so}
      </span>
      <h3 className="mt-4 font-semibold text-content">{tieuDe}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{mo}</p>
    </li>
  );
}
