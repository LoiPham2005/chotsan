import type { PrismaClient } from "@prisma/client";
import { dateKey } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { priceForSlot } from "@/lib/pricing";
import { atMinuteVN, overlaps, SLOT_MINUTES, slotRange, weekdayInVN } from "@/lib/slots";

/**
 * Lịch trống của một cơ sở trong một ngày — lưới SÂN × KHUNG 30 PHÚT.
 *
 * ---
 * VÌ SAO MỘT HÀM TRẢ CẢ LƯỚI, KHÔNG PHẢI HỎI TỪNG Ô
 *
 * Màn đặt sân hiển thị 10 sân × 32 khung = 320 ô. Hỏi từng ô là 320 lần gọi
 * database cho một lần mở trang. Ở đây tất cả đọc trong BẢY truy vấn chạy song
 * song, phần còn lại là tính trong bộ nhớ.
 *
 * ---
 * NGƯỜI TA HỎI "19H CÒN SÂN NÀO?", KHÔNG HỎI "SÂN 7 CÓ RẢNH KHÔNG?"
 *
 * Vì vậy hàm này còn trả `summary` — số sân trống theo từng khung — để giao
 * diện vẽ được dải tổng quan cả ngày mà không phải quét lại toàn lưới.
 */

/**
 * - `FREE`: đặt được.
 * - `TAKEN`: đã có người giữ/đặt.
 * - `CLOSED`: sân con đang bảo trì (`CourtClosure`).
 * - `PAST`: khung đã bắt đầu (giờ bắt đầu ≤ bây giờ) — gồm MỌI khung của ngày đã qua.
 * - `NOT_FOR_SALE`: không luật giá nào phủ khung này (giá 0đ) — chủ sân chưa mở bán giờ đó.
 */
export type SlotStatus = "FREE" | "TAKEN" | "CLOSED" | "PAST" | "NOT_FOR_SALE";

/** Ngày đang xem so với hôm nay, theo giờ Việt Nam. */
export type DayTiming = "PAST" | "TODAY" | "FUTURE";

export type SlotCell = {
  /** Phút từ 00:00, giờ Việt Nam. */
  minute: number;
  status: SlotStatus;
  price: number;
  isPeak: boolean;
};

export type CourtAvailability = {
  courtId: string;
  courtName: string;
  slots: SlotCell[];
};

export type DayAvailability = {
  venueId: string;
  /** `"2026-09-04"` theo giờ Việt Nam. */
  date: string;
  /**
   * Giao diện cần phân biệt "hôm nay đã hết giờ" với "ngày này đã qua" — hai câu
   * khác nhau với người đang chọn ngày, dù lưới của cả hai đều toàn ô đã qua.
   */
  timing: DayTiming;
  /** Phút bắt đầu của mọi khung trong ngày — trục hoành của lưới. */
  minutes: number[];
  courts: CourtAvailability[];
  /** Số sân còn trống theo từng khung, cùng thứ tự với `minutes`. */
  summary: number[];
  isClosed: boolean;
};

/**
 * Lượt đặt đang CHIẾM khung giờ.
 *
 * ---
 * CHỖ GIỮ ĐÃ QUÁ HẠN KHÔNG CHIẾM GÌ CẢ — DÙ CRON CHƯA KỊP NHẢ
 *
 * `HOLDING` chỉ chiếm chỗ khi còn hạn (`holdExpiresAt` ở tương lai) hoặc khi
 * không có hạn (`null` — khách đã báo chuyển khoản, đang chờ chủ sân đối chiếu).
 *
 * Trước đây mọi `HOLDING` đều chiếm chỗ, và thứ duy nhất nhả chúng là cron
 * `booking:expire-holds` ở worker. Worker không chạy (máy dev chỉ `pnpm dev`,
 * hoặc worker production chết) = mỗi lần khách mở màn thanh toán rồi bỏ đi là
 * khoá khung đó VĨNH VIỄN. Đã xảy ra thật: giữ chỗ lúc 09:38, tới 10:41 vẫn
 * khoá sân. Tính đúng ở đây thì đúng bất kể worker sống hay chết.
 *
 * Ràng buộc `EXCLUDE` ở database vẫn tính mọi `HOLDING` (nó không đọc được
 * "bây giờ"), nên `BookingService` nhả chỗ quá hạn gối lên khung mới NGAY
 * TRONG transaction giữ chỗ — xem `releaseStaleHolds`.
 */
export function occupyingBookingWhere(now: Date) {
  return {
    OR: [
      { status: { in: ["CONFIRMED", "CHECKED_IN"] as ("CONFIRMED" | "CHECKED_IN")[] } },
      {
        status: "HOLDING" as const,
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
      },
    ],
  };
}

/**
 * Vì sao một dãy không đặt được — để nơi gọi nói ĐÚNG lý do thay vì một câu
 * chung "đã có người đặt hoặc ngoài giờ mở cửa" cho mọi trường hợp.
 *
 * - `DAY_CLOSED`: sân nghỉ cả ngày (chưa khai giờ, hoặc cơ sở không mở bán).
 * - `COURT`: sân con không thuộc cơ sở, đã tắt hoặc đã xoá.
 * - `OUTSIDE_HOURS`: dãy vượt ra ngoài giờ mở cửa.
 * - Còn lại trùng tên `SlotStatus` của khung chặn nó.
 */
export type RangeUnavailableReason =
  "DAY_CLOSED" | "COURT" | "OUTSIDE_HOURS" | "PAST" | "CLOSED" | "TAKEN" | "NOT_FOR_SALE";

/**
 * Một dãy có nhiều khung chặn khác nhau thì báo lý do đứng trước: "đã qua giờ"
 * là chuyện không sửa được, nên nói nó trước "đã có người đặt".
 */
const BLOCKING_ORDER = ["PAST", "CLOSED", "TAKEN", "NOT_FOR_SALE"] as const;

/** Báo giá của một dãy trong một lần đặt nhiều dãy. */
export type RangeQuote = {
  courtId: string;
  startMinute: number;
  endMinute: number;
  /** `null` khi sân con không thuộc cơ sở này (hoặc đã tắt). */
  courtName: string | null;
  /** `false` khi có bất kỳ khung nào không đặt được — khi đó tiền là 0. */
  available: boolean;
  /** `null` khi `available`. */
  reason: RangeUnavailableReason | null;
  slotCount: number;
  total: number;
};

/**
 * Báo giá một dãy từ lịch ĐÃ ĐỌC SẴN. Tách ra để một lần đặt sáu dãy chỉ đọc
 * lịch MỘT lần, thay vì sáu lần × bảy truy vấn.
 */
export function quoteFromDay(
  day: DayAvailability,
  range: { courtId: string; startMinute: number; endMinute: number },
): RangeQuote {
  const court = day.isClosed
    ? undefined
    : day.courts.find((item) => item.courtId === range.courtId);
  const base = { ...range, courtName: court?.courtName ?? null };

  const unavailable = (reason: RangeUnavailableReason): RangeQuote => ({
    ...base,
    available: false,
    reason,
    slotCount: 0,
    total: 0,
  });

  if (day.isClosed) return unavailable("DAY_CLOSED");
  if (!court) return unavailable("COURT");

  const wanted = court.slots.filter(
    (slot) => slot.minute >= range.startMinute && slot.minute < range.endMinute,
  );
  const expected = Math.floor((range.endMinute - range.startMinute) / SLOT_MINUTES);

  if (wanted.length === 0 || wanted.length !== expected) return unavailable("OUTSIDE_HOURS");

  const blocked = BLOCKING_ORDER.find((status) => wanted.some((slot) => slot.status === status));
  if (blocked) return unavailable(blocked);

  return {
    ...base,
    available: true,
    reason: null,
    slotCount: wanted.length,
    total: wanted.reduce((sum, slot) => sum + slot.price, 0),
  };
}

export class AvailabilityService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async forDay(
    venueId: string,
    date: Date,
    options: { now?: Date; excludeBookingId?: string } = {},
  ): Promise<DayAvailability> {
    const now = options.now ?? new Date();
    const weekday = weekdayInVN(date);

    // Ngày theo giờ Việt Nam đi qua `date.ts` — một chỗ duy nhất biết múi giờ.
    // Bản trước tự dựng `Intl.DateTimeFormat` hai lần ngay trong hàm này.
    const key = dateKey(date);
    const todayKey = dateKey(now);
    const timing: DayTiming = key < todayKey ? "PAST" : key === todayKey ? "TODAY" : "FUTURE";

    const dayStart = atMinuteVN(date, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [venue, hour, courts, bookings, closures, rules, overrides] = await Promise.all([
      this.db.venue.findFirst({
        // CHỈ cơ sở đang mở bán. Nháp, chờ duyệt, tạm nghỉ, bảo trì hay bị khoá
        // đều ra lưới rỗng — kể cả khi ai đó gọi thẳng bằng `venueId` tự chế.
        where: { id: venueId, status: "ACTIVE", deletedAt: null },
        select: { id: true },
      }),
      this.db.venueHour.findUnique({
        where: { venueId_weekday: { venueId, weekday } },
        select: { openMinute: true, closeMinute: true, isClosed: true },
      }),
      this.db.court.findMany({
        where: { venueId, isActive: true, deletedAt: null },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      this.db.booking.findMany({
        where: {
          venueId,
          ...occupyingBookingWhere(now),
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
          // Đổi giờ thì lượt đặt phải được giấu khỏi lịch của chính nó, nếu
          // không nó tự chặn mình mỗi khi khung mới gối lên khung cũ.
          ...(options.excludeBookingId ? { id: { not: options.excludeBookingId } } : {}),
        },
        select: { courtId: true, startAt: true, endAt: true },
      }),
      this.db.courtClosure.findMany({
        where: { court: { venueId }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
        select: { courtId: true, startAt: true, endAt: true },
      }),
      this.db.priceRule.findMany({
        where: { venueId },
        // `id` + `createdAt` để `priceForSlot` chọn được MỘT luật xác định khi
        // các luật chồng nhau — không phụ thuộc thứ tự database trả về.
        select: {
          id: true,
          courtId: true,
          weekdays: true,
          startMinute: true,
          endMinute: true,
          pricePerSlot: true,
          isPeak: true,
          priority: true,
          createdAt: true,
        },
      }),
      this.db.priceOverride.findMany({
        where: { venueId, date: new Date(`${key}T00:00:00Z`) },
        select: {
          id: true,
          courtId: true,
          startMinute: true,
          endMinute: true,
          pricePerSlot: true,
          isPeak: true,
          createdAt: true,
        },
      }),
    ]);

    const empty: DayAvailability = {
      venueId,
      date: key,
      timing,
      minutes: [],
      courts: [],
      summary: [],
      isClosed: true,
    };

    if (!venue) return empty;

    // Chưa khai giờ mở cửa cho thứ này = đóng cửa. Đoán bừa một khung mặc định
    // sẽ bán ra những giờ mà sân không có ai trực.
    if (!hour || hour.isClosed) return empty;

    const minutes = slotRange(hour.openMinute, hour.closeMinute);
    if (minutes.length === 0) return empty;

    const toMinutes = (at: Date) => Math.round((at.getTime() - dayStart.getTime()) / 60_000);

    const courtsResult: CourtAvailability[] = courts.map((court) => {
      const taken = bookings
        .filter((booking) => booking.courtId === court.id)
        .map((booking) => ({ start: toMinutes(booking.startAt), end: toMinutes(booking.endAt) }));

      const closed = closures
        .filter((closure) => closure.courtId === court.id)
        .map((closure) => ({ start: toMinutes(closure.startAt), end: toMinutes(closure.endAt) }));

      const slots: SlotCell[] = minutes.map((minute) => {
        const end = minute + SLOT_MINUTES;
        const { price, isPeak } = priceForSlot({
          courtId: court.id,
          weekday,
          slotStartMinute: minute,
          basePrice: 0,
          rules,
          overrides,
        });

        /*
         * Đã qua = giờ BẮT ĐẦU của khung ≤ bây giờ, so bằng mốc tuyệt đối.
         *
         * Bản trước chỉ xét "hôm nay" (`nowMinute = -1` cho mọi ngày khác), nên
         * mở `?date=` của hôm qua là cả ngày hiện FREE và đặt được. So mốc tuyệt
         * đối thì ngày đã qua, hôm nay và ngày mai cùng một phép tính — và khớp
         * đúng điều kiện `BookingService.holdCheckout` dùng để từ chối.
         */
        const started = dayStart.getTime() + minute * 60_000 <= now.getTime();

        // Thứ tự xét quan trọng: sân đang bảo trì thì hiện "đóng" chứ không
        // hiện "đã có người" — hai chuyện khác nhau với người đang tìm sân.
        // Khung chưa có giá xét SAU "đã qua": khung đã qua thì nói đã qua.
        const status: SlotStatus = closed.some((range) =>
          overlaps(range.start, range.end, minute, end),
        )
          ? "CLOSED"
          : taken.some((range) => overlaps(range.start, range.end, minute, end))
            ? "TAKEN"
            : started
              ? "PAST"
              : price <= 0
                ? "NOT_FOR_SALE"
                : "FREE";

        return { minute, status, price, isPeak };
      });

      return { courtId: court.id, courtName: court.name, slots };
    });

    const summary = minutes.map(
      (_, index) => courtsResult.filter((court) => court.slots[index]?.status === "FREE").length,
    );

    return {
      venueId,
      date: key,
      timing,
      minutes,
      courts: courtsResult,
      summary,
      isClosed: false,
    };
  }

  /**
   * Báo giá cho một khoảng cụ thể trên một sân con — dùng trước khi giữ chỗ.
   *
   * Trả `null` khi có bất kỳ khung nào không đặt được. KHÔNG trả về giá của
   * phần đặt được: báo giá một phần rồi để người dùng bấm tiếp là cách chắc
   * chắn để họ nghĩ mình đã đặt cả hai tiếng.
   */
  async quote(params: {
    venueId: string;
    courtId: string;
    date: Date;
    startMinute: number;
    endMinute: number;
    now?: Date;
    /** Đổi giờ: giấu lượt đặt này khỏi lịch để nó không tự chặn chính mình. */
    excludeBookingId?: string;
  }): Promise<{ slotCount: number; total: number; slots: SlotCell[] } | null> {
    const day = await this.forDay(params.venueId, params.date, {
      now: params.now,
      excludeBookingId: params.excludeBookingId,
    });

    const quote = quoteFromDay(day, params);
    if (!quote.available) return null;

    const slots =
      day.courts
        .find((item) => item.courtId === params.courtId)
        ?.slots.filter(
          (slot) => slot.minute >= params.startMinute && slot.minute < params.endMinute,
        ) ?? [];

    return { slotCount: quote.slotCount, total: quote.total, slots };
  }

  /**
   * Báo giá cho NHIỀU dãy trong cùng một ngày — một lần đặt nhiều sân.
   *
   * Đọc lịch một lần rồi báo giá từng dãy. Trả đủ mọi dãy, kể cả dãy không đặt
   * được (`available: false` kèm `reason`), để nơi gọi báo đúng tên sân + giờ +
   * lý do thay vì một câu chung chung.
   */
  async quoteMany(params: {
    venueId: string;
    date: Date;
    ranges: readonly { courtId: string; startMinute: number; endMinute: number }[];
    now?: Date;
  }): Promise<RangeQuote[]> {
    const day = await this.forDay(params.venueId, params.date, { now: params.now });
    return params.ranges.map((range) => quoteFromDay(day, range));
  }
}

export const availabilityService = new AvailabilityService();
