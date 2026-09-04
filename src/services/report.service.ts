import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { atMinuteVN, MINUTES_PER_DAY } from "@/lib/slots";

/**
 * Báo cáo doanh thu của một cơ sở.
 *
 * ---
 * ĐẾM TỪ `bookings`, KHÔNG ĐẾM TỪ `payments`
 *
 * Một lượt đặt có thể có nhiều bản ghi thanh toán (thử VNPay rồi bỏ, quay sang
 * chuyển khoản tay), và một khoản hoàn tiền cũng là một dòng. Cộng theo
 * `payments` là đếm trùng. `bookings.total` mới là số tiền của một lượt.
 *
 * ---
 * "DOANH THU" Ở ĐÂY LÀ TIỀN ĐÃ CHỐT, KHÔNG PHẢI TIỀN ĐÃ VỀ
 *
 * Chỉ tính lượt `CONFIRMED`/`CHECKED_IN`/`COMPLETED`. Lượt `HOLDING` chưa trả
 * tiền, lượt `CANCELLED` thì tiền có thể đã hoàn — gộp chúng vào là chủ sân
 * nhìn thấy một con số không bao giờ khớp với sao kê ngân hàng.
 */

/** Trạng thái được coi là ĐÃ BÁN. Khớp với cách `AvailabilityService` hiểu. */
const SOLD = ["CONFIRMED", "CHECKED_IN", "COMPLETED"] as const;

export type DailyRevenue = { date: string; bookings: number; revenue: number };

export class ReportService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Tổng quan một khoảng ngày.
   *
   * `from`/`to` là ngày theo giờ Việt Nam, tính CẢ hai đầu. Quy đổi sang mốc
   * tuyệt đối ngay tại đây bằng `atMinuteVN` — để giao diện tự tính là mỗi màn
   * lại lệch nửa ngày một kiểu.
   */
  async venueSummary(venueId: string, range: { from: Date; to: Date }) {
    const start = atMinuteVN(range.from, 0);
    const end = atMinuteVN(range.to, MINUTES_PER_DAY);

    const window = { venueId, startAt: { gte: start, lt: end } };

    const [sold, cancelled, holding, byCourt, commissionRate] = await Promise.all([
      this.db.booking.aggregate({
        where: { ...window, status: { in: [...SOLD] } },
        _sum: { total: true, discountTotal: true },
        _count: { _all: true },
      }),
      this.db.booking.count({ where: { ...window, status: { in: ["CANCELLED", "NO_SHOW"] } } }),
      this.db.booking.count({ where: { ...window, status: "HOLDING" } }),
      this.db.booking.groupBy({
        by: ["courtId"],
        where: { ...window, status: { in: [...SOLD] } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.db.venue
        .findUnique({ where: { id: venueId }, select: { commissionRate: true } })
        .then((venue) => Number(venue?.commissionRate ?? 0)),
    ]);

    const revenue = sold._sum.total ?? 0;

    return {
      bookingCount: sold._count._all,
      revenue,
      discountTotal: sold._sum.discountTotal ?? 0,
      cancelledCount: cancelled,
      holdingCount: holding,
      commissionRate,
      // Hoa hồng nền tảng sẽ thu ở hoá đơn cuối tháng — tiền booking đi thẳng
      // vào tài khoản sân, nên đây là khoản chủ sân sẽ NỢ, không phải khoản đã
      // bị trừ. Làm rõ ngay ở tên trường để không ai đọc nhầm.
      commissionOwed: Math.round((revenue * commissionRate) / 100),
      byCourt: byCourt.map((row) => ({
        courtId: row.courtId,
        bookings: row._count._all,
        revenue: row._sum.total ?? 0,
      })),
    };
  }

  /**
   * Doanh thu theo từng ngày — nguồn cho biểu đồ cột.
   *
   * Gom nhóm bằng SQL thô vì Prisma `groupBy` không cắt được theo ngày. Ép múi
   * giờ `Asia/Ho_Chi_Minh` ngay trong câu lệnh: gom theo UTC thì mọi lượt đặt
   * sau 17:00 giờ VN rơi sang ngày hôm sau.
   */
  async dailyRevenue(venueId: string, range: { from: Date; to: Date }): Promise<DailyRevenue[]> {
    const start = atMinuteVN(range.from, 0);
    const end = atMinuteVN(range.to, MINUTES_PER_DAY);

    const rows = await this.db.$queryRaw<{ date: string; bookings: bigint; revenue: bigint }[]>`
      SELECT to_char(start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS date,
             count(*)::bigint       AS bookings,
             sum(total)::bigint     AS revenue
      FROM bookings
      WHERE venue_id = ${venueId}
        AND start_at >= ${start}
        AND start_at <  ${end}
        AND status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
      GROUP BY 1
      ORDER BY 1
    `;

    // `bigint` không đi qua ranh giới Server → Client được (JSON không có kiểu
    // đó). Đổi sang `number` ngay tại đây, không đẩy xuống giao diện.
    return rows.map((row) => ({
      date: row.date,
      bookings: Number(row.bookings),
      revenue: Number(row.revenue),
    }));
  }
}

export const reportService = new ReportService();
