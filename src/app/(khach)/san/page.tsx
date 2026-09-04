import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TheSan } from "@/components/venue/the-san";
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
export default async function TimSanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const lay = (key: string) => {
    const value = params[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };

  const trang = Number(lay("trang") ?? 1);

  const [ketQua, monTheThao] = await Promise.all([
    venueService.search({
      q: lay("q"),
      sportKey: lay("mon"),
      province: lay("tinh"),
      page: Number.isFinite(trang) ? trang : 1,
      limit: 12,
    }),
    sportService.listActive(),
  ]);

  const { items, meta } = ketQua;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <h1 className="text-2xl font-bold text-content sm:text-3xl">Tìm sân</h1>

      <form method="get" className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Input
          type="search"
          name="q"
          defaultValue={lay("q") ?? ""}
          placeholder="Tên sân hoặc địa chỉ…"
          aria-label="Tìm theo tên sân hoặc địa chỉ"
        />

        <select
          name="mon"
          defaultValue={lay("mon") ?? ""}
          aria-label="Môn thể thao"
          className="h-10 rounded-token-md border border-line bg-surface px-3 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 sm:w-44"
        >
          <option value="">Tất cả môn</option>
          {monTheThao.map((mon) => (
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
        <KhongCoKetQua />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((san) => (
            <TheSan
              key={san.id}
              san={{
                ...san,
                // `Decimal` của Prisma không đi qua ranh giới Server → Client
                // được. Đổi sang số ngay tại đây, không đẩy xuống component.
                ratingAvg: Number(san.ratingAvg),
              }}
            />
          ))}
        </div>
      )}

      {meta.totalPages > 1 && <PhanTrang meta={meta} params={params} />}
    </div>
  );
}

function KhongCoKetQua() {
  return (
    <div className="mt-8 rounded-xl border border-dashed border-line bg-surface p-10 text-center">
      <p className="text-lg font-medium text-content">Chưa tìm thấy sân nào</p>
      <p className="mt-1 text-sm text-muted">
        Thử bỏ bớt bộ lọc, hoặc tìm bằng tên quen thuộc của sân.
      </p>
      <Button asChild variant="outline" className="mt-4">
        <Link href="/san">Xem tất cả sân</Link>
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
function PhanTrang({
  meta,
  params,
}: {
  meta: { page: number; totalPages: number };
  params: Record<string, string | string[] | undefined>;
}) {
  const duongDan = (trang: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "trang" && typeof value === "string" && value !== "") query.set(key, value);
    }
    if (trang > 1) query.set("trang", String(trang));
    const chuoi = query.toString();
    return chuoi ? `/san?${chuoi}` : "/san";
  };

  return (
    <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Phân trang">
      <Button asChild variant="outline" size="sm" disabled={meta.page <= 1}>
        <Link
          href={duongDan(meta.page - 1)}
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
          href={duongDan(meta.page + 1)}
          aria-disabled={meta.page >= meta.totalPages}
          className={meta.page >= meta.totalPages ? "pointer-events-none opacity-40" : ""}
        >
          Sau
        </Link>
      </Button>
    </nav>
  );
}
