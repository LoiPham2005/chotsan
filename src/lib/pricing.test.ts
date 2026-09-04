import { describe, expect, it } from "vitest";
import { priceForSlot, totalForSlots, type PriceRuleInput } from "./pricing";

/**
 * Sai ở đây là tính sai tiền của chủ sân — loại lỗi họ phát hiện lúc đối soát
 * cuối tháng và không ai giải thích nổi vài nghìn đồng chênh từ đâu.
 */

const BASE = 50_000;

function rule(overrides: Partial<PriceRuleInput> = {}): PriceRuleInput {
  return {
    courtId: null,
    weekdays: [],
    startMinute: 0,
    endMinute: 24 * 60,
    pricePerSlot: 60_000,
    isPeak: false,
    priority: 0,
    ...overrides,
  };
}

function ask(params: {
  slot: number;
  weekday?: number;
  courtId?: string;
  rules?: PriceRuleInput[];
  overrides?: Parameters<typeof priceForSlot>[0]["overrides"];
}) {
  return priceForSlot({
    courtId: params.courtId ?? "c1",
    weekday: params.weekday ?? 5,
    slotStartMinute: params.slot,
    basePrice: BASE,
    rules: params.rules ?? [],
    overrides: params.overrides ?? [],
  });
}

describe("giá cơ sở", () => {
  it("dùng khi không luật nào khớp", () => {
    expect(ask({ slot: 10 * 60 })).toEqual({ price: BASE, isPeak: false });
  });

  it("không tự đánh dấu giờ vàng", () => {
    // Giờ vàng là quyết định của chủ sân, không phải mặc định của hệ thống.
    expect(ask({ slot: 19 * 60 }).isPeak).toBe(false);
  });
});

describe("luật theo tuần", () => {
  it("áp đúng khung giờ, không lấn sang khung ngoài", () => {
    const rules = [
      rule({ startMinute: 17 * 60, endMinute: 22 * 60, pricePerSlot: 90_000, isPeak: true }),
    ];

    expect(ask({ slot: 16 * 60 + 30, rules }).price).toBe(BASE);
    expect(ask({ slot: 17 * 60, rules }).price).toBe(90_000);
    expect(ask({ slot: 21 * 60 + 30, rules }).price).toBe(90_000);
    // Khung 22:00–22:30 nằm ngoài luật 17:00–22:00.
    expect(ask({ slot: 22 * 60, rules }).price).toBe(BASE);
  });

  it("lọc theo thứ trong tuần; mảng rỗng nghĩa là mọi ngày", () => {
    const cuoiTuan = [rule({ weekdays: [0, 6], pricePerSlot: 100_000 })];

    expect(ask({ slot: 10 * 60, weekday: 6, rules: cuoiTuan }).price).toBe(100_000);
    expect(ask({ slot: 10 * 60, weekday: 3, rules: cuoiTuan }).price).toBe(BASE);
    expect(ask({ slot: 10 * 60, weekday: 3, rules: [rule({ pricePerSlot: 70_000 })] }).price).toBe(
      70_000,
    );
  });

  it("priority cao thắng khi hai luật cùng khớp", () => {
    const rules = [
      rule({ pricePerSlot: 60_000, priority: 0 }),
      rule({ startMinute: 18 * 60, endMinute: 20 * 60, pricePerSlot: 90_000, priority: 10 }),
    ];

    expect(ask({ slot: 18 * 60, rules }).price).toBe(90_000);
    expect(ask({ slot: 21 * 60, rules }).price).toBe(60_000);
  });

  it("luật gắn đích danh sân con thắng luật áp cả cơ sở khi cùng priority", () => {
    // Luật CỤ THỂ HƠN thắng — nếu không thì đặt giá riêng cho sân VIP không có
    // tác dụng, và chủ sân sẽ tưởng hệ thống hỏng.
    const rules = [
      rule({ courtId: null, pricePerSlot: 60_000 }),
      rule({ courtId: "vip", pricePerSlot: 120_000 }),
    ];

    expect(ask({ slot: 10 * 60, courtId: "vip", rules }).price).toBe(120_000);
    expect(ask({ slot: 10 * 60, courtId: "c1", rules }).price).toBe(60_000);
  });
});

describe("đè giá theo ngày", () => {
  it("thắng mọi luật theo tuần, kể cả luật priority cao nhất", () => {
    const rules = [rule({ pricePerSlot: 90_000, priority: 999, isPeak: true })];
    const overrides = [
      { courtId: null, startMinute: 0, endMinute: 24 * 60, pricePerSlot: 150_000, isPeak: true },
    ];

    expect(ask({ slot: 19 * 60, rules, overrides })).toEqual({ price: 150_000, isPeak: true });
  });

  it("chỉ đè đúng khung giờ được khai", () => {
    const overrides = [
      {
        courtId: null,
        startMinute: 18 * 60,
        endMinute: 20 * 60,
        pricePerSlot: 200_000,
        isPeak: true,
      },
    ];

    expect(ask({ slot: 18 * 60 + 30, overrides }).price).toBe(200_000);
    expect(ask({ slot: 20 * 60, overrides }).price).toBe(BASE);
  });

  it("đè cho riêng một sân con không ảnh hưởng sân khác", () => {
    const overrides = [
      { courtId: "vip", startMinute: 0, endMinute: 24 * 60, pricePerSlot: 300_000, isPeak: false },
    ];

    expect(ask({ slot: 10 * 60, courtId: "vip", overrides }).price).toBe(300_000);
    expect(ask({ slot: 10 * 60, courtId: "c1", overrides }).price).toBe(BASE);
  });
});

describe("totalForSlots", () => {
  it("cộng đúng tiền của một dãy khung", () => {
    // 18:00–20:00 giá vàng = 4 khung × 90k.
    expect(
      totalForSlots([
        { price: 90_000, isPeak: true },
        { price: 90_000, isPeak: true },
        { price: 90_000, isPeak: true },
        { price: 90_000, isPeak: true },
      ]),
    ).toBe(360_000);
  });

  it("cộng đúng khi dãy vắt qua ranh giới giờ vàng", () => {
    // 16:30–18:00: hai khung thường + một khung vàng. Đây là ca mà cách tính
    // "giá/giờ chia đôi" hay sai nhất.
    expect(
      totalForSlots([
        { price: 50_000, isPeak: false },
        { price: 50_000, isPeak: false },
        { price: 75_000, isPeak: true },
      ]),
    ).toBe(175_000);
  });

  it("dãy rỗng cho 0", () => {
    expect(totalForSlots([])).toBe(0);
  });
});
