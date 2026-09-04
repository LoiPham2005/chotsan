import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  VenueAdminLockedError,
  VenueConfigError,
  VenueNotFoundError,
  VenueNotReadyError,
} from "@/lib/errors";
import { VenueService } from "./venue.service";

/**
 * Hai chỗ sai ở tầng này tốn tiền thật của chủ sân:
 * mở bán một cơ sở chưa có giá (khách đặt được sân 0đ), và khai giờ mở cửa
 * lệch khung 30 phút (mọi khung giờ lệch theo, không có gì báo lỗi).
 */

const VENUE = { id: "v1", slug: "san-abc", name: "Sân ABC" };

type Options = {
  venue?: { id: string; status?: string } | null;
  slugTaken?: string[];
  counts?: { hours: number; courts: number; priceRules: number };
};

function createDb(options: Options = {}) {
  const taken = new Set(options.slugTaken ?? []);

  const db = {
    venue: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...VENUE, ...data }),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ ...VENUE, ...data, id: where.id }),
      ),
      findFirst: vi.fn(() =>
        Promise.resolve(
          "venue" in options
            ? options.venue && {
                status: "ACTIVE",
                ...options.venue,
                _count: options.counts ?? { hours: 7, courts: 3, priceRules: 2 },
              }
            : {
                ...VENUE,
                status: "ACTIVE",
                _count: options.counts ?? { hours: 7, courts: 3, priceRules: 2 },
              },
        ),
      ),
      findUnique: vi.fn(({ where }: { where: { slug: string } }) =>
        Promise.resolve(taken.has(where.slug) ? { id: "khac" } : null),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    venueMember: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "m1", ...data }),
      ),
      findMany: vi.fn().mockResolvedValue([]),
    },
    venueHour: {
      deleteMany: vi.fn().mockResolvedValue({ count: 7 }),
      createMany: vi.fn().mockResolvedValue({ count: 7 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? Promise.resolve((arg as (tx: unknown) => unknown)(db))
        : Promise.resolve([[], 0]),
    ),
  };

  return { db: db as unknown as PrismaClient, mock: db };
}

function hoursForWeek(open = 6 * 60, close = 22 * 60) {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openMinute: open,
    closeMinute: close,
  }));
}

beforeEach(() => vi.clearAllMocks());

describe("create — tạo cơ sở", () => {
  it("tạo sân và gán người tạo làm OWNER trong CÙNG một transaction", async () => {
    // Tách hai bước thì có khe: tạo sân xong, tạo thành viên hỏng, và sân đó
    // không thuộc về ai — kể cả người vừa tạo cũng không sửa được.
    const { db, mock } = createDb();
    await new VenueService(db).create({
      name: "Sân ABC",
      sportId: "s1",
      address: "1 Nguyễn Trãi",
      ward: "Phường Thanh Xuân",
      province: "Hà Nội",
      ownerId: "u1",
    });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.venueMember.create.mock.calls[0]![0].data).toMatchObject({
      userId: "u1",
      role: "OWNER",
      status: "ACTIVE",
    });
  });

  it("sân mới luôn là bản nháp, không tự mở bán", async () => {
    // Sân mới chưa có giờ, chưa có sân con, chưa có giá — ACTIVE ngay là bán ra
    // một thứ chưa tồn tại.
    const { db, mock } = createDb();
    await new VenueService(db).create({
      name: "Sân ABC",
      sportId: "s1",
      address: "1 Nguyễn Trãi",
      ward: "Phường Thanh Xuân",
      province: "Hà Nội",
      ownerId: "u1",
    });

    expect(mock.venue.create.mock.calls[0]![0].data.status).toBe("DRAFT");
  });

  it("sinh slug bỏ dấu từ tên", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).create({
      name: "Sân Cầu Lông Đại Việt",
      sportId: "s1",
      address: "x",
      ward: "y",
      province: "z",
      ownerId: "u1",
    });

    expect(mock.venue.create.mock.calls[0]![0].data.slug).toBe("san-cau-long-dai-viet");
  });

  it("slug đã có người dùng thì thêm số, không ghi đè sân của người khác", async () => {
    const { db, mock } = createDb({ slugTaken: ["san-abc", "san-abc-2"] });
    await new VenueService(db).create({
      name: "Sân ABC",
      sportId: "s1",
      address: "x",
      ward: "y",
      province: "z",
      ownerId: "u1",
    });

    expect(mock.venue.create.mock.calls[0]![0].data.slug).toBe("san-abc-3");
  });

  it("tên toàn ký tự lạ vẫn ra slug dùng được", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).create({
      name: "!!! ???",
      sportId: "s1",
      address: "x",
      ward: "y",
      province: "z",
      ownerId: "u1",
    });

    expect(mock.venue.create.mock.calls[0]![0].data.slug).toBe("san");
  });
});

describe("setStatus — mở bán", () => {
  it("CHẶN mở bán khi chưa có giá — khách sẽ đặt được sân 0đ", async () => {
    const { db, mock } = createDb({ counts: { hours: 7, courts: 3, priceRules: 0 } });

    await expect(new VenueService(db).setStatus("v1", "ACTIVE")).rejects.toBeInstanceOf(
      VenueNotReadyError,
    );
    expect(mock.venue.update).not.toHaveBeenCalled();
  });

  it("chặn khi chưa có giờ mở cửa hoặc chưa có sân con", async () => {
    for (const counts of [
      { hours: 0, courts: 3, priceRules: 2 },
      { hours: 7, courts: 0, priceRules: 2 },
    ]) {
      const { db } = createDb({ counts });
      await expect(new VenueService(db).setStatus("v1", "ACTIVE")).rejects.toBeInstanceOf(
        VenueNotReadyError,
      );
    }
  });

  it("nói RÕ còn thiếu gì để chủ sân không phải đi dò từng màn", async () => {
    const { db } = createDb({ counts: { hours: 0, courts: 0, priceRules: 0 } });

    await expect(new VenueService(db).setStatus("v1", "ACTIVE")).rejects.toThrow(
      /giờ mở cửa, ít nhất một sân con, bảng giá/,
    );
  });

  it("đủ điều kiện thì mở bán được", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).setStatus("v1", "ACTIVE");

    expect(mock.venue.update.mock.calls[0]![0].data.status).toBe("ACTIVE");
  });

  it("tạm ngừng bán thì KHÔNG kiểm điều kiện — đóng cửa luôn phải làm được", async () => {
    const { db, mock } = createDb({ counts: { hours: 0, courts: 0, priceRules: 0 } });
    await new VenueService(db).setStatus("v1", "SUSPENDED");

    expect(mock.venue.update.mock.calls[0]![0].data.status).toBe("SUSPENDED");
  });

  /**
   * Trước đây chỉ có một trạng thái `SUSPENDED` cho cả "chủ sân tự tạm nghỉ"
   * lẫn "nền tảng khoá vì vi phạm" — nghĩa là chủ sân bị khoá chỉ cần bấm
   * "Mở bán lại" là gỡ được hình phạt. Bản cũ tách hai trạng thái, và đó là
   * điều đúng.
   */
  it("chủ sân KHÔNG tự gỡ được lệnh khoá của nền tảng", async () => {
    const { db, mock } = createDb({ venue: { id: "v1", status: "ADMIN_LOCKED" } });

    await expect(new VenueService(db).setStatus("v1", "ACTIVE")).rejects.toBeInstanceOf(
      VenueAdminLockedError,
    );
    expect(mock.venue.update).not.toHaveBeenCalled();
  });

  it("chủ sân cũng không tự KHOÁ được — khoá là việc của nền tảng", async () => {
    const { db } = createDb();

    await expect(new VenueService(db).setStatus("v1", "ADMIN_LOCKED")).rejects.toBeInstanceOf(
      VenueAdminLockedError,
    );
  });

  it("admin thì gỡ được", async () => {
    const { db, mock } = createDb({ venue: { id: "v1", status: "ADMIN_LOCKED" } });
    await new VenueService(db).setStatus("v1", "ACTIVE", { byAdmin: true });

    expect(mock.venue.update.mock.calls[0]![0].data.status).toBe("ACTIVE");
  });

  it("đóng cửa thì ghi lý do cho khách đọc, mở lại thì xoá", async () => {
    // Khách đang xem sân cần biết VÌ SAO sân đóng, không phải chỉ thấy
    // "hiện không nhận đặt".
    const { db, mock } = createDb();
    const service = new VenueService(db);

    await service.setStatus("v1", "UNDER_MAINTENANCE", { inactiveNote: "Sửa mặt sân tới 25/9" });
    expect(mock.venue.update.mock.calls[0]![0].data.inactiveNote).toBe("Sửa mặt sân tới 25/9");

    await service.setStatus("v1", "ACTIVE");
    expect(mock.venue.update.mock.calls[1]![0].data.inactiveNote).toBeNull();
  });
});

describe("setHours — giờ mở cửa cả tuần", () => {
  it("thay CẢ TUẦN một lần, không sửa từng thứ", async () => {
    // Cập nhật từng dòng thì nửa chừng lỗi mạng để lại một tuần lẫn giờ cũ với
    // giờ mới, và lưới đặt sân hiện ra sai mà không ai biết vì sao.
    const { db, mock } = createDb();
    await new VenueService(db).setHours("v1", hoursForWeek());

    expect(mock.venueHour.deleteMany).toHaveBeenCalledWith({ where: { venueId: "v1" } });
    const [{ data }] = mock.venueHour.createMany.mock.calls[0] as [{ data: unknown[] }];
    expect(data).toHaveLength(7);
    expect(mock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("TỪ CHỐI giờ lệch khung 30 phút", async () => {
    // 06:15 sẽ sinh ra khung 06:15, 06:45… lệch với mọi bảng giá, và không có
    // gì báo lỗi ở tầng dưới.
    const { db, mock } = createDb();

    await expect(
      new VenueService(db).setHours("v1", [{ weekday: 1, openMinute: 375, closeMinute: 22 * 60 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
    expect(mock.venueHour.deleteMany).not.toHaveBeenCalled();
  });

  it("từ chối giờ đóng trước giờ mở, và giờ vượt quá 24:00", async () => {
    const { db } = createDb();
    const service = new VenueService(db);

    await expect(
      service.setHours("v1", [{ weekday: 1, openMinute: 22 * 60, closeMinute: 6 * 60 }]),
    ).rejects.toThrow(/sau giờ mở cửa/);

    await expect(
      service.setHours("v1", [{ weekday: 1, openMinute: 6 * 60, closeMinute: 25 * 60 }]),
    ).rejects.toThrow(/24:00/);
  });

  it("ngày nghỉ thì bỏ qua mọi phép kiểm giờ", async () => {
    // Ngày đóng cửa không cần giờ hợp lệ — bắt khai giờ cho ngày nghỉ là vô nghĩa.
    const { db, mock } = createDb();
    await new VenueService(db).setHours("v1", [
      { weekday: 0, openMinute: 0, closeMinute: 0, isClosed: true },
    ]);

    expect(mock.venueHour.createMany).toHaveBeenCalled();
  });

  it("từ chối thứ ngoài 0–6", async () => {
    const { db } = createDb();

    await expect(
      new VenueService(db).setHours("v1", [{ weekday: 7, openMinute: 360, closeMinute: 1320 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
  });

  it("cơ sở không tồn tại hoặc đã xoá thì báo NOT_FOUND", async () => {
    const { db } = createDb({ venue: null });

    await expect(new VenueService(db).setHours("v1", hoursForWeek())).rejects.toBeInstanceOf(
      VenueNotFoundError,
    );
  });
});

describe("search — tìm sân", () => {
  it("chỉ trả sân ĐANG BÁN và chưa xoá", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).search({ q: "cầu lông" });

    const [{ where }] = mock.venue.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(where).toMatchObject({ status: "ACTIVE", deletedAt: null });
  });

  it("chặn limit để một request không kéo cả bảng về", async () => {
    const { db } = createDb();
    const result = await new VenueService(db).search({ limit: 5_000 });

    expect(result.meta.limit).toBe(50);
  });

  it("trang âm hoặc 0 vẫn ra trang 1", async () => {
    const { db } = createDb();

    expect((await new VenueService(db).search({ page: -3 })).meta.page).toBe(1);
    expect((await new VenueService(db).search({ page: 0 })).meta.page).toBe(1);
  });

  it("đếm và lấy trang SONG SONG, KHÔNG bọc transaction", async () => {
    // Trang này được mở nhiều nhất; một transaction giữ riêng một kết nối cho
    // cả hai câu và đổ ngay khi có vài người tìm cùng lúc trên Neon.
    const { db, mock } = createDb();
    const result = await new VenueService(db).search({});

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.venue.findMany).toHaveBeenCalledTimes(1);
    expect(mock.venue.count).toHaveBeenCalledTimes(1);
    expect(result.meta.total).toBe(0);
  });
});

describe("softDelete", () => {
  it("xoá mềm và ngừng bán, KHÔNG xoá thật", async () => {
    // Lượt đặt, hoá đơn, nhật ký đều trỏ tới sân này — xoá thật là vỡ báo cáo
    // doanh thu của những năm trước.
    const { db, mock } = createDb();
    const now = new Date("2026-09-04T03:00:00Z");
    await new VenueService(db).softDelete("v1", now);

    expect(mock.venue.update.mock.calls[0]![0].data).toEqual({
      deletedAt: now,
      status: "SUSPENDED",
    });
  });
});
