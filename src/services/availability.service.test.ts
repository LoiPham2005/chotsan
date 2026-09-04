import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { AvailabilityService } from "./availability.service";

/**
 * Lưới sân × khung giờ là màn được mở nhiều nhất của sản phẩm, và cũng là chỗ
 * sai thì thấy ngay: bán trùng chỗ, hiện sai giá, hoặc mở bán giờ đã trôi qua.
 *
 * Ngày dùng xuyên suốt: 2026-09-04 (thứ Sáu, weekday = 5), giờ Việt Nam.
 */

const DATE = new Date("2026-09-04T05:00:00Z"); // 12:00 giờ VN
const VN_MIDNIGHT = new Date("2026-09-03T17:00:00Z"); // 00:00 ngày 04/09 giờ VN

/** Mốc tuyệt đối của phút thứ N trong ngày 04/09 theo giờ VN. */
function at(minute: number): Date {
  return new Date(VN_MIDNIGHT.getTime() + minute * 60_000);
}

type Options = {
  hour?: { openMinute: number; closeMinute: number; isClosed: boolean } | null;
  courts?: { id: string; name: string }[];
  bookings?: { courtId: string; startAt: Date; endAt: Date }[];
  closures?: { courtId: string; startAt: Date; endAt: Date }[];
  rules?: unknown[];
  overrides?: unknown[];
  venue?: { id: string } | null;
};

function createDb(options: Options = {}) {
  return {
    // `??` không dùng được ở đây: `null ?? default` vẫn ra default, mà `null`
    // chính là thứ test muốn truyền vào.
    venue: {
      findFirst: vi.fn().mockResolvedValue("venue" in options ? options.venue : { id: "v1" }),
    },
    venueHour: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options.hour === undefined
            ? { openMinute: 6 * 60, closeMinute: 22 * 60, isClosed: false }
            : options.hour,
        ),
    },
    court: {
      findMany: vi.fn().mockResolvedValue(options.courts ?? [{ id: "c1", name: "Sân 1" }]),
    },
    booking: { findMany: vi.fn().mockResolvedValue(options.bookings ?? []) },
    courtClosure: { findMany: vi.fn().mockResolvedValue(options.closures ?? []) },
    priceRule: { findMany: vi.fn().mockResolvedValue(options.rules ?? []) },
    priceOverride: { findMany: vi.fn().mockResolvedValue(options.overrides ?? []) },
  } as unknown as PrismaClient;
}

/** "Bây giờ" mặc định là hôm khác, để mọi khung đều còn bán được. */
const NOT_TODAY = new Date("2026-09-01T05:00:00Z");

beforeEach(() => vi.clearAllMocks());

describe("forDay — khung giờ mở cửa", () => {
  it("sinh đúng số khung 30 phút giữa giờ mở và giờ đóng", () => {
    return new AvailabilityService(createDb())
      .forDay("v1", DATE, { now: NOT_TODAY })
      .then((day) => {
        // 06:00–22:00 = 16 tiếng = 32 khung.
        expect(day.minutes).toHaveLength(32);
        expect(day.minutes[0]).toBe(360);
        expect(day.minutes.at(-1)).toBe(21 * 60 + 30);
        expect(day.isClosed).toBe(false);
      });
  });

  it("chưa khai giờ mở cửa cho thứ này = ĐÓNG, không đoán khung mặc định", async () => {
    // Đoán bừa sẽ bán ra những giờ mà sân không có ai trực.
    const day = await new AvailabilityService(createDb({ hour: null })).forDay("v1", DATE, {
      now: NOT_TODAY,
    });

    expect(day.isClosed).toBe(true);
    expect(day.minutes).toEqual([]);
  });

  it("sân không tồn tại thì trả lưới rỗng, không ném lỗi", async () => {
    const day = await new AvailabilityService(createDb({ venue: null })).forDay("v9", DATE, {
      now: NOT_TODAY,
    });

    expect(day.isClosed).toBe(true);
  });
});

describe("forDay — lượt đặt đang giữ chỗ", () => {
  it("đánh dấu TAKEN đúng những khung bị chiếm, không lấn sang khung kề", async () => {
    const day = await new AvailabilityService(
      createDb({ bookings: [{ courtId: "c1", startAt: at(18 * 60), endAt: at(19 * 60) }] }),
    ).forDay("v1", DATE, { now: NOT_TODAY });

    const byMinute = new Map(day.courts[0]!.slots.map((slot) => [slot.minute, slot.status]));

    expect(byMinute.get(17 * 60 + 30)).toBe("FREE"); // ngay trước
    expect(byMinute.get(18 * 60)).toBe("TAKEN");
    expect(byMinute.get(18 * 60 + 30)).toBe("TAKEN");
    expect(byMinute.get(19 * 60)).toBe("FREE"); // ngay sau — không lấn
  });

  it("lượt đặt sân này không ảnh hưởng sân khác", async () => {
    const day = await new AvailabilityService(
      createDb({
        courts: [
          { id: "c1", name: "Sân 1" },
          { id: "c2", name: "Sân 2" },
        ],
        bookings: [{ courtId: "c1", startAt: at(18 * 60), endAt: at(19 * 60) }],
      }),
    ).forDay("v1", DATE, { now: NOT_TODAY });

    const slotAt = (courtIndex: number, minute: number) =>
      day.courts[courtIndex]!.slots.find((slot) => slot.minute === minute)!.status;

    expect(slotAt(0, 18 * 60)).toBe("TAKEN");
    expect(slotAt(1, 18 * 60)).toBe("FREE");
  });

  it("bảo trì hiện ĐÓNG, không hiện đã-có-người", async () => {
    // Hai chuyện khác nhau với người đang tìm sân: một cái là hết chỗ, một cái
    // là sân hỏng.
    const day = await new AvailabilityService(
      createDb({ closures: [{ courtId: "c1", startAt: at(14 * 60), endAt: at(16 * 60) }] }),
    ).forDay("v1", DATE, { now: NOT_TODAY });

    const slot = day.courts[0]!.slots.find((item) => item.minute === 15 * 60)!;
    expect(slot.status).toBe("CLOSED");
  });
});

describe("forDay — khung đã trôi qua", () => {
  it("đánh dấu PAST cho khung đã qua TRONG NGÀY HÔM NAY", async () => {
    // 12:00 giờ VN ngày 04/09.
    const now = new Date("2026-09-04T05:00:00Z");

    const day = await new AvailabilityService(createDb()).forDay("v1", DATE, { now });
    const byMinute = new Map(day.courts[0]!.slots.map((slot) => [slot.minute, slot.status]));

    expect(byMinute.get(10 * 60)).toBe("PAST");
    expect(byMinute.get(11 * 60 + 30)).toBe("PAST");
    expect(byMinute.get(12 * 60)).toBe("FREE");
    expect(byMinute.get(19 * 60)).toBe("FREE");
  });

  it("ngày mai thì không khung nào bị coi là đã qua", async () => {
    const day = await new AvailabilityService(createDb()).forDay("v1", DATE, {
      now: new Date("2026-09-03T05:00:00Z"),
    });

    expect(day.courts[0]!.slots.some((slot) => slot.status === "PAST")).toBe(false);
  });
});

describe("forDay — dải tổng quan", () => {
  it("đếm đúng số sân trống theo từng khung", async () => {
    // Người ta hỏi "19h còn sân nào?" — dải này trả lời mà không phải quét lưới.
    const day = await new AvailabilityService(
      createDb({
        courts: [
          { id: "c1", name: "Sân 1" },
          { id: "c2", name: "Sân 2" },
          { id: "c3", name: "Sân 3" },
        ],
        bookings: [
          { courtId: "c1", startAt: at(19 * 60), endAt: at(20 * 60) },
          { courtId: "c2", startAt: at(19 * 60), endAt: at(19 * 60 + 30) },
        ],
      }),
    ).forDay("v1", DATE, { now: NOT_TODAY });

    const indexOf = (minute: number) => day.minutes.indexOf(minute);

    expect(day.summary[indexOf(19 * 60)]).toBe(1); // c1, c2 bận
    expect(day.summary[indexOf(19 * 60 + 30)]).toBe(2); // c2 đã xong
    expect(day.summary[indexOf(20 * 60)]).toBe(3);
  });
});

describe("quote — báo giá trước khi giữ chỗ", () => {
  const RULES = [
    {
      courtId: null,
      weekdays: [],
      startMinute: 17 * 60,
      endMinute: 22 * 60,
      pricePerSlot: 90_000,
      isPeak: true,
      priority: 10,
    },
    {
      courtId: null,
      weekdays: [],
      startMinute: 0,
      endMinute: 24 * 60,
      pricePerSlot: 50_000,
      isPeak: false,
      priority: 0,
    },
  ];

  it("cộng đúng tiền cho hai tiếng giờ vàng", async () => {
    const quote = await new AvailabilityService(createDb({ rules: RULES })).quote({
      venueId: "v1",
      courtId: "c1",
      date: DATE,
      startMinute: 18 * 60,
      endMinute: 20 * 60,
      now: NOT_TODAY,
    });

    expect(quote).not.toBeNull();
    expect(quote!.slotCount).toBe(4);
    expect(quote!.total).toBe(360_000);
  });

  it("cộng đúng khi dãy VẮT QUA ranh giới giờ vàng", async () => {
    // 16:30–18:00 = hai khung thường + hai khung vàng. Đây là ca mà cách tính
    // "giá theo giờ rồi chia đôi" hay sai nhất.
    const quote = await new AvailabilityService(createDb({ rules: RULES })).quote({
      venueId: "v1",
      courtId: "c1",
      date: DATE,
      startMinute: 16 * 60,
      endMinute: 18 * 60,
      now: NOT_TODAY,
    });

    expect(quote!.total).toBe(50_000 * 2 + 90_000 * 2);
  });

  /**
   * Bài test quan trọng nhất của file này.
   *
   * Báo giá phần đặt được rồi để người dùng bấm tiếp là cách chắc chắn để họ
   * nghĩ mình đã đặt cả hai tiếng, rồi tới sân và phát hiện chỉ có một tiếng.
   */
  it("trả null khi CÓ BẤT KỲ khung nào đã bị chiếm, không báo giá phần còn lại", async () => {
    const quote = await new AvailabilityService(
      createDb({
        rules: RULES,
        bookings: [{ courtId: "c1", startAt: at(19 * 60), endAt: at(19 * 60 + 30) }],
      }),
    ).quote({
      venueId: "v1",
      courtId: "c1",
      date: DATE,
      startMinute: 18 * 60,
      endMinute: 20 * 60,
      now: NOT_TODAY,
    });

    expect(quote).toBeNull();
  });

  it("trả null khi khoảng vượt ra ngoài giờ mở cửa", async () => {
    const quote = await new AvailabilityService(createDb({ rules: RULES })).quote({
      venueId: "v1",
      courtId: "c1",
      date: DATE,
      startMinute: 21 * 60,
      endMinute: 23 * 60, // sân đóng lúc 22:00
      now: NOT_TODAY,
    });

    expect(quote).toBeNull();
  });

  it("trả null cho sân con không thuộc cơ sở này", async () => {
    const quote = await new AvailabilityService(createDb({ rules: RULES })).quote({
      venueId: "v1",
      courtId: "khong-ton-tai",
      date: DATE,
      startMinute: 18 * 60,
      endMinute: 19 * 60,
      now: NOT_TODAY,
    });

    expect(quote).toBeNull();
  });

  it("trả null khi khung đã trôi qua trong hôm nay", async () => {
    const quote = await new AvailabilityService(createDb({ rules: RULES })).quote({
      venueId: "v1",
      courtId: "c1",
      date: DATE,
      startMinute: 10 * 60,
      endMinute: 11 * 60,
      now: new Date("2026-09-04T05:00:00Z"), // 12:00 VN
    });

    expect(quote).toBeNull();
  });
});
