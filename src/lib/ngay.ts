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

export const MUI_GIO = "Asia/Ho_Chi_Minh";

const KHOA_NGAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: MUI_GIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `"2026-09-04"` theo giờ Việt Nam. Đây là dạng dùng trên URL. */
export function khoaNgay(date: Date): string {
  return KHOA_NGAY.format(date);
}

/**
 * Đọc `?ngay=2026-09-04` từ URL.
 *
 * Sai định dạng hoặc ngày không tồn tại (31/02) thì trả về hôm nay — người dùng
 * sửa URL bằng tay không được thấy trang lỗi.
 */
export function docKhoaNgay(value: string | undefined, now = new Date()): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return tuKhoaNgay(khoaNgay(now));

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return tuKhoaNgay(khoaNgay(now));
  if (khoaNgay(parsed) !== value) return tuKhoaNgay(khoaNgay(now));

  return parsed;
}

/**
 * Từ `"2026-09-04"` ra một mốc thời gian nằm GIỮA ngày đó theo giờ VN.
 *
 * Giữa trưa chứ không phải nửa đêm: mọi hàm nhận `date` ở tầng dưới đều chỉ
 * quan tâm "ngày nào", và giữa trưa thì cộng/trừ vài giờ vẫn không rơi sang
 * ngày khác — nửa đêm thì rơi ngay.
 */
export function tuKhoaNgay(key: string): Date {
  return new Date(`${key}T05:00:00Z`); // 12:00 giờ VN
}

/** Cộng thêm `soNgay` ngày, giữ nguyên khoá ngày theo giờ VN. */
export function themNgay(date: Date, soNgay: number): Date {
  return tuKhoaNgay(khoaNgay(new Date(date.getTime() + soNgay * 24 * 60 * 60_000)));
}

const THU = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

/** `{ thu: "Thứ 6", ngay: "04/09" }` — dùng cho dải chọn ngày. */
export function nhanNgay(date: Date): { thu: string; ngay: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MUI_GIO,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(date);

  const lay = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(lay("weekday"));

  return { thu: THU[weekday] ?? "", ngay: `${lay("day")}/${lay("month")}` };
}

/** `"Thứ 6, 04/09/2026"` — dùng ở chỗ cần nói rõ ngày nào. */
export function nhanNgayDay(date: Date): string {
  const { thu } = nhanNgay(date);
  const [nam, thang, ngay] = khoaNgay(date).split("-");
  return `${thu}, ${ngay}/${thang}/${nam}`;
}

/** `"19:00 – 21:00"` từ hai mốc phút trong ngày. */
export function nhanKhungGio(startMinute: number, endMinute: number): string {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${hhmm(startMinute)} – ${hhmm(endMinute)}`;
}

/** Giờ:phút của một mốc tuyệt đối, theo giờ VN. */
export function gioPhut(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: MUI_GIO,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
