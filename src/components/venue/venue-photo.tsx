import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Một ảnh của cơ sở, phủ kín khung chứa (khung phải là `relative` và có kích thước).
 *
 * ---
 * ẢNH NỘI BỘ ĐI QUA `next/image`, ẢNH NGOÀI DÙNG `<img>` THƯỜNG
 *
 * Ảnh nội bộ (`/demo/venues/...`) được Next thu nhỏ và đổi sang WebP đúng cỡ
 * từng chỗ: thẻ sân rộng 360px không phải tải ảnh gốc 1280px. Trên điện thoại
 * đó là khác biệt giữa trang mở ngay và trang ì ạch.
 *
 * Ảnh ở host ngoài (sau này chủ sân tải lên kho S3/R2) thì `next/image` đòi
 * khai host đó trong `images.remotePatterns` — chưa khai mà dùng là trang ném
 * lỗi. Thà chưa tối ưu còn hơn vỡ trang, nên nhánh đó dùng `<img>` thường.
 */
export function VenuePhoto({
  src,
  alt,
  sizes,
  preload = false,
  eager = false,
  className,
}: {
  src: string;
  alt: string;
  /** Bề rộng ảnh thật sự chiếm trên màn hình — quyết định Next cắt cỡ nào. */
  sizes: string;
  /**
   * Chèn `<link rel="preload">` vào `<head>`. CHỈ cho ảnh chắc chắn là phần tử
   * lớn nhất ở đầu trang ở MỌI khổ màn (ảnh bìa trang chi tiết sân). Nhiều ảnh
   * cùng preload là mất tác dụng.
   */
  preload?: boolean;
  /**
   * Tải ngay, ưu tiên cao — nhưng KHÔNG preload trong `<head>`. Cho ảnh nằm trên
   * màn hình đầu mà chưa chắc là phần tử lớn nhất ở mọi khổ (thẻ sân đầu tiên:
   * lớn nhất ở desktop, chỉ là ảnh nhỏ 112px trên điện thoại). Tài liệu Next 16
   * khuyên `loading="eager"`/`fetchPriority` cho trường hợp này thay vì `preload`.
   */
  eager?: boolean;
  className?: string;
}) {
  // Hai cách không đi cùng nhau (Next cảnh báo khi `preload` kèm `loading`).
  const loadNow = eager && !preload;

  if (src.startsWith("/") && !src.startsWith("//")) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        preload={preload}
        loading={loadNow ? "eager" : undefined}
        fetchPriority={loadNow ? "high" : undefined}
        className={cn("object-cover", className)}
      />
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- host ngoài chưa khai trong images.remotePatterns */
    <img
      src={src}
      alt={alt}
      loading={preload || eager ? "eager" : "lazy"}
      fetchPriority={preload || eager ? "high" : undefined}
      decoding="async"
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}
