import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  CourtClosureConflictError,
  CourtClosureNotFoundError,
  CourtNotFoundError,
  PriceOverrideNotFoundError,
  VenueConfigError,
  VenueNotFoundError,
} from "@/lib/errors";
import { CourtService, findPricingGaps } from "./court.service";

/**
 * Ba thứ ở tầng này phải giữ bằng mọi giá: xoá sân con là XOÁ MỀM (lượt đặt cũ
 * vẫn phải đọc được), đóng sân KHÔNG được chồng lên lượt khách đã đặt, và bảng
 * giá phải cho ra MỘT giá xác định cho mỗi khung.
 *
 * Ngày mốc: thứ Sáu 04/09/2026, giờ Việt Nam.
 */

const NOW = new Date("2026-09-04T03:00:00Z"); // 10:00 giờ VN

type Row = Record<string, unknown>;

/**
 * Mock `where` của Prisma cho đúng những dạng tầng này dùng: bằng nhau, `in`,
 * `lt`/`gt`, `null`, `OR` lồng nhau. Mock phải LỌC THẬT — trả bừa mọi thứ thì
 * bài test "sân của cơ sở khác" không chứng minh được gì (GOTCHAS #19).
 */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((clause) => matches(row, clause));

    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) {
      return value instanceof Date && value.getTime() === condition.getTime();
    }
    if (typeof condition === "object") {
      const { in: list, lt, gt } = condition as { in?: unknown[]; lt?: Date; gt?: Date };
      if (list && !list.includes(value)) return false;
      if (lt && !(value instanceof Date && value < lt)) return false;
      if (gt && !(value instanceof Date && value > gt)) return false;
      return true;
    }
    return value === condition;
  });
}

const COURTS: Row[] = [
  { id: "c1", venueId: "v1", name: "Sân 1", isActive: true, deletedAt: null },
  { id: "c2", venueId: "v1", name: "Sân 2", isActive: true, deletedAt: null },
  { id: "c9", venueId: "v2", name: "Sân của cơ sở khác", isActive: true, deletedAt: null },
];

type Options = {
  venue?: { id: string; sportId: string } | null;
  courts?: Row[];
  bookings?: Row[];
  closures?: Row[];
  overrides?: Row[];
  hours?: Row[];
  rules?: Row[];
};

function createDb(options: Options = {}) {
  const venue = "venue" in options ? options.venue : { id: "v1", sportId: "s1" };
  const courts = options.courts ?? COURTS;
  const bookings = options.bookings ?? [];
  const closures = options.closures ?? [];
  const overrides = options.overrides ?? [];

  const db = {
    venue: {
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(venue && where.id === venue.id ? venue : null),
      ),
    },
    court: {
      create: vi.fn(({ data }: { data: Row }) => Promise.resolve({ id: "c-new", ...data })),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Row }) =>
        Promise.resolve({ ...data, id: where.id }),
      ),
      findFirst: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(courts.find((court) => matches(court, where)) ?? null),
      ),
      findMany: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(courts.filter((court) => matches(court, where))),
      ),
    },
    courtClosure: {
      create: vi.fn(({ data }: { data: Row }) => Promise.resolve({ id: "cl-new", ...data })),
      deleteMany: vi.fn(({ where }: { where: { id: string; court: { venueId: string } } }) => {
        const found = closures.find(
          (closure) =>
            closure.id === where.id &&
            courts.some(
              (court) => court.id === closure.courtId && court.venueId === where.court.venueId,
            ),
        );
        return Promise.resolve({ count: found ? 1 : 0 });
      }),
    },
    booking: {
      findMany: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(bookings.filter((booking) => matches(booking, where))),
      ),
    },
    venueHour: { findMany: vi.fn().mockResolvedValue(options.hours ?? []) },
    priceRule: {
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      createMany: vi.fn((_args: { data: Row[] }) => Promise.resolve({ count: 2 })),
      findMany: vi.fn().mockResolvedValue(options.rules ?? []),
    },
    priceOverride: {
      create: vi.fn(({ data }: { data: Row }) => Promise.resolve({ id: "po-new", ...data })),
      findMany: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve(overrides.filter((override) => matches(override, where))),
      ),
      deleteMany: vi.fn(({ where }: { where: Row }) =>
        Promise.resolve({ count: overrides.filter((override) => matches(override, where)).length }),
      ),
    },
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([{ id: "c1" }]),
    ),
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? Promise.resolve((arg as (tx: unknown) => unknown)(db))
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  return { db: db as unknown as PrismaClient, mock: db };
}

/** Mốc tuyệt đối theo giờ VN, ngày 05/09/2026 (thứ Bảy). */
const at = (hhmm: string) => new Date(`2026-09-05T${hhmm}:00+07:00`);

const PRICE = { startMinute: 6 * 60, endMinute: 22 * 60, pricePerSlot: 60_000 };

beforeEach(() => vi.clearAllMocks());

describe("create — thêm sân con", () => {
  it("lấy môn theo cơ sở, không bắt gõ lại cho từng sân", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).create({ venueId: "v1", name: "  Sân 1  " });

    expect(mock.court.create.mock.calls[0]![0].data).toMatchObject({
      sportId: "s1",
      name: "Sân 1",
    });
  });

  it("KHÔNG đoán mặt sân khi chưa khai — để trống là trạng thái thật", async () => {
    // Trước đây mặc định "INDOOR", mà trong-nhà không phải một loại mặt sân.
    // Đoán bừa thì mọi sân đều hiện sai vật liệu và không ai đi sửa lại.
    const { db, mock } = createDb();
    await new CourtService(db).create({ venueId: "v1", name: "Sân 1" });

    expect(mock.court.create.mock.calls[0]![0].data).toMatchObject({
      surface: null,
      isIndoor: false,
    });
  });

  it("cỏ nhân tạo TRONG NHÀ tả được — hai chiều độc lập", async () => {
    // Enum cũ gộp INDOOR/OUTDOOR chung với vật liệu nên ca này không tả nổi.
    const { db, mock } = createDb();
    await new CourtService(db).create({
      venueId: "v1",
      name: "Sân 1",
      surface: "ARTIFICIAL_GRASS",
      isIndoor: true,
    });

    expect(mock.court.create.mock.calls[0]![0].data).toMatchObject({
      surface: "ARTIFICIAL_GRASS",
      isIndoor: true,
    });
  });

  it("cơ sở không tồn tại hoặc đã xoá thì báo NOT_FOUND", async () => {
    const { db } = createDb({ venue: null });

    await expect(new CourtService(db).create({ venueId: "v1", name: "x" })).rejects.toBeInstanceOf(
      VenueNotFoundError,
    );
  });
});

describe("softDelete — xoá sân con", () => {
  it("xoá MỀM và tắt bán, không xoá thật", async () => {
    // Lượt đặt trỏ tới sân con bằng khoá ngoại; xoá thật là hoặc database từ
    // chối, hoặc doanh thu tháng trước biến mất theo.
    const { db, mock } = createDb();
    await new CourtService(db).softDelete("c1", { venueId: "v1", now: NOW });

    expect(mock.court.update.mock.calls[0]![0].data).toEqual({ deletedAt: NOW, isActive: false });
  });

  it("sân không tồn tại, hoặc thuộc CƠ SỞ KHÁC, thì báo NOT_FOUND và không ghi gì", async () => {
    for (const courtId of ["missing-court", "c9"]) {
      const { db, mock } = createDb();

      await expect(
        new CourtService(db).softDelete(courtId, { venueId: "v1" }),
      ).rejects.toBeInstanceOf(CourtNotFoundError);
      expect(mock.court.update).not.toHaveBeenCalled();
    }
  });
});

describe("reorder — sắp xếp cột trong lưới", () => {
  it("đánh số lại theo đúng thứ tự truyền vào", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).reorder("v1", ["c2", "c1"]);

    expect(mock.court.update.mock.calls[0]![0]).toMatchObject({
      where: { id: "c2" },
      data: { sortOrder: 0 },
    });
    expect(mock.court.update.mock.calls[1]![0]).toMatchObject({
      where: { id: "c1" },
      data: { sortOrder: 1 },
    });
  });

  it("làm trong một transaction — nửa chừng hỏng là thứ tự loạn", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).reorder("v1", ["c2", "c1"]);

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("từ chối danh sách thiếu sân, thừa sân, hoặc lẫn sân của cơ sở khác", async () => {
    const { db } = createDb();
    const service = new CourtService(db);

    await expect(service.reorder("v1", ["c1"])).rejects.toBeInstanceOf(VenueConfigError);
    await expect(service.reorder("v1", ["c1", "c2", "c3"])).rejects.toBeInstanceOf(
      VenueConfigError,
    );
    await expect(service.reorder("v1", ["c1", "c9"])).rejects.toBeInstanceOf(VenueConfigError);
  });
});

describe("close — đóng sân bảo trì", () => {
  const CLOSE = {
    venueId: "v1",
    courtId: "c1",
    startAt: at("18:00"),
    endAt: at("22:00"),
    now: NOW,
  };

  it("TỪ CHỐI khi chồng lên lượt còn sống — database không biết tới lịch đóng sân", async () => {
    // Trước đây vẫn tạo lịch đóng rồi mới trả danh sách "đang vướng": khách đã
    // trả tiền tới nơi mới thấy sân khoá.
    const live = [
      { code: "CONF01", status: "CONFIRMED", holdExpiresAt: null },
      { code: "CHECK1", status: "CHECKED_IN", holdExpiresAt: null },
      { code: "HOLD01", status: "HOLDING", holdExpiresAt: new Date(NOW.getTime() + 5 * 60_000) },
      // Khách đã báo chuyển khoản: hạn giữ chỗ bị xoá, vẫn đang chiếm chỗ.
      { code: "PAID01", status: "HOLDING", holdExpiresAt: null },
    ];

    for (const booking of live) {
      const { db, mock } = createDb({
        bookings: [{ ...booking, courtId: "c1", startAt: at("19:00"), endAt: at("21:00") }],
      });

      const error = await new CourtService(db).close(CLOSE).catch((e: unknown) => e);

      expect(error, booking.code).toBeInstanceOf(CourtClosureConflictError);
      expect((error as CourtClosureConflictError).bookingCodes).toEqual([booking.code]);
      expect(mock.courtClosure.create).not.toHaveBeenCalled();
    }
  });

  it("câu báo chỉ đúng lượt nào, giờ nào (giờ VN), và bảo làm gì tiếp", async () => {
    const { db } = createDb({
      bookings: [
        {
          code: "8F3K2M",
          courtId: "c1",
          status: "CONFIRMED",
          holdExpiresAt: null,
          startAt: at("19:00"),
          endAt: at("21:00"),
        },
      ],
    });

    await expect(new CourtService(db).close(CLOSE)).rejects.toThrow(
      "Còn 1 lượt đặt trong khoảng này: 8F3K2M (Thứ 7, 05/09/2026 19:00–21:00). Huỷ hoặc dời các lượt đó trước khi đóng sân.",
    );
  });

  it("chỗ giữ QUÁ HẠN, lượt đã huỷ/hết hạn, lượt liền kề và lượt sân khác KHÔNG chặn", async () => {
    // Chỗ giữ quá hạn không còn chiếm chỗ dù cron chưa kịp nhả — lịch đã hiểu
    // như vậy, đóng sân cũng phải hiểu như vậy.
    const { db, mock } = createDb({
      bookings: [
        {
          code: "STALE1",
          courtId: "c1",
          status: "HOLDING",
          holdExpiresAt: new Date(NOW.getTime() - 60_000),
          startAt: at("19:00"),
          endAt: at("20:00"),
        },
        {
          code: "CANCEL",
          courtId: "c1",
          status: "CANCELLED",
          holdExpiresAt: null,
          startAt: at("19:00"),
          endAt: at("20:00"),
        },
        {
          code: "EXPIRE",
          courtId: "c1",
          status: "EXPIRED",
          holdExpiresAt: null,
          startAt: at("20:00"),
          endAt: at("21:00"),
        },
        // Nửa mở: kết thúc đúng lúc bắt đầu đóng thì không gối.
        {
          code: "BEFORE",
          courtId: "c1",
          status: "CONFIRMED",
          holdExpiresAt: null,
          startAt: at("16:00"),
          endAt: at("18:00"),
        },
        {
          code: "OTHER1",
          courtId: "c2",
          status: "CONFIRMED",
          holdExpiresAt: null,
          startAt: at("19:00"),
          endAt: at("21:00"),
        },
      ],
    });

    await new CourtService(db).close({ ...CLOSE, reason: "Thay mặt sân" });

    expect(mock.courtClosure.create.mock.calls[0]![0].data).toMatchObject({
      courtId: "c1",
      startAt: at("18:00"),
      endAt: at("22:00"),
      reason: "Thay mặt sân",
    });
    expect(mock.court.update).not.toHaveBeenCalled();
  });

  it("kiểm + ghi trong MỘT transaction, khoá dòng sân con FOR UPDATE trước khi đọc lịch", async () => {
    // FOR UPDATE (không phải NO KEY UPDATE) mới bắt phép kiểm khoá ngoại của
    // một lượt đặt đang chèn vào sân này phải chờ.
    const { db, mock } = createDb();
    await new CourtService(db).close(CLOSE);

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    const [strings, courtId] = mock.$queryRaw.mock.calls[0]!;
    expect(strings.join("?")).toMatch(/FROM courts WHERE id = \? FOR UPDATE$/);
    expect(courtId).toBe("c1");
    expect(mock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mock.booking.findMany.mock.invocationCallOrder[0]!,
    );
    expect(mock.booking.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      mock.courtClosure.create.mock.invocationCallOrder[0]!,
    );
  });

  it("sân của CƠ SỞ KHÁC thì không tìm thấy, không đọc lịch, không tạo gì", async () => {
    const { db, mock } = createDb();

    await expect(new CourtService(db).close({ ...CLOSE, courtId: "c9" })).rejects.toBeInstanceOf(
      CourtNotFoundError,
    );
    expect(mock.booking.findMany).not.toHaveBeenCalled();
    expect(mock.courtClosure.create).not.toHaveBeenCalled();
  });

  it("từ chối khoảng ngược và khoảng dài bất thường", async () => {
    const { db } = createDb();
    const service = new CourtService(db);

    await expect(
      service.close({ ...CLOSE, startAt: at("22:00"), endAt: at("18:00") }),
    ).rejects.toThrow(/sau giờ bắt đầu/);

    // Gõ nhầm 2026 thành 2036 là chuyện xảy ra thật.
    await expect(
      service.close({ ...CLOSE, endAt: new Date("2036-09-05T00:00:00Z") }),
    ).rejects.toThrow(/quá dài/);
  });
});

describe("reopen — bỏ lịch đóng sân", () => {
  const closures = [{ id: "cl1", courtId: "c1" }];

  it("xoá lịch đóng của sân thuộc đúng cơ sở", async () => {
    const { db, mock } = createDb({ closures });
    await new CourtService(db).reopen("cl1", { venueId: "v1" });

    expect(mock.courtClosure.deleteMany).toHaveBeenCalledWith({
      where: { id: "cl1", court: { venueId: "v1" } },
    });
  });

  it("lịch đóng của cơ sở khác thì báo không tìm thấy", async () => {
    const { db } = createDb({ closures });

    await expect(new CourtService(db).reopen("cl1", { venueId: "v2" })).rejects.toBeInstanceOf(
      CourtClosureNotFoundError,
    );
  });
});

describe("update — sửa sân con", () => {
  it("đúng cơ sở thì sửa bình thường", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).update("c1", { isActive: false }, { venueId: "v1" });

    expect(mock.court.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { isActive: false },
    });
  });

  /**
   * Lỗ hổng thật trước đây: quyền kiểm trên `venueId` của URL, `courtId` lấy từ
   * form. Nhân viên cơ sở A gửi id sân con của cơ sở B là tắt được sân của B.
   */
  it("sân con của CƠ SỞ KHÁC thì coi như không tồn tại — lọc ngay trong câu truy vấn", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).update("c9", { isActive: false }, { venueId: "v1" }),
    ).rejects.toBeInstanceOf(CourtNotFoundError);
    expect(mock.court.update).not.toHaveBeenCalled();
    expect(mock.court.findFirst.mock.calls[0]![0].where).toMatchObject({ id: "c9", venueId: "v1" });
  });
});

describe("setPriceRules — bảng giá", () => {
  it("TỪ CHỐI luật gắn vào sân con của cơ sở khác", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [
        { ...PRICE, courtId: "c1" },
        { ...PRICE, courtId: "c9" },
      ]),
    ).rejects.toBeInstanceOf(VenueConfigError);
    expect(mock.priceRule.deleteMany).not.toHaveBeenCalled();
  });

  it("luật chung cả cơ sở (không gắn sân con) thì không cần tra sân", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).setPriceRules("v1", [PRICE]);

    expect(mock.court.findMany).not.toHaveBeenCalled();
    expect(mock.priceRule.createMany).toHaveBeenCalledTimes(1);
  });

  it("thay CẢ BỘ, không sửa lẻ từng luật", async () => {
    // Giá chồng lớp lên nhau theo priority; sửa lẻ để lại một bảng giá không
    // ai hiểu nổi, kể cả người vừa sửa.
    const { db, mock } = createDb();
    await new CourtService(db).setPriceRules("v1", [PRICE]);

    expect(mock.priceRule.deleteMany).toHaveBeenCalledWith({ where: { venueId: "v1" } });
    expect(mock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("TỪ CHỐI khung lệch 30 phút", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [{ ...PRICE, startMinute: 6 * 60 + 15 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
    expect(mock.priceRule.deleteMany).not.toHaveBeenCalled();
  });

  it("từ chối giá âm, giá không nguyên và ưu tiên không nguyên", async () => {
    const { db } = createDb();
    const service = new CourtService(db);

    await expect(service.setPriceRules("v1", [{ ...PRICE, pricePerSlot: -1 }])).rejects.toThrow(
      /không âm/,
    );
    await expect(service.setPriceRules("v1", [{ ...PRICE, pricePerSlot: 1.5 }])).rejects.toThrow(
      /không âm/,
    );
    await expect(service.setPriceRules("v1", [{ ...PRICE, priority: 0.5 }])).rejects.toThrow(
      /Ưu tiên/,
    );
  });

  it("giá 0đ thì CHO — sân miễn phí giờ thấp điểm là chuyện có thật", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).setPriceRules("v1", [{ ...PRICE, pricePerSlot: 0 }]);

    expect(mock.priceRule.createMany).toHaveBeenCalled();
  });

  it("từ chối thứ ngoài 0–6", async () => {
    const { db } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [{ ...PRICE, weekdays: [1, 9] }]),
    ).rejects.toThrow(/0–6/);
  });

  it("kiểm TOÀN BỘ luật trước khi xoá — một luật sai không được làm mất bảng giá cũ", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [PRICE, { ...PRICE, pricePerSlot: -5 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
    expect(mock.priceRule.deleteMany).not.toHaveBeenCalled();
  });

  /**
   * Hai luật cùng priority phủ cùng khung: `priceForSlot` sắp theo priority rồi
   * lấy cái đầu — hoà nhau thì giá tuỳ thứ tự dòng database trả về, có thể đổi
   * giữa hai lần tải trang. Khách thấy 70k, bấm đặt ra 110k.
   */
  it("TỪ CHỐI hai luật cùng ưu tiên, cùng cả cơ sở, chung ngày, gối giờ — nói rõ luật nào", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [
        { startMinute: 5 * 60 + 30, endMinute: 23 * 60, pricePerSlot: 70_000, priority: 0 },
        {
          weekdays: [1, 2, 3, 4, 5],
          startMinute: 17 * 60,
          endMinute: 22 * 60,
          pricePerSlot: 110_000,
          priority: 10,
        },
        {
          weekdays: [5, 6],
          startMinute: 18 * 60,
          endMinute: 23 * 60,
          pricePerSlot: 120_000,
          priority: 10,
        },
      ]),
    ).rejects.toThrow(
      "Luật 2 và luật 3 chồng nhau: cùng ưu tiên 10, cùng áp cho cả cơ sở, Thứ 6 18:00–22:00. Đổi ưu tiên của một luật hoặc sửa giờ để biết giá nào được tính.",
    );
    expect(mock.priceRule.deleteMany).not.toHaveBeenCalled();
  });

  it("luật 'mọi ngày' giao với luật chỉ một ngày; cùng một sân con thì nêu tên sân", async () => {
    const { db } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [
        { courtId: "c2", startMinute: 6 * 60, endMinute: 12 * 60, pricePerSlot: 50_000 },
        {
          courtId: "c2",
          weekdays: [0],
          startMinute: 11 * 60,
          endMinute: 14 * 60,
          pricePerSlot: 60_000,
        },
      ]),
    ).rejects.toThrow("cùng áp cho Sân 2, Chủ nhật 11:00–12:00");
  });

  it("KHÔNG coi là chồng: khác ưu tiên, khác phạm vi, không chung ngày, hay chỉ liền kề giờ", async () => {
    const cases = [
      // Khác ưu tiên — luật cao hơn thắng, giá xác định.
      [
        { ...PRICE, priority: 0 },
        { ...PRICE, priority: 1 },
      ],
      // Riêng sân con vs cả cơ sở, cùng ưu tiên — luật riêng sân con thắng.
      [PRICE, { ...PRICE, courtId: "c1" }],
      // Hai sân con khác nhau.
      [
        { ...PRICE, courtId: "c1" },
        { ...PRICE, courtId: "c2" },
      ],
      // Không chung ngày.
      [
        { ...PRICE, weekdays: [1, 2, 3, 4, 5] },
        { ...PRICE, weekdays: [0, 6] },
      ],
      // Liền kề: 17:00–19:00 rồi 19:00–22:00 (nửa mở, không gối).
      [
        { ...PRICE, startMinute: 17 * 60, endMinute: 19 * 60 },
        { ...PRICE, startMinute: 19 * 60, endMinute: 22 * 60 },
      ],
    ];

    for (const rules of cases) {
      const { db, mock } = createDb();
      await new CourtService(db).setPriceRules("v1", rules);
      expect(mock.priceRule.createMany).toHaveBeenCalledTimes(1);
    }
  });

  it("bảng giá mẫu của seed (nền, giờ vàng trong tuần, cuối tuần) vẫn lưu được", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).setPriceRules("v1", [
      { weekdays: [], startMinute: 330, endMinute: 1380, pricePerSlot: 70_000, priority: 0 },
      {
        weekdays: [1, 2, 3, 4, 5],
        startMinute: 1020,
        endMinute: 1320,
        pricePerSlot: 110_000,
        isPeak: true,
        priority: 10,
      },
      {
        weekdays: [0, 6],
        startMinute: 330,
        endMinute: 1380,
        pricePerSlot: 110_000,
        isPeak: true,
        priority: 5,
      },
    ]);

    expect(mock.priceRule.createMany.mock.calls[0]![0].data).toHaveLength(3);
  });
});

describe("setPriceOverride — đè giá theo ngày", () => {
  const OVERRIDE = {
    venueId: "v1",
    dateKey: "2026-09-04",
    startMinute: 18 * 60,
    endMinute: 22 * 60,
    pricePerSlot: 150_000,
  };

  it("chuẩn hoá ngày về nửa đêm UTC", async () => {
    // Không chuẩn hoá thì cùng một ngày lịch thành hai dòng khác nhau tuỳ máy
    // chủ đang ở múi giờ nào.
    const { db, mock } = createDb();
    await new CourtService(db).setPriceOverride(OVERRIDE);

    const [{ data }] = mock.priceOverride.create.mock.calls[0] as [{ data: { date: Date } }];
    expect(data.date.toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });

  it("từ chối ngày sai dạng và ngày không có thật", async () => {
    const { db, mock } = createDb();

    for (const dateKey of ["04/09/2026", "2026-02-31"]) {
      await expect(new CourtService(db).setPriceOverride({ ...OVERRIDE, dateKey })).rejects.toThrow(
        /YYYY-MM-DD/,
      );
    }
    expect(mock.priceOverride.create).not.toHaveBeenCalled();
  });

  it("từ chối khung lệch 30 phút", async () => {
    const { db } = createDb();

    await expect(
      new CourtService(db).setPriceOverride({ ...OVERRIDE, startMinute: 18 * 60 + 10 }),
    ).rejects.toBeInstanceOf(VenueConfigError);
  });

  it("sân con của CƠ SỞ KHÁC thì không tìm thấy, không tạo", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).setPriceOverride({ ...OVERRIDE, courtId: "c9" }),
    ).rejects.toBeInstanceOf(CourtNotFoundError);
    expect(mock.priceOverride.create).not.toHaveBeenCalled();
  });

  it("TỪ CHỐI gối giờ với đè giá đã có cùng ngày và CÙNG phạm vi", async () => {
    // Đè giá không có priority: hai cái cùng phạm vi gối nhau thì không biết giá nào thắng.
    const date = new Date("2026-09-04T00:00:00Z");
    const cases = [
      { courtId: null, message: "đã có giá đè 20:00–23:00 cho cả cơ sở" },
      { courtId: "c1", message: "đã có giá đè 20:00–23:00 cho sân con này" },
    ];

    for (const { courtId, message } of cases) {
      const { db, mock } = createDb({
        overrides: [{ venueId: "v1", courtId, date, startMinute: 20 * 60, endMinute: 23 * 60 }],
      });

      await expect(new CourtService(db).setPriceOverride({ ...OVERRIDE, courtId })).rejects.toThrow(
        message,
      );
      expect(mock.priceOverride.create).not.toHaveBeenCalled();
    }
  });

  it("đè riêng một sân con gối lên đè cả cơ sở vẫn tạo được — đè riêng thắng khi tính giá", async () => {
    const date = new Date("2026-09-04T00:00:00Z");
    const { db, mock } = createDb({
      overrides: [{ venueId: "v1", courtId: null, date, startMinute: 20 * 60, endMinute: 23 * 60 }],
    });

    await new CourtService(db).setPriceOverride({ ...OVERRIDE, courtId: "c1" });

    expect(mock.priceOverride.create).toHaveBeenCalledTimes(1);
  });

  it("khác ngày, khác sân con, hoặc chỉ liền kề giờ thì vẫn tạo được", async () => {
    const other = new Date("2026-09-05T00:00:00Z");
    const same = new Date("2026-09-04T00:00:00Z");
    const { db, mock } = createDb({
      overrides: [
        { venueId: "v1", courtId: null, date: other, startMinute: 18 * 60, endMinute: 22 * 60 },
        { venueId: "v1", courtId: "c2", date: same, startMinute: 18 * 60, endMinute: 22 * 60 },
        { venueId: "v1", courtId: "c1", date: same, startMinute: 22 * 60, endMinute: 24 * 60 },
      ],
    });

    await new CourtService(db).setPriceOverride({ ...OVERRIDE, courtId: "c1" });

    expect(mock.priceOverride.create).toHaveBeenCalledTimes(1);
  });
});

describe("removePriceOverride", () => {
  const overrides = [{ id: "po1", venueId: "v1" }];

  it("xoá giá đè của đúng cơ sở", async () => {
    const { db, mock } = createDb({ overrides });
    await new CourtService(db).removePriceOverride("po1", { venueId: "v1" });

    expect(mock.priceOverride.deleteMany).toHaveBeenCalledWith({
      where: { id: "po1", venueId: "v1" },
    });
  });

  it("giá đè của cơ sở khác thì báo không tìm thấy", async () => {
    const { db } = createDb({ overrides });

    await expect(
      new CourtService(db).removePriceOverride("po1", { venueId: "v2" }),
    ).rejects.toBeInstanceOf(PriceOverrideNotFoundError);
  });
});

describe("findPricingGaps — khung mở cửa chưa có giá", () => {
  const openAllWeek = (openMinute: number, closeMinute: number) =>
    Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      openMinute,
      closeMinute,
      isClosed: false,
    }));
  const courts = [{ id: "c1" }, { id: "c2" }];

  it("mở 05:30–23:00 mà luật chỉ phủ 06:00–22:00: hở hai đầu, mọi ngày, mọi sân — gộp thành 2 dòng", () => {
    const gaps = findPricingGaps({
      hours: openAllWeek(330, 1380),
      courts,
      rules: [{ courtId: null, weekdays: [], startMinute: 360, endMinute: 1320 }],
    });

    expect(gaps).toEqual([
      { weekdays: [1, 2, 3, 4, 5, 6, 0], startMinute: 330, endMinute: 360, courtIds: ["c1", "c2"] },
      {
        weekdays: [1, 2, 3, 4, 5, 6, 0],
        startMinute: 1320,
        endMinute: 1380,
        courtIds: ["c1", "c2"],
      },
    ]);
  });

  it("luật riêng một sân con chỉ lấp khoảng hở của sân đó", () => {
    const gaps = findPricingGaps({
      hours: [{ weekday: 1, openMinute: 360, closeMinute: 720, isClosed: false }],
      courts,
      rules: [{ courtId: "c1", weekdays: [], startMinute: 360, endMinute: 720 }],
    });

    expect(gaps).toEqual([{ weekdays: [1], startMinute: 360, endMinute: 720, courtIds: ["c2"] }]);
  });

  it("luật chỉ cho ngày thường: cuối tuần hở cả ngày; ngày nghỉ và ngày chưa khai giờ thì không tính", () => {
    const hours = openAllWeek(360, 1320).map((hour) =>
      hour.weekday === 3 ? { ...hour, isClosed: true } : hour,
    );

    const gaps = findPricingGaps({
      hours: hours.filter((hour) => hour.weekday !== 4),
      courts: [{ id: "c1" }],
      rules: [{ courtId: null, weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 1320 }],
    });

    expect(gaps).toEqual([
      { weekdays: [6, 0], startMinute: 360, endMinute: 1320, courtIds: ["c1"] },
    ]);
  });

  it("bảng giá mẫu của seed phủ kín giờ mở cửa — không báo động giả", () => {
    const gaps = findPricingGaps({
      hours: openAllWeek(330, 1380),
      courts,
      rules: [
        { courtId: null, weekdays: [], startMinute: 330, endMinute: 1380 },
        { courtId: null, weekdays: [1, 2, 3, 4, 5], startMinute: 1020, endMinute: 1320 },
        { courtId: null, weekdays: [0, 6], startMinute: 330, endMinute: 1380 },
      ],
    });

    expect(gaps).toEqual([]);
  });
});

describe("pricingGaps — đọc từ database", () => {
  it("chỉ xét sân con ĐANG BÁN của cơ sở; hở ở mọi sân thì trả courtNames null", async () => {
    const { db, mock } = createDb({
      hours: [
        { weekday: 6, openMinute: 360, closeMinute: 480, isClosed: false },
        { weekday: 0, openMinute: 360, closeMinute: 480, isClosed: false },
      ],
      courts: [
        ...COURTS,
        // Sân đang tắt không bán — không được làm "mọi sân" thành "Sân 1, Sân 2".
        { id: "c3", venueId: "v1", name: "Sân 3", isActive: false, deletedAt: null },
      ],
      rules: [
        { courtId: null, weekdays: [6], startMinute: 360, endMinute: 420 },
        { courtId: "c1", weekdays: [6], startMinute: 420, endMinute: 480 },
      ],
    });

    const gaps = await new CourtService(db).pricingGaps("v1");

    expect(mock.court.findMany.mock.calls[0]![0].where).toEqual({
      venueId: "v1",
      isActive: true,
      deletedAt: null,
    });
    expect(gaps).toEqual([
      { weekdays: [6], startMinute: 420, endMinute: 480, courtNames: ["Sân 2"] },
      { weekdays: [0], startMinute: 360, endMinute: 480, courtNames: null },
    ]);
  });
});
