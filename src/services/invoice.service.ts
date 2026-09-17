import type { PrismaClient } from "@prisma/client";
import { addDays, dateKey, fromDateKey } from "@/lib/date";
import {
  InvoiceNotFoundError,
  InvoicePaidError,
  InvoicePeriodOpenError,
  InvoiceWaivedError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { atMinuteVN } from "@/lib/slots";

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
 * HOÁ ĐƠN LÀ ẢNH CHỤP LÚC XUẤT — CỐ Ý
 *
 * Số lượt, doanh thu và TỈ LỆ HOA HỒNG được chép vào hoá đơn đúng lúc xuất. Lượt
 * đặt của tháng đó được xác nhận/huỷ/hoàn tiền về sau, hay tỉ lệ của sân đổi về
 * sau, KHÔNG sửa hoá đơn đã xuất: số chủ sân đã nhận và có thể đã trả không được
 * tự đổi sau lưng họ. Cần điều chỉnh thì miễn hoá đơn (kèm lý do) và xử lý tay.
 * Hệ quả với hoá đơn bù (xem `generateMissing`): tỉ lệ dùng là tỉ lệ LÚC XUẤT.
 *
 * ---
 * CHỐNG XUẤT TRÙNG NẰM Ở DATABASE
 *
 * `@@unique([venueId, periodStart])`. Cron chạy lại, hoặc admin bấm hai lần,
 * đều không tạo được hoá đơn thứ hai cho cùng một kỳ — và đó là chốt chặn duy
 * nhất đáng tin, vì hai tiến trình cùng chạy thì phép kiểm ở tầng này đều thấy
 * "chưa có".
 *
 * ---
 * SỐ HOÁ ĐƠN KHÔNG BAO GIỜ TRÙNG
 *
 * `CS-YYYYMM-000042`: phần đuôi lấy từ sequence Postgres `platform_invoice_number_seq`
 * (tạo tay trong migration `20260917160000_integrity_invoice_numbering`). Bản
 * trước lấy 6 ký tự cuối của id cơ sở — hai sân trùng 6 ký tự là trùng số, và
 * hoá đơn sân thứ hai bị coi là "đã xuất" rồi bỏ qua IM LẶNG. `nextval()` không
 * bao giờ trả một giá trị hai lần, kể cả khi transaction bị huỷ (đổi lại số có
 * thể hở — chấp nhận, đây không phải hoá đơn giá trị gia tăng).
 */

/** Trạng thái lượt đặt được tính vào doanh thu. Khớp `ReportService`. */
const SOLD = ["CONFIRMED", "CHECKED_IN", "COMPLETED"] as const;

/** Số ngày kể từ cuối kỳ tới hạn phải trả. */
const DUE_DAYS = 15;

/** Số tháng đã kết thúc gần nhất mà `generateMissing` tự bù nếu còn thiếu hoá đơn. */
const INVOICE_BACKFILL_MONTHS = 3;

/** Tên THẬT của ràng buộc (cơ sở, kỳ) — migration `20260904170000_hoa_don_hoa_hong`. */
const PERIOD_UNIQUE = "platform_invoices_venue_id_period_start_key";

/** Trạng thái còn phải thu. `DRAFT` hiện không dùng, vẫn coi là chưa chốt. */
const OPEN_STATUSES = ["DRAFT", "DUE", "OVERDUE"] as const;

const DAY_MS = 86_400_000;

type Month = { year: number; month: number };

export type InvoiceFailure = { period: string; venueId: string | null; message: string };

/** Tháng (theo giờ VN) chứa mốc thời gian này. */
function monthOf(date: Date): Month {
  const [year, month] = dateKey(date).split("-").map(Number);
  return { year: year!, month: month! };
}

function shiftMonth({ year, month }: Month, delta: number): Month {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** `"2026-09"` */
function monthKey({ year, month }: Month): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Cột `@db.Date` giữ nửa đêm UTC của NGÀY THEO GIỜ VN. */
function dateColumn(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/**
 * Kỳ hoá đơn của một tháng.
 *
 * `start`/`end` là mốc TUYỆT ĐỐI 00:00 giờ VN ngày 1 tháng này/tháng sau — cắt
 * theo UTC thì mọi lượt sau 17:00 giờ VN ngày cuối tháng rơi sang tháng sau, và
 * hoá đơn thiếu đúng những khung giờ vàng đắt nhất.
 */
function periodOf(month: Month) {
  const firstKey = `${monthKey(month)}-01`;
  const nextFirstKey = `${monthKey(shiftMonth(month, 1))}-01`;
  const lastKey = dateKey(addDays(fromDateKey(nextFirstKey), -1));

  return {
    key: monthKey(month),
    start: atMinuteVN(fromDateKey(firstKey), 0),
    end: atMinuteVN(fromDateKey(nextFirstKey), 0),
    periodStart: dateColumn(firstKey),
    periodEnd: dateColumn(lastKey),
    // Cộng từ NGÀY CUỐI KỲ, không cộng từ `end` — `end` là 00:00 ngày đầu tháng
    // sau, cộng từ đó ra hạn trả lệch đúng một ngày.
    dueDate: dateColumn(dateKey(addDays(fromDateKey(lastKey), DUE_DAYS))),
    number: (sequence: bigint | number) =>
      // `padStart` không cắt bớt: qua số 999999 thì đuôi dài thêm, không quay vòng.
      `CS-${monthKey(month).replace("-", "")}-${String(sequence).padStart(6, "0")}`,
  };
}

export class InvoiceService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Xuất hoá đơn cho MỘT tháng ĐÃ KẾT THÚC, cho mọi cơ sở có doanh thu.
   *
   * `month` là bất kỳ ngày nào trong tháng cần chốt. Cơ sở không có đồng nào thì
   * không xuất — hoá đơn 0đ chỉ làm chủ sân hoang mang; nhờ vậy cũng không bao giờ
   * có hoá đơn cho kỳ trước khi cơ sở bắt đầu bán.
   *
   * TỪNG CƠ SỞ ĐỘC LẬP: một cơ sở hỏng (kể cả trùng số hoá đơn) được ghi vào
   * `failed` rồi đi tiếp, không chặn hoá đơn của cơ sở khác. Chỉ trùng KỲ mới là
   * "đã xuất" — trùng số hay lỗi khác đều hiện ra ở `failed`, không bị nuốt.
   */
  async generateForMonth(
    month: Date,
    options: { now?: Date } = {},
  ): Promise<{ period: string; created: number; skipped: number; failed: InvoiceFailure[] }> {
    const now = options.now ?? new Date();
    const period = periodOf(monthOf(month));

    if (period.end > now) throw new InvoicePeriodOpenError(period.key);

    const rows = await this.db.booking.groupBy({
      by: ["venueId"],
      where: { startAt: { gte: period.start, lt: period.end }, status: { in: [...SOLD] } },
      _sum: { total: true },
      _count: { _all: true },
    });

    const result = { period: period.key, created: 0, skipped: 0, failed: [] as InvoiceFailure[] };

    const billable = rows.filter((row) => (row._sum.total ?? 0) > 0);
    result.skipped += rows.length - billable.length;
    if (billable.length === 0) return result;

    const venueIds = billable.map((row) => row.venueId);
    const [venues, existing] = await Promise.all([
      this.db.venue.findMany({
        where: { id: { in: venueIds } },
        select: { id: true, commissionRate: true },
      }),
      // Đọc trước kỳ đã xuất: chạy lại (hằng ngày) thì không tốn số từ sequence
      // cho những hoá đơn chắc chắn đã có. Cuộc đua vẫn do ràng buộc duy nhất chặn.
      this.db.platformInvoice.findMany({
        where: { periodStart: period.periodStart, venueId: { in: venueIds } },
        select: { venueId: true },
      }),
    ]);

    const rates = new Map(venues.map((venue) => [venue.id, Number(venue.commissionRate ?? 0)]));
    const invoiced = new Set(existing.map((invoice) => invoice.venueId));

    for (const row of billable) {
      const rate = rates.get(row.venueId) ?? 0;

      // Sân được miễn hoa hồng (khuyến mãi, đối tác) hoặc kỳ này đã xuất.
      if (rate <= 0 || invoiced.has(row.venueId)) {
        result.skipped += 1;
        continue;
      }

      const gross = row._sum.total ?? 0;

      try {
        await this.db.$transaction(
          async (tx) => {
            const [sequence] = await tx.$queryRaw<{ value: bigint }[]>`
              SELECT nextval('platform_invoice_number_seq') AS value
            `;
            if (!sequence) throw new Error("Sequence số hoá đơn không trả giá trị");

            await tx.platformInvoice.create({
              data: {
                number: period.number(sequence.value),
                venueId: row.venueId,
                periodStart: period.periodStart,
                periodEnd: period.periodEnd,
                bookingCount: row._count._all,
                grossRevenue: gross,
                commissionRate: rate,
                commissionAmount: Math.round((gross * rate) / 100),
                status: "DUE",
                dueDate: period.dueDate,
              },
            });
          },
          { maxWait: 10_000, timeout: 20_000 },
        );
        result.created += 1;
      } catch (error) {
        // Trùng KỲ = một lần chạy khác vừa xuất xong. Đường chạy bình thường.
        if (isUniqueViolation(error, PERIOD_UNIQUE)) {
          result.skipped += 1;
          continue;
        }

        result.failed.push({
          period: period.key,
          venueId: row.venueId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Xuất hoá đơn cho MỌI tháng đã kết thúc còn thiếu, trong `months` tháng gần
   * nhất (theo giờ VN), từ cũ tới mới.
   *
   * Đây là thứ job theo lịch gọi. Bản trước chỉ chốt "tháng trước" đúng một lần
   * vào mùng 1 — lần chạy đó hỏng (database chập chờn, worker đang deploy) là mất
   * hẳn hoá đơn tháng đó. Giờ mỗi lần chạy tự bù tháng còn thiếu, và chạy lại bao
   * nhiêu lần cũng không xuất trùng — nên lịch chạy HẰNG NGÀY cũng an toàn.
   *
   * Một tháng hỏng hẳn (không đọc được lượt đặt) được ghi vào `failed` rồi đi
   * tiếp tháng khác. Nơi gọi quyết định có ném lỗi hay không.
   */
  async generateMissing(options: { now?: Date; months?: number } = {}) {
    const now = options.now ?? new Date();
    const current = monthOf(now);
    const periods: string[] = [];
    const failed: InvoiceFailure[] = [];
    let created = 0;
    let skipped = 0;

    for (let back = options.months ?? INVOICE_BACKFILL_MONTHS; back >= 1; back -= 1) {
      const month = shiftMonth(current, -back);
      periods.push(monthKey(month));

      try {
        const result = await this.generateForMonth(fromDateKey(`${monthKey(month)}-15`), { now });
        created += result.created;
        skipped += result.skipped;
        failed.push(...result.failed);
      } catch (error) {
        failed.push({
          period: monthKey(month),
          venueId: null,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { periods, created, skipped, failed };
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
   *
   * Đếm theo NGÀY giờ VN, cùng cách `markOverdue` quyết định quá hạn: đếm bằng
   * mốc tuyệt đối thì sáng hôm sau ngày hạn, hoá đơn đã nằm ở tab "Quá hạn" mà
   * vẫn hiện "quá hạn 0 ngày".
   */
  async listByStatus(
    status: "DUE" | "OVERDUE" | "PAID" | "WAIVED",
    options: { limit?: number; now?: Date } = {},
  ) {
    const { limit = 100, now = new Date() } = options;
    const today = dateColumn(dateKey(now));

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
      overdueDays: Math.max(0, Math.round((today.getTime() - row.dueDate.getTime()) / DAY_MS)),
    }));
  }

  /**
   * Đánh dấu đã thu được tiền.
   *
   * So-rồi-đổi trong MỘT câu (`updateMany` kèm điều kiện trạng thái): bấm "Đã thu"
   * đúng lúc người khác bấm "Miễn" thì chỉ một bên thắng, không có hoá đơn vừa
   * PAID vừa bị ghi đè thành WAIVED. `alreadyPaid` để màn hình nói đúng sự thật
   * thay vì lại báo "đã ghi nhận".
   */
  async markPaid(invoiceId: string, now = new Date()): Promise<{ alreadyPaid: boolean }> {
    const { count } = await this.db.platformInvoice.updateMany({
      where: { id: invoiceId, status: { in: [...OPEN_STATUSES] } },
      data: { status: "PAID", paidAt: now },
    });
    if (count > 0) return { alreadyPaid: false };

    const invoice = await this.requireInvoice(invoiceId);
    if (invoice.status === "WAIVED") throw new InvoiceWaivedError();
    return { alreadyPaid: true };
  }

  /** Miễn hoá đơn — cần lý do, vì đây là tiền nền tảng tự bỏ. So-rồi-đổi như `markPaid`. */
  async waive(input: {
    invoiceId: string;
    by: string;
    reason: string;
  }): Promise<{ alreadyWaived: boolean }> {
    const { count } = await this.db.platformInvoice.updateMany({
      where: { id: input.invoiceId, status: { in: [...OPEN_STATUSES] } },
      data: { status: "WAIVED", waivedBy: input.by, waiveReason: input.reason.trim() },
    });
    if (count > 0) return { alreadyWaived: false };

    const invoice = await this.requireInvoice(input.invoiceId);
    if (invoice.status === "PAID") throw new InvoicePaidError();
    return { alreadyWaived: true };
  }

  /**
   * Đánh dấu quá hạn. Cron chạy hằng ngày.
   *
   * `updateMany` một câu, không đọc-rồi-ghi từng dòng: hai bản worker chạy song
   * song thì câu này vẫn đúng.
   */
  async markOverdue(now = new Date()): Promise<number> {
    const result = await this.db.platformInvoice.updateMany({
      where: { status: "DUE", dueDate: { lt: dateColumn(dateKey(now)) } },
      data: { status: "OVERDUE" },
    });
    return result.count;
  }

  private async requireInvoice(invoiceId: string) {
    const invoice = await this.db.platformInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true },
    });
    if (!invoice) throw new InvoiceNotFoundError();
    return invoice;
  }
}

export const invoiceService = new InvoiceService();
