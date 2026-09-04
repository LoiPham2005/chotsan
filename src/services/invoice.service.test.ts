import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { InvoicePaidError, InvoiceService, InvoiceWaivedError } from "./invoice.service";

/**
 * Hoá đơn hoa hồng là khoản chủ sân NỢ — tiền đặt sân đi thẳng vào tài khoản
 * của họ. Sai kỳ hoặc xuất trùng là đòi nhầm tiền của người thật.
 */

const THANG_9 = new Date("2026-09-15T05:00:00Z");

function createDb(over: Record<string, unknown> = {}) {
  const db = {
    booking: {
      groupBy: vi
        .fn()
        .mockResolvedValue([{ venueId: "v1", _sum: { total: 50_000_000 }, _count: { _all: 120 } }]),
    },
    venue: { findUnique: vi.fn().mockResolvedValue({ commissionRate: 8 }) },
    platformInvoice: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "i1", ...data }),
      ),
      findUnique: vi.fn().mockResolvedValue({ id: "i1", status: "DUE" }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "i1", ...data }),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
    ...over,
  };
  return { db: db as unknown as PrismaClient, mock: db };
}

beforeEach(() => vi.clearAllMocks());

describe("generateForMonth", () => {
  /**
   * Cắt theo UTC thì mọi lượt sau 17:00 giờ VN ngày cuối tháng rơi sang tháng
   * sau — hoá đơn thiếu đúng những khung giờ vàng đắt nhất.
   */
  it("cắt kỳ theo GIỜ VIỆT NAM, không theo UTC", async () => {
    const { db, mock } = createDb();
    await new InvoiceService(db).generateForMonth(THANG_9);

    const [args] = mock.booking.groupBy.mock.calls[0] as [
      { where: { startAt: { gte: Date; lt: Date } } },
    ];
    // 00:00 ngày 01/09 giờ VN = 17:00 ngày 31/08 UTC.
    expect(args.where.startAt.gte.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    // 00:00 ngày 01/10 giờ VN = 17:00 ngày 30/09 UTC.
    expect(args.where.startAt.lt.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("tính hoa hồng theo tỷ lệ của từng sân", async () => {
    const { db, mock } = createDb();
    const result = await new InvoiceService(db).generateForMonth(THANG_9);

    const [{ data }] = mock.platformInvoice.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toMatchObject({
      venueId: "v1",
      bookingCount: 120,
      grossRevenue: 50_000_000,
      commissionRate: 8,
      commissionAmount: 4_000_000,
      status: "DUE",
    });
    expect(result.created).toBe(1);
  });

  it("kỳ và hạn trả là NGÀY theo giờ VN", async () => {
    const { db, mock } = createDb();
    await new InvoiceService(db).generateForMonth(THANG_9);

    const [{ data }] = mock.platformInvoice.create.mock.calls[0] as [
      { data: { periodStart: Date; periodEnd: Date; dueDate: Date } },
    ];
    expect(data.periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(data.periodEnd.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    // Hạn trả = 15 ngày sau NGÀY CUỐI KỲ.
    expect(data.dueDate.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("số hoá đơn đọc được kỳ ngay trên đó", async () => {
    const { db, mock } = createDb();
    await new InvoiceService(db).generateForMonth(THANG_9);

    const [{ data }] = mock.platformInvoice.create.mock.calls[0] as [{ data: { number: string } }];
    expect(data.number).toMatch(/^CS-202609-/);
  });

  it("sân không có doanh thu thì KHÔNG xuất hoá đơn 0đ", async () => {
    const { db, mock } = createDb();
    mock.booking.groupBy.mockResolvedValue([
      { venueId: "v1", _sum: { total: 0 }, _count: { _all: 0 } },
    ]);

    const result = await new InvoiceService(db).generateForMonth(THANG_9);

    expect(mock.platformInvoice.create).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, skipped: 1 });
  });

  it("sân được miễn hoa hồng (0%) thì bỏ qua", async () => {
    const { db, mock } = createDb();
    mock.venue.findUnique.mockResolvedValue({ commissionRate: 0 });

    const result = await new InvoiceService(db).generateForMonth(THANG_9);

    expect(mock.platformInvoice.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  /**
   * Đây là đường chạy BÌNH THƯỜNG khi cron chạy lại, không phải lỗi.
   */
  it("xuất lại cùng kỳ thì bỏ qua, không ném lỗi và không tạo bản thứ hai", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await new InvoiceService(db).generateForMonth(THANG_9);

    expect(result).toEqual({ created: 0, skipped: 1 });
  });

  it("lỗi khác thì ném lên, không nuốt", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.create.mockRejectedValue(new Error("Can't reach database server"));

    await expect(new InvoiceService(db).generateForMonth(THANG_9)).rejects.toThrow(
      "reach database",
    );
  });
});

describe("listByStatus", () => {
  it("tính sẵn số ngày quá hạn — giao diện không được gọi Date.now() lúc render", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.findMany.mockResolvedValue([
      { id: "i1", dueDate: new Date("2026-10-15T00:00:00Z"), commissionAmount: 1 },
    ]);

    const rows = await new InvoiceService(db).listByStatus("OVERDUE", {
      now: new Date("2026-11-04T03:00:00Z"),
    });

    expect(rows[0]!.overdueDays).toBe(20);
  });

  it("chưa tới hạn thì 0, không phải số âm", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.findMany.mockResolvedValue([
      { id: "i1", dueDate: new Date("2026-12-01T00:00:00Z"), commissionAmount: 1 },
    ]);

    const rows = await new InvoiceService(db).listByStatus("DUE", {
      now: new Date("2026-11-04T03:00:00Z"),
    });

    expect(rows[0]!.overdueDays).toBe(0);
  });
});

describe("markPaid / waive / markOverdue", () => {
  it("đánh dấu đã thu tiền kèm mốc thời gian", async () => {
    const { db, mock } = createDb();
    const now = new Date("2026-10-10T03:00:00Z");
    await new InvoiceService(db).markPaid("i1", now);

    const [{ data }] = mock.platformInvoice.update.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toEqual({ status: "PAID", paidAt: now });
  });

  it("thu tiền hai lần không tạo thay đổi thứ hai", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.findUnique.mockResolvedValue({ id: "i1", status: "PAID" });

    await new InvoiceService(db).markPaid("i1");

    expect(mock.platformInvoice.update).not.toHaveBeenCalled();
  });

  it("không thu tiền hoá đơn đã miễn", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.findUnique.mockResolvedValue({ id: "i1", status: "WAIVED" });

    await expect(new InvoiceService(db).markPaid("i1")).rejects.toBeInstanceOf(InvoiceWaivedError);
  });

  it("không miễn hoá đơn đã thu tiền", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.findUnique.mockResolvedValue({ id: "i1", status: "PAID" });

    await expect(
      new InvoiceService(db).waive({ invoiceId: "i1", by: "u1", reason: "x" }),
    ).rejects.toBeInstanceOf(InvoicePaidError);
  });

  it("đánh dấu quá hạn bằng MỘT câu lệnh", async () => {
    // Đọc-rồi-ghi từng dòng thì hai bản worker song song giẫm lên nhau.
    const { db, mock } = createDb();
    const count = await new InvoiceService(db).markOverdue(new Date("2026-10-20T03:00:00Z"));

    expect(count).toBe(4);
    const [args] = mock.platformInvoice.updateMany.mock.calls[0] as [
      { where: { status: string; dueDate: { lt: Date } }; data: { status: string } },
    ];
    expect(args.where.status).toBe("DUE");
    expect(args.data.status).toBe("OVERDUE");
  });
});
