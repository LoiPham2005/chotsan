import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  AvailabilityService,
  occupyingBookingWhere,
  quoteFromDay,
  type DayAvailability,
} from "./availability.service";

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

/** Luật giá phủ cả ngày — thiếu nó thì mọi khung là "chưa mở bán". */
const ALL_DAY_RULE = {
  id: "r-all-day",
  courtId: null,
  weekdays: [],
  startMinute: 0,
  endMinute: 24 * 60,
  pricePerSlot: 50_000,
  isPeak: false,
  priority: 0,
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

type VenueRow = { id: string; status: string; deletedAt: Date | null };

type Options = {
  hour?: { openMinute: number; closeMinute: number; isClosed: boolean } | null;
  courts?: { id: string; name: string }[];
  bookings?: { courtId: string; startAt: Date; endAt: Date }[];
  closures?: { courtId: string; startAt: Date; endAt: Date }[];
  rules?: unknown[];
  overrides?: unknown[];
  venue?: VenueRow | null;
};

function createDb(options: Options = {}) {
  const venue: VenueRow | null =
    "venue" in options ? (options.venue ?? null) : { id: "v1", status: "ACTIVE", deletedAt: null };

  return {
    venue: {
      // Lọc THẬT theo `where`: bài "cơ sở không mở bán" chỉ có nghĩa khi mock
      // không trả bừa bản ghi bất kể điều kiện.
      findFirst: vi.fn(({ where }: { where: { id: string; status?: string; deletedAt?: null } }) =>
        Promise.resolve(
          venue &&
            venue.id === where.id &&
            (where.status === undefined || venue.status === where.status) &&
            (!("deletedAt" in where) || venue.deletedAt === null)
            ? { id: venue.id }
            : null,
        ),
      ),
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
    priceRule: { findMany: vi.fn().mockResolvedValue(options.rules ?? [ALL_DAY_RULE]) },
    priceOverride: { findMany: vi.fn().mockResolvedValue(options.overrides ?? []) },
  } as unknown as PrismaClient;
}

/** "Bây giờ" mặc định là hôm TRƯỚC ngày đang xem, để mọi khung đều còn bán được. */
const DAY_BEFORE = new Date("2026-09-01T05:00:00Z");

beforeEach(() => vi.clearAllMocks());

describe("forDay — khung giờ mở cửa", () => {
  it("sinh đúng số khung 30 phút giữa giờ mở và giờ đóng", async () => {
    const day = await new AvailabilityService(createDb()).forDay("v1", DATE, { now: DAY_BEFORE });

    // 06:00–22:00 = 16 tiếng = 32 khung.
    expect(day.minutes).toHaveLength(32);
    expect(day.minutes[0]).toBe(360);
    expect(day.minutes.at(-1)).toBe(21 * 60 + 30);
    expect(day.isClosed).toBe(false);
  });

  it("chưa khai giờ mở cửa cho thứ này = ĐÓNG, không đoán khung mặc định", async () => {
    // Đoán bừa sẽ bán ra những giờ mà sân không có ai trực.
    const day = await new AvailabilityService(createDb({ hour: null })).forDay("v1", DATE, {
      now: DAY_BEFORE,
    });

    expect(day.isClosed).toBe(true);
    expect(day.minutes).toEqual([]);
  });

  it("sân không tồn tại thì trả lưới rỗng, không ném lỗi", async () => {
    const day = await new AvailabilityService(createDb({ venue: null })).forDay("v9", DATE, {
      now: DAY_BEFORE,
    });

    expect(day.isClosed).toBe(true);
  });

  /**
   * Lỗi thật trước đây: lịch chỉ lọc `deletedAt`, nên request tự chế tới một cơ
   * sở nháp, tạm nghỉ hay bị admin khoá vẫn thấy lưới trống và đặt được.
   */
  it("cơ sở KHÔNG mở bán (nháp, tạm nghỉ, bảo trì, bị khoá) thì lưới rỗng", async () => {
    for (const status of ["DRAFT", "PENDING", "SUSPENDED", "UNDER_MAINTENANCE", "ADMIN_LOCKED"]) {
      const db = createDb({ venue: { id: "v1", status, deletedAt: null } });
      const day = await new AvailabilityService(db).forDay("v1", DATE, { now: DAY_BEFORE });

      expect(day.isClosed).toBe(true);
      expect(day.courts).toEqual([]);
    }
  });

  it("ngày tính theo giờ VN: 00:30 sáng 04/09 giờ VN vẫn là ngày 04/09", async () => {
    // 17:30 UTC ngày 03/09 = 00:30 ngày 04/09 giờ VN. Lấy ngày theo giờ máy chủ
    // (UTC) là ra 03/09 và bán lịch của hôm trước.
    const day = await new AvailabilityService(createDb()).forDay(
      "v1",
      new Date("2026-09-03T17:30:00Z"),
      { now: DAY_BEFORE },
    );

    expect(day.date).toBe("2026-09-04");
  });
});

describe("forDay — lượt đặt đang giữ chỗ", () => {
  it("đánh dấu TAKEN đúng những khung bị chiếm, không lấn sang khung kề", async () => {
    const day = await new AvailabilityService(
      createDb({ bookings: [{ courtId: "c1", startAt: at(18 * 60), endAt: at(19 * 60) }] }),
    ).forDay("v1", DATE, { now: DAY_BEFORE });

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
    ).forDay("v1", DATE, { now: DAY_BEFORE });

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
    ).forDay("v1", DATE, { now: DAY_BEFORE });

    const slot = day.courts[0]!.slots.find((item) => item.minute === 15 * 60)!;
    expect(slot.status).toBe("CLOSED");
  });
});

describe("forDay — khung đã trôi qua", () => {
  it("hôm nay: khung đã BẮT ĐẦU là PAST, kể cả khung bắt đầu đúng lúc này", async () => {
    // 12:00 giờ VN ngày 04/09. Khung 12:00 bắt đầu đúng bây giờ = đã bắt đầu —
    // khớp điều kiện `holdCheckout` từ chối, để lưới không bày ra ô bấm vào là lỗi.
    const now = new Date("2026-09-04T05:00:00Z");

    const day = await new AvailabilityService(createDb()).forDay("v1", DATE, { now });
    const byMinute = new Map(day.courts[0]!.slots.map((slot) => [slot.minute, slot.status]));

    expect(day.timing).toBe("TODAY");
    expect(byMinute.get(10 * 60)).toBe("PAST");
    expect(byMinute.get(11 * 60 + 30)).toBe("PAST");
    expect(byMinute.get(12 * 60)).toBe("PAST");
    expect(byMinute.get(12 * 60 + 30)).toBe("FREE");
    expect(byMinute.get(19 * 60)).toBe("FREE");
  });

  it("một giây trước giờ bắt đầu thì khung vẫn còn bán", async () => {
    const now = new Date(at(12 * 60).getTime() - 1_000); // 11:59:59 giờ VN
    const day = await new AvailabilityService(createDb()).forDay("v1", DATE, { now });

    expect(day.courts[0]!.slots.find((slot) => slot.minute === 12 * 60)!.status).toBe("FREE");
  });

  it("ngày mai thì không khung nào bị coi là đã qua", async () => {
    // Bây giờ là 12:00 VN ngày 03/09 — ngày đang xem (04/09) là ngày mai.
    const day = await new AvailabilityService(createDb()).forDay("v1", DATE, {
      now: new Date("2026-09-03T05:00:00Z"),
    });

    expect(day.timing).toBe("FUTURE");
    expect(day.courts[0]!.slots.some((slot) => slot.status === "PAST")).toBe(false);
  });

  /**
   * Lỗi thật trước đây: "đã qua" chỉ tính cho HÔM NAY (`nowMinute = -1` với mọi
   * ngày khác), nên mở `?date=` của hôm qua là cả ngày FREE và đặt được.
   */
  it("NGÀY ĐÃ QUA: mọi khung đều PAST, không khung nào còn bán", async () => {
    // Bây giờ là 08:00 VN ngày 05/09 — ngày đang xem (04/09) đã qua.
    const day = await new AvailabilityService(createDb()).forDay("v1", DATE, {
      now: new Date("2026-09-05T01:00:00Z"),
    });

    expect(day.timing).toBe("PAST");
    expect(day.courts[0]!.slots.every((slot) => slot.status === "PAST")).toBe(true);
    expect(day.summary.every((count) => count === 0)).toBe(true);
  });
});

describe("forDay — khung chưa có giá", () => {
  /**
   * Lỗi thật trước đây: không luật giá nào phủ khung → giá 0đ → khách đặt được
   * lượt 0đ → mở giao dịch vi phạm CHECK `amount > 0` → trang thanh toán 500.
   */
  it("khung không luật giá nào phủ là NOT_FOR_SALE, không phải FREE 0đ", async () => {
    const day = await new AvailabilityService(
      createDb({
        rules: [{ ...ALL_DAY_RULE, startMinute: 17 * 60, endMinute: 22 * 60 }],
      }),
    ).forDay("v1", DATE, { now: DAY_BEFORE });

    const byMinute = new Map(day.courts[0]!.slots.map((slot) => [slot.minute, slot.status]));

    expect(byMinute.get(16 * 60 + 30)).toBe("NOT_FOR_SALE");
    expect(byMinute.get(17 * 60)).toBe("FREE");
    // Dải tổng quan không đếm khung không bán được là "còn trống".
    expect(day.summary[day.minutes.indexOf(16 * 60 + 30)]).toBe(0);
  });

  it("luật giá 0đ cũng là chưa mở bán", async () => {
    const day = await new AvailabilityService(
      createDb({ rules: [{ ...ALL_DAY_RULE, pricePerSlot: 0 }] }),
    ).forDay("v1", DATE, { now: DAY_BEFORE });

    expect(day.courts[0]!.slots.every((slot) => slot.status === "NOT_FOR_SALE")).toBe(true);
  });

  it("khung đã qua thì nói ĐÃ QUA, không nói chưa có giá", async () => {
    const day = await new AvailabilityService(createDb({ rules: [] })).forDay("v1", DATE, {
      now: new Date("2026-09-04T05:00:00Z"),
    });

    expect(day.courts[0]!.slots.find((slot) => slot.minute === 10 * 60)!.status).toBe("PAST");
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
    ).forDay("v1", DATE, { now: DAY_BEFORE });

    const indexOf = (minute: number) => day.minutes.indexOf(minute);

    expect(day.summary[indexOf(19 * 60)]).toBe(1); // c1, c2 bận
    expect(day.summary[indexOf(19 * 60 + 30)]).toBe(2); // c2 đã xong
    expect(day.summary[indexOf(20 * 60)]).toBe(3);
  });
});

describe("forDay — luật giá chồng nhau", () => {
  it("đọc kèm `id` và `createdAt` để chọn được MỘT luật xác định", async () => {
    // Thiếu hai cột này thì `priceForSlot` không có gì để phân định hai luật
    // cùng priority, và giá lại tuỳ thứ tự database trả về.
    const db = createDb();
    await new AvailabilityService(db).forDay("v1", DATE, { now: DAY_BEFORE });

    const [{ select }] = vi.mocked(db.priceRule.findMany).mock.calls[0] as unknown as [
      { select: Record<string, boolean> },
    ];
    expect(select).toMatchObject({ id: true, createdAt: true, priority: true });
  });

  it("hai luật cùng priority phủ cùng khung: luật mới hơn thắng, dù database trả theo thứ tự nào", async () => {
    const older = { ...ALL_DAY_RULE, id: "r-cu", pricePerSlot: 60_000 };
    const newer = {
      ...ALL_DAY_RULE,
      id: "r-moi",
      pricePerSlot: 80_000,
      createdAt: new Date("2026-09-02T00:00:00Z"),
    };

    for (const rules of [
      [older, newer],
      [newer, older],
    ]) {
      const day = await new AvailabilityService(createDb({ rules })).forDay("v1", DATE, {
        now: DAY_BEFORE,
      });
      expect(day.courts[0]!.slots[0]!.price).toBe(80_000);
    }
  });
});

describe("quote — báo giá trước khi giữ chỗ", () => {
  const RULES = [
    {
      ...ALL_DAY_RULE,
      id: "r-peak",
      startMinute: 17 * 60,
      endMinute: 22 * 60,
      pricePerSlot: 90_000,
      isPeak: true,
      priority: 10,
    },
    { ...ALL_DAY_RULE, id: "r-base" },
  ];

  it("cộng đúng tiền cho hai tiếng giờ vàng", async () => {
    const quote = await new AvailabilityService(createDb({ rules: RULES })).quote({
      venueId: "v1",
      courtId: "c1",
      date: DATE,
      startMinute: 18 * 60,
      endMinute: 20 * 60,
      now: DAY_BEFORE,
    });

    expect(quote).not.toBeNull();
    expect(quote!.slotCount).toBe(4);
    expect(quote!.total).toBe(360_000);
  });

  it("cộng đúng khi dãy VẮT QUA ranh giới giờ vàng", async () => {
    // 16:00–18:00 = hai khung thường (16:00, 16:30) + hai khung vàng (17:00,
    // 17:30). Đây là ca mà cách tính "giá theo giờ rồi chia đôi" hay sai nhất.
    const quote = await new AvailabilityService(createDb({ rules: RULES })).quote({
      venueId: "v1",
      courtId: "c1",
      date: DATE,
      startMinute: 16 * 60,
      endMinute: 18 * 60,
      now: DAY_BEFORE,
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
      now: DAY_BEFORE,
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
      now: DAY_BEFORE,
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
      now: DAY_BEFORE,
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

describe("quoteFromDay — lý do không đặt được", () => {
  function dayWith(statuses: Record<number, "TAKEN" | "CLOSED" | "PAST" | "NOT_FOR_SALE">) {
    const minutes = [18 * 60, 18 * 60 + 30, 19 * 60, 19 * 60 + 30];
    return {
      venueId: "v1",
      date: "2026-09-04",
      timing: "FUTURE",
      minutes,
      summary: minutes.map(() => 1),
      isClosed: false,
      courts: [
        {
          courtId: "c1",
          courtName: "Sân 1",
          slots: minutes.map((minute) => ({
            minute,
            status: statuses[minute] ?? "FREE",
            price: 70_000,
            isPeak: false,
          })),
        },
      ],
    } satisfies DayAvailability;
  }

  const RANGE = { courtId: "c1", startMinute: 18 * 60, endMinute: 20 * 60 };

  it("đặt được thì không có lý do, tiền là tổng các khung", () => {
    expect(quoteFromDay(dayWith({}), RANGE)).toMatchObject({
      available: true,
      reason: null,
      slotCount: 4,
      total: 280_000,
    });
  });

  it("nói ĐÚNG lý do của khung chặn", () => {
    expect(quoteFromDay(dayWith({ [19 * 60]: "TAKEN" }), RANGE).reason).toBe("TAKEN");
    expect(quoteFromDay(dayWith({ [19 * 60]: "CLOSED" }), RANGE).reason).toBe("CLOSED");
    expect(quoteFromDay(dayWith({ [19 * 60]: "NOT_FOR_SALE" }), RANGE).reason).toBe("NOT_FOR_SALE");
  });

  it("nhiều lý do cùng lúc thì 'đã qua giờ' đứng trước — chuyện không sửa được nói trước", () => {
    const day = dayWith({ [18 * 60]: "PAST", [19 * 60]: "TAKEN" });
    expect(quoteFromDay(day, RANGE).reason).toBe("PAST");
  });

  it("sân con lạ, ngoài giờ, ngày nghỉ đều có lý do riêng", () => {
    expect(quoteFromDay(dayWith({}), { ...RANGE, courtId: "san-la" }).reason).toBe("COURT");
    expect(quoteFromDay(dayWith({}), { ...RANGE, endMinute: 21 * 60 }).reason).toBe(
      "OUTSIDE_HOURS",
    );
    expect(quoteFromDay({ ...dayWith({}), isClosed: true, courts: [] }, RANGE).reason).toBe(
      "DAY_CLOSED",
    );
  });
});

describe("excludeBookingId — dùng khi đổi giờ", () => {
  it("loại lượt đặt được chỉ định ra khỏi truy vấn, không lọc sau khi đã đọc", async () => {
    // Lọc trong bộ nhớ thì `summary` và giá vẫn đúng, nhưng đây là chỗ dễ quên
    // một nhánh; loại ngay trong câu truy vấn thì không có nhánh nào để quên.
    const db = createDb();
    await new AvailabilityService(db).forDay("v1", DATE, {
      now: DAY_BEFORE,
      excludeBookingId: "b1",
    });

    const [{ where }] = (
      db.booking.findMany as unknown as { mock: { calls: [{ where: { id?: { not: string } } }][] } }
    ).mock.calls[0]!;

    expect(where.id).toEqual({ not: "b1" });
  });

  it("không truyền thì KHÔNG thêm điều kiện — lịch bình thường không giấu gì", async () => {
    const db = createDb();
    await new AvailabilityService(db).forDay("v1", DATE, { now: DAY_BEFORE });

    const [{ where }] = (
      db.booking.findMany as unknown as { mock: { calls: [{ where: { id?: unknown } }][] } }
    ).mock.calls[0]!;

    expect(where.id).toBeUndefined();
  });
});

describe("chỗ giữ quá hạn — không chiếm khung dù cron chưa nhả", () => {
  const NOW = new Date("2026-09-04T03:00:00Z");

  /**
   * Lỗi thật: giữ chỗ lúc 09:38, tới 10:41 vẫn khoá sân — vì thứ duy nhất nhả
   * chỗ là cron ở worker, mà máy dev chỉ chạy `pnpm dev`. Lịch phải tự tính đúng
   * bất kể worker sống hay chết.
   */
  it("truy vấn chỉ lấy HOLDING còn hạn hoặc không có hạn, cùng mọi lượt đã xác nhận", async () => {
    const db = createDb();
    await new AvailabilityService(db).forDay("v1", DATE, { now: NOW });

    const where = vi.mocked(db.booking.findMany).mock.calls[0]![0]!.where;
    expect(where).toMatchObject(occupyingBookingWhere(NOW));
    expect(occupyingBookingWhere(NOW)).toEqual({
      OR: [
        { status: { in: ["CONFIRMED", "CHECKED_IN"] } },
        { status: "HOLDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: NOW } }] },
      ],
    });
  });

  it("khách đã báo chuyển khoản (hạn = null) thì VẪN chiếm khung", () => {
    // Đang chờ chủ sân đối chiếu tiền — nhả chỗ lúc này là bán lại chỗ đã trả tiền.
    const holding = occupyingBookingWhere(NOW).OR[1]!;
    expect(holding).toMatchObject({ OR: expect.arrayContaining([{ holdExpiresAt: null }]) });
  });
});

describe("quoteMany — báo giá nhiều dãy của một lần đặt", () => {
  it("đọc lịch MỘT lần cho mọi dãy", async () => {
    const db = createDb({
      courts: [
        { id: "c1", name: "Sân 1" },
        { id: "c2", name: "Sân 2" },
      ],
    });
    const quotes = await new AvailabilityService(db).quoteMany({
      venueId: "v1",
      date: DATE,
      now: DAY_BEFORE,
      ranges: [
        { courtId: "c1", startMinute: 18 * 60, endMinute: 19 * 60 },
        { courtId: "c2", startMinute: 20 * 60, endMinute: 20 * 60 + 30 },
        { courtId: "c1", startMinute: 21 * 60, endMinute: 22 * 60 },
      ],
    });

    expect(db.booking.findMany).toHaveBeenCalledTimes(1);
    expect(quotes.map((quote) => [quote.courtName, quote.available, quote.slotCount])).toEqual([
      ["Sân 1", true, 2],
      ["Sân 2", true, 1],
      ["Sân 1", true, 2],
    ]);
  });

  it("trả ĐỦ mọi dãy, dãy hỏng đánh dấu không đặt được kèm tên sân và lý do", async () => {
    const db = createDb({
      courts: [
        { id: "c1", name: "Sân 1" },
        { id: "c2", name: "Sân 2" },
      ],
      bookings: [{ courtId: "c2", startAt: at(20 * 60), endAt: at(21 * 60) }],
    });
    const quotes = await new AvailabilityService(db).quoteMany({
      venueId: "v1",
      date: DATE,
      now: DAY_BEFORE,
      ranges: [
        { courtId: "c1", startMinute: 20 * 60, endMinute: 21 * 60 },
        { courtId: "c2", startMinute: 20 * 60, endMinute: 21 * 60 },
        { courtId: "san-la", startMinute: 20 * 60, endMinute: 21 * 60 },
      ],
    });

    expect(quotes[0]).toMatchObject({ available: true, courtName: "Sân 1" });
    expect(quotes[1]).toMatchObject({
      available: false,
      courtName: "Sân 2",
      reason: "TAKEN",
      total: 0,
    });
    expect(quotes[2]).toMatchObject({ available: false, courtName: null, reason: "COURT" });
  });
});
