import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `twMerge` biết thêm các token riêng trong `src/app/globals.css`.
 *
 * ---
 * LỖI NÓ SỬA
 *
 * `twMerge` mặc định chỉ nhận ra bo góc và bóng đổ theo thang có sẵn (`sm`,
 * `md`, `lg`…). Bo góc `token-md` và bóng `nang-1` của dự án không nằm trong
 * thang đó, nên gộp bo góc `md` với bo góc `token-md` giữ CẢ HAI class — bên nào
 * thắng là do thứ tự Tailwind sinh CSS, không phải do thứ tự viết. Tệ hơn, bóng
 * `nang-1` bị đoán là MÀU bóng, nên bóng `sm` truyền vào sau không đè được nó.
 *
 * (Chú thích này cố ý không viết nguyên tên class: bộ quét của Tailwind đọc cả
 * comment và sẽ sinh CSS cho chúng.)
 *
 * Màu (`text-content`, `bg-surface`…) thì bản mặc định đã coi mọi tên lạ là
 * màu; khai lại ở đây để danh sách token nằm một chỗ và không phụ thuộc vào
 * cách đoán đó của thư viện.
 *
 * Thêm token mới vào `@theme` của `globals.css` thì thêm tên vào đây.
 */
const COLOR_TOKENS = [
  "canvas",
  "surface",
  "elevated",
  "line",
  "line-strong",
  "content",
  "muted",
  "subtle",
  "brand",
  "brand-hover",
  "brand-tint",
  "brand-line",
  "brand-text",
  "peak",
  "peak-tint",
  "peak-line",
  "peak-text",
  "taken",
  "taken-line",
  "danger",
  "danger-hover",
  "danger-tint",
  "danger-line",
  "danger-text",
  "rating",
  "admin-nav",
  // Màu nhận diện môn (`sport-icon.tsx`): chữ/biểu tượng và nền nhạt của từng môn.
  ...[
    "badminton",
    "football",
    "pickleball",
    "tennis",
    "basketball",
    "volleyball",
    "table-tennis",
    "other",
  ].flatMap((sport) => [`sport-${sport}`, `sport-${sport}-tint`]),
];

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: COLOR_TOKENS,
      radius: ["token-sm", "token-md", "token-lg", "token-xl", "token-control"],
      shadow: ["nang-1", "nang-2", "nang-3", "chon", "dock", "sticky-edge"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
