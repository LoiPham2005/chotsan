/**
 * Toán khung giờ — thuần tuý, không chạm database.
 *
 * ---
 * VÌ SAO TÁCH RA MỘT FILE RIÊNG KHÔNG CÓ PRISMA
 *
 * Đây là phần dễ sai nhất của sản phẩm và cũng là phần cần test dày nhất: lệch
 * một khung 30 phút nghĩa là bán trùng chỗ hoặc tính sai tiền. Tách khỏi tầng
 * dữ liệu thì test chạy trong vài mili giây và không cần database, nên không ai
 * có cớ để lười viết.
 *
 * ---
 * ĐƠN VỊ: PHÚT TỪ 00:00, KHÔNG PHẢI `Date`
 *
 * Giờ mở cửa "06:00–22:00" là thuộc tính của *cái sân*, không gắn với ngày nào.
 * Lưu bằng `Date` buộc phải chọn một ngày giả rồi mọi phép so sánh đều phải cắt
 * bỏ phần ngày — và sớm muộn sẽ có chỗ quên cắt. Số phút thì không có múi giờ,
 * không có giờ mùa hè, và so sánh bằng dấu `<`.
 */

/** Toàn hệ thống chạy bước 30 phút. Đổi số này là đổi cả sản phẩm. */
export const SLOT_MINUTES = 30;

export const MINUTES_PER_DAY = 24 * 60;

/** `"18:30"` → `1110`. Trả `null` cho chuỗi sai định dạng. */
export function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/** `1110` → `"18:30"`. */
export function formatHhMm(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Khung 30 phút phải bắt đầu ở phút 0 hoặc 30. */
export function isSlotAligned(minuteOfDay: number): boolean {
  return Number.isInteger(minuteOfDay) && minuteOfDay % SLOT_MINUTES === 0;
}

/**
 * Danh sách phút bắt đầu của mọi khung trong khoảng `[from, to)`.
 *
 * Nửa mở có chủ đích: sân mở 06:00–22:00 thì khung cuối bắt đầu 21:30 và kết
 * thúc đúng lúc đóng cửa. Nếu đóng khoảng ở cả hai đầu thì sẽ sinh thêm một
 * khung 22:00–22:30 mà sân đã đóng.
 */
export function slotRange(fromMinute: number, toMinute: number): number[] {
  if (!Number.isFinite(fromMinute) || !Number.isFinite(toMinute)) return [];

  const start = Math.ceil(fromMinute / SLOT_MINUTES) * SLOT_MINUTES;
  const slots: number[] = [];

  for (let minute = start; minute + SLOT_MINUTES <= toMinute; minute += SLOT_MINUTES) {
    slots.push(minute);
  }

  return slots;
}

/** Số khung 30 phút giữa hai mốc. Lẻ nửa khung thì làm tròn LÊN. */
export function countSlots(fromMinute: number, toMinute: number): number {
  return Math.max(0, Math.ceil((toMinute - fromMinute) / SLOT_MINUTES));
}

/**
 * Hai khoảng có giao nhau không — nửa mở `[start, end)`.
 *
 * 18:00–19:00 và 19:00–20:00 KHÔNG giao: khung sau bắt đầu đúng lúc khung
 * trước kết thúc. Dùng `<=` ở đây là chặn nhầm mọi lượt đặt liền kề.
 */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Ghép các phút liền nhau thành từng đoạn `[start, end)`. */
export function groupConsecutive(minutes: readonly number[]): { start: number; end: number }[] {
  const sorted = [...new Set(minutes)].sort((a, b) => a - b);
  const blocks: { start: number; end: number }[] = [];

  for (const minute of sorted) {
    const last = blocks.at(-1);

    if (last && last.end === minute) {
      last.end = minute + SLOT_MINUTES;
    } else {
      blocks.push({ start: minute, end: minute + SLOT_MINUTES });
    }
  }

  return blocks;
}

/**
 * Số phút từ 00:00 của một mốc thời gian, theo múi giờ Việt Nam.
 *
 * ⚠️ Không dùng `date.getHours()`: nó theo múi giờ của MÁY CHỦ. Container chạy
 * UTC thì 19:00 giờ Việt Nam thành 12:00, và lịch sân lệch 7 tiếng — loại lỗi
 * chỉ lộ ra sau khi deploy, không bao giờ thấy trên máy dev.
 */
export function minuteOfDayInVN(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);

  return hour * 60 + minute;
}

/** Thứ trong tuần theo giờ Việt Nam. 0 = Chủ nhật, khớp `Date.getDay()`. */
export function weekdayInVN(date: Date): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
  }).format(date);

  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

/** Mốc thời gian tuyệt đối của phút thứ N trong một ngày, theo giờ Việt Nam. */
export function atMinuteVN(dateOnly: Date, minuteOfDay: number): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dateOnly);

  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const minutes = String(minuteOfDay % 60).padStart(2, "0");

  // +07:00 viết cứng: Việt Nam không có giờ mùa hè và chưa từng đổi múi giờ kể
  // từ 1975, nên đây là hằng số chứ không phải giả định tạm.
  return new Date(`${ymd}T${hours}:${minutes}:00+07:00`);
}

/** Tiền VNĐ có dấu chấm ngăn nghìn: `180000` → `"180.000đ"`. */
export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString("vi-VN")}đ`;
}

/** Dạng rút gọn cho ô hẹp trong lưới: `180000` → `"180k"`. */
export function formatVndShort(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}tr`;
  }

  if (amount >= 1000) {
    const thousands = amount / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(0)}k`;
  }

  return String(amount);
}
