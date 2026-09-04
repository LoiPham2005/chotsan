import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CourtNotFoundError, VenueConfigError, VenueNotFoundError } from "@/lib/errors";
import { CourtService } from "./court.service";

/**
 * Hai thứ ở tầng này phải giữ bằng mọi giá: xoá sân con là XOÁ MỀM (lượt đặt
 * cũ vẫn phải đọc được), và đóng sân KHÔNG tự huỷ lượt đã bán.
 */

const COURT = { id: "c1", venueId: "v1", name: "Sân 1" };

type Options = {
  venue?: { sportId: string } | null;
  court?: { id: string; venueId: string } | null;
  courts?: { id: string }[];
  affected?: unknown[];
};

function createDb(options: Options = {}) {
  const db = {
    venue: {
      findFirst: vi
        .fn()
        .mockResolvedValue("venue" in options ? options.venue : { id: "v1", sportId: "s1" }),
    },
    court: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...COURT, ...data }),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ ...COURT, ...data, id: where.id }),
      ),
      findFirst: vi.fn().mockResolvedValue("court" in options ? options.court : COURT),
      findMany: vi.fn().mockResolvedValue(options.courts ?? [{ id: "c1" }, { id: "c2" }]),
    },
    courtClosure: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "cl1", ...data }),
      ),
      delete: vi.fn().mockResolvedValue({ id: "cl1" }),
    },
    booking: { findMany: vi.fn().mockResolvedValue(options.affected ?? []) },
    priceRule: {
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    priceOverride: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "po1", ...data }),
      ),
      delete: vi.fn().mockResolvedValue({ id: "po1" }),
    },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? Promise.resolve((arg as (tx: unknown) => unknown)(db))
        : Promise.all(arg as Promise<unknown>[]),
    ),
  };

  return { db: db as unknown as PrismaClient, mock: db };
}

const GIA = { startMinute: 6 * 60, endMinute: 22 * 60, pricePerSlot: 60_000 };

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
    const now = new Date("2026-09-04T03:00:00Z");
    await new CourtService(db).softDelete("c1", now);

    expect(mock.court.update.mock.calls[0]![0].data).toEqual({ deletedAt: now, isActive: false });
  });

  it("sân không tồn tại thì báo NOT_FOUND", async () => {
    const { db } = createDb({ court: null });

    await expect(new CourtService(db).softDelete("c1")).rejects.toBeInstanceOf(CourtNotFoundError);
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
    await expect(service.reorder("v1", ["c1", "cua-court-khac"])).rejects.toBeInstanceOf(
      VenueConfigError,
    );
  });
});

describe("close — đóng sân bảo trì", () => {
  it("KHÔNG huỷ lượt đã đặt, chỉ trả về danh sách đang vướng", async () => {
    // Huỷ hàng loạt trong im lặng là cách nhanh nhất để mất khách. Trả danh
    // sách ra để giao diện hỏi chủ sân xử lý thế nào.
    const { db, mock } = createDb({
      affected: [{ id: "b1", code: "8F3K2M", customerName: "A", status: "CONFIRMED" }],
    });

    const result = await new CourtService(db).close({
      courtId: "c1",
      startAt: new Date("2026-09-05T00:00:00Z"),
      endAt: new Date("2026-09-06T00:00:00Z"),
      reason: "Thay mặt sân",
    });

    expect(result.affectedBookings).toHaveLength(1);
    expect(mock.court.update).not.toHaveBeenCalled();
    const [{ where }] = mock.booking.findMany.mock.calls[0] as [
      { where: { status: { in: string[] } } },
    ];
    expect(where.status).toEqual({ in: ["HOLDING", "CONFIRMED", "CHECKED_IN"] });
  });

  it("từ chối khoảng ngược và khoảng dài bất thường", async () => {
    const { db } = createDb();
    const service = new CourtService(db);

    await expect(
      service.close({
        courtId: "c1",
        startAt: new Date("2026-09-06T00:00:00Z"),
        endAt: new Date("2026-09-05T00:00:00Z"),
      }),
    ).rejects.toThrow(/sau giờ bắt đầu/);

    // Gõ nhầm 2026 thành 2036 là chuyện xảy ra thật.
    await expect(
      service.close({
        courtId: "c1",
        startAt: new Date("2026-09-05T00:00:00Z"),
        endAt: new Date("2036-09-05T00:00:00Z"),
      }),
    ).rejects.toThrow(/quá dài/);
  });
});

describe("setPriceRules — bảng giá", () => {
  it("thay CẢ BỘ, không sửa lẻ từng luật", async () => {
    // Giá chồng lớp lên nhau theo priority; sửa lẻ để lại một bảng giá không
    // ai hiểu nổi, kể cả người vừa sửa.
    const { db, mock } = createDb();
    await new CourtService(db).setPriceRules("v1", [GIA]);

    expect(mock.priceRule.deleteMany).toHaveBeenCalledWith({ where: { venueId: "v1" } });
    expect(mock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("TỪ CHỐI khung lệch 30 phút", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [{ ...GIA, startMinute: 6 * 60 + 15 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
    expect(mock.priceRule.deleteMany).not.toHaveBeenCalled();
  });

  it("từ chối giá âm và giá không nguyên", async () => {
    const { db } = createDb();
    const service = new CourtService(db);

    await expect(service.setPriceRules("v1", [{ ...GIA, pricePerSlot: -1 }])).rejects.toThrow(
      /không âm/,
    );
    await expect(service.setPriceRules("v1", [{ ...GIA, pricePerSlot: 1.5 }])).rejects.toThrow(
      /không âm/,
    );
  });

  it("giá 0đ thì CHO — sân miễn phí giờ thấp điểm là chuyện có thật", async () => {
    const { db, mock } = createDb();
    await new CourtService(db).setPriceRules("v1", [{ ...GIA, pricePerSlot: 0 }]);

    expect(mock.priceRule.createMany).toHaveBeenCalled();
  });

  it("từ chối thứ ngoài 0–6", async () => {
    const { db } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [{ ...GIA, weekdays: [1, 9] }]),
    ).rejects.toThrow(/0–6/);
  });

  it("kiểm TOÀN BỘ luật trước khi xoá — một luật sai không được làm mất bảng giá cũ", async () => {
    const { db, mock } = createDb();

    await expect(
      new CourtService(db).setPriceRules("v1", [GIA, { ...GIA, pricePerSlot: -5 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
    expect(mock.priceRule.deleteMany).not.toHaveBeenCalled();
  });
});

describe("setPriceOverride — đè giá theo ngày", () => {
  it("chuẩn hoá ngày về nửa đêm UTC", async () => {
    // Không chuẩn hoá thì cùng một ngày lịch thành hai dòng khác nhau tuỳ máy
    // chủ đang ở múi giờ nào.
    const { db, mock } = createDb();
    await new CourtService(db).setPriceOverride({
      venueId: "v1",
      dateKey: "2026-09-04",
      startMinute: 18 * 60,
      endMinute: 22 * 60,
      pricePerSlot: 150_000,
    });

    const [{ data }] = mock.priceOverride.create.mock.calls[0] as [{ data: { date: Date } }];
    expect(data.date.toISOString()).toBe("2026-09-04T00:00:00.000Z");
  });

  it("từ chối ngày sai dạng", async () => {
    const { db } = createDb();

    await expect(
      new CourtService(db).setPriceOverride({
        venueId: "v1",
        dateKey: "04/09/2026",
        startMinute: 0,
        endMinute: 60,
        pricePerSlot: 1_000,
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("từ chối khung lệch 30 phút", async () => {
    const { db } = createDb();

    await expect(
      new CourtService(db).setPriceOverride({
        venueId: "v1",
        dateKey: "2026-09-04",
        startMinute: 18 * 60 + 10,
        endMinute: 22 * 60,
        pricePerSlot: 1_000,
      }),
    ).rejects.toBeInstanceOf(VenueConfigError);
  });
});
