import type { Metadata } from "next";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { fieldClassName, Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { VenueCard } from "@/components/venue/venue-card";
import { sportService } from "@/services/sport.service";
import { venueService } from "@/services/venue.service";

export const metadata: Metadata = {
  title: "Tìm sân",
  description: "Tìm sân cầu lông, bóng đá, pickleball, tennis gần bạn và đặt trong 30 giây.",
};

/**
 * Danh sách sân.
 *
 * Server Component gọi THẲNG service — cùng tiến trình, không đi qua HTTP.
 * Đây là lý do chọn nextjs_base: một cú nhảy mạng bị bỏ đi cho mỗi lần mở trang.
 *
 * Bộ lọc là `<form method="get">` thuần, không JavaScript. Nghĩa là: kết quả
 * lọc có URL riêng chia sẻ được, bấm nút quay lại hoạt động đúng, và trang chạy
 * cả khi JavaScript chưa tải xong — thứ hay xảy ra trên 3G ngoài sân.
 */
export default async function VenueSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };

  const page = Number(read("page") ?? 1);

  // Ba truy vấn độc lập — chạy song song.
  const [result, sports, provinces] = await Promise.all([
    venueService.search({
      q: read("q"),
      sportKey: read("mon"),
      province: read("tinh"),
      page: Number.isFinite(page) ? page : 1,
      limit: 12,
    }),
    sportService.listActive(),
    venueService.listActiveProvinces(),
  ]);

  const { items, meta } = result;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <h1 className="text-2xl font-bold text-content sm:text-3xl">Tìm sân</h1>

      {/*
        `?tinh=` đã được đọc từ lâu nhưng KHÔNG có ô nào để chọn — lọc theo tỉnh
        chỉ làm được bằng cách tự sửa URL. Tên tham số giữ nguyên (`mon`, `tinh`):
        link cũ đã chia sẻ vẫn phải mở ra đúng kết quả.
      */}
      <form method="get" className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input
          type="search"
          name="q"
          defaultValue={read("q") ?? ""}
          placeholder="Tên sân hoặc địa chỉ…"
          aria-label="Tìm theo tên sân hoặc địa chỉ"
        />

        <select
          name="mon"
          defaultValue={read("mon") ?? ""}
          aria-label="Môn thể thao"
          className={cn(fieldClassName, "h-11 cursor-pointer sm:w-44")}
        >
          <option value="">Tất cả môn</option>
          {sports.map((sport) => (
            <option key={sport.key} value={sport.key}>
              {sport.name}
            </option>
          ))}
        </select>

        <select
          name="tinh"
          defaultValue={read("tinh") ?? ""}
          aria-label="Tỉnh/thành phố"
          className={cn(fieldClassName, "h-11 cursor-pointer sm:w-48")}
        >
          <option value="">Mọi tỉnh/thành</option>
          {provinces.map((province) => (
            <option key={province} value={province}>
              {province}
            </option>
          ))}
        </select>

        <Button type="submit">Tìm</Button>
      </form>

      <p className="mt-4 text-sm text-muted" aria-live="polite">
        {meta.total === 0 ? "Không có sân nào khớp" : `${meta.total} sân`}
      </p>

      {items.length === 0 ? (
        <EmptyResults />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((venue, index) => (
            <VenueCard
              key={venue.id}
              // Thẻ ĐẦU nằm trên màn hình đầu — Next đo được ảnh của nó là phần tử
              // LCP của trang mà lại đang tải lười. Chỉ thẻ đầu: tải ngay cả 12 ảnh
              // là giành băng thông của chính ảnh cần hiện trước.
              eager={index === 0}
              venue={{
                ...venue,
                // `Decimal` của Prisma không đi qua ranh giới Server → Client
                // được. Đổi sang số ngay tại đây, không đẩy xuống component.
                ratingAvg: Number(venue.ratingAvg),
              }}
            />
          ))}
        </div>
      )}

      {meta.totalPages > 1 && <Pagination meta={meta} params={params} />}
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="mt-8 rounded-token-lg border border-dashed border-line bg-surface p-10 text-center">
      <p className="text-lg font-medium text-content">Chưa tìm thấy sân nào</p>
      <p className="mt-1 text-sm text-muted">
        Thử bỏ bớt bộ lọc, hoặc tìm bằng tên quen thuộc của sân.
      </p>
      <Button asChild variant="outline" className="mt-4">
        <Link href="/venues">Xem tất cả sân</Link>
      </Button>
    </div>
  );
}

/**
 * Phân trang theo SỐ TRANG, không phải "tải thêm".
 *
 * Người tìm sân hay mở nhiều tab để so sánh, và cần quay lại đúng trang cũ sau
 * khi bấm nút back — "tải thêm" mất sạch trạng thái đó.
 */
function Pagination({
  meta,
  params,
}: {
  meta: { page: number; totalPages: number };
  params: Record<string, string | string[] | undefined>;
}) {
  const buildHref = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "page" && typeof value === "string" && value !== "") query.set(key, value);
    }
    if (page > 1) query.set("page", String(page));
    const search = query.toString();
    return search ? `/venues?${search}` : "/venues";
  };

  return (
    <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Phân trang">
      <PageLink href={buildHref(meta.page - 1)} disabled={meta.page <= 1} label="Trước" />

      <span className="px-3 text-sm text-muted">
        Trang {meta.page} / {meta.totalPages}
      </span>

      <PageLink
        href={buildHref(meta.page + 1)}
        disabled={meta.page >= meta.totalPages}
        label="Sau"
      />
    </nav>
  );
}

/**
 * Nút chuyển trang.
 *
 * Hết trang thì KHÔNG render link: bản trước là `<Link>` kèm
 * `pointer-events-none` — chuột không bấm được nhưng Tab tới rồi Enter vẫn đi
 * tới trang 0 hay trang quá cuối, ra một danh sách rỗng. Phần tử không tương
 * tác thì không có gì để bàn phím kích hoạt.
 */
function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  const className = buttonVariants({ variant: "outline", size: "sm" });

  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(className, "cursor-not-allowed opacity-40")}>
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
