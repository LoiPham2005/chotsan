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
 */

export type PriceRuleInput = {
  /** Null = áp cho mọi sân con của cơ sở. */
  courtId: string | null;
  /** Rỗng = mọi ngày trong tuần. 0 = Chủ nhật. */
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  pricePerSlot: number;
  isPeak: boolean;
  priority: number;
};

export type PriceOverrideInput = {
  courtId: string | null;
  startMinute: number;
  endMinute: number;
  pricePerSlot: number;
  isPeak: boolean;
};

export type SlotPrice = {
  price: number;
  isPeak: boolean;
};

/**
 * Giá của MỘT khung, cho một sân con, vào một thứ cụ thể.
 *
 * `overrides` đã được lọc sẵn theo ngày ở tầng gọi — hàm này không biết gì về
 * `Date`, đó là lý do nó test được mà không cần dựng dữ liệu thời gian.
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

  // Tầng 3 — đè theo ngày. Thắng mọi luật, không cần xét priority: mỗi ngày lễ
  // chỉ có một bảng giá, chồng chéo ở đây là lỗi nhập liệu chứ không phải luật.
  const override = overrides.find(
    (item) =>
      (item.courtId === null || item.courtId === courtId) &&
      overlaps(item.startMinute, item.endMinute, slotStartMinute, slotEnd),
  );

  if (override) {
    return { price: override.pricePerSlot, isPeak: override.isPeak };
  }

  // Tầng 2 — luật theo tuần. Luật CỤ THỂ HƠN thắng: priority cao trước, và khi
  // bằng nhau thì luật gắn đích danh sân con thắng luật áp cho cả cơ sở.
  const matched = rules
    .filter(
      (rule) =>
        (rule.courtId === null || rule.courtId === courtId) &&
        (rule.weekdays.length === 0 || rule.weekdays.includes(weekday)) &&
        overlaps(rule.startMinute, rule.endMinute, slotStartMinute, slotEnd),
    )
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (b.courtId === null ? 0 : 1) - (a.courtId === null ? 0 : 1);
    });

  const rule = matched[0];
  if (rule) return { price: rule.pricePerSlot, isPeak: rule.isPeak };

  // Tầng 1 — giá cơ sở. Không đánh dấu giờ vàng: giờ vàng là một quyết định của
  // chủ sân, không phải mặc định của hệ thống.
  return { price: basePrice, isPeak: false };
}

/** Tổng tiền của một dãy khung liên tiếp. */
export function totalForSlots(slots: readonly SlotPrice[]): number {
  return slots.reduce((sum, slot) => sum + slot.price, 0);
}
