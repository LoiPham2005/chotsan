import Link from "next/link";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { VenuePhoto } from "@/components/venue/venue-photo";
import { formatVndShort, SLOT_MINUTES } from "@/lib/slots";

/**
 * Thẻ một cơ sở trong danh sách.
 *
 * ---
 * THỨ TỰ ĐỌC: TÊN → Ở ĐÂU → GIÁ → ĐÁNH GIÁ
 *
 * Ảnh chỉ để nhận diện, không được chiếm chỗ của giá — sân nào cũng chụp giống
 * nhau, còn giá là thứ quyết định bấm hay không.
 *
 * Chưa có ảnh thì KHÔNG để ô xám trống: nền nhạt theo màu môn kèm biểu tượng
 * của môn đó. Ô trống trông như trang hỏng; một khối màu có chủ đích thì không,
 * và nó còn giúp phân biệt môn khi lướt nhanh.
 *
 * ---
 * VIỀN, KHÔNG ĐỔ BÓNG
 *
 * Thẻ thường không đổ bóng (SKILL.md §4, §7) — rê chuột thì viền chuyển xanh
 * nhạt là đủ báo "bấm được", không nhấc thẻ lên thành "app nhiều lớp".
 *
 * ---
 * ĐIỆN THOẠI: THẺ NẰM NGANG
 *
 * Ảnh nhỏ bên trái để một màn hình thấy được 4–5 sân. Xếp dọc như desktop thì
 * mỗi lần cuộn chỉ thấy một sân rưỡi.
 */
export type VenueCardData = {
  slug: string;
  name: string;
  address: string;
  ward: string;
  province: string;
  ratingAvg: number;
  ratingCount: number;
  imageUrl: string | null;
  fromPricePerSlot: number | null;
  sport: { key?: string; name: string };
};

export function VenueCard({
  venue,
  eager = false,
}: {
  venue: VenueCardData;
  /**
   * Tải ảnh NGAY thay vì đợi cuộn tới — CHỈ cho thẻ đầu tiên của danh sách: nó
   * nằm trên màn hình đầu và Next đo được nó là phần tử LCP của trang tìm sân.
   */
  eager?: boolean;
}) {
  const style = sportStyle(venue.sport.key ?? "");

  return (
    <Link
      href={`/venues/${venue.slug}`}
      className="group relative flex overflow-hidden rounded-token-lg border border-line bg-surface transition-colors duration-200 hover:border-brand-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-col"
    >
      <div className={`relative w-28 shrink-0 overflow-hidden ${style.tint} sm:h-44 sm:w-full`}>
        {venue.imageUrl ? (
          /* `alt` rỗng: tên sân đứng ngay dưới, đọc lại lần nữa chỉ làm phiền trình đọc màn hình. */
          <VenuePhoto
            src={venue.imageUrl}
            alt=""
            eager={eager}
            sizes="(min-width: 1024px) 370px, (min-width: 640px) 50vw, 112px"
            className="transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className={`flex h-full w-full items-center justify-center ${style.text}`}>
            <SportIcon
              sportKey={venue.sport.key ?? ""}
              className="h-9 w-9 opacity-45 transition-transform duration-300 group-hover:scale-110 sm:h-14 sm:w-14"
            />
          </div>
        )}

        {/* Nền trắng gần đặc: nhãn đọc được trên mọi ảnh mà không cần phủ lớp tối
            chuyển sắc lên ảnh. */}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-surface/95 py-1 pl-1.5 pr-2.5 text-xs font-semibold text-content ring-1 ring-line">
          <SportIcon sportKey={venue.sport.key ?? ""} className={`h-3.5 w-3.5 ${style.text}`} />
          {venue.sport.name}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:p-4">
        <h3 className="truncate font-semibold leading-snug text-content transition-colors group-hover:text-brand-text">
          {venue.name}
        </h3>

        <p className="flex items-start gap-1 text-sm text-muted">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-subtle"
            aria-hidden
          >
            <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
            <circle cx="12" cy="10" r="2.4" />
          </svg>
          <span className="truncate">
            {venue.address}, {venue.ward}, {venue.province}
          </span>
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 border-t border-line/70 pt-2.5">
          <p className="text-sm leading-none">
            {venue.fromPricePerSlot === null ? (
              <span className="text-subtle">Chưa có giá</span>
            ) : (
              <>
                <span className="text-muted">từ </span>
                <span className="text-base font-bold text-content">
                  {formatVndShort(venue.fromPricePerSlot)}
                </span>
                <span className="text-xs text-muted"> /{SLOT_MINUTES} phút</span>
              </>
            )}
          </p>

          {venue.ratingCount > 0 && (
            <p className="flex shrink-0 items-center gap-1 text-sm leading-none">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-rating" aria-hidden>
                <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9L12 2.6Z" />
              </svg>
              <span className="font-semibold text-content">{venue.ratingAvg.toFixed(1)}</span>
              <span className="text-xs text-subtle">({venue.ratingCount})</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
