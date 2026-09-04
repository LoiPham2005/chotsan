/**
 * Ngày tháng theo giờ Việt Nam, dùng cho tầng giao diện.
 *
 * ---
 * ĐỪNG DÙNG `new Date(chuỗi)` RỒI `.getDate()`
 *
 * Máy chủ chạy UTC, trình duyệt chạy giờ máy người dùng. Cùng một mốc thời gian
 * cho ra hai ngày khác nhau ở hai nơi — và React sẽ báo lỗi hydration, hoặc tệ
 * hơn là không báo gì mà hiện sai ngày.
 *
 * Mọi thứ ở đây đi qua `Intl.DateTimeFormat` với `timeZone: "Asia/Ho_Chi_Minh"`,
 * nên máy chủ và trình duyệt luôn ra cùng kết quả.
 */

export const TIME_ZONE = "Asia/Ho_Chi_Minh";

const DATE_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `"2026-09-04"` theo giờ Việt Nam. Đây là dạng dùng trên URL. */
export function dateKey(date: Date): string {
  return DATE_KEY_FORMAT.format(date);
}

/**
 * Đọc `?date=2026-09-04` từ URL.
 *
 * Sai định dạng hoặc ngày không tồn tại (31/02) thì trả về hôm nay — người dùng
 * sửa URL bằng tay không được thấy trang lỗi.
 */
export function parseDateKey(value: string | undefined, now = new Date()): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fromDateKey(dateKey(now));

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return fromDateKey(dateKey(now));
  if (dateKey(parsed) !== value) return fromDateKey(dateKey(now));

  return parsed;
}

/**
 * Từ `"2026-09-04"` ra một mốc thời gian nằm GIỮA ngày đó theo giờ VN.
 *
 * Giữa trưa chứ không phải nửa đêm: mọi hàm nhận `date` ở tầng dưới đều chỉ
 * quan tâm "ngày nào", và giữa trưa thì cộng/trừ vài giờ vẫn không rơi sang
 * ngày khác — nửa đêm thì rơi ngay.
 */
export function fromDateKey(key: string): Date {
  return new Date(`${key}T05:00:00Z`); // 12:00 giờ VN
}

/** Cộng thêm `days` ngày, giữ nguyên khoá ngày theo giờ VN. */
export function addDays(date: Date, days: number): Date {
  return fromDateKey(dateKey(new Date(date.getTime() + days * 24 * 60 * 60_000)));
}

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

/** `{ weekday: "Thứ 6", dayMonth: "04/09" }` — dùng cho dải chọn ngày. */
export function dayLabel(date: Date): { weekday: string; dayMonth: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(read("weekday"));

  return { weekday: WEEKDAY_NAMES[weekday] ?? "", dayMonth: `${read("day")}/${read("month")}` };
}

/** `"Thứ 6, 04/09/2026"` — dùng ở chỗ cần nói rõ ngày nào. */
export function fullDateLabel(date: Date): string {
  const { weekday } = dayLabel(date);
  const [year, month, day] = dateKey(date).split("-");
  return `${weekday}, ${day}/${month}/${year}`;
}

/** `"19:00 – 21:00"` từ hai mốc phút trong ngày. */
export function timeRangeLabel(startMinute: number, endMinute: number): string {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${hhmm(startMinute)} – ${hhmm(endMinute)}`;
}

/** Giờ:phút của một mốc tuyệt đối, theo giờ VN. */
export function timeOfDay(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
