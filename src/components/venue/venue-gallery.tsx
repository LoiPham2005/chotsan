import { VenuePhoto } from "@/components/venue/venue-photo";
import { cn } from "@/lib/cn";

/** Máy tính hiện tối đa bấy nhiêu ảnh; điện thoại vuốt xem được hết. */
const DESKTOP_MAX = 4;

/**
 * Băng ảnh đầu trang chi tiết sân.
 *
 * ---
 * MỘT DANH SÁCH ẢNH CHO MỌI CỠ MÀN HÌNH, KHÔNG PHẢI HAI BẢN
 *
 *   Điện thoại — vuốt ngang, mỗi ảnh gần kín bề ngang, lộ mép ảnh sau để biết
 *                còn ảnh.
 *   Máy tính   — lưới: ảnh bìa lớn bên trái, ba ảnh nhỏ bên phải.
 *
 * Làm hai khối riêng rồi ẩn/hiện theo màn hình thì trình duyệt vẫn TẢI cả hai
 * — ảnh trong khối bị `display: none` vẫn được tải nếu không lazy — tức là
 * ảnh bìa tải hai lần ở hai cỡ khác nhau. Một danh sách đổi bố cục bằng CSS
 * thì mỗi ảnh chỉ tải một lần, và `preload` ảnh bìa đúng một lần.
 *
 * Không có ảnh thì không dựng gì: một khối xám "chưa có ảnh" chiếm nửa màn
 * hình còn tệ hơn không có.
 */
export function VenueGallery({ images, name }: { images: { url: string }[]; name: string }) {
  if (images.length === 0) return null;

  const count = Math.min(images.length, DESKTOP_MAX);

  return (
    <section aria-label={`Ảnh ${name}`} className="mt-5">
      <ul
        className={cn(
          "scrollbar-thin -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2",
          "sm:mx-0 sm:grid sm:h-72 sm:grid-rows-2 sm:gap-2 sm:overflow-hidden sm:rounded-token-xl sm:px-0 sm:pb-0 lg:h-80",
          count === 1 ? "sm:grid-cols-1" : count === 2 ? "sm:grid-cols-2" : "sm:grid-cols-4",
        )}
      >
        {images.map((image, index) => (
          <li
            key={`${image.url}-${index}`}
            className={cn(
              "relative aspect-[16/10] w-[86%] shrink-0 snap-center overflow-hidden rounded-token-lg bg-elevated",
              "sm:aspect-auto sm:w-auto sm:rounded-none",
              desktopCell(index, count),
            )}
          >
            <VenuePhoto
              src={image.url}
              alt={`${name} — ảnh ${index + 1}`}
              preload={index === 0}
              sizes={
                index === 0 && count > 2
                  ? "(min-width: 1280px) 620px, (min-width: 640px) 50vw, 86vw"
                  : "(min-width: 1280px) 310px, (min-width: 640px) 25vw, 86vw"
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Vị trí từng ảnh trong lưới máy tính.
 *
 * Bốn ảnh trên lưới 4 cột × 2 hàng, xếp tự động theo hàng:
 *   ảnh 1 — chiếm 2 cột × 2 hàng (bìa)
 *   ảnh 2 — cột 3, hàng 1
 *   ảnh 3 — cột 4, kéo dài 2 hàng
 *   ảnh 4 — cột 3, hàng 2 (ô còn trống duy nhất)
 * Ba ảnh: bìa 2×2, hai ảnh còn lại mỗi ảnh rộng 2 cột, xếp chồng bên phải.
 */
function desktopCell(index: number, count: number): string {
  if (index >= DESKTOP_MAX) return "sm:hidden";
  if (count === 1 || count === 2) return "sm:row-span-2";
  if (index === 0) return "sm:col-span-2 sm:row-span-2";
  if (count === 3) return "sm:col-span-2";
  return index === 2 ? "sm:row-span-2" : "";
}
