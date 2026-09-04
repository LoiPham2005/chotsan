import Link from "next/link";
import { SportIcon, sportStyle } from "@/components/venue/sport-icon";
import { formatVndShort } from "@/lib/slots";

/**
 * Thẻ một cơ sở trong danh sách.
 *
 * ---
 * THỨ TỰ ĐỌC: TÊN → Ở ĐÂU → GIÁ → ĐÁNH GIÁ
 *
 * Ảnh chỉ để nhận diện, không được chiếm chỗ của giá — sân nào cũng chụp giống
 * nhau, còn giá là thứ quyết định bấm hay không.
 *
 * Chưa có ảnh thì KHÔNG để ô xám trống: nền chuyển sắc theo môn kèm biểu tượng
 * của môn đó. Ô trống trông như trang hỏng; một khối màu có chủ đích thì không,
 * và nó còn giúp phân biệt môn khi lướt nhanh.
 *
 * ---
 * ĐIỆN THOẠI: THẺ NẰM NGANG
 *
 * Ảnh nhỏ bên trái để một màn hình thấy được 4–5 sân. Xếp dọc như desktop thì
 * mỗi lần cuộn chỉ thấy một sân rưỡi.
 */
export function VenueCard({
  court,
}: {
  court: {
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
}) {
  const mon = sportStyle(court.sport.key ?? "");

  return (
    <Link
      href={`/venues/${court.slug}`}
      className="group relative flex overflow-hidden rounded-token-lg border border-line bg-surface shadow-nang-1 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-line hover:shadow-nang-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-col"
    >
      <div
        className={`relative w-28 shrink-0 overflow-hidden bg-gradient-to-br ${mon.nen} sm:h-44 sm:w-full`}
      >
        {court.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- ảnh do chủ sân tải lên, không biết trước kích thước */
          <img
            src={court.imageUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className={`flex h-full w-full items-center justify-center ${mon.mau}`}>
            <SportIcon
              sportKey={court.sport.key ?? ""}
              className="h-9 w-9 opacity-45 transition-transform duration-300 group-hover:scale-110 sm:h-14 sm:w-14"
            />
          </div>
        )}

        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-surface/90 py-1 pl-1.5 pr-2.5 text-xs font-semibold text-content shadow-nang-1 backdrop-blur-sm">
          <SportIcon sportKey={court.sport.key ?? ""} className={`h-3.5 w-3.5 ${mon.mau}`} />
          {court.sport.name}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:p-4">
        <h3 className="truncate font-semibold leading-snug text-content transition-colors group-hover:text-brand">
          {court.name}
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
            {court.address}, {court.ward}, {court.province}
          </span>
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 border-t border-line/70 pt-2.5">
          <p className="text-sm leading-none">
            {court.fromPricePerSlot === null ? (
              <span className="text-subtle">Chưa có giá</span>
            ) : (
              <>
                <span className="text-muted">từ </span>
                <span className="text-base font-bold text-content">
                  {formatVndShort(court.fromPricePerSlot)}
                </span>
                <span className="text-xs text-muted"> /30 phút</span>
              </>
            )}
          </p>

          {court.ratingCount > 0 && (
            <p className="flex shrink-0 items-center gap-1 text-sm leading-none">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-amber-400" aria-hidden>
                <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9L12 2.6Z" />
              </svg>
              <span className="font-semibold text-content">{court.ratingAvg.toFixed(1)}</span>
              <span className="text-xs text-subtle">({court.ratingCount})</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
