import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TheSan } from "@/components/venue/the-san";
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
export default async function TrangChuPage() {
  const [monTheThao, noiBat] = await Promise.all([
    sportService.listActive(),
    venueService.search({ limit: 6 }),
  ]);

  return (
    <div>
      <section className="border-b border-line bg-gradient-to-b from-brand-tint to-canvas">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6 sm:py-20">
          <h1 className="text-3xl font-bold leading-tight text-content sm:text-5xl">
            Đặt sân thể thao
            <br className="sm:hidden" /> <span className="text-brand">nhanh, rõ giá</span>
          </h1>

          <p className="mx-auto mt-3 max-w-xl text-base text-muted sm:text-lg">
            Xem sân nào còn trống theo từng 30 phút, biết trước giá, đặt xong trong 30 giây. Không
            cần gọi điện hỏi.
          </p>

          {/*
            `<form method="get">` thuần, không JavaScript: kết quả có URL chia
            sẻ được, nút quay lại hoạt động đúng, và tìm được cả khi mạng 3G
            ngoài sân chưa tải xong bundle.
          */}
          <form
            action="/san"
            method="get"
            className="mx-auto mt-7 grid max-w-2xl gap-2 sm:grid-cols-[1fr_11rem_auto]"
          >
            <Input
              type="search"
              name="q"
              placeholder="Tên sân hoặc địa chỉ…"
              aria-label="Tìm theo tên sân hoặc địa chỉ"
              className="h-12 bg-surface text-base"
            />

            <select
              name="mon"
              aria-label="Môn thể thao"
              className="h-12 rounded-token-md border border-line bg-surface px-3 text-base text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              <option value="">Tất cả môn</option>
              {monTheThao.map((mon) => (
                <option key={mon.key} value={mon.key}>
                  {mon.name}
                </option>
              ))}
            </select>

            <Button type="submit" size="lg" className="h-12">
              Tìm sân
            </Button>
          </form>

          <ul className="mt-5 flex flex-wrap justify-center gap-2">
            {monTheThao.slice(0, 5).map((mon) => (
              <li key={mon.key}>
                <Link
                  href={`/san?mon=${mon.key}`}
                  className="inline-block rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-content transition hover:border-brand-line hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {mon.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-bold text-content sm:text-2xl">Sân đang nhận đặt</h2>
          <Link href="/san" className="text-sm font-medium text-brand hover:underline">
            Xem tất cả →
          </Link>
        </div>

        {noiBat.items.length === 0 ? (
          <p className="mt-6 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center text-muted">
            Chưa có sân nào đang mở bán. Quay lại sau giúp bạn nhé.
          </p>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {noiBat.items.map((san) => (
              // `Decimal` của Prisma không đi qua ranh giới Server → Client
              // được — đổi sang số ngay tại đây.
              <TheSan key={san.id} san={{ ...san, ratingAvg: Number(san.ratingAvg) }} />
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <h2 className="text-center text-xl font-bold text-content sm:text-2xl">
            Đặt sân trong ba bước
          </h2>

          <ol className="mt-7 grid gap-6 sm:grid-cols-3">
            <BuocLam
              so={1}
              tieuDe="Chọn sân và giờ"
              mo="Lưới sân × khung 30 phút cho thấy ngay sân nào trống, giờ nào giá cao hơn."
            />
            <BuocLam
              so={2}
              tieuDe="Chuyển khoản"
              mo="Quét mã QR bằng app ngân hàng. Chỗ được giữ 10 phút để bạn thanh toán."
            />
            <BuocLam
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

function BuocLam({ so, tieuDe, mo }: { so: number; tieuDe: string; mo: string }) {
  return (
    <li className="text-center sm:text-left">
      <span
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-base font-bold text-white"
        aria-hidden
      >
        {so}
      </span>
      <h3 className="mt-3 font-semibold text-content">{tieuDe}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{mo}</p>
    </li>
  );
}
