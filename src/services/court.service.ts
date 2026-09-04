import type { PrismaClient } from "@prisma/client";
import type { CourtSurface } from "@prisma/client";
import { CourtNotFoundError, VenueConfigError, VenueNotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isSlotAligned, MINUTES_PER_DAY, SLOT_MINUTES } from "@/lib/slots";

/**
 * Sân con, lịch bảo trì, và bảng giá.
 *
 * ---
 * XOÁ SÂN CON LÀ XOÁ MỀM, KHÔNG BAO GIỜ XOÁ THẬT
 *
 * Lượt đặt trỏ tới sân con bằng khoá ngoại. Xoá thật thì hoặc database từ chối,
 * hoặc (tệ hơn) xoá theo cả lượt đặt — và doanh thu tháng trước biến mất.
 *
 * ---
 * TẮT SÂN KHÔNG HUỶ LƯỢT ĐÃ ĐẶT
 *
 * `isActive = false` chỉ ngừng bán khung MỚI. Khách đã đặt và đã trả tiền vẫn
 * giữ chỗ của họ — huỷ hàng loạt trong im lặng là cách nhanh nhất để mất khách.
 * Muốn đóng sân có khách rồi thì phải huỷ từng lượt, có lý do, có hoàn tiền.
 */

/** Khoảng thời gian đóng sân dài nhất cho một lần khai — chặn lỗi gõ nhầm năm. */
const MAX_CLOSURE_DAYS = 365;

export class CourtService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async create(input: {
    venueId: string;
    name: string;
    /** Vật liệu mặt sân. Để trống = chưa khai; đừng đoán bừa. */
    surface?: CourtSurface | null;
    isIndoor?: boolean;
    note?: string | null;
    sortOrder?: number;
  }) {
    const venue = await this.db.venue.findFirst({
      where: { id: input.venueId, deletedAt: null },
      select: { sportId: true },
    });

    if (!venue) throw new VenueNotFoundError();

    return this.db.court.create({
      data: {
        venueId: input.venueId,
        // Sân con mặc định theo môn của cơ sở. Sân đa môn là chuyện hiếm và có
        // thể sửa sau; bắt khai lại môn cho từng sân là bắt gõ thừa 10 lần.
        sportId: venue.sportId,
        name: input.name.trim(),
        surface: input.surface ?? null,
        isIndoor: input.isIndoor ?? false,
        note: input.note ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async update(
    courtId: string,
    input: Partial<{
      name: string;
      surface: CourtSurface | null;
      isIndoor: boolean;
      note: string | null;
      sortOrder: number;
      isActive: boolean;
    }>,
  ) {
    await this.requireCourt(courtId);

    return this.db.court.update({ where: { id: courtId }, data: input });
  }

  /**
   * Đổi thứ tự hiển thị của cả danh sách một lần.
   *
   * Lưới đặt sân xếp cột theo `sortOrder`; đổi từng sân một thì giữa chừng có
   * hai sân cùng số và thứ tự nhảy loạn trước mắt người đang kéo thả.
   */
  async reorder(venueId: string, courtIds: string[]) {
    const courts = await this.db.court.findMany({
      where: { venueId, deletedAt: null },
      select: { id: true },
    });

    const known = new Set(courts.map((court) => court.id));
    if (courtIds.length !== known.size || courtIds.some((id) => !known.has(id))) {
      throw new VenueConfigError("Danh sách sắp xếp phải gồm đúng các sân của cơ sở này");
    }

    return this.db.$transaction(
      courtIds.map((id, index) =>
        this.db.court.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );
  }

  /** Xoá mềm. Lượt đặt cũ vẫn đọc được, khung mới không bán nữa. */
  async softDelete(courtId: string, now = new Date()) {
    await this.requireCourt(courtId);

    return this.db.court.update({
      where: { id: courtId },
      data: { deletedAt: now, isActive: false },
    });
  }

  /**
   * Đóng sân một khoảng — bảo trì, cho thuê nguyên buổi, thời tiết.
   *
   * Khoảng đóng KHÔNG huỷ lượt đã đặt, chỉ chặn bán mới. Hàm trả kèm danh sách
   * lượt đang vướng để giao diện hỏi chủ sân "còn 3 lượt trong khoảng này, xử
   * lý thế nào?" thay vì im lặng để đó rồi khách tới không có sân.
   */
  async close(input: {
    courtId: string;
    startAt: Date;
    endAt: Date;
    reason?: string | null;
    createdBy?: string | null;
  }) {
    await this.requireCourt(input.courtId);

    if (input.endAt <= input.startAt) {
      throw new VenueConfigError("Giờ kết thúc phải sau giờ bắt đầu");
    }

    const days = (input.endAt.getTime() - input.startAt.getTime()) / (24 * 60 * 60_000);
    if (days > MAX_CLOSURE_DAYS) {
      throw new VenueConfigError("Khoảng đóng sân quá dài, kiểm tra lại ngày tháng");
    }

    const [closure, vuong] = await this.db.$transaction([
      this.db.courtClosure.create({
        data: {
          courtId: input.courtId,
          startAt: input.startAt,
          endAt: input.endAt,
          reason: input.reason ?? null,
          createdBy: input.createdBy ?? null,
        },
      }),
      this.db.booking.findMany({
        where: {
          courtId: input.courtId,
          status: { in: ["HOLDING", "CONFIRMED", "CHECKED_IN"] },
          startAt: { lt: input.endAt },
          endAt: { gt: input.startAt },
        },
        orderBy: { startAt: "asc" },
        select: {
          id: true,
          code: true,
          customerName: true,
          customerPhone: true,
          startAt: true,
          endAt: true,
          status: true,
        },
      }),
    ]);

    return { closure, affectedBookings: vuong };
  }

  async reopen(closureId: string) {
    return this.db.courtClosure.delete({ where: { id: closureId } });
  }

  /**
   * Đặt lại toàn bộ bảng giá của một cơ sở.
   *
   * Thay cả bộ chứ không sửa từng luật: giá là thứ chồng lớp lên nhau theo
   * `priority`, và sửa lẻ một luật giữa chừng để lại một bảng giá không ai
   * hiểu nổi — kể cả người vừa sửa.
   */
  async setPriceRules(
    venueId: string,
    rules: {
      courtId?: string | null;
      weekdays?: number[];
      startMinute: number;
      endMinute: number;
      pricePerSlot: number;
      isPeak?: boolean;
      priority?: number;
    }[],
  ) {
    const venue = await this.db.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: { id: true },
    });

    if (!venue) throw new VenueNotFoundError();

    for (const rule of rules) {
      this.assertRange(rule.startMinute, rule.endMinute);

      if (!Number.isInteger(rule.pricePerSlot) || rule.pricePerSlot < 0) {
        throw new VenueConfigError("Giá mỗi khung phải là số nguyên không âm");
      }
      if (rule.weekdays?.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
        throw new VenueConfigError("Thứ trong tuần phải nằm trong khoảng 0–6");
      }
    }

    return this.db.$transaction(async (tx) => {
      await tx.priceRule.deleteMany({ where: { venueId } });
      await tx.priceRule.createMany({
        data: rules.map((rule) => ({
          venueId,
          courtId: rule.courtId ?? null,
          weekdays: rule.weekdays ?? [],
          startMinute: rule.startMinute,
          endMinute: rule.endMinute,
          pricePerSlot: rule.pricePerSlot,
          isPeak: rule.isPeak ?? false,
          priority: rule.priority ?? 0,
        })),
      });

      return tx.priceRule.findMany({
        where: { venueId },
        orderBy: [{ priority: "desc" }, { startMinute: "asc" }],
      });
    });
  }

  /**
   * Đè giá cho một ngày cụ thể — lễ tết, giải đấu, khuyến mãi.
   *
   * Ngày lưu ở kiểu `Date` của Postgres nên phải chuẩn hoá về nửa đêm UTC,
   * nếu không cùng một ngày lịch sẽ thành hai dòng khác nhau tuỳ máy chủ đang
   * ở múi giờ nào.
   */
  async setPriceOverride(input: {
    venueId: string;
    dateKey: string;
    courtId?: string | null;
    startMinute: number;
    endMinute: number;
    pricePerSlot: number;
    isPeak?: boolean;
    reason?: string | null;
  }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) {
      throw new VenueConfigError("Ngày phải theo dạng YYYY-MM-DD");
    }

    this.assertRange(input.startMinute, input.endMinute);

    if (!Number.isInteger(input.pricePerSlot) || input.pricePerSlot < 0) {
      throw new VenueConfigError("Giá mỗi khung phải là số nguyên không âm");
    }

    return this.db.priceOverride.create({
      data: {
        venueId: input.venueId,
        courtId: input.courtId ?? null,
        date: new Date(`${input.dateKey}T00:00:00Z`),
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        pricePerSlot: input.pricePerSlot,
        isPeak: input.isPeak ?? false,
        reason: input.reason ?? null,
      },
    });
  }

  async removePriceOverride(overrideId: string) {
    return this.db.priceOverride.delete({ where: { id: overrideId } });
  }

  /** Sân con của một cơ sở, kèm khoảng đóng sắp tới — nguồn cho màn quản lý sân. */
  /** Bảng giá hiện tại của một cơ sở — nguồn cho màn sửa giá. */
  async listPriceRules(venueId: string) {
    return this.db.priceRule.findMany({
      where: { venueId },
      orderBy: [{ priority: "desc" }, { startMinute: "asc" }],
      select: {
        courtId: true,
        weekdays: true,
        startMinute: true,
        endMinute: true,
        pricePerSlot: true,
        isPeak: true,
        priority: true,
      },
    });
  }

  async listForVenue(venueId: string, options: { from?: Date } = {}) {
    const from = options.from ?? new Date();

    return this.db.court.findMany({
      where: { venueId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        surface: true,
        isIndoor: true,
        note: true,
        isActive: true,
        sortOrder: true,
        closures: {
          where: { endAt: { gt: from } },
          orderBy: { startAt: "asc" },
          select: { id: true, startAt: true, endAt: true, reason: true },
        },
      },
    });
  }

  private assertRange(startMinute: number, endMinute: number) {
    if (!isSlotAligned(startMinute) || !isSlotAligned(endMinute)) {
      throw new VenueConfigError(`Khung giờ phải tròn ${SLOT_MINUTES} phút`);
    }
    if (startMinute >= endMinute) {
      throw new VenueConfigError("Giờ kết thúc phải sau giờ bắt đầu");
    }
    if (endMinute > MINUTES_PER_DAY) {
      throw new VenueConfigError("Khung giờ không vượt quá 24:00");
    }
  }

  private async requireCourt(courtId: string) {
    const court = await this.db.court.findFirst({
      where: { id: courtId, deletedAt: null },
      select: { id: true, venueId: true },
    });

    if (!court) throw new CourtNotFoundError();
    return court;
  }
}

export const courtService = new CourtService();
