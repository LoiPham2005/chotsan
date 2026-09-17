import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ReportService } from "./report.service";

/**
 * Sai ở đây là chủ sân nhìn một con số không bao giờ khớp với sao kê ngân hàng
 * — loại lỗi họ phát hiện cuối tháng và mất cả buổi để đối chiếu.
 */

const FROM = new Date("2026-09-01T05:00:00Z");
const TO = new Date("2026-09-30T05:00:00Z");

type Row = Record<string, unknown>;

/**
 * Mock `where` của Prisma cho các dạng tầng này dùng (bằng nhau, `in`,
 * `gte`/`lt`/`gt`, `null`, `OR`) — đếm phải LỌC THẬT, không trả một con số bừa.
 */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((clause) => matches(row, clause));

    const value = row[key];
    if (condition === null) return value === null;
    if (typeof condition === "object") {
      const {
        in: list,
        gte,
        lt,
        gt,
      } = condition as { in?: unknown[]; gte?: Date; lt?: Date; gt?: Date };
      const at = value instanceof Date ? value.getTime() : Number.NaN;
      if (list && !list.includes(value)) return false;
      if (gte && !(at >= gte.getTime())) return false;
      if (lt && !(at < lt.getTime())) return false;
      if (gt && !(at > gt.getTime())) return false;
      return true;
    }
    return value === condition;
  });
}

function createDb(over: Record<string, unknown> = {}) {
  const db = {
    booking: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { total: 12_000_000, discountTotal: 500_000 },
        _count: { _all: 40 },
      }),
      count: vi.fn().mockResolvedValue(3),
      groupBy: vi
        .fn()
        .mockResolvedValue([{ courtId: "c1", _sum: { total: 7_000_000 }, _count: { _all: 25 } }]),
    },
    venue: { findUnique: vi.fn().mockResolvedValue({ commissionRate: 8 }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    ...over,
  };
  return { db: db as unknown as PrismaClient, mock: db };
}

beforeEach(() => vi.clearAllMocks());

describe("venueSummary", () => {
  it("chỉ tính lượt ĐÃ BÁN, bỏ giữ chỗ và đã huỷ", async () => {
    // Gộp HOLDING vào doanh thu là đếm tiền chưa ai trả.
    const { db, mock } = createDb();
    await new ReportService(db).venueSummary("v1", { from: FROM, to: TO });

    const [args] = mock.booking.aggregate.mock.calls[0] as [
      { where: { status: { in: string[] } } },
    ];
    expect(args.where.status.in).toEqual(["CONFIRMED", "CHECKED_IN", "COMPLETED"]);
  });

  it("khoảng ngày tính CẢ hai đầu, theo giờ Việt Nam", async () => {
    const { db, mock } = createDb();
    await new ReportService(db).venueSummary("v1", { from: FROM, to: TO });

    const [args] = mock.booking.aggregate.mock.calls[0] as [
      { where: { startAt: { gte: Date; lt: Date } } },
    ];
    // 00:00 ngày 01/09 giờ VN = 17:00 ngày 31/08 UTC.
    expect(args.where.startAt.gte.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    // Hết ngày 30/09 giờ VN = 17:00 ngày 30/09 UTC.
    expect(args.where.startAt.lt.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("hoa hồng là khoản chủ sân NỢ, tính từ doanh thu và tỷ lệ của sân", async () => {
    const { db } = createDb();
    const result = await new ReportService(db).venueSummary("v1", { from: FROM, to: TO });

    expect(result.revenue).toBe(12_000_000);
    expect(result.commissionRate).toBe(8);
    expect(result.commissionOwed).toBe(960_000);
  });

  it("sân chưa khai tỷ lệ hoa hồng thì nợ 0, không phải NaN", async () => {
    const { db, mock } = createDb();
    mock.venue.findUnique.mockResolvedValue({ commissionRate: null });

    const result = await new ReportService(db).venueSummary("v1", { from: FROM, to: TO });

    expect(result.commissionRate).toBe(0);
    expect(result.commissionOwed).toBe(0);
  });

  it("chưa có lượt nào thì mọi con số là 0, không phải null", async () => {
    const { db, mock } = createDb();
    mock.booking.aggregate.mockResolvedValue({
      _sum: { total: null, discountTotal: null },
      _count: { _all: 0 },
    });

    const result = await new ReportService(db).venueSummary("v1", { from: FROM, to: TO });

    expect(result).toMatchObject({
      revenue: 0,
      discountTotal: 0,
      bookingCount: 0,
      commissionOwed: 0,
    });
  });

  /**
   * Lỗi thật trước đây: đếm mọi HOLDING. Chỗ giữ quá hạn mà cron chưa nhả (máy
   * dev không chạy worker) vẫn hiện "N lượt đang chờ thanh toán" mãi mãi.
   */
  it("chỉ đếm chỗ giữ CÒN SỐNG — chỗ giữ quá hạn không tính dù cron chưa nhả", async () => {
    const now = new Date("2026-09-10T03:00:00Z");
    const inWindow = new Date("2026-09-10T12:00:00Z");
    const bookings = [
      { status: "HOLDING", holdExpiresAt: new Date(now.getTime() + 5 * 60_000) }, // còn hạn
      { status: "HOLDING", holdExpiresAt: null }, // đã báo chuyển khoản
      { status: "HOLDING", holdExpiresAt: new Date(now.getTime() - 60_000) }, // quá hạn
      { status: "CONFIRMED", holdExpiresAt: null },
      { status: "CANCELLED", holdExpiresAt: null },
    ].map((booking) => ({ ...booking, venueId: "v1", startAt: inWindow }));

    const { db, mock } = createDb();
    mock.booking.count.mockImplementation(({ where }: { where: Row }) =>
      Promise.resolve(bookings.filter((booking) => matches(booking, where)).length),
    );

    const result = await new ReportService(db).venueSummary("v1", { from: FROM, to: TO }, { now });

    expect(result.holdingCount).toBe(2);
    expect(result.cancelledCount).toBe(1);
  });

  it("tách được doanh thu theo từng sân con", async () => {
    const { db } = createDb();
    const result = await new ReportService(db).venueSummary("v1", { from: FROM, to: TO });

    expect(result.byCourt).toEqual([{ courtId: "c1", bookings: 25, revenue: 7_000_000 }]);
  });
});

describe("dailyRevenue", () => {
  it("đổi bigint sang number — JSON không mang được bigint", async () => {
    // Không đổi ở đây thì component nhận bigint và React ném lỗi serialize.
    const { db, mock } = createDb();
    mock.$queryRaw.mockResolvedValue([{ date: "2026-09-04", bookings: 12n, revenue: 3_400_000n }]);

    const rows = await new ReportService(db).dailyRevenue("v1", { from: FROM, to: TO });

    expect(rows).toEqual([{ date: "2026-09-04", bookings: 12, revenue: 3_400_000 }]);
    expect(typeof rows[0]!.revenue).toBe("number");
  });

  it("gom nhóm theo giờ Việt Nam, không theo UTC", async () => {
    // Gom theo UTC thì mọi lượt sau 17:00 giờ VN rơi sang ngày hôm sau.
    const { db, mock } = createDb();
    await new ReportService(db).dailyRevenue("v1", { from: FROM, to: TO });

    // Prisma truyền template literal: phần tử đầu là mảng các đoạn SQL tĩnh.
    const [chunks] = mock.$queryRaw.mock.calls[0] as [string[] | { raw?: string[] }];
    const sql = (Array.isArray(chunks) ? chunks : (chunks.raw ?? [])).join(" ");
    expect(sql).toContain("Asia/Ho_Chi_Minh");
    expect(sql).toContain("CONFIRMED");
  });
});
