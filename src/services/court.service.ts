import type { PrismaClient } from "@prisma/client";
import type { CourtSurface } from "@prisma/client";
import { dateKey, fullDateLabel, timeOfDay } from "@/lib/date";
import {
  CourtClosureConflictError,
  CourtClosureNotFoundError,
  CourtNotFoundError,
  PriceOverrideNotFoundError,
  VenueConfigError,
  VenueNotFoundError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import {
  formatHhMm,
  groupConsecutive,
  isSlotAligned,
  MINUTES_PER_DAY,
  overlaps,
  SLOT_MINUTES,
  slotRange,
} from "@/lib/slots";
import { occupyingBookingWhere } from "@/services/availability.service";

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
 *
 * ---
 * MỌI THAO TÁC THEO ID ĐỀU NHẬN `venueId`
 *
 * Id sân con, lịch đóng sân, giá đè đến từ form; quyền thì kiểm trên `venueId`
 * của URL. Service lọc theo `venueId` NGAY TRONG câu truy vấn, lệch cơ sở thì
 * báo không tìm thấy (GOTCHAS #19) — kể cả với hàm chưa màn nào gọi, để lúc nối
 * vào không ai phải nhớ thêm bước này.
 */

/** Khoảng thời gian đóng sân dài nhất cho một lần khai — chặn lỗi gõ nhầm năm. */
const MAX_CLOSURE_DAYS = 365;

/** Thứ tự hiển thị ngày trong tuần của người Việt: Thứ 2 trước, Chủ nhật cuối. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** 0 = Chủ nhật, khớp `VenueHour.weekday`. */
const WEEKDAY_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

/** "mọi ngày", hoặc "Thứ 2, Thứ 7" theo thứ tự trong tuần. */
function weekdaysLabel(weekdays: readonly number[]): string {
  const days = WEEK_ORDER.filter((day) => weekdays.includes(day));
  return days.length === 7 ? "mọi ngày" : days.map((day) => WEEKDAY_NAMES[day]).join(", ");
}

/** Những ngày mà CẢ HAI luật cùng áp. `weekdays` rỗng = mọi ngày. */
function sharedWeekdays(a: readonly number[], b: readonly number[]): number[] {
  return WEEK_ORDER.filter(
    (day) => (a.length === 0 || a.includes(day)) && (b.length === 0 || b.includes(day)),
  );
}

export type PricingGapInput = {
  hours: { weekday: number; openMinute: number; closeMinute: number; isClosed: boolean }[];
  courts: { id: string }[];
  rules: { courtId: string | null; weekdays: number[]; startMinute: number; endMinute: number }[];
};

export type PricingGap = {
  /** Theo thứ tự Thứ 2 → Chủ nhật. */
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  courtIds: string[];
};

/**
 * Những khung giờ MỞ CỬA mà không luật giá nào phủ, theo từng sân con đang bán.
 *
 * Khung như vậy khách không đặt được (hoặc tệ hơn, ra giá 0đ) mà chủ sân không
 * hề biết — bảng giá nhìn vẫn "có luật". Thuần tuý, không chạm database: gộp
 * các sân và các ngày có CÙNG khoảng hở thành một dòng để danh sách đọc được
 * ("Thứ 7, Chủ nhật 22:00–23:00 · mọi sân") thay vì 70 dòng lặp lại.
 *
 * Chỉ xét luật theo tuần: giá đè theo ngày (`PriceOverride`) là ngoại lệ một
 * ngày, không lấp được khoảng hở của các tuần khác.
 */
export function findPricingGaps(input: PricingGapInput): PricingGap[] {
  const gaps = new Map<string, PricingGap>();

  for (const weekday of WEEK_ORDER) {
    const hour = input.hours.find((item) => item.weekday === weekday);
    if (!hour || hour.isClosed) continue;

    const slots = slotRange(hour.openMinute, hour.closeMinute);
    const sameDay = new Map<
      string,
      { startMinute: number; endMinute: number; courtIds: string[] }
    >();

    for (const court of input.courts) {
      const uncovered = slots.filter(
        (minute) =>
          !input.rules.some(
            (rule) =>
              (rule.courtId === null || rule.courtId === court.id) &&
              (rule.weekdays.length === 0 || rule.weekdays.includes(weekday)) &&
              overlaps(rule.startMinute, rule.endMinute, minute, minute + SLOT_MINUTES),
          ),
      );

      for (const block of groupConsecutive(uncovered)) {
        const key = `${block.start}-${block.end}`;
        const entry = sameDay.get(key) ?? {
          startMinute: block.start,
          endMinute: block.end,
          courtIds: [],
        };
        entry.courtIds.push(court.id);
        sameDay.set(key, entry);
      }
    }

    for (const range of sameDay.values()) {
      const key = `${range.startMinute}-${range.endMinute}-${range.courtIds.join(",")}`;
      const existing = gaps.get(key);
      if (existing) existing.weekdays.push(weekday);
      else gaps.set(key, { weekdays: [weekday], ...range });
    }
  }

  const position = (day: number) => WEEK_ORDER.indexOf(day as (typeof WEEK_ORDER)[number]);
  return [...gaps.values()].sort(
    (a, b) => position(a.weekdays[0]!) - position(b.weekdays[0]!) || a.startMinute - b.startMinute,
  );
}

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
    /** Sân con PHẢI thuộc cơ sở này. Bắt buộc — xem `requireCourt`. */
    options: { venueId: string },
  ) {
    await this.requireCourt(courtId, options.venueId);

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
  async softDelete(courtId: string, options: { venueId: string; now?: Date }) {
    await this.requireCourt(courtId, options.venueId);

    return this.db.court.update({
      where: { id: courtId },
      data: { deletedAt: options.now ?? new Date(), isActive: false },
    });
  }

  /**
   * Đóng sân một khoảng — bảo trì, cho thuê nguyên buổi, thời tiết.
   *
   * TỪ CHỐI khi khoảng đóng chồng lên lượt đặt CÒN SỐNG, kèm danh sách lượt để
   * chủ sân huỷ/dời trước. Trước đây hàm cứ tạo lịch đóng rồi trả danh sách
   * "đang vướng" — mà ràng buộc chống trùng ở database không biết tới lịch đóng
   * sân, nên khách đã trả tiền tới nơi mới thấy sân khoá.
   *
   * "Còn sống" theo đúng định nghĩa của lịch (`occupyingBookingWhere`): chỗ giữ
   * đã quá hạn KHÔNG chặn — nó không còn chiếm chỗ dù cron chưa kịp nhả.
   *
   * ---
   * KHOÁ DÒNG SÂN CON TRONG LÚC KIỂM + GHI
   *
   * Database không có ràng buộc nào giữa `bookings` và `court_closures`, nên kiểm
   * rồi ghi rời nhau là có khe cho một lượt đặt chen vào. Transaction này giữ
   * `FOR UPDATE` trên dòng sân con — cố ý không phải `FOR NO KEY UPDATE`: chèn một
   * lượt đặt phải kiểm khoá ngoại tới đúng dòng đó (`FOR KEY SHARE`), và chỉ
   * `FOR UPDATE` mới bắt nó chờ. Lượt đặt commit TRƯỚC thì phép kiểm ở đây thấy
   * nó và từ chối; lượt đặt chèn SAU thì phải chờ lịch đóng commit xong.
   *
   * ⚠️ Kín hẳn cần thêm một nửa ở phía đặt sân: sau khi chèn lượt đặt, đọc lại
   * lịch đóng gối khung trong CÙNG transaction (nó đọc lúc chưa có lịch đóng, chèn
   * sau khi lịch đóng commit).
   */
  async close(input: {
    venueId: string;
    courtId: string;
    startAt: Date;
    endAt: Date;
    reason?: string | null;
    createdBy?: string | null;
    now?: Date;
  }) {
    if (input.endAt <= input.startAt) {
      throw new VenueConfigError("Giờ kết thúc phải sau giờ bắt đầu");
    }

    const days = (input.endAt.getTime() - input.startAt.getTime()) / (24 * 60 * 60_000);
    if (days > MAX_CLOSURE_DAYS) {
      throw new VenueConfigError("Khoảng đóng sân quá dài, kiểm tra lại ngày tháng");
    }

    await this.requireCourt(input.courtId, input.venueId);

    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM courts WHERE id = ${input.courtId} FOR UPDATE`;

        const conflicts = await tx.booking.findMany({
          where: {
            courtId: input.courtId,
            ...occupyingBookingWhere(input.now ?? new Date()),
            startAt: { lt: input.endAt },
            endAt: { gt: input.startAt },
          },
          orderBy: { startAt: "asc" },
          select: { code: true, startAt: true, endAt: true },
        });

        if (conflicts.length > 0) {
          const shown = conflicts
            .slice(0, 3)
            .map(
              (booking) =>
                `${booking.code} (${fullDateLabel(booking.startAt)} ${timeOfDay(booking.startAt)}–${timeOfDay(booking.endAt)})`,
            );
          const more = conflicts.length > 3 ? ` và ${conflicts.length - 3} lượt khác` : "";

          throw new CourtClosureConflictError(
            conflicts.map((booking) => booking.code),
            `Còn ${conflicts.length} lượt đặt trong khoảng này: ${shown.join(", ")}${more}. ` +
              "Huỷ hoặc dời các lượt đó trước khi đóng sân.",
          );
        }

        return tx.courtClosure.create({
          data: {
            courtId: input.courtId,
            startAt: input.startAt,
            endAt: input.endAt,
            reason: input.reason ?? null,
            createdBy: input.createdBy ?? null,
          },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  /** Bỏ một lịch đóng sân. Lịch của sân thuộc cơ sở khác → không tìm thấy. */
  async reopen(closureId: string, options: { venueId: string }) {
    const { count } = await this.db.courtClosure.deleteMany({
      where: { id: closureId, court: { venueId: options.venueId } },
    });

    if (count === 0) throw new CourtClosureNotFoundError();
  }

  /**
   * Đặt lại toàn bộ bảng giá của một cơ sở.
   *
   * Thay cả bộ chứ không sửa từng luật: giá là thứ chồng lớp lên nhau theo
   * `priority`, và sửa lẻ một luật giữa chừng để lại một bảng giá không ai
   * hiểu nổi — kể cả người vừa sửa.
   *
   * TỪ CHỐI hai luật cùng `priority`, cùng phạm vi (cùng một sân con, hoặc cùng
   * "cả cơ sở"), chung ít nhất một ngày và gối giờ lên nhau: với cặp đó
   * `priceForSlot` không có cách nào chọn — giá phụ thuộc thứ tự dòng database
   * trả về, tức là có thể đổi giữa hai lần tải trang. Luật riêng sân con và luật
   * cả cơ sở cùng priority thì KHÔNG xung đột: luật riêng sân con thắng.
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

    /*
     * Luật gắn sân con nào thì sân con đó phải thuộc CƠ SỞ NÀY.
     *
     * `courtId` đến từ form. Database giờ cũng chặn bằng khoá ngoại hai cột
     * (court_id, venue_id), nhưng chặn ở đây thì câu báo nói được thành lời
     * thay vì một lỗi 500.
     */
    const courtIds = [...new Set(rules.flatMap((rule) => (rule.courtId ? [rule.courtId] : [])))];
    const courtNames = new Map<string, string>();
    if (courtIds.length > 0) {
      const owned = await this.db.court.findMany({
        where: { id: { in: courtIds }, venueId, deletedAt: null },
        select: { id: true, name: true },
      });

      if (owned.length !== courtIds.length) {
        throw new VenueConfigError("Luật giá chỉ gắn được vào sân con của chính cơ sở này");
      }
      for (const court of owned) courtNames.set(court.id, court.name);
    }

    const normalized = rules.map((rule) => ({
      courtId: rule.courtId ?? null,
      weekdays: rule.weekdays ?? [],
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
      pricePerSlot: rule.pricePerSlot,
      isPeak: rule.isPeak ?? false,
      priority: rule.priority ?? 0,
    }));

    for (const rule of normalized) {
      this.assertRange(rule.startMinute, rule.endMinute);

      if (!Number.isInteger(rule.pricePerSlot) || rule.pricePerSlot < 0) {
        throw new VenueConfigError("Giá mỗi khung phải là số nguyên không âm");
      }
      if (rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
        throw new VenueConfigError("Thứ trong tuần phải nằm trong khoảng 0–6");
      }
      if (!Number.isInteger(rule.priority)) {
        throw new VenueConfigError("Ưu tiên phải là số nguyên");
      }
    }

    // Đánh số theo đúng thứ tự trên màn sửa giá ("Luật 1", "Luật 2"…) để chủ
    // sân tìm ra ngay hai dòng đang đá nhau.
    for (let i = 0; i < normalized.length; i += 1) {
      for (let j = i + 1; j < normalized.length; j += 1) {
        const a = normalized[i]!;
        const b = normalized[j]!;

        if (a.priority !== b.priority || a.courtId !== b.courtId) continue;
        const days = sharedWeekdays(a.weekdays, b.weekdays);
        if (
          days.length === 0 ||
          !overlaps(a.startMinute, a.endMinute, b.startMinute, b.endMinute)
        ) {
          continue;
        }

        const scope = a.courtId ? (courtNames.get(a.courtId) ?? "một sân con") : "cả cơ sở";
        const from = formatHhMm(Math.max(a.startMinute, b.startMinute));
        const to = formatHhMm(Math.min(a.endMinute, b.endMinute));

        throw new VenueConfigError(
          `Luật ${i + 1} và luật ${j + 1} chồng nhau: cùng ưu tiên ${a.priority}, cùng áp cho ` +
            `${scope}, ${weekdaysLabel(days)} ${from}–${to}. Đổi ưu tiên của một luật hoặc ` +
            "sửa giờ để biết giá nào được tính.",
        );
      }
    }

    return this.db.$transaction(async (tx) => {
      await tx.priceRule.deleteMany({ where: { venueId } });
      await tx.priceRule.createMany({ data: normalized.map((rule) => ({ venueId, ...rule })) });

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
   *
   * TỪ CHỐI đè giá gối giờ lên một đè giá đã có của cùng ngày và CÙNG PHẠM VI
   * (cùng sân con, hoặc cùng là cả cơ sở): đè giá không có priority, nên hai cái
   * cùng phạm vi gối nhau là không ai biết khách sẽ trả giá nào.
   *
   * Khác phạm vi thì CHO: `priceForSlot` chốt đè riêng sân con thắng đè cả cơ sở.
   * Đó đúng là cách chủ sân làm ngày lễ — giá lễ cho cả cơ sở, rồi giá riêng cho
   * sân VIP.
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
    const date = new Date(`${input.dateKey}T00:00:00Z`);
    // `dateKey` của nửa đêm UTC khớp lại chuỗi gốc = ngày có thật (loại 31/02).
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey) ||
      Number.isNaN(date.getTime()) ||
      dateKey(date) !== input.dateKey
    ) {
      throw new VenueConfigError("Ngày phải theo dạng YYYY-MM-DD");
    }

    this.assertRange(input.startMinute, input.endMinute);

    if (!Number.isInteger(input.pricePerSlot) || input.pricePerSlot < 0) {
      throw new VenueConfigError("Giá mỗi khung phải là số nguyên không âm");
    }

    const venue = await this.db.venue.findFirst({
      where: { id: input.venueId, deletedAt: null },
      select: { id: true },
    });
    if (!venue) throw new VenueNotFoundError();

    const courtId = input.courtId ?? null;
    if (courtId) await this.requireCourt(courtId, input.venueId);

    const sameDay = await this.db.priceOverride.findMany({
      where: { venueId: input.venueId, date },
      select: { courtId: true, startMinute: true, endMinute: true },
    });

    const clash = sameDay.find(
      (existing) =>
        (existing.courtId ?? null) === courtId &&
        overlaps(existing.startMinute, existing.endMinute, input.startMinute, input.endMinute),
    );

    if (clash) {
      throw new VenueConfigError(
        `Ngày ${fullDateLabel(date)} đã có giá đè ${formatHhMm(clash.startMinute)}–` +
          `${formatHhMm(clash.endMinute)} ${clash.courtId ? "cho sân con này" : "cho cả cơ sở"} ` +
          "gối lên khung vừa nhập. Xoá hoặc sửa giá đè cũ trước.",
      );
    }

    return this.db.priceOverride.create({
      data: {
        venueId: input.venueId,
        courtId,
        date,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        pricePerSlot: input.pricePerSlot,
        isPeak: input.isPeak ?? false,
        reason: input.reason ?? null,
      },
    });
  }

  /** Bỏ một giá đè. Giá đè của cơ sở khác → không tìm thấy. */
  async removePriceOverride(overrideId: string, options: { venueId: string }) {
    const { count } = await this.db.priceOverride.deleteMany({
      where: { id: overrideId, venueId: options.venueId },
    });

    if (count === 0) throw new PriceOverrideNotFoundError();
  }

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

  /**
   * Khung giờ mở cửa chưa có luật giá, theo sân con đang bán — để màn "Sân &
   * giá" cảnh báo chủ sân trước khi khách vấp phải. Xem `findPricingGaps`.
   *
   * `courtNames: null` = hở ở MỌI sân đang bán (hiện một chữ "mọi sân" thay vì
   * liệt kê mười tên).
   */
  async pricingGaps(venueId: string) {
    const [hours, courts, rules] = await Promise.all([
      this.db.venueHour.findMany({
        where: { venueId },
        select: { weekday: true, openMinute: true, closeMinute: true, isClosed: true },
      }),
      this.db.court.findMany({
        where: { venueId, isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      }),
      this.db.priceRule.findMany({
        where: { venueId },
        select: { courtId: true, weekdays: true, startMinute: true, endMinute: true },
      }),
    ]);

    const names = new Map(courts.map((court) => [court.id, court.name]));

    return findPricingGaps({ hours, courts, rules }).map((gap) => ({
      weekdays: gap.weekdays,
      startMinute: gap.startMinute,
      endMinute: gap.endMinute,
      courtNames:
        gap.courtIds.length === courts.length
          ? null
          : gap.courtIds.map((id) => names.get(id) ?? "—"),
    }));
  }

  /** Sân con của một cơ sở, kèm khoảng đóng sắp tới — nguồn cho màn quản lý sân. */
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

  /**
   * Sân con PHẢI thuộc `venueId` — lọc ngay trong câu truy vấn.
   *
   * Quyền được kiểm trên `venueId` của URL, còn `courtId` lấy từ form — người
   * gọi tự đặt được. Lệch cơ sở thì báo KHÔNG TÌM THẤY, không báo "không có
   * quyền": không xác nhận cho người dò rằng id đó tồn tại.
   */
  private async requireCourt(courtId: string, venueId: string) {
    const court = await this.db.court.findFirst({
      where: { id: courtId, venueId, deletedAt: null },
      select: { id: true, venueId: true },
    });

    if (!court) throw new CourtNotFoundError();
    return court;
  }
}

export const courtService = new CourtService();
