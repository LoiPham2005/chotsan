import { describe, expect, it } from "vitest";
import {
  priceForSlot,
  totalForSlots,
  type PriceOverrideInput,
  type PriceRuleInput,
} from "./pricing";

/**
 * Sai ở đây là tính sai tiền của chủ sân — loại lỗi họ phát hiện lúc đối soát
 * cuối tháng và không ai giải thích nổi vài nghìn đồng chênh từ đâu.
 */

const BASE = 50_000;
const CREATED = new Date("2026-09-01T03:00:00Z");

function rule(overrides: Partial<PriceRuleInput> = {}): PriceRuleInput {
  return {
    id: "r1",
    courtId: null,
    weekdays: [],
    startMinute: 0,
    endMinute: 24 * 60,
    pricePerSlot: 60_000,
    isPeak: false,
    priority: 0,
    createdAt: CREATED,
    ...overrides,
  };
}

function override(overrides: Partial<PriceOverrideInput> = {}): PriceOverrideInput {
  return {
    id: "o1",
    courtId: null,
    startMinute: 0,
    endMinute: 24 * 60,
    pricePerSlot: 150_000,
    isPeak: true,
    createdAt: CREATED,
    ...overrides,
  };
}

function ask(params: {
  slot: number;
  weekday?: number;
  courtId?: string;
  rules?: PriceRuleInput[];
  overrides?: PriceOverrideInput[];
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
    const weekend = [rule({ weekdays: [0, 6], pricePerSlot: 100_000 })];

    expect(ask({ slot: 10 * 60, weekday: 6, rules: weekend }).price).toBe(100_000);
    expect(ask({ slot: 10 * 60, weekday: 3, rules: weekend }).price).toBe(BASE);
    expect(ask({ slot: 10 * 60, weekday: 3, rules: [rule({ pricePerSlot: 70_000 })] }).price).toBe(
      70_000,
    );
  });

  it("priority cao thắng khi hai luật cùng khớp", () => {
    const rules = [
      rule({ id: "r1", pricePerSlot: 60_000, priority: 0 }),
      rule({
        id: "r2",
        startMinute: 18 * 60,
        endMinute: 20 * 60,
        pricePerSlot: 90_000,
        priority: 10,
      }),
    ];

    expect(ask({ slot: 18 * 60, rules }).price).toBe(90_000);
    expect(ask({ slot: 21 * 60, rules }).price).toBe(60_000);
  });

  it("luật gắn đích danh sân con thắng luật áp cả cơ sở khi cùng priority", () => {
    // Luật CỤ THỂ HƠN thắng — nếu không thì đặt giá riêng cho sân VIP không có
    // tác dụng, và chủ sân sẽ tưởng hệ thống hỏng.
    const rules = [
      rule({ id: "r1", courtId: null, pricePerSlot: 60_000 }),
      rule({ id: "r2", courtId: "vip", pricePerSlot: 120_000 }),
    ];

    expect(ask({ slot: 10 * 60, courtId: "vip", rules }).price).toBe(120_000);
    expect(ask({ slot: 10 * 60, courtId: "c1", rules }).price).toBe(60_000);
  });
});

/**
 * Lỗi thật trước đây: truy vấn luật giá không `orderBy`, nên hai luật chồng
 * nhau cùng priority cho giá tuỳ database trả dòng nào trước. Mỗi bài dưới đây
 * đảo thứ tự đầu vào để chứng minh kết quả KHÔNG phụ thuộc thứ tự đó.
 */
describe("luật chồng nhau — giá phải xác định", () => {
  function bothOrders<T>(items: T[]): T[][] {
    return [items, [...items].reverse()];
  }

  it("cùng priority, cùng phạm vi: luật MỚI HƠN thắng", () => {
    const older = rule({ id: "r-cu", pricePerSlot: 60_000 });
    const newer = rule({
      id: "r-moi",
      pricePerSlot: 80_000,
      createdAt: new Date(CREATED.getTime() + 60_000),
    });

    for (const rules of bothOrders([older, newer])) {
      expect(ask({ slot: 10 * 60, rules }).price).toBe(80_000);
    }
  });

  it("cùng priority, cùng phạm vi, cùng lúc tạo: `id` nhỏ hơn thắng — không bao giờ hoà", () => {
    // Bảng giá được lưu CẢ BẢNG trong một transaction nên mọi luật chung một
    // `createdAt`; phải có tiêu chí cuối cùng luôn phân định được.
    const a = rule({ id: "cm-a", pricePerSlot: 60_000 });
    const b = rule({ id: "cm-b", pricePerSlot: 90_000 });

    for (const rules of bothOrders([a, b])) {
      expect(ask({ slot: 10 * 60, rules }).price).toBe(60_000);
    }
  });

  it("luật riêng sân con thắng luật cả cơ sở dù luật cả cơ sở mới hơn", () => {
    const specific = rule({ id: "r1", courtId: "c1", pricePerSlot: 120_000 });
    const venueWide = rule({
      id: "r2",
      courtId: null,
      pricePerSlot: 60_000,
      createdAt: new Date(CREATED.getTime() + 60_000),
    });

    for (const rules of bothOrders([specific, venueWide])) {
      expect(ask({ slot: 10 * 60, courtId: "c1", rules }).price).toBe(120_000);
    }
  });

  it("priority vẫn đứng trên mọi tiêu chí khác", () => {
    const specificNewer = rule({
      id: "r1",
      courtId: "c1",
      pricePerSlot: 120_000,
      createdAt: new Date(CREATED.getTime() + 60_000),
    });
    const highPriority = rule({ id: "r2", courtId: null, pricePerSlot: 90_000, priority: 5 });

    for (const rules of bothOrders([specificNewer, highPriority])) {
      expect(ask({ slot: 10 * 60, courtId: "c1", rules }).price).toBe(90_000);
    }
  });
});

describe("đè giá theo ngày", () => {
  it("thắng mọi luật theo tuần, kể cả luật priority cao nhất", () => {
    const rules = [rule({ pricePerSlot: 90_000, priority: 999, isPeak: true })];
    const overrides = [override()];

    expect(ask({ slot: 19 * 60, rules, overrides })).toEqual({ price: 150_000, isPeak: true });
  });

  it("chỉ đè đúng khung giờ được khai", () => {
    const overrides = [
      override({ startMinute: 18 * 60, endMinute: 20 * 60, pricePerSlot: 200_000 }),
    ];

    expect(ask({ slot: 18 * 60 + 30, overrides }).price).toBe(200_000);
    expect(ask({ slot: 20 * 60, overrides }).price).toBe(BASE);
  });

  it("đè cho riêng một sân con không ảnh hưởng sân khác", () => {
    const overrides = [override({ courtId: "vip", pricePerSlot: 300_000, isPeak: false })];

    expect(ask({ slot: 10 * 60, courtId: "vip", overrides }).price).toBe(300_000);
    expect(ask({ slot: 10 * 60, courtId: "c1", overrides }).price).toBe(BASE);
  });

  it("hai đè giá chồng nhau: riêng sân con thắng, rồi mới nhất — không tuỳ thứ tự đầu vào", () => {
    const venueWide = override({ id: "o1", pricePerSlot: 150_000 });
    const specific = override({ id: "o2", courtId: "c1", pricePerSlot: 250_000 });
    const newerVenueWide = override({
      id: "o3",
      pricePerSlot: 180_000,
      createdAt: new Date(CREATED.getTime() + 60_000),
    });

    for (const overrides of [
      [venueWide, specific, newerVenueWide],
      [newerVenueWide, specific, venueWide],
    ]) {
      expect(ask({ slot: 10 * 60, courtId: "c1", overrides }).price).toBe(250_000);
      expect(ask({ slot: 10 * 60, courtId: "c2", overrides }).price).toBe(180_000);
    }
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
    // 16:00–17:30 với giờ vàng từ 17:00: hai khung thường (16:00, 16:30) + một
    // khung vàng (17:00). Đây là ca mà cách tính "giá/giờ chia đôi" hay sai nhất.
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
