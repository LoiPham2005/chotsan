import { cn } from "@/lib/cn";

/**
 * Biểu tượng và màu riêng cho từng môn thể thao.
 *
 * ---
 * VÌ SAO KHÔNG DÙNG EMOJI 🏸 🏀
 *
 * Emoji hiện KHÁC NHAU trên mỗi hệ điều hành — cùng một trang, máy Android và
 * máy iPhone thấy hai hình khác hẳn, và trên Windows nhiều emoji thể thao chỉ
 * ra một ô vuông. Với thứ đóng vai nhận diện danh mục thì đó là không dùng được.
 *
 * ---
 * MÀU Ở ĐÂY KHÔNG PHẢI MÀU THƯƠNG HIỆU
 *
 * Chúng chỉ để PHÂN BIỆT môn với nhau trong danh sách. Xanh emerald vẫn giữ
 * đúng một nghĩa của nó (hành động chính / còn trống) và cam vẫn chỉ nói giờ
 * vàng — xem SKILL.md. Vì vậy bảng dưới đây tránh cả hai màu đó.
 */
const MON: Record<string, { mau: string; nen: string; ve: React.ReactNode }> = {
  badminton: {
    mau: "text-sky-600",
    nen: "from-sky-50 to-sky-100",
    ve: (
      <>
        <path d="M14.5 3.5 20.5 9.5 12 18l-6-6 8.5-8.5Z" />
        <path d="m6 12-2.5 2.5a3 3 0 0 0 4.2 4.2L10 16" />
      </>
    ),
  },
  football: {
    mau: "text-indigo-600",
    nen: "from-indigo-50 to-indigo-100",
    ve: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 7 4 2.9-1.5 4.7h-5L8 9.9 12 7Z" />
      </>
    ),
  },
  pickleball: {
    mau: "text-violet-600",
    nen: "from-violet-50 to-violet-100",
    ve: (
      <>
        <path d="M13 3a6 6 0 0 1 0 12 6 6 0 0 1 0-12Z" />
        <path d="m8.8 14.2-4 4a2.5 2.5 0 0 0 3.5 3.5l4-4" />
      </>
    ),
  },
  tennis: {
    mau: "text-lime-600",
    nen: "from-lime-50 to-lime-100",
    ve: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M5 5a9 9 0 0 1 6 6 9 9 0 0 0 8 4M19 5a9 9 0 0 0-6 6 9 9 0 0 1-8 4" />
      </>
    ),
  },
  basketball: {
    mau: "text-orange-700",
    nen: "from-orange-50 to-orange-100",
    ve: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3v18M5 5.5c3 2.5 3 10.5 0 13M19 5.5c-3 2.5-3 10.5 0 13" />
      </>
    ),
  },
  volleyball: {
    mau: "text-rose-600",
    nen: "from-rose-50 to-rose-100",
    ve: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3c-3 4-3 12 0 18M3.5 9c4.5 1 10.5 4 13 9M20.5 9c-4.5 1-10.5 4-13 9" />
      </>
    ),
  },
  "table-tennis": {
    mau: "text-cyan-600",
    nen: "from-cyan-50 to-cyan-100",
    ve: (
      <>
        <path d="M12.5 3a6.5 6.5 0 0 1 0 13 6.5 6.5 0 0 1 0-13Z" />
        <path d="m8.5 15.5-4 4a2.4 2.4 0 0 0 3.4 3.4l4-4" />
        <circle cx="18.5" cy="16.5" r="2" />
      </>
    ),
  },
};

const MAC_DINH = {
  mau: "text-slate-500",
  nen: "from-slate-50 to-slate-100",
  ve: <rect x="3" y="5" width="18" height="14" rx="2" />,
};

export function sportStyle(sportKey: string) {
  return MON[sportKey] ?? MAC_DINH;
}

export function SportIcon({ sportKey, className }: { sportKey: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-5 w-5", className)}
      aria-hidden
      focusable="false"
    >
      {sportStyle(sportKey).ve}
    </svg>
  );
}
