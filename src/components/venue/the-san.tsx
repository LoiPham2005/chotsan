import Link from "next/link";
import { formatVndShort } from "@/lib/slots";

/**
 * Thẻ một cơ sở trong danh sách tìm kiếm.
 *
 * Bốn thông tin, đúng thứ tự người tìm sân cần: tên, ở đâu, **giá từ bao
 * nhiêu**, đánh giá. Ảnh chỉ để nhận diện — sân nào cũng chụp giống nhau, nên
 * không cho nó chiếm chỗ của giá.
 *
 * Trên điện thoại thẻ nằm NGANG (ảnh nhỏ bên trái) để một màn hình thấy được
 * 4–5 sân; xếp dọc như desktop thì mỗi lần cuộn chỉ thấy một sân rưỡi.
 */
export function TheSan({
  san,
}: {
  san: {
    slug: string;
    name: string;
    address: string;
    ward: string;
    province: string;
    ratingAvg: number;
    ratingCount: number;
    imageUrl: string | null;
    fromPricePerSlot: number | null;
    sport: { name: string };
  };
}) {
  return (
    <Link
      href={`/san/${san.slug}`}
      className="group flex overflow-hidden rounded-xl border border-line bg-surface transition hover:border-brand-line hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex-col"
    >
      <div className="relative w-28 shrink-0 bg-elevated sm:h-40 sm:w-full">
        {san.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- ảnh do chủ sân tải lên, không biết trước kích thước */
          <img src={san.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl" aria-hidden>
            🏟️
          </div>
        )}

        <span className="absolute left-2 top-2 rounded-md bg-surface/90 px-2 py-0.5 text-xs font-medium text-muted backdrop-blur">
          {san.sport.name}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 sm:p-4">
        <h3 className="truncate font-semibold text-content group-hover:text-brand">{san.name}</h3>

        <p className="truncate text-sm text-muted">
          {san.address}, {san.ward}, {san.province}
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <p className="text-sm">
            {san.fromPricePerSlot === null ? (
              <span className="text-subtle">Chưa có giá</span>
            ) : (
              <>
                <span className="text-muted">từ </span>
                <span className="font-semibold text-content">
                  {formatVndShort(san.fromPricePerSlot)}
                </span>
                <span className="text-muted"> / 30 phút</span>
              </>
            )}
          </p>

          {san.ratingCount > 0 && (
            <p className="shrink-0 text-sm text-muted">
              <span aria-hidden>★</span>{" "}
              <span className="font-medium text-content">{san.ratingAvg.toFixed(1)}</span>{" "}
              <span className="text-subtle">({san.ratingCount})</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
