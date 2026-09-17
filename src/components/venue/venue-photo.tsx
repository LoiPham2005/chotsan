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
  className,
}: {
  src: string;
  alt: string;
  /** Bề rộng ảnh thật sự chiếm trên màn hình — quyết định Next cắt cỡ nào. */
  sizes: string;
  /** Chỉ cho ảnh lớn nhất ở đầu trang (LCP). Nhiều ảnh cùng preload là mất tác dụng. */
  preload?: boolean;
  className?: string;
}) {
  if (src.startsWith("/") && !src.startsWith("//")) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        preload={preload}
        className={cn("object-cover", className)}
      />
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- host ngoài chưa khai trong images.remotePatterns */
    <img
      src={src}
      alt={alt}
      loading={preload ? "eager" : "lazy"}
      fetchPriority={preload ? "high" : undefined}
      decoding="async"
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}
