import Link from "next/link";
import { dateKey, dayLabel, addDays } from "@/lib/date";

/**
 * Dải 14 ngày để chọn.
 *
 * Là LINK chứ không phải nút JavaScript: mỗi ngày có URL riêng nên gửi cho bạn
 * bè được ("sân này, tối thứ 7"), nút quay lại hoạt động đúng, và trang đổi
 * ngày được cả khi JavaScript chưa tải xong.
 *
 * Cuộn ngang trên điện thoại. KHÔNG rút xuống 7 ngày ở khổ nhỏ: người đặt sân
 * hay đặt cho cuối tuần sau, mà 7 ngày thì không với tới.
 */
export function DateStrip({
  basePath,
  selected,
  dayCount = 14,
  today = new Date(),
}: {
  basePath: string;
  selected: Date;
  dayCount?: number;
  today?: Date;
}) {
  const selectedKey = dateKey(selected);
  const todayKey = dateKey(today);

  const days = Array.from({ length: dayCount }, (_, index) => addDays(today, index));

  return (
    <div
      className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
      role="group"
      aria-label="Chọn ngày"
    >
      {days.map((item) => {
        const key = dateKey(item);
        const label = dayLabel(item);
        const isToday = key === todayKey;
        const isSelected = key === selectedKey;

        return (
          <Link
            key={key}
            href={`${basePath}?date=${key}`}
            scroll={false}
            aria-current={isSelected ? "date" : undefined}
            className={`flex min-w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-token-md border px-3 py-2 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              isSelected
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-content hover:border-brand-line hover:bg-brand-tint"
            }`}
          >
            <span className={`text-xs ${isSelected ? "text-white/80" : "text-muted"}`}>
              {isToday ? "Hôm nay" : label.weekday}
            </span>
            <span className="text-sm font-semibold">{label.dayMonth}</span>
          </Link>
        );
      })}
    </div>
  );
}
