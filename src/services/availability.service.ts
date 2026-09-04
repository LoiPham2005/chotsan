import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { priceForSlot } from "@/lib/pricing";
import {
  atMinuteVN,
  minuteOfDayInVN,
  overlaps,
  SLOT_MINUTES,
  slotRange,
  weekdayInVN,
} from "@/lib/slots";

/**
 * Lịch trống của một cơ sở trong một ngày — lưới SÂN × KHUNG 30 PHÚT.
 *
 * ---
 * VÌ SAO MỘT HÀM TRẢ CẢ LƯỚI, KHÔNG PHẢI HỎI TỪNG Ô
 *
 * Màn đặt sân hiển thị 10 sân × 32 khung = 320 ô. Hỏi từng ô là 320 lần gọi
 * database cho một lần mở trang. Ở đây tất cả đọc trong BỐN truy vấn, phần còn
 * lại là tính trong bộ nhớ.
 *
 * ---
 * NGƯỜI TA HỎI "19H CÒN SÂN NÀO?", KHÔNG HỎI "SÂN 7 CÓ RẢNH KHÔNG?"
 *
 * Vì vậy hàm này còn trả `summary` — số sân trống theo từng khung — để giao
 * diện vẽ được dải tổng quan cả ngày mà không phải quét lại toàn lưới.
 */

export type SlotStatus = "FREE" | "TAKEN" | "CLOSED" | "PAST";

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
  /** Phút bắt đầu của mọi khung trong ngày — trục hoành của lưới. */
  minutes: number[];
  courts: CourtAvailability[];
  /** Số sân còn trống theo từng khung, cùng thứ tự với `minutes`. */
  summary: number[];
  isClosed: boolean;
};

/** Trạng thái lượt đặt được coi là ĐANG GIỮ CHỖ. Khớp ràng buộc EXCLUDE trong migration. */
const LIVE_BOOKING_STATUSES = ["HOLDING", "CONFIRMED", "CHECKED_IN"] as const;

export class AvailabilityService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async forDay(
    venueId: string,
    date: Date,
    options: { now?: Date } = {},
  ): Promise<DayAvailability> {
    const now = options.now ?? new Date();
    const weekday = weekdayInVN(date);
    const dateKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);

    const dayStart = atMinuteVN(date, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [venue, hour, courts, bookings, closures, rules, overrides] = await Promise.all([
      this.db.venue.findFirst({
        where: { id: venueId, deletedAt: null },
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
          status: { in: [...LIVE_BOOKING_STATUSES] },
          startAt: { lt: dayEnd },
          endAt: { gt: dayStart },
        },
        select: { courtId: true, startAt: true, endAt: true },
      }),
      this.db.courtClosure.findMany({
        where: { court: { venueId }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
        select: { courtId: true, startAt: true, endAt: true },
      }),
      this.db.priceRule.findMany({
        where: { venueId },
        select: {
          courtId: true,
          weekdays: true,
          startMinute: true,
          endMinute: true,
          pricePerSlot: true,
          isPeak: true,
          priority: true,
        },
      }),
      this.db.priceOverride.findMany({
        where: { venueId, date: new Date(`${dateKey}T00:00:00Z`) },
        select: {
          courtId: true,
          startMinute: true,
          endMinute: true,
          pricePerSlot: true,
          isPeak: true,
        },
      }),
    ]);

    const empty: DayAvailability = {
      venueId,
      date: dateKey,
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

    // Khung đã trôi qua trong ngày hôm nay thì không bán được nữa. So sánh theo
    // giờ Việt Nam, không theo giờ máy chủ.
    const todayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const isToday = todayKey === dateKey;
    const nowMinute = isToday ? minuteOfDayInVN(now) : -1;

    const toMinutes = (at: Date) => {
      const diff = Math.round((at.getTime() - dayStart.getTime()) / 60_000);
      return diff;
    };

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

        // Thứ tự xét quan trọng: sân đang bảo trì thì hiện "đóng" chứ không
        // hiện "đã có người" — hai chuyện khác nhau với người đang tìm sân.
        const status: SlotStatus = closed.some((range) =>
          overlaps(range.start, range.end, minute, end),
        )
          ? "CLOSED"
          : taken.some((range) => overlaps(range.start, range.end, minute, end))
            ? "TAKEN"
            : minute < nowMinute
              ? "PAST"
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
      date: dateKey,
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
  }): Promise<{ slotCount: number; total: number; slots: SlotCell[] } | null> {
    const day = await this.forDay(params.venueId, params.date, { now: params.now });
    if (day.isClosed) return null;

    const court = day.courts.find((item) => item.courtId === params.courtId);
    if (!court) return null;

    const wanted = court.slots.filter(
      (slot) => slot.minute >= params.startMinute && slot.minute < params.endMinute,
    );

    const expected = Math.floor((params.endMinute - params.startMinute) / SLOT_MINUTES);
    if (wanted.length === 0 || wanted.length !== expected) return null;
    if (wanted.some((slot) => slot.status !== "FREE")) return null;

    return {
      slotCount: wanted.length,
      total: wanted.reduce((sum, slot) => sum + slot.price, 0),
      slots: wanted,
    };
  }
}

export const availabilityService = new AvailabilityService();
