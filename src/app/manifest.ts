import type { MetadataRoute } from "next";

/**
 * Web App Manifest — Next tự gắn `<link rel="manifest">` cho tệp này.
 *
 * Bản cũ nằm ở `public/manifest.webmanifest`: không trang nào link tới nó, và nó
 * trỏ tới ba ảnh PNG không tồn tại. Ở đây biểu tượng trỏ đúng hai tệp có thật do
 * Next phục vụ theo quy ước: `app/icon.svg` (mọi cỡ) và `app/apple-icon.png`
 * (180×180, nền kín không bo góc — hệ điều hành tự bo).
 *
 * Màu lấy đúng token của `globals.css`: nền `--bg-color`, thanh trạng thái
 * `--primary-color` (khớp `themeColor` trong `layout.tsx`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ChốtSân — Đặt sân thể thao",
    short_name: "ChốtSân",
    description: "Đặt sân cầu lông, bóng đá, tennis, pickleball, bóng rổ theo khung 30 phút.",
    lang: "vi",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#10b981",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
