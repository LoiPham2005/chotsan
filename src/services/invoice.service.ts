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
      // Cộng từ NGÀY CUỐI KỲ, không cộng từ `end` — `end` là 00:00 ngày đầu
      // tháng sau, nên cộng từ đó ra hạn trả lệch đúng một ngày.
      const periodEnd = dateOnly(new Date(end.getTime() - 86_400_000));
      const dueDate = new Date(periodEnd.getTime() + DUE_DAYS * 86_400_000);

      try {
        await this.db.platformInvoice.create({
          data: {
            number: invoiceNumber(periodStart, row.venueId),
            venueId: row.venueId,
            periodStart,
            periodEnd,
            bookingCount: row._count._all,
            grossRevenue: gross,
            commissionRate: rate,
            commissionAmount: Math.round((gross * rate) / 100),
            status: "DUE",
            dueDate,
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

  /**
   * Toàn bộ hoá đơn theo trạng thái — màn đối soát của nền tảng.
   *
   * Trả kèm `overdueDays` tính sẵn. Để giao diện tự trừ ngày là gọi `Date.now()`
   * trong lúc render — không thuần khiết, React cảnh báo, và mỗi màn lại tính
   * một kiểu.
   */
  async listByStatus(
    status: "DUE" | "OVERDUE" | "PAID" | "WAIVED",
    options: { limit?: number; now?: Date } = {},
  ) {
    const { limit = 100, now = new Date() } = options;

    const rows = await this.db.platformInvoice.findMany({
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

    return rows.map((row) => ({
      ...row,
      overdueDays: Math.max(0, Math.floor((now.getTime() - row.dueDate.getTime()) / 86_400_000)),
    }));
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
  const end = new Date(Date.UTC(year!, month, 1) - 7 * 3_600_000);
  return { start, end };
}

/**
 * Cột `@db.Date` chỉ giữ phần ngày — lấy NGÀY THEO GIỜ VN của một mốc tuyệt
 * đối, trả về nửa đêm UTC của ngày đó.
 *
 * Đi qua `Intl` thay vì cộng trừ giờ bằng tay: 22:00 UTC là 05:00 hôm sau ở
 * Việt Nam, và tự tính bằng `getUTCDate() + 1` thì sai ngay ở ngày cuối tháng.
 */
function dateOnly(date: Date): Date {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  return new Date(`${key}T00:00:00Z`);
}

/** `CS-202609-a1b2c3` — đọc được kỳ và sân ngay trên số hoá đơn. */
function invoiceNumber(periodStart: Date, venueId: string): string {
  const ym = `${periodStart.getUTCFullYear()}${String(periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
  return `CS-${ym}-${venueId.slice(-6)}`;
}

/**
 * Đây có phải lỗi "đã xuất hoá đơn cho kỳ này rồi" không.
 *
 * Prisma để mã ở thuộc tính `code`, KHÔNG để trong thông điệp — dò bằng
 * `message.includes("P2002")` là không bao giờ khớp, và cron chạy lại sẽ ném
 * lỗi thay vì bỏ qua êm.
 */
function isDuplicatePeriod(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { code?: string }).code === "P2002") return true;
  return error.message.includes("platform_invoices_venue_id_period_start_key");
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
