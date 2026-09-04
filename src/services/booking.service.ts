import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BookingNotFoundError,
  BookingStateError,
  SlotTakenError,
  SlotUnavailableError,
} from "@/lib/errors";
import { isExclusionViolation, isUniqueViolation } from "@/lib/prisma-errors";
import { atMinuteVN, formatHhMm, minuteOfDayInVN } from "@/lib/slots";
import { transferNoteForBooking } from "@/lib/vietqr";
import { type AvailabilityService, availabilityService } from "./availability.service";

/**
 * Đặt sân — giữ chỗ, xác nhận, huỷ, đổi giờ.
 *
 * ---
 * TẦNG NÀY KHÔNG PHẢI THỨ CHẶN TRÙNG CHỖ
 *
 * Nó KIỂM TRA trước để báo lỗi tử tế, nhưng thứ thật sự chặn là ràng buộc
 * `EXCLUDE USING gist` trong database. Hai request đến cùng lúc đều thấy "còn
 * trống" ở bước kiểm — chỉ Postgres mới quyết được ai thắng.
 *
 * Vì vậy `hold()` bắt lỗi 23P01 và dịch thành `SlotTakenError`. Đừng bao giờ
 * bỏ khối bắt lỗi đó vì "đã kiểm ở trên rồi".
 */

/** Mã đặt sân đọc qua điện thoại. Bỏ 0/O/1/I/L — nghe qua điện thoại là lẫn. */
const CODE_ALPHABET = "23456789ACDEFGHJKMNPQRTUVWXY";

/** Số phút giữ chỗ mặc định khi sân không tự khai. */
const DEFAULT_HOLD_MINUTES = 10;

function generateCode(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Tên ràng buộc `EXCLUDE` chống trùng khung giờ — xem migration cùng tên. */
const RANG_BUOC_CHONG_TRUNG = "bookings_khong_trung_khung_gio";

/** Đây có phải lỗi vi phạm ràng buộc chống trùng khung giờ không. */
function isSlotConflict(error: unknown): boolean {
  return isExclusionViolation(error, RANG_BUOC_CHONG_TRUNG) || isExclusionViolation(error);
}

/**
 * Đây có phải lỗi trùng MÃ ĐẶT SÂN không — thứ duy nhất đáng sinh mã rồi thử lại.
 *
 * Nhận diện chặt theo tên cột chứ không phải `message.includes("code")`: rất
 * nhiều thông điệp lỗi của Prisma có chữ "code" mà chẳng liên quan gì, và thử
 * lại một lỗi không liên quan ba lần chỉ làm chậm rồi vẫn hỏng.
 */
function isCodeCollision(error: unknown): boolean {
  return isUniqueViolation(error, "code");
}

export type HoldInput = {
  venueId: string;
  courtId: string;
  /** Ngày theo giờ Việt Nam. */
  date: Date;
  startMinute: number;
  endMinute: number;
  customerName: string;
  customerPhone: string;
  customerNote?: string | null;
  userId?: string | null;
  source?: "WEB" | "MOBILE" | "COUNTER";
  createdBy?: string | null;
  now?: Date;
};

export class BookingService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly availability: AvailabilityService = availabilityService,
  ) {}

  /**
   * Giữ chỗ. Lượt đặt ở trạng thái `HOLDING` cho tới khi thanh toán xong.
   *
   * Giữ chỗ có hạn (mặc định 10 phút) vì không có nó thì một người mở trang
   * thanh toán rồi bỏ đi sẽ khoá khung giờ đẹp nhất vô thời hạn.
   */
  async hold(input: HoldInput) {
    const now = input.now ?? new Date();

    const quote = await this.availability.quote({
      venueId: input.venueId,
      courtId: input.courtId,
      date: input.date,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      now,
    });

    if (!quote) {
      throw new SlotUnavailableError(
        `Khung ${formatHhMm(input.startMinute)}–${formatHhMm(input.endMinute)} không đặt được`,
      );
    }

    const venue = await this.db.venue.findFirst({
      where: { id: input.venueId, deletedAt: null },
      select: { holdMinutes: true },
    });

    const holdMinutes = venue?.holdMinutes ?? DEFAULT_HOLD_MINUTES;

    const startAt = atMinuteVN(input.date, input.startMinute);
    const endAt = atMinuteVN(input.date, input.endMinute);

    /*
     * Thử tối đa 3 lần vì HAI lý do khác nhau, và chỉ một trong hai đáng thử lại:
     *   • Trùng mã đặt sân — hiếm (28^6 ≈ 481 triệu) nhưng có thể; sinh mã mới.
     *   • Trùng khung giờ — người khác vừa lấy mất; thử lại cũng vô ích.
     */
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.booking.create({
          data: {
            code: generateCode(),
            venueId: input.venueId,
            courtId: input.courtId,
            userId: input.userId ?? null,
            customerName: input.customerName.trim(),
            customerPhone: input.customerPhone.trim(),
            customerNote: input.customerNote ?? null,
            startAt,
            endAt,
            slotCount: quote.slotCount,
            status: "HOLDING",
            source: input.source ?? "WEB",
            subtotal: quote.total,
            total: quote.total,
            holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
            createdBy: input.createdBy ?? null,
          },
        });
      } catch (error) {
        if (isSlotConflict(error)) throw new SlotTakenError();

        // Trùng mã: vòng lặp sinh mã khác. Lỗi khác thì ném lên nguyên vẹn.
        if (!isCodeCollision(error)) throw error;
        if (attempt === 2) throw error;
      }
    }

    throw new SlotTakenError();
  }

  /** Nội dung chuyển khoản khách phải ghi — khớp `transferNoteForBooking`. */
  transferNote(bookingCode: string): string {
    return transferNoteForBooking(bookingCode);
  }

  /** Thanh toán xong. Xoá hạn giữ chỗ để cron không quét nhầm. */
  async confirm(bookingId: string) {
    const booking = await this.requireBooking(bookingId);

    if (booking.status === "CONFIRMED") return booking;
    if (booking.status !== "HOLDING") {
      throw new BookingStateError(this.describeState(booking.status));
    }

    return this.db.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
  }

  async checkIn(bookingId: string, options: { now?: Date } = {}) {
    const booking = await this.requireBooking(bookingId);

    if (booking.status === "CHECKED_IN") return booking;
    if (booking.status !== "CONFIRMED") {
      throw new BookingStateError(
        booking.status === "HOLDING"
          ? "Lượt đặt này chưa thanh toán"
          : this.describeState(booking.status),
      );
    }

    return this.db.booking.update({
      where: { id: bookingId },
      data: { status: "CHECKED_IN", checkedInAt: options.now ?? new Date() },
    });
  }

  /**
   * Huỷ. Trả kèm `refundable` để nơi gọi quyết định có hoàn tiền không.
   *
   * Service KHÔNG tự hoàn tiền: hoàn tiền là một luồng riêng cần quyền riêng
   * (`payment:refund`), và gộp vào đây là giấu một thao tác tiền bạc bên trong
   * một thao tác trông có vẻ vô hại.
   */
  async cancel(
    bookingId: string,
    options: {
      reason?: string;
      cancelledBy?: string | null;
      /** Đè chính sách của sân. Chỉ dùng khi nền tảng chủ động huỷ hộ. */
      freeCancelHours?: number;
      now?: Date;
    } = {},
  ) {
    const booking = await this.requireBooking(bookingId);

    if (["CANCELLED", "EXPIRED"].includes(booking.status)) {
      throw new BookingStateError(this.describeState(booking.status));
    }
    if (["CHECKED_IN", "COMPLETED"].includes(booking.status)) {
      throw new BookingStateError("Lượt đặt đã diễn ra, không huỷ được");
    }

    /*
     * Chính sách huỷ là của TỪNG SÂN, không phải hằng số của hệ thống.
     *
     * Sân cầu lông trong ngõ cho huỷ trước 1 tiếng; sân bóng 11 người thuê cả
     * buổi thì 24 tiếng cũng là sát. Trước đây con số 2 nằm cứng trong hàm này
     * và không có chỗ nào khai khác đi được — mọi chủ sân đều phải theo một
     * chính sách mà không ai chọn.
     */
    const venue = await this.db.venue.findUnique({
      where: { id: booking.venueId },
      select: { freeCancelHours: true, cancelFeePercent: true },
    });

    const freeCancelHours = options.freeCancelHours ?? venue?.freeCancelHours ?? 2;
    const now = options.now ?? new Date();
    const freeUntil = new Date(booking.startAt.getTime() - freeCancelHours * 60 * 60_000);
    const refundable = now <= freeUntil;

    // Huỷ trễ: khách mất một phần, phần còn lại mới hoàn. `cancelFeePercent`
    // để trống = mất trắng, vì đó là mặc định của phần lớn sân hiện nay.
    const feePercent = refundable ? 0 : (venue?.cancelFeePercent ?? 100);
    const refundableAmount = Math.round((booking.total * (100 - feePercent)) / 100);

    const updated = await this.db.booking.update({
      where: { id: bookingId },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: options.reason ?? null,
        cancelledBy: options.cancelledBy ?? null,
        holdExpiresAt: null,
      },
    });

    return { booking: updated, refundable, freeUntil, freeCancelHours, refundableAmount };
  }

  /**
   * Đổi sang khung giờ hoặc sân khác.
   *
   * Làm bằng huỷ-rồi-tạo-lại trong MỘT transaction: ràng buộc chống trùng nằm
   * ở database, nên phải nhả khung cũ trước khi giữ khung mới, nếu không lượt
   * đặt sẽ tự chặn chính mình khi hai khung có phần giao nhau.
   */
  async reschedule(params: {
    bookingId: string;
    courtId: string;
    date: Date;
    startMinute: number;
    endMinute: number;
    actorId?: string | null;
    now?: Date;
  }) {
    const booking = await this.requireBooking(params.bookingId);

    if (!["HOLDING", "CONFIRMED"].includes(booking.status)) {
      throw new BookingStateError(this.describeState(booking.status));
    }

    const quote = await this.availability.quote({
      venueId: booking.venueId,
      courtId: params.courtId,
      date: params.date,
      startMinute: params.startMinute,
      endMinute: params.endMinute,
      now: params.now,
      excludeBookingId: params.bookingId,
    });

    if (!quote) throw new SlotUnavailableError("Khung giờ mới không đặt được");

    const startAt = atMinuteVN(params.date, params.startMinute);
    const endAt = atMinuteVN(params.date, params.endMinute);

    try {
      return await this.db.$transaction(async (tx) => {
        // Nhả khung cũ trước — nếu không, khung mới gối lên khung cũ sẽ bị
        // chính lượt đặt này chặn.
        await tx.booking.update({
          where: { id: params.bookingId },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: params.actorId ?? null,
          },
        });

        return tx.booking.update({
          where: { id: params.bookingId },
          data: {
            status: booking.status,
            courtId: params.courtId,
            startAt,
            endAt,
            slotCount: quote.slotCount,
            subtotal: quote.total,
            total: quote.total - booking.discountTotal,
            cancelledAt: null,
            cancelledBy: null,
          },
        });
      });
    } catch (error) {
      if (isSlotConflict(error)) throw new SlotTakenError();
      throw error;
    }
  }

  /**
   * Huỷ những lượt giữ chỗ đã hết hạn — cron chạy mỗi phút.
   *
   * `updateMany` một câu chứ không đọc rồi cập nhật từng dòng: hai bản worker
   * chạy song song thì câu này vẫn đúng, còn vòng lặp đọc-rồi-ghi thì không.
   */
  async expireHolds(options: { now?: Date } = {}): Promise<number> {
    const result = await this.db.booking.updateMany({
      where: { status: "HOLDING", holdExpiresAt: { lte: options.now ?? new Date() } },
      data: { status: "EXPIRED", holdExpiresAt: null },
    });

    return result.count;
  }

  /**
   * Tra lượt đặt bằng MÃ, kèm đủ thứ màn thanh toán cần.
   *
   * Mã đặt sân là thứ duy nhất khách vãng lai có — họ không đăng nhập, nên
   * không tra bằng `userId` được. Đổi lại mã phải khó đoán: 6 ký tự trên bảng
   * 28 chữ = 481 triệu tổ hợp, và trang này KHÔNG lộ gì hơn những gì khách đã
   * tự nhập cộng thông tin công khai của sân.
   */
  async findByCode(code: string) {
    return this.db.booking.findUnique({
      where: { code: code.trim().toUpperCase() },
      select: {
        id: true,
        code: true,
        status: true,
        startAt: true,
        endAt: true,
        slotCount: true,
        subtotal: true,
        discountTotal: true,
        total: true,
        holdExpiresAt: true,
        customerName: true,
        customerPhone: true,
        customerNote: true,
        venueId: true,
        court: { select: { name: true } },
        venue: {
          select: {
            slug: true,
            name: true,
            address: true,
            ward: true,
            province: true,
            phone: true,
            freeCancelHours: true,
            cancelFeePercent: true,
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            provider: true,
            amount: true,
            transferNote: true,
            declaredAt: true,
            rejectReason: true,
            expiresAt: true,
          },
        },
      },
    });
  }

  /**
   * Lượt đặt của MỘT NGƯỜI — nguồn cho màn "Lượt đặt của tôi".
   *
   * Chia hai nhóm ngay ở tầng này chứ không để giao diện tự lọc: "sắp tới" và
   * "đã qua" trả lời hai câu hỏi khác nhau, và người dùng gần như chỉ quan tâm
   * nhóm đầu. Sắp tới thì gần nhất lên trước; đã qua thì mới nhất lên trước.
   */
  async listForUser(userId: string, options: { now?: Date; limit?: number } = {}) {
    const now = options.now ?? new Date();

    const select = {
      id: true,
      code: true,
      status: true,
      startAt: true,
      endAt: true,
      total: true,
      court: { select: { name: true } },
      venue: { select: { slug: true, name: true, address: true, ward: true, province: true } },
      review: { select: { id: true } },
    } as const;

    const [upcoming, past] = await Promise.all([
      this.db.booking.findMany({
        where: { userId, endAt: { gte: now }, status: { notIn: ["CANCELLED", "EXPIRED"] } },
        orderBy: { startAt: "asc" },
        select,
      }),
      this.db.booking.findMany({
        where: {
          userId,
          OR: [{ endAt: { lt: now } }, { status: { in: ["CANCELLED", "EXPIRED"] } }],
        },
        orderBy: { startAt: "desc" },
        take: options.limit ?? 30,
        select,
      }),
    ]);

    return { upcoming, past };
  }

  /**
   * Lượt đặt cụ thể của một người — dùng trước khi cho họ huỷ.
   *
   * Ràng buộc quyền sở hữu nằm TRONG câu truy vấn (`where: { id, userId }`),
   * không phải một phép kiểm riêng sau đó: `id` đến từ URL nên người gọi tự
   * đặt được, và quên phép kiểm rời là ai cũng huỷ được lượt của người khác.
   */
  async findOwnedByUser(bookingId: string, userId: string) {
    return this.db.booking.findFirst({
      where: { id: bookingId, userId },
      select: { id: true, code: true, status: true, startAt: true, venueId: true },
    });
  }

  /** Lượt đặt của một sân trong một ngày — nguồn cho màn lịch của chủ sân. */
  async listForVenueDay(venueId: string, date: Date) {
    const dayStart = atMinuteVN(date, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const bookings = await this.db.booking.findMany({
      where: { venueId, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      orderBy: [{ courtId: "asc" }, { startAt: "asc" }],
      select: {
        id: true,
        code: true,
        courtId: true,
        customerName: true,
        customerPhone: true,
        startAt: true,
        endAt: true,
        status: true,
        source: true,
        total: true,
      },
    });

    return bookings.map((booking) => {
      const startMinute = minuteOfDayInVN(booking.startAt);
      const durationMinutes = (booking.endAt.getTime() - booking.startAt.getTime()) / 60_000;

      // Trả phút-trong-ngày để màn lịch đặt khối vào đúng cột mà không phải tự
      // quy đổi múi giờ ở tầng giao diện — chỗ đó chắc chắn sẽ quy đổi sai.
      return { ...booking, startMinute, endMinute: startMinute + durationMinutes };
    });
  }

  private async requireBooking(bookingId: string) {
    const booking = await this.db.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new BookingNotFoundError();
    return booking;
  }

  private describeState(status: string): string {
    const labels: Record<string, string> = {
      HOLDING: "Lượt đặt đang chờ thanh toán",
      CONFIRMED: "Lượt đặt đã được xác nhận",
      CHECKED_IN: "Khách đã tới sân",
      COMPLETED: "Lượt đặt đã hoàn tất",
      CANCELLED: "Lượt đặt đã bị huỷ",
      EXPIRED: "Lượt đặt đã hết hạn giữ chỗ",
      NO_SHOW: "Khách không tới",
    };

    return labels[status] ?? "Không thao tác được với lượt đặt này";
  }
}

export const bookingService = new BookingService();
