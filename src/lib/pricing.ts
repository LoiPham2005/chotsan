import { overlaps, SLOT_MINUTES } from "./slots";

/**
 * Chọn giá cho từng khung 30 phút — thuần tuý, không chạm database.
 *
 * ---
 * BA TẦNG, TẦNG SAU ĐÈ TẦNG TRƯỚC
 *
 *   1. Giá cơ sở của sân (khi không luật nào khớp)
 *   2. `PriceRule` — theo thứ trong tuần và khung giờ, `priority` cao thắng
 *   3. `PriceOverride` — theo NGÀY cụ thể (lễ, sự kiện), thắng tất cả
 *
 * ---
 * VÌ SAO GIÁ LƯU THEO KHUNG 30 PHÚT, KHÔNG PHẢI THEO GIỜ
 *
 * Lưu "180.000đ/giờ" rồi chia đôi lúc chạy là chỗ sinh lệch tròn số: 175.000
 * chia đôi ra 87.500, và tuỳ chỗ làm tròn mà hai khung cộng lại thành 174.000
 * hay 176.000. Chủ sân sẽ phát hiện ra khi đối soát cuối tháng, và không ai
 * giải thích nổi vài nghìn đồng chênh từ đâu.
 *
 * ---
 * LUẬT CHỒNG NHAU PHẢI RA CÙNG MỘT GIÁ MỖI LẦN HỎI
 *
 * Trước đây hai luật cùng priority phủ cùng một khung thì luật nào thắng tuỳ
 * thứ tự database trả về — mà truy vấn không `orderBy`, nên thứ tự đó đổi theo
 * kế hoạch truy vấn. Khách thấy 70k trên lưới rồi bị giữ chỗ với giá 110k. Nay
 * thứ tự được chốt ngay trong hàm này, không phụ thuộc thứ tự đầu vào:
 * priority cao → luật riêng sân con → luật mới hơn → `id` nhỏ hơn.
 */

export type PriceRuleInput = {
  id: string;
  /** Null = áp cho mọi sân con của cơ sở. */
  courtId: string | null;
  /** Rỗng = mọi ngày trong tuần. 0 = Chủ nhật. */
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  pricePerSlot: number;
  isPeak: boolean;
  priority: number;
  createdAt: Date;
};

export type PriceOverrideInput = {
  id: string;
  courtId: string | null;
  startMinute: number;
  endMinute: number;
  pricePerSlot: number;
  isPeak: boolean;
  createdAt: Date;
};

export type SlotPrice = {
  price: number;
  isPeak: boolean;
};

/**
 * Thứ tự khi mọi tiêu chí nghiệp vụ khác đã bằng nhau: riêng sân con trước cả
 * cơ sở, mới hơn trước cũ hơn, rồi `id` — tiêu chí cuối cùng luôn phân định
 * được, nên không bao giờ có "hoà".
 */
function specificFirstThenNewest(
  a: { id: string; courtId: string | null; createdAt: Date },
  b: { id: string; courtId: string | null; createdAt: Date },
): number {
  const specific = (b.courtId === null ? 0 : 1) - (a.courtId === null ? 0 : 1);
  if (specific !== 0) return specific;

  const newer = b.createdAt.getTime() - a.createdAt.getTime();
  if (newer !== 0) return newer;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Giá của MỘT khung, cho một sân con, vào một thứ cụ thể.
 *
 * `overrides` đã được lọc sẵn theo ngày ở tầng gọi — hàm này không cần biết
 * khung thuộc ngày nào, đó là lý do nó test được mà không dựng dữ liệu lịch.
 */
export function priceForSlot(params: {
  courtId: string;
  weekday: number;
  slotStartMinute: number;
  basePrice: number;
  rules: readonly PriceRuleInput[];
  overrides: readonly PriceOverrideInput[];
}): SlotPrice {
  const { courtId, weekday, slotStartMinute, basePrice, rules, overrides } = params;
  const slotEnd = slotStartMinute + SLOT_MINUTES;

  // Tầng 3 — đè theo ngày. Thắng mọi luật, không xét priority: mỗi ngày lễ chỉ
  // nên có một bảng giá. Chồng nhau vẫn phải ra một giá xác định — đè riêng
  // cho sân con thắng đè cả cơ sở, rồi đè mới nhất.
  const override = overrides
    .filter(
      (item) =>
        (item.courtId === null || item.courtId === courtId) &&
        overlaps(item.startMinute, item.endMinute, slotStartMinute, slotEnd),
    )
    .sort(specificFirstThenNewest)[0];

  if (override) {
    return { price: override.pricePerSlot, isPeak: override.isPeak };
  }

  // Tầng 2 — luật theo tuần. Luật CỤ THỂ HƠN thắng: priority cao trước, và khi
  // bằng nhau thì luật gắn đích danh sân con thắng luật áp cho cả cơ sở.
  const rule = rules
    .filter(
      (item) =>
        (item.courtId === null || item.courtId === courtId) &&
        (item.weekdays.length === 0 || item.weekdays.includes(weekday)) &&
        overlaps(item.startMinute, item.endMinute, slotStartMinute, slotEnd),
    )
    .sort((a, b) => b.priority - a.priority || specificFirstThenNewest(a, b))[0];

  if (rule) return { price: rule.pricePerSlot, isPeak: rule.isPeak };

  // Tầng 1 — giá cơ sở. Không đánh dấu giờ vàng: giờ vàng là một quyết định của
  // chủ sân, không phải mặc định của hệ thống.
  return { price: basePrice, isPeak: false };
}

/** Tổng tiền của một dãy khung liên tiếp. */
export function totalForSlots(slots: readonly SlotPrice[]): number {
  return slots.reduce((sum, slot) => sum + slot.price, 0);
}
