import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const [result, sports] = await Promise.all([
    venueService.search({
      q: read("q"),
      sportKey: read("mon"),
      province: read("tinh"),
      page: Number.isFinite(page) ? page : 1,
      limit: 12,
    }),
    sportService.listActive(),
  ]);

  const { items, meta } = result;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <h1 className="text-2xl font-bold text-content sm:text-3xl">Tìm sân</h1>

      <form method="get" className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
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
          className="h-10 rounded-token-md border border-line bg-surface px-3 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 sm:w-44"
        >
          <option value="">Tất cả môn</option>
          {sports.map((mon) => (
            <option key={mon.key} value={mon.key}>
              {mon.name}
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
          {items.map((court) => (
            <VenueCard
              key={court.id}
              court={{
                ...court,
                // `Decimal` của Prisma không đi qua ranh giới Server → Client
                // được. Đổi sang số ngay tại đây, không đẩy xuống component.
                ratingAvg: Number(court.ratingAvg),
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
    <div className="mt-8 rounded-xl border border-dashed border-line bg-surface p-10 text-center">
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
    const chuoi = query.toString();
    return chuoi ? `/venues?${chuoi}` : "/venues";
  };

  return (
    <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Phân trang">
      <Button asChild variant="outline" size="sm" disabled={meta.page <= 1}>
        <Link
          href={buildHref(meta.page - 1)}
          aria-disabled={meta.page <= 1}
          className={meta.page <= 1 ? "pointer-events-none opacity-40" : ""}
        >
          Trước
        </Link>
      </Button>

      <span className="px-3 text-sm text-muted">
        Trang {meta.page} / {meta.totalPages}
      </span>

      <Button asChild variant="outline" size="sm" disabled={meta.page >= meta.totalPages}>
        <Link
          href={buildHref(meta.page + 1)}
          aria-disabled={meta.page >= meta.totalPages}
          className={meta.page >= meta.totalPages ? "pointer-events-none opacity-40" : ""}
        >
          Sau
        </Link>
      </Button>
    </nav>
  );
}
