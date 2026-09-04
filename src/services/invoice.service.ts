import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";

/**
 * Hoá đơn hoa hồng nền tảng thu của chủ sân.
 *
 * ---
 * ĐÂY LÀ KHOẢN NỢ, KHÔNG PHẢI KHOẢN ĐÃ TRỪ
 *
 * Tiền đặt sân đi thẳng vào tài khoản của sân — nền tảng không giữ hộ. Nên
 * mỗi tháng nền tảng đếm doanh thu, nhân tỷ lệ, và xuất một hoá đơn. Quá hạn
 * thì khoá sân; đó là đòn bẩy duy nhất để đòi.
 *
 * ---
 * CHỐNG XUẤT TRÙNG NẰM Ở DATABASE
 *
 * `@@unique([venueId, periodStart])`. Cron chạy lại, hoặc admin bấm hai lần,
 * đều không tạo được hoá đơn thứ hai cho cùng một kỳ — và đó là chốt chặn duy
 * nhất đáng tin, vì hai tiến trình cùng chạy thì phép kiểm ở tầng này đều thấy
 * "chưa có".
 */

/** Trạng thái lượt đặt được tính vào doanh thu. Khớp `ReportService`. */
const SOLD = ["CONFIRMED", "CHECKED_IN", "COMPLETED"] as const;

/** Số ngày kể từ khi xuất tới hạn phải trả. */
const DUE_DAYS = 15;

export class InvoiceService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Xuất hoá đơn cho MỘT tháng, cho mọi cơ sở có doanh thu.
   *
   * `month` là bất kỳ ngày nào trong tháng cần chốt. Trả về số hoá đơn đã tạo
   * — cơ sở không có đồng nào thì không xuất, vì một hoá đơn 0đ chỉ làm chủ sân
   * hoang mang.
   */
  async generateForMonth(month: Date): Promise<{ created: number; skipped: number }> {
    const { start, end } = monthRangeVN(month);

    const rows = await this.db.booking.groupBy({
      by: ["venueId"],
      where: { startAt: { gte: start, lt: end }, status: { in: [...SOLD] } },
      _sum: { total: true },
      _count: { _all: true },
    });

    let created = 0;
    let skipped = 0;

    for (const row of rows) {
      const gross = row._sum.total ?? 0;
      if (gross <= 0) {
        skipped += 1;
        continue;
      }

      const venue = await this.db.venue.findUnique({
        where: { id: row.venueId },
        select: { commissionRate: true },
      });

      const rate = Number(venue?.commissionRate ?? 0);
      if (rate <= 0) {
        // Sân được miễn hoa hồng (khuyến mãi, đối tác) — không xuất hoá đơn 0đ.
        skipped += 1;
        continue;
      }

      const periodStart = dateOnly(start);

      try {
        await this.db.platformInvoice.create({
          data: {
            number: invoiceNumber(periodStart, row.venueId),
            venueId: row.venueId,
            periodStart,
            periodEnd: dateOnly(new Date(end.getTime() - 86_400_000)),
            bookingCount: row._count._all,
            grossRevenue: gross,
            commissionRate: rate,
            commissionAmount: Math.round((gross * rate) / 100),
            status: "DUE",
            dueDate: dateOnly(new Date(end.getTime() + DUE_DAYS * 86_400_000)),
          },
        });
        created += 1;
      } catch (error) {
        // Trùng kỳ = đã xuất rồi. Đây là đường chạy BÌNH THƯỜNG khi cron chạy
        // lại, không phải lỗi — nên bỏ qua chứ không ném lên.
        if (isDuplicatePeriod(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    return { created, skipped };
  }

  /** Hoá đơn của một cơ sở — chủ sân xem ở màn doanh thu. */
  async listForVenue(venueId: string, limit = 12) {
    return this.db.platformInvoice.findMany({
      where: { venueId },
      orderBy: { periodStart: "desc" },
      take: limit,
    });
  }

  /** Toàn bộ hoá đơn theo trạng thái — màn đối soát của nền tảng. */
  async listByStatus(status: "DUE" | "OVERDUE" | "PAID" | "WAIVED", limit = 100) {
    return this.db.platformInvoice.findMany({
      where: { status },
      orderBy: { dueDate: "asc" },
      take: limit,
      select: {
        id: true,
        number: true,
        periodStart: true,
        periodEnd: true,
        bookingCount: true,
        grossRevenue: true,
        commissionRate: true,
        commissionAmount: true,
        status: true,
        dueDate: true,
        venue: { select: { id: true, name: true, ward: true, province: true } },
      },
    });
  }

  /** Đánh dấu đã thu được tiền. */
  async markPaid(invoiceId: string, now = new Date()) {
    const invoice = await this.requireInvoice(invoiceId);
    if (invoice.status === "PAID") return invoice;
    if (invoice.status === "WAIVED") throw new InvoiceWaivedError();

    return this.db.platformInvoice.update({
      where: { id: invoiceId },
      data: { status: "PAID", paidAt: now },
    });
  }

  /** Miễn hoá đơn — cần lý do, vì đây là tiền nền tảng tự bỏ. */
  async waive(input: { invoiceId: string; by: string; reason: string }) {
    const invoice = await this.requireInvoice(input.invoiceId);
    if (invoice.status === "PAID") throw new InvoicePaidError();

    return this.db.platformInvoice.update({
      where: { id: input.invoiceId },
      data: { status: "WAIVED", waivedBy: input.by, waiveReason: input.reason.trim() },
    });
  }

  /**
   * Đánh dấu quá hạn. Cron chạy hằng ngày.
   *
   * `updateMany` một câu, không đọc-rồi-ghi từng dòng: hai bản worker chạy song
   * song thì câu này vẫn đúng.
   */
  async markOverdue(now = new Date()): Promise<number> {
    const result = await this.db.platformInvoice.updateMany({
      where: { status: "DUE", dueDate: { lt: dateOnly(now) } },
      data: { status: "OVERDUE" },
    });
    return result.count;
  }

  private async requireInvoice(invoiceId: string) {
    const invoice = await this.db.platformInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new InvoiceNotFoundError();
    return invoice;
  }
}

/**
 * Đầu và cuối tháng theo GIỜ VIỆT NAM, trả về mốc tuyệt đối.
 *
 * Cắt theo UTC thì mọi lượt đặt sau 17:00 giờ VN ngày cuối tháng rơi sang tháng
 * sau — và hoá đơn thiếu đúng những khung giờ vàng đắt nhất.
 */
function monthRangeVN(anyDayInMonth: Date): { start: Date; end: Date } {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).format(anyDayInMonth);

  const [year, month] = key.split("-").map(Number);
  // 00:00 giờ VN = 17:00 UTC ngày hôm trước.
  const start = new Date(Date.UTC(year!, month! - 1, 1) - 7 * 3_600_000);
  const end = new Date(Date.UTC(year!, month!, 1) - 7 * 3_600_000);
  return { start, end };
}

/** Cột `@db.Date` chỉ giữ phần ngày; chuẩn hoá về nửa đêm UTC cho nhất quán. */
function dateOnly(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + (date.getUTCHours() >= 17 ? 1 : 0)),
  );
}

/** `CS-202609-a1b2c3` — đọc được kỳ và sân ngay trên số hoá đơn. */
function invoiceNumber(periodStart: Date, venueId: string): string {
  const ym = `${periodStart.getUTCFullYear()}${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
  return `CS-${ym}-${venueId.slice(-6)}`;
}

function isDuplicatePeriod(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("P2002") || text.includes("platform_invoices_venue_id_period_start_key");
}

export class InvoiceNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Không tìm thấy hoá đơn");
  }
}
export class InvoicePaidError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("Hoá đơn đã thu tiền rồi, không miễn được");
  }
}
export class InvoiceWaivedError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("Hoá đơn này đã được miễn");
  }
}

export const invoiceService = new InvoiceService();
