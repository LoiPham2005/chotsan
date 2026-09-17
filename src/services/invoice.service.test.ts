import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  InvoiceNotFoundError,
  InvoicePaidError,
  InvoicePeriodOpenError,
  InvoiceWaivedError,
} from "@/lib/errors";
import { InvoiceService } from "./invoice.service";

/**
 * Hoá đơn hoa hồng là khoản chủ sân NỢ — tiền đặt sân đi thẳng vào tài khoản
 * của họ. Sai kỳ, xuất trùng, hay bỏ sót một cơ sở trong im lặng là đòi nhầm
 * tiền của người thật (hoặc không đòi được đồng nào).
 *
 * Mốc: tháng 9/2026 giờ Việt Nam; job chạy lúc 02:00 ngày 01/10/2026.
 */

const SEPTEMBER = new Date("2026-09-15T05:00:00Z");
const AFTER_SEPTEMBER = new Date("2026-09-30T19:00:00Z"); // 02:00 ngày 01/10 giờ VN

type Row = { venueId: string; _sum: { total: number | null }; _count: { _all: number } };

/** Lỗi trùng khoá đúng hình dạng Prisma 7 + adapter-pg (xem prisma-errors.test.ts). */
function uniqueViolation(constraint: string, fields: string[]): Error {
  return Object.assign(
    new Error(
      `Unique constraint failed on the fields: (${fields.map((f) => `\`${f}\``).join(",")})`,
    ),
    {
      code: "P2002",
      meta: {
        modelName: "PlatformInvoice",
        driverAdapterError: {
          cause: {
            originalCode: "23505",
            originalMessage: `duplicate key value violates unique constraint "${constraint}"`,
            constraint: { fields },
          },
        },
      },
    },
  );
}

type Options = {
  rows?: Row[] | ((where: { startAt: { gte: Date; lt: Date } }) => Row[]);
  rates?: Record<string, number | null>;
  /** venueId đã có hoá đơn của kỳ đang xuất. */
  invoiced?: string[];
  createErrors?: Record<string, Error>;
  invoice?: { id: string; status: string } | null;
  updateCount?: number;
};

function createDb(options: Options = {}) {
  let sequence = 41;

  const db = {
    booking: {
      groupBy: vi.fn((args: { where: { startAt: { gte: Date; lt: Date } } }) =>
        Promise.resolve(
          typeof options.rows === "function"
            ? options.rows(args.where)
            : (options.rows ?? [
                { venueId: "v1", _sum: { total: 50_000_000 }, _count: { _all: 120 } },
              ]),
        ),
      ),
    },
    venue: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.map((id) => ({
            id,
            // `in` chứ không `??`: test cần truyền `null` tường minh (sân chưa khai tỷ lệ).
            commissionRate: options.rates && id in options.rates ? options.rates[id] : 8,
          })),
        ),
      ),
    },
    platformInvoice: {
      create: vi.fn(({ data }: { data: { venueId: string } & Record<string, unknown> }) => {
        const error = options.createErrors?.[data.venueId];
        return error ? Promise.reject(error) : Promise.resolve({ id: "i1", ...data });
      }),
      findMany: vi.fn(({ where }: { where: { venueId?: { in: string[] } } }) =>
        Promise.resolve(
          where.venueId
            ? where.venueId.in
                .filter((id) => options.invoiced?.includes(id))
                .map((venueId) => ({ venueId }))
            : [],
        ),
      ),
      findUnique: vi
        .fn()
        .mockResolvedValue("invoice" in options ? options.invoice : { id: "i1", status: "DUE" }),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: options.updateCount ?? 1 }),
      ),
    },
    // Mỗi lần gọi là một số MỚI — đúng như nextval() của Postgres.
    $queryRaw: vi.fn((_strings: TemplateStringsArray) => {
      sequence += 1;
      return Promise.resolve([{ value: BigInt(sequence) }]);
    }),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
  };

  return { db: db as unknown as PrismaClient, mock: db };
}

beforeEach(() => vi.clearAllMocks());

describe("generateForMonth — xuất một tháng", () => {
  /**
   * Cắt theo UTC thì mọi lượt sau 17:00 giờ VN ngày cuối tháng rơi sang tháng
   * sau — hoá đơn thiếu đúng những khung giờ vàng đắt nhất.
   */
  it("cắt kỳ theo GIỜ VIỆT NAM, không theo UTC", async () => {
    const { db, mock } = createDb();
    await new InvoiceService(db).generateForMonth(SEPTEMBER, { now: AFTER_SEPTEMBER });

    const [args] = mock.booking.groupBy.mock.calls[0]!;
    // 00:00 ngày 01/09 giờ VN = 17:00 ngày 31/08 UTC.
    expect(args.where.startAt.gte.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    // 00:00 ngày 01/10 giờ VN = 17:00 ngày 30/09 UTC.
    expect(args.where.startAt.lt.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("tính hoa hồng theo tỷ lệ của từng sân", async () => {
    const { db, mock } = createDb();
    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    expect(mock.platformInvoice.create.mock.calls[0]![0].data).toMatchObject({
      venueId: "v1",
      bookingCount: 120,
      grossRevenue: 50_000_000,
      commissionRate: 8,
      commissionAmount: 4_000_000,
      status: "DUE",
    });
    expect(result).toEqual({ period: "2026-09", created: 1, skipped: 0, failed: [] });
  });

  it("kỳ và hạn trả là NGÀY theo giờ VN", async () => {
    const { db, mock } = createDb();
    await new InvoiceService(db).generateForMonth(SEPTEMBER, { now: AFTER_SEPTEMBER });

    const { data } = mock.platformInvoice.create.mock.calls[0]![0] as unknown as {
      data: { periodStart: Date; periodEnd: Date; dueDate: Date };
    };
    expect(data.periodStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(data.periodEnd.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    // Hạn trả = 15 ngày sau NGÀY CUỐI KỲ.
    expect(data.dueDate.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  it("kỳ tháng 2 và kỳ vắt qua năm vẫn đúng ngày cuối", async () => {
    const { db, mock } = createDb();
    const service = new InvoiceService(db);
    const later = new Date("2027-06-01T00:00:00Z");

    await service.generateForMonth(new Date("2027-02-10T05:00:00Z"), { now: later });
    await service.generateForMonth(new Date("2026-12-31T16:00:00Z"), { now: later });

    const dates = mock.platformInvoice.create.mock.calls.map(([args]) => {
      const data = args.data as unknown as { periodEnd: Date; dueDate: Date };
      return [data.periodEnd.toISOString().slice(0, 10), data.dueDate.toISOString().slice(0, 10)];
    });
    expect(dates).toEqual([
      ["2027-02-28", "2027-03-15"],
      ["2026-12-31", "2027-01-15"],
    ]);
  });

  /**
   * Lỗi thật trước đây: số = `CS-YYYYMM-<6 ký tự cuối id cơ sở>`. Hai cơ sở trùng
   * 6 ký tự cuối là trùng số; lỗi trùng bị coi là "đã xuất" và hoá đơn thứ hai
   * biến mất trong im lặng.
   */
  it("số hoá đơn lấy từ sequence: hai cơ sở trùng đuôi id vẫn ra hai số KHÁC nhau", async () => {
    const { db, mock } = createDb({
      rows: [
        { venueId: "cmabc123456", _sum: { total: 1_000_000 }, _count: { _all: 3 } },
        { venueId: "cmxyz123456", _sum: { total: 2_000_000 }, _count: { _all: 5 } },
      ],
    });

    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    const numbers = mock.platformInvoice.create.mock.calls.map(([args]) => args.data.number);
    expect(numbers).toEqual(["CS-202609-000042", "CS-202609-000043"]);
    expect(result.created).toBe(2);
    // nextval() nằm TRONG transaction tạo hoá đơn, mỗi hoá đơn một lần.
    expect(mock.$transaction).toHaveBeenCalledTimes(2);
    expect(mock.$queryRaw.mock.calls[0]![0].join("")).toContain(
      "nextval('platform_invoice_number_seq')",
    );
  });

  it("sân không có doanh thu thì KHÔNG xuất hoá đơn 0đ", async () => {
    const { db, mock } = createDb({
      rows: [{ venueId: "v1", _sum: { total: 0 }, _count: { _all: 0 } }],
    });

    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    expect(mock.platformInvoice.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, skipped: 1 });
  });

  it("sân được miễn hoa hồng (0%) hoặc chưa khai tỷ lệ thì bỏ qua", async () => {
    const { db, mock } = createDb({
      rows: [
        { venueId: "v0", _sum: { total: 1_000 }, _count: { _all: 1 } },
        { venueId: "vn", _sum: { total: 1_000 }, _count: { _all: 1 } },
      ],
      rates: { v0: 0, vn: null },
    });

    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    expect(mock.platformInvoice.create).not.toHaveBeenCalled();
    expect(result.skipped).toBe(2);
  });

  it("kỳ đã có hoá đơn thì bỏ qua TRƯỚC khi lấy số — chạy lại không làm hở sequence", async () => {
    const { db, mock } = createDb({ invoiced: ["v1"] });

    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    expect(result).toMatchObject({ created: 0, skipped: 1, failed: [] });
    expect(mock.$queryRaw).not.toHaveBeenCalled();
  });

  it("thua cuộc đua trên ràng buộc (cơ sở, kỳ) thì coi là đã xuất, không báo lỗi", async () => {
    const { db } = createDb({
      createErrors: {
        v1: uniqueViolation("platform_invoices_venue_id_period_start_key", [
          "venue_id",
          "period_start",
        ]),
      },
    });

    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    expect(result).toMatchObject({ created: 0, skipped: 1, failed: [] });
  });

  it("TRÙNG SỐ hoá đơn KHÔNG bị nuốt thành 'đã xuất' — hiện ra ở failed", async () => {
    const { db } = createDb({
      createErrors: { v1: uniqueViolation("platform_invoices_number_key", ["number"]) },
    });

    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toEqual([
      { period: "2026-09", venueId: "v1", message: expect.stringContaining("Unique constraint") },
    ]);
  });

  it("một cơ sở hỏng KHÔNG chặn hoá đơn của cơ sở khác", async () => {
    const { db, mock } = createDb({
      rows: [
        { venueId: "v1", _sum: { total: 1_000_000 }, _count: { _all: 2 } },
        { venueId: "v2", _sum: { total: 3_000_000 }, _count: { _all: 6 } },
      ],
      createErrors: { v1: new Error("Can't reach database server") },
    });

    const result = await new InvoiceService(db).generateForMonth(SEPTEMBER, {
      now: AFTER_SEPTEMBER,
    });

    expect(result.created).toBe(1);
    expect(result.failed).toEqual([
      { period: "2026-09", venueId: "v1", message: "Can't reach database server" },
    ]);
    expect(mock.platformInvoice.create.mock.calls[1]![0].data.venueId).toBe("v2");
  });

  it("KHÔNG xuất cho tháng chưa kết thúc — hoá đơn là ảnh chụp, chốt sớm là thiếu tiền", async () => {
    const { db, mock } = createDb();

    await expect(
      new InvoiceService(db).generateForMonth(SEPTEMBER, {
        now: new Date("2026-09-30T16:59:00Z"), // 23:59 ngày 30/09 giờ VN
      }),
    ).rejects.toBeInstanceOf(InvoicePeriodOpenError);
    expect(mock.booking.groupBy).not.toHaveBeenCalled();
  });
});

describe("generateMissing — job tự bù", () => {
  it("xuất cho 3 tháng ĐÃ KẾT THÚC gần nhất theo giờ VN, từ cũ tới mới", async () => {
    const { db, mock } = createDb({ rows: [] });

    // 00:30 ngày 01/09 giờ VN: tháng 8 vừa kết thúc, tháng 9 chưa.
    const result = await new InvoiceService(db).generateMissing({
      now: new Date("2026-08-31T17:30:00Z"),
    });

    expect(result.periods).toEqual(["2026-06", "2026-07", "2026-08"]);
    const starts = mock.booking.groupBy.mock.calls.map(([args]) =>
      args.where.startAt.gte.toISOString(),
    );
    expect(starts).toEqual([
      "2026-05-31T17:00:00.000Z",
      "2026-06-30T17:00:00.000Z",
      "2026-07-31T17:00:00.000Z",
    ]);
  });

  it("23:30 ngày cuối tháng giờ VN — tháng đó CHƯA kết thúc nên CHƯA được chốt", async () => {
    const { db } = createDb({ rows: [] });

    // 16:30 UTC ngày 31/08 = 23:30 ngày 31/08 giờ VN.
    const result = await new InvoiceService(db).generateMissing({
      now: new Date("2026-08-31T16:30:00Z"),
    });

    expect(result.periods).toEqual(["2026-05", "2026-06", "2026-07"]);
  });

  it("vắt qua năm mới vẫn lùi đúng tháng", async () => {
    const { db } = createDb({ rows: [] });

    const result = await new InvoiceService(db).generateMissing({
      now: new Date("2027-01-01T03:00:00Z"),
    });

    expect(result.periods).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  /**
   * Lỗi thật trước đây: job chỉ chốt "tháng trước" đúng một lần vào mùng 1 và
   * không thử lại — lần đó hỏng là mất hẳn hoá đơn tháng đó.
   */
  it("tháng trước bị lỡ thì lần chạy sau TỰ BÙ; tháng đã có thì không xuất lại", async () => {
    // Tháng 7 đã xuất (v1 có hoá đơn), tháng 8 bị lỡ (chưa có).
    const { db, mock } = createDb({
      rows: (where) =>
        where.startAt.gte.toISOString().startsWith("2026-06-30") ||
        where.startAt.gte.toISOString().startsWith("2026-07-31")
          ? [{ venueId: "v1", _sum: { total: 1_000_000 }, _count: { _all: 4 } }]
          : [],
    });
    mock.platformInvoice.findMany.mockImplementation(({ where }) =>
      Promise.resolve(
        (where as { periodStart: Date }).periodStart.toISOString() === "2026-07-01T00:00:00.000Z"
          ? [{ venueId: "v1" }]
          : [],
      ),
    );

    const result = await new InvoiceService(db).generateMissing({
      now: new Date("2026-09-02T03:00:00Z"),
    });

    expect(result).toMatchObject({ created: 1, skipped: 1, failed: [] });
    const periods = mock.platformInvoice.create.mock.calls.map(([args]) =>
      (args.data.periodStart as Date).toISOString(),
    );
    expect(periods).toEqual(["2026-08-01T00:00:00.000Z"]);
  });

  it("một tháng không đọc được lượt đặt vẫn chạy tiếp các tháng khác, lỗi hiện ra ở failed", async () => {
    const { db, mock } = createDb({ rows: [] });
    mock.booking.groupBy
      .mockRejectedValueOnce(new Error("Can't reach database server"))
      .mockResolvedValue([]);

    const result = await new InvoiceService(db).generateMissing({
      now: new Date("2026-09-02T03:00:00Z"),
    });

    expect(mock.booking.groupBy).toHaveBeenCalledTimes(3);
    expect(result.failed).toEqual([
      { period: "2026-06", venueId: null, message: "Can't reach database server" },
    ]);
  });
});

describe("listByStatus", () => {
  it("tính sẵn số ngày quá hạn — giao diện không được gọi Date.now() lúc render", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.findMany.mockResolvedValue([
      { id: "i1", dueDate: new Date("2026-10-15T00:00:00Z"), commissionAmount: 1 } as never,
    ]);

    const rows = await new InvoiceService(db).listByStatus("OVERDUE", {
      now: new Date("2026-11-04T03:00:00Z"),
    });

    expect(rows[0]!.overdueDays).toBe(20);
  });

  it("đếm theo NGÀY giờ VN: 06:00 sáng hôm sau hạn trả là đã quá hạn 1 ngày", async () => {
    // Đếm bằng mốc tuyệt đối thì lúc này mới trôi 23 tiếng → "0 ngày", trong khi
    // `markOverdue` đã chuyển hoá đơn sang tab Quá hạn.
    const { db, mock } = createDb();
    mock.platformInvoice.findMany.mockResolvedValue([
      { id: "i1", dueDate: new Date("2026-10-15T00:00:00Z"), commissionAmount: 1 } as never,
    ]);

    const rows = await new InvoiceService(db).listByStatus("OVERDUE", {
      now: new Date("2026-10-15T23:00:00Z"), // 06:00 ngày 16/10 giờ VN
    });

    expect(rows[0]!.overdueDays).toBe(1);
  });

  it("chưa tới hạn thì 0, không phải số âm", async () => {
    const { db, mock } = createDb();
    mock.platformInvoice.findMany.mockResolvedValue([
      { id: "i1", dueDate: new Date("2026-12-01T00:00:00Z"), commissionAmount: 1 } as never,
    ]);

    const rows = await new InvoiceService(db).listByStatus("DUE", {
      now: new Date("2026-11-04T03:00:00Z"),
    });

    expect(rows[0]!.overdueDays).toBe(0);
  });
});

describe("markPaid / waive / markOverdue", () => {
  it("đánh dấu đã thu tiền bằng so-rồi-đổi: chỉ ghi khi hoá đơn còn phải thu", async () => {
    const { db, mock } = createDb();
    const now = new Date("2026-10-10T03:00:00Z");

    await expect(new InvoiceService(db).markPaid("i1", now)).resolves.toEqual({
      alreadyPaid: false,
    });
    expect(mock.platformInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: "i1", status: { in: ["DRAFT", "DUE", "OVERDUE"] } },
      data: { status: "PAID", paidAt: now },
    });
  });

  it("thu tiền hai lần: không ghi lần hai và NÓI RÕ là đã thu từ trước", async () => {
    const { db } = createDb({ updateCount: 0, invoice: { id: "i1", status: "PAID" } });

    await expect(new InvoiceService(db).markPaid("i1")).resolves.toEqual({ alreadyPaid: true });
  });

  it("không thu tiền hoá đơn đã miễn", async () => {
    const { db } = createDb({ updateCount: 0, invoice: { id: "i1", status: "WAIVED" } });

    await expect(new InvoiceService(db).markPaid("i1")).rejects.toBeInstanceOf(InvoiceWaivedError);
  });

  it("hoá đơn không tồn tại thì NOT_FOUND", async () => {
    const { db } = createDb({ updateCount: 0, invoice: null });

    await expect(new InvoiceService(db).markPaid("i1")).rejects.toBeInstanceOf(
      InvoiceNotFoundError,
    );
  });

  it("miễn hoá đơn ghi người miễn + lý do, chỉ khi còn phải thu", async () => {
    const { db, mock } = createDb();

    await expect(
      new InvoiceService(db).waive({ invoiceId: "i1", by: "u1", reason: "  Đối tác chiến lược  " }),
    ).resolves.toEqual({ alreadyWaived: false });
    expect(mock.platformInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: "i1", status: { in: ["DRAFT", "DUE", "OVERDUE"] } },
      data: { status: "WAIVED", waivedBy: "u1", waiveReason: "Đối tác chiến lược" },
    });
  });

  it("không miễn hoá đơn đã thu tiền; miễn lần hai thì báo đã miễn, không ghi đè lý do", async () => {
    const paid = createDb({ updateCount: 0, invoice: { id: "i1", status: "PAID" } });
    await expect(
      new InvoiceService(paid.db).waive({ invoiceId: "i1", by: "u1", reason: "x" }),
    ).rejects.toBeInstanceOf(InvoicePaidError);

    const waived = createDb({ updateCount: 0, invoice: { id: "i1", status: "WAIVED" } });
    await expect(
      new InvoiceService(waived.db).waive({ invoiceId: "i1", by: "u2", reason: "khác" }),
    ).resolves.toEqual({ alreadyWaived: true });
  });

  it("đánh dấu quá hạn bằng MỘT câu lệnh, so với NGÀY hôm nay giờ VN", async () => {
    // Đọc-rồi-ghi từng dòng thì hai bản worker song song giẫm lên nhau.
    const { db, mock } = createDb({ updateCount: 4 });
    const count = await new InvoiceService(db).markOverdue(new Date("2026-10-20T20:00:00Z"));

    expect(count).toBe(4);
    const [args] = mock.platformInvoice.updateMany.mock.calls[0]!;
    // 20:00 UTC ngày 20/10 = 03:00 ngày 21/10 giờ VN.
    expect(args).toEqual({
      where: { status: "DUE", dueDate: { lt: new Date("2026-10-21T00:00:00Z") } },
      data: { status: "OVERDUE" },
    });
  });
});
