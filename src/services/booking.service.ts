import { randomInt } from "node:crypto";
import { Prisma, type BookingStatus, type PaymentStatus, type PrismaClient } from "@prisma/client";
import { isHoldExpired } from "@/lib/booking-status";
import { fullDateLabel } from "@/lib/date";
import {
  BookingNotFoundError,
  BookingStateError,
  BookingValidationError,
  SlotTakenError,
  SlotUnavailableError,
  VenueNotBookableError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isExclusionViolation, isUniqueViolation } from "@/lib/prisma-errors";
import {
  atMinuteVN,
  formatHhMm,
  isSlotAligned,
  MINUTES_PER_DAY,
  minuteOfDayInVN,
  overlaps,
  SLOT_MINUTES,
} from "@/lib/slots";
import { transferNoteForBooking } from "@/lib/vietqr";
import {
  type AvailabilityService,
  availabilityService,
  type RangeUnavailableReason,
} from "./availability.service";

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
 * Vì vậy `holdCheckout()` bắt lỗi 23P01 và dịch thành `SlotTakenError`. Đừng
 * bao giờ bỏ khối bắt lỗi đó vì "đã kiểm ở trên rồi".
 */

/** Mã đặt sân đọc qua điện thoại. Bỏ 0/O/1/I/L — nghe qua điện thoại là lẫn. */
const CODE_ALPHABET = "23456789ACDEFGHJKMNPQRTUVWXY";

/** Số phút giữ chỗ mặc định khi sân không tự khai. */
export const DEFAULT_HOLD_MINUTES = 10;

/**
 * Mặc định 5 giây của Prisma là sát với sáu lượt × vài câu lệnh qua mạng tới
 * Neon. Hết giờ giữa chừng thì cả lần đặt hỏng vô cớ.
 */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

/** Chỉ hai trạng thái này còn huỷ được — mọi trạng thái khác là chuyện đã xong. */
const CANCELLABLE: BookingStatus[] = ["HOLDING", "CONFIRMED"];

/** Giao dịch mà tiền đã chuyển hoặc đã được khai là chuyển — không đổi số tiền được nữa. */
const MONEY_COMMITTED: PaymentStatus[] = [
  "AWAITING_CONFIRMATION",
  "SUCCEEDED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
];

/** Tiền ĐÃ về tài khoản sân (trừ phần đã hoàn) — nguồn duy nhất để tính tiền hoàn khi huỷ. */
const MONEY_RECEIVED: PaymentStatus[] = ["SUCCEEDED", "PARTIALLY_REFUNDED"];

function generateCode(): string {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Tên ràng buộc `EXCLUDE` chống trùng khung giờ — xem migration cùng tên. */
const SLOT_CONFLICT_CONSTRAINT = "bookings_khong_trung_khung_gio";

/** Đây có phải lỗi vi phạm ràng buộc chống trùng khung giờ không. */
function isSlotConflict(error: unknown): boolean {
  return isExclusionViolation(error, SLOT_CONFLICT_CONSTRAINT) || isExclusionViolation(error);
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

/**
 * Kiểm HÌNH DẠNG một dãy giờ — thuần tuý, trước mọi truy vấn.
 *
 * Action đã chặn bằng zod, nhưng service là cửa vào của cả web lẫn mobile (và
 * script): không tự kiểm thì một dãy 18:15–19:15 đi tới báo giá, rơi vào nhánh
 * "không đặt được", và khách nhận câu "đã có người đặt" cho một khung không
 * tồn tại.
 */
function assertRangeShape(range: { startMinute: number; endMinute: number }): void {
  const { startMinute, endMinute } = range;

  if (
    !Number.isInteger(startMinute) ||
    !Number.isInteger(endMinute) ||
    startMinute < 0 ||
    endMinute > MINUTES_PER_DAY
  ) {
    throw new BookingValidationError("Giờ đặt phải nằm trong một ngày, từ 00:00 tới 24:00.");
  }
  if (!isSlotAligned(startMinute) || !isSlotAligned(endMinute)) {
    throw new BookingValidationError(
      `Giờ đặt phải tròn ${SLOT_MINUTES} phút (ví dụ 18:00, 18:30) — ${formatHhMm(startMinute)}–${formatHhMm(endMinute)} không hợp lệ.`,
    );
  }
  if (startMinute >= endMinute) {
    throw new BookingValidationError(
      `Giờ kết thúc phải sau giờ bắt đầu — ${formatHhMm(startMinute)}–${formatHhMm(endMinute)} không hợp lệ.`,
    );
  }
}

/** Câu báo cho dãy không đặt được — nói ĐÚNG lý do, không đổ hết cho "đã có người đặt". */
function unavailableMessage(label: string, reason: RangeUnavailableReason | null): string {
  switch (reason) {
    case "DAY_CLOSED":
      return `Sân nghỉ vào ngày này nên ${label} không đặt được. Chọn ngày khác giúp bạn nhé.`;
    case "COURT":
      return `${label} không đặt được — sân con này đã ngừng nhận đặt. Chọn sân khác giúp bạn nhé.`;
    case "OUTSIDE_HOURS":
      return `${label} nằm ngoài giờ mở cửa của sân. Chọn giờ khác giúp bạn nhé.`;
    case "PAST":
      return `${label} đã qua giờ. Chọn giờ khác giúp bạn nhé.`;
    case "CLOSED":
      return `${label} đang bảo trì. Chọn giờ khác giúp bạn nhé.`;
    case "NOT_FOR_SALE":
      return `${label} chưa có giá nên sân chưa mở bán giờ này. Chọn giờ khác hoặc gọi sân giúp bạn nhé.`;
    default:
      return `${label} đã có người đặt. Chọn giờ khác giúp bạn nhé.`;
  }
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

/** Một lượt trong lần đặt: MỘT sân + MỘT dãy giờ liền. */
export type CheckoutRange = { courtId: string; startMinute: number; endMinute: number };

export type HoldCheckoutInput = Omit<HoldInput, "courtId" | "startMinute" | "endMinute"> & {
  ranges: readonly CheckoutRange[];
};

type Tx = Prisma.TransactionClient;

export class BookingService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly availability: AvailabilityService = availabilityService,
  ) {}

  /**
   * Giữ chỗ. Lượt đặt ở trạng thái `HOLDING` cho tới khi thanh toán xong.
   *
   * Giữ chỗ có hạn (theo sân, mặc định `DEFAULT_HOLD_MINUTES`) vì không có nó
   * thì một người mở trang thanh toán rồi bỏ đi sẽ khoá khung giờ đẹp nhất vô
   * thời hạn.
   */
  async hold(input: HoldInput) {
    const { courtId, startMinute, endMinute, ...rest } = input;
    const [booking] = await this.holdCheckout({
      ...rest,
      ranges: [{ courtId, startMinute, endMinute }],
    });
    return booking!;
  }

  /**
   * Giữ chỗ cho MỘT LẦN ĐẶT gồm một hoặc nhiều lượt (nhiều sân, nhiều khung rời).
   *
   * ---
   * TẤT CẢ HOẶC KHÔNG GÌ — TRONG MỘT TRANSACTION
   *
   * Nhóm 8 người chọn Sân 1 và Sân 3 cùng giờ. Giữ được Sân 1 mà mất Sân 3 thì
   * Sân 1 một mình vô dụng với họ, nhưng vẫn khoá chỗ của người khác. Trước đây
   * nơi gọi giữ từng lượt rồi tự huỷ các lượt đã giữ khi một lượt hỏng — để lại
   * những dòng `CANCELLED` rác, và nếu tiến trình chết giữa chừng thì còn nguyên
   * nửa lần đặt. Transaction làm việc đó đúng mà không cần dọn.
   *
   * ---
   * CÁC LƯỢT MANG CHUNG `checkoutCode` = MÃ CỦA LƯỢT ĐẦU
   *
   * Để khách chuyển khoản MỘT lần cho cả nhóm và chủ sân duyệt MỘT lần. Đặt một
   * lượt thì `checkoutCode` để `null` — không có nhóm nào để nối.
   *
   * ---
   * THỬ LẠI CẢ TRANSACTION KHI TRÙNG MÃ
   *
   * Trùng mã (28^6 ≈ 481 triệu tổ hợp) hiếm nhưng tăng theo số lượt đã có.
   * Không thử lại ngay trong transaction được: câu `INSERT` hỏng làm Postgres
   * huỷ cả transaction. Nên cuộn lại toàn bộ rồi sinh bộ mã mới. Trùng KHUNG
   * GIỜ thì không thử lại — người khác đã lấy mất, thử lại cũng vô ích.
   */
  async holdCheckout(input: HoldCheckoutInput) {
    const now = input.now ?? new Date();

    if (input.ranges.length === 0) {
      throw new SlotUnavailableError("Chọn ít nhất một khung giờ");
    }
    if (Number.isNaN(input.date.getTime())) {
      throw new BookingValidationError("Ngày đặt không hợp lệ. Chọn lại ngày giúp bạn nhé.");
    }

    for (const range of input.ranges) assertRangeShape(range);

    // Hai dãy CHỒNG nhau trên cùng một sân trong CÙNG một lần đặt: ràng buộc
    // EXCLUDE sẽ chặn dãy thứ hai và khách nhận "vừa có người đặt mất" — trong
    // khi người "đặt mất" chính là họ. Chặn ở đây với câu nói đúng chuyện.
    for (const [index, range] of input.ranges.entries()) {
      const clash = input.ranges.find(
        (other, otherIndex) =>
          otherIndex < index &&
          other.courtId === range.courtId &&
          overlaps(other.startMinute, other.endMinute, range.startMinute, range.endMinute),
      );
      if (clash) {
        throw new BookingValidationError(
          `Hai khung ${formatHhMm(clash.startMinute)}–${formatHhMm(clash.endMinute)} và ${formatHhMm(range.startMinute)}–${formatHhMm(range.endMinute)} của cùng một sân chồng lên nhau trong lần đặt này. Bỏ bớt một khung giúp bạn nhé.`,
        );
      }
    }

    // Giờ BẮT ĐẦU ≤ bây giờ là không bán — kể cả ngày đã qua gửi lên bằng
    // request tự chế. So mốc tuyệt đối, khớp đúng điều kiện `forDay` đánh dấu PAST.
    const started = input.ranges.find(
      (range) => atMinuteVN(input.date, range.startMinute).getTime() <= now.getTime(),
    );
    if (started) {
      throw new SlotUnavailableError(
        `Khung ${formatHhMm(started.startMinute)}–${formatHhMm(started.endMinute)} ${fullDateLabel(input.date)} đã qua giờ. Chọn giờ khác giúp bạn nhé.`,
      );
    }

    const venue = await this.db.venue.findFirst({
      where: { id: input.venueId, deletedAt: null },
      select: { status: true, holdMinutes: true },
    });

    // Lịch trống đã ẩn cơ sở không mở bán, nhưng request tự chế không đi qua
    // lịch. Nói đúng lý do thay vì để báo giá hỏng thành "đã có người đặt".
    if (!venue || venue.status !== "ACTIVE") throw new VenueNotBookableError();

    const quotes = await this.availability.quoteMany({
      venueId: input.venueId,
      date: input.date,
      ranges: input.ranges,
      now,
    });

    const label = (index: number) => {
      const range = input.ranges[index]!;
      const court = quotes[index]?.courtName ?? "Sân";
      return `${court} ${formatHhMm(range.startMinute)}–${formatHhMm(range.endMinute)}`;
    };

    const unavailable = quotes.findIndex((quote) => !quote.available);
    if (unavailable !== -1) {
      throw new SlotUnavailableError(
        unavailableMessage(label(unavailable), quotes[unavailable]!.reason),
      );
    }

    // Không bao giờ giữ một lượt 0đ: không mở được giao dịch cho nó (CHECK
    // `amount > 0`), và khách kẹt ở màn thanh toán không trả được. `forDay` đã
    // đánh dấu khung chưa có giá; đây là chốt cuối khi dữ liệu giá lệch.
    const free = quotes.findIndex((quote) => quote.total <= 0);
    if (free !== -1) {
      throw new SlotUnavailableError(unavailableMessage(label(free), "NOT_FOR_SALE"));
    }

    const holdMinutes = venue.holdMinutes ?? DEFAULT_HOLD_MINUTES;
    const holdExpiresAt = new Date(now.getTime() + holdMinutes * 60_000);

    const ranges = input.ranges.map((range) => ({
      ...range,
      startAt: atMinuteVN(input.date, range.startMinute),
      endAt: atMinuteVN(input.date, range.endMinute),
    }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const codes = input.ranges.map(() => generateCode());
      const checkoutCode = input.ranges.length > 1 ? codes[0]! : null;

      try {
        return await this.db.$transaction(async (tx) => {
          await this.lockCourts(
            tx,
            input.venueId,
            ranges.map((range) => range.courtId),
          );
          await this.assertNoClosure(tx, ranges, label);

          const created = [];

          for (const [index, range] of ranges.entries()) {
            await this.releaseStaleHolds(tx, range.courtId, range.startAt, range.endAt, now);

            try {
              created.push(
                await tx.booking.create({
                  data: {
                    code: codes[index]!,
                    checkoutCode,
                    venueId: input.venueId,
                    courtId: range.courtId,
                    userId: input.userId ?? null,
                    customerName: input.customerName.trim(),
                    customerPhone: input.customerPhone.trim(),
                    customerNote: input.customerNote?.trim() || null,
                    startAt: range.startAt,
                    endAt: range.endAt,
                    slotCount: quotes[index]!.slotCount,
                    status: "HOLDING",
                    source: input.source ?? "WEB",
                    subtotal: quotes[index]!.total,
                    total: quotes[index]!.total,
                    holdExpiresAt,
                    createdBy: input.createdBy ?? null,
                  },
                }),
              );
            } catch (error) {
              if (isSlotConflict(error)) {
                throw new SlotTakenError(
                  `${label(index)} vừa có người đặt mất. Chọn giờ khác giúp bạn nhé.`,
                );
              }
              throw error;
            }
          }

          return created;
        }, TRANSACTION_OPTIONS);
      } catch (error) {
        if (isCodeCollision(error) && attempt < 2) continue;
        throw error;
      }
    }

    throw new SlotTakenError();
  }

  /**
   * Khoá DÒNG của các sân con sắp giữ chỗ, theo thứ tự `id`.
   *
   * ---
   * VÌ SAO PHẢI KHOÁ: ĐUA VỚI LỊCH ĐÓNG SÂN
   *
   * Ràng buộc EXCLUDE chỉ biết lượt đặt, không biết `CourtClosure`. Chủ sân tạo
   * lịch bảo trì đúng lúc khách đang giữ chỗ thì cả hai cùng thấy "chưa có gì"
   * và cùng ghi — khách giữ được một khung sân đang sửa. Kiểm lại lịch đóng
   * trong transaction thôi CHƯA ĐỦ: lịch đóng ghi xong sau câu kiểm vẫn lọt.
   *
   * `FOR UPDATE` trên dòng `courts` xung đột với khoá `FOR KEY SHARE` mà Postgres
   * tự lấy khi INSERT một dòng `court_closures` (kiểm khoá ngoại). Nên hai bên
   * xếp hàng: lịch đóng ghi trước thì câu kiểm sau khi có khoá thấy nó; giữ chỗ
   * ghi trước thì lịch đóng chờ tới khi lượt đặt đã nằm trong database.
   *
   * Sắp theo `id` trong MỘT câu lệnh: hai lần đặt nhiều sân khoá cùng thứ tự,
   * không bao giờ chờ lẫn nhau thành vòng (deadlock).
   *
   * ---
   * CÙNG CÂU ĐÓ KIỂM LẠI: SÂN CON CÒN BẬT, ĐÚNG CƠ SỞ, CƠ SỞ CÒN MỞ BÁN
   *
   * Báo giá đã kiểm những điều này — nhưng TRƯỚC transaction. Chủ sân tắt sân
   * con (cập nhật dòng `courts`, phải chờ khoá này) hay admin khoá cơ sở đúng
   * lúc đó thì lượt đặt vẫn được ghi. Database cũng không ép `bookings.venue_id`
   * khớp `courts.venue_id`; điều kiện `venue_id` ở đây là chốt cho việc đó.
   */
  private async lockCourts(tx: Tx, venueId: string, courtIds: readonly string[]): Promise<void> {
    const ids = [...new Set(courtIds)].sort();

    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM courts c
      JOIN venues v ON v.id = c.venue_id
      WHERE c.id IN (${Prisma.join(ids)})
        AND c.venue_id = ${venueId}
        AND c.is_active = true
        AND c.deleted_at IS NULL
        AND v.status = 'ACTIVE'
        AND v.deleted_at IS NULL
      ORDER BY c.id
      FOR UPDATE OF c`;

    if (locked.length !== ids.length) {
      throw new SlotUnavailableError(
        "Sân vừa tạm ngừng nhận đặt hoặc sân con vừa được tắt. Tải lại trang rồi chọn lại giúp bạn nhé.",
      );
    }
  }

  /** Có lịch đóng sân (bảo trì) chồng lên dãy nào không — kiểm SAU khi đã khoá sân. */
  private async assertNoClosure(
    tx: Tx,
    ranges: readonly { courtId: string; startAt: Date; endAt: Date }[],
    label: (index: number) => string,
  ): Promise<void> {
    const closure = await tx.courtClosure.findFirst({
      where: {
        OR: ranges.map((range) => ({
          courtId: range.courtId,
          startAt: { lt: range.endAt },
          endAt: { gt: range.startAt },
        })),
      },
      select: { courtId: true, startAt: true, endAt: true },
    });

    if (!closure) return;

    const index = ranges.findIndex(
      (range) =>
        range.courtId === closure.courtId &&
        overlaps(
          range.startAt.getTime(),
          range.endAt.getTime(),
          closure.startAt.getTime(),
          closure.endAt.getTime(),
        ),
    );

    throw new SlotUnavailableError(
      `${label(Math.max(index, 0))} vừa được sân đóng để bảo trì. Chọn giờ khác giúp bạn nhé.`,
    );
  }

  /**
   * Nhả những chỗ giữ ĐÃ QUÁ HẠN đang gối lên khung sắp giữ.
   *
   * Lịch (`AvailabilityService`) coi chỗ giữ quá hạn là trống, nhưng ràng buộc
   * `EXCLUDE` ở database vẫn tính nó — Postgres không biết "bây giờ" là mấy giờ
   * trong một ràng buộc. Không nhả trước thì khách thấy ô trống, bấm đặt, và
   * nhận "vừa có người đặt mất" từ một người đã bỏ đi từ lâu.
   *
   * Chỗ giữ có `holdExpiresAt = null` (khách đã báo chuyển khoản) KHÔNG bị đụng:
   * `lte` không bao giờ khớp `null`.
   */
  private async releaseStaleHolds(
    tx: Tx,
    courtId: string,
    startAt: Date,
    endAt: Date,
    now: Date,
  ): Promise<void> {
    await tx.booking.updateMany({
      where: {
        courtId,
        status: "HOLDING",
        holdExpiresAt: { lte: now },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      data: { status: "EXPIRED", holdExpiresAt: null },
    });
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

  async checkIn(bookingId: string, options: { now?: Date; venueId?: string } = {}) {
    const booking = await this.requireBooking(bookingId, options.venueId);

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
   * Huỷ. Trả kèm các con số tiền để nơi gọi nói đúng với người bấm.
   *
   * Service KHÔNG tự hoàn tiền: hoàn tiền là một luồng riêng cần quyền riêng
   * (`payment:refund`), và gộp vào đây là giấu một thao tác tiền bạc bên trong
   * một thao tác trông có vẻ vô hại.
   *
   * ---
   * CẬP NHẬT CÓ ĐIỀU KIỆN, TRONG MỘT TRANSACTION
   *
   * Trước đây: đọc trạng thái rồi `update` không điều kiện. Chủ sân duyệt tiền,
   * cron nhả chỗ hay nhân viên nhận sân đúng lúc đó là lượt đặt bị ghi đè thành
   * `CANCELLED` từ một trạng thái không ai kiểm. Nay `updateMany` chỉ khớp khi
   * lượt VẪN đang HOLDING/CONFIRMED; lệch thì báo lỗi, không ghi gì.
   *
   * ---
   * GIAO DỊCH ĐANG SỐNG ĐI THEO LƯỢT ĐẶT
   *
   * Huỷ lượt mà để giao dịch chờ duyệt nằm lại hàng chờ thì chủ sân duyệt xong
   * là tiền SUCCEEDED cho một lượt CANCELLED. `PENDING` (chưa ai chuyển gì) huỷ
   * theo luôn. `AWAITING_CONFIRMATION` (khách nói đã chuyển tiền): khách tự huỷ
   * thì TỪ CHỐI — tiền có thể đã nằm trong tài khoản sân, chỉ sân quyết được;
   * sân huỷ thì giao dịch huỷ theo kèm lý do, và kết quả báo số tiền khách đã
   * khai để sân đối chiếu, hoàn nếu đã nhận.
   */
  async cancel(
    bookingId: string,
    options: {
      /**
       * Ai bấm huỷ. Bắt buộc vì hai bên được làm hai việc khác nhau với khoản
       * khách đã báo chuyển — mặc định bên nào cũng là đoán thay người gọi.
       */
      actor: "CUSTOMER" | "VENUE";
      reason?: string;
      cancelledBy?: string | null;
      /** Đè chính sách của sân. Chỉ dùng khi nền tảng chủ động huỷ hộ. */
      freeCancelHours?: number;
      /** Nhân viên sân huỷ hộ: lượt đặt PHẢI thuộc sân này. Xem `requireBooking`. */
      venueId?: string;
      now?: Date;
    },
  ) {
    const now = options.now ?? new Date();
    const booking = await this.requireBooking(bookingId, options.venueId);

    if (["CHECKED_IN", "COMPLETED"].includes(booking.status)) {
      throw new BookingStateError("Lượt đặt đã diễn ra, không huỷ được");
    }
    if (!CANCELLABLE.includes(booking.status)) {
      throw new BookingStateError(this.describeState(booking.status));
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
    const freeUntil = new Date(booking.startAt.getTime() - freeCancelHours * 60 * 60_000);
    const refundable = now <= freeUntil;

    // Huỷ trễ: khách mất một phần, phần còn lại mới hoàn. `cancelFeePercent`
    // để trống = mất trắng, vì đó là mặc định của phần lớn sân hiện nay.
    const feePercent = refundable ? 0 : (venue?.cancelFeePercent ?? 100);
    const cancelReason = options.reason ?? null;
    const cancelledBy = options.cancelledBy ?? null;

    return this.db.$transaction(async (tx) => {
      const cancelled = await tx.booking.updateMany({
        where: {
          id: bookingId,
          ...(options.venueId !== undefined ? { venueId: options.venueId } : {}),
          status: { in: CANCELLABLE },
        },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          cancelReason,
          cancelledBy,
          holdExpiresAt: null,
        },
      });

      if (cancelled.count !== 1) {
        throw new BookingStateError(
          "Lượt đặt vừa đổi trạng thái (đã nhận sân, hết hạn hoặc đã huỷ). Tải lại trang giúp bạn nhé.",
        );
      }

      // Đọc SAU khi đã giữ khoá dòng lượt đặt: khai chuyển khoản và duyệt tiền
      // cũng khoá dòng này trước khi đụng giao dịch, nên thứ đọc được ở đây là
      // thứ không ai đổi được nữa cho tới khi transaction này xong.
      const payments = await tx.payment.findMany({
        where: { bookingId },
        select: { id: true, status: true, amount: true, refundedAmount: true },
      });

      const awaiting = payments.filter((payment) => payment.status === "AWAITING_CONFIRMATION");

      if (awaiting.length > 0 && options.actor === "CUSTOMER") {
        // Ném trong transaction = cuộn lại cả bước huỷ ở trên.
        throw new BookingStateError(
          "Bạn đã báo chuyển khoản — sân đang kiểm tra. Liên hệ sân nếu muốn huỷ.",
        );
      }

      await tx.payment.updateMany({
        where: { bookingId, status: "PENDING" },
        data: { status: "CANCELLED", expiresAt: null },
      });

      if (awaiting.length > 0) {
        await tx.payment.updateMany({
          where: {
            id: { in: awaiting.map((payment) => payment.id) },
            status: "AWAITING_CONFIRMATION",
          },
          data: {
            status: "CANCELLED",
            failReason: `Sân huỷ lượt đặt${cancelReason ? `: ${cancelReason}` : ""}`,
            reviewedBy: cancelledBy,
            reviewedAt: now,
            expiresAt: null,
          },
        });
      }

      // Hoàn tiền tính từ tiền ĐÃ VỀ, không từ giá lượt đặt: lượt chưa trả đồng
      // nào thì không có gì để hoàn, dù còn trong hạn huỷ miễn phí.
      const paidAmount = payments
        .filter((payment) => MONEY_RECEIVED.includes(payment.status))
        .reduce((sum, payment) => sum + payment.amount - payment.refundedAmount, 0);

      return {
        booking: {
          ...booking,
          status: "CANCELLED" as const,
          cancelledAt: now,
          cancelReason,
          cancelledBy,
          holdExpiresAt: null,
        },
        refundable,
        freeUntil,
        freeCancelHours,
        feePercent,
        /** Tiền khách đã trả và sân đã nhận (trừ phần đã hoàn). */
        paidAmount,
        refundableAmount: Math.round((paidAmount * (100 - feePercent)) / 100),
        /** Tiền khách KHAI đã chuyển mà sân chưa đối chiếu — chỉ khác 0 khi sân huỷ. */
        awaitingAmount: awaiting.reduce((sum, payment) => sum + payment.amount, 0),
      };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Đổi sang khung giờ hoặc sân khác.
   *
   * Làm bằng huỷ-rồi-tạo-lại trong MỘT transaction: ràng buộc chống trùng nằm
   * ở database, nên phải nhả khung cũ trước khi giữ khung mới, nếu không lượt
   * đặt sẽ tự chặn chính mình khi hai khung có phần giao nhau.
   *
   * ---
   * TIỀN KHÔNG ĐƯỢC LỆCH VỚI GIAO DỊCH
   *
   * Khung mới khác giá mà lượt đặt đã trả (hoặc khách đã khai chuyển) theo giá
   * cũ là số tiền trên lượt đặt không còn khớp với số tiền đã chuyển. Nên chỉ
   * cho đổi khi CÙNG giá, hoặc khi lượt còn giữ chỗ và chưa ai chuyển gì — khi
   * đó giao dịch `PENDING` được sửa số tiền ngay trong transaction.
   */
  async reschedule(params: {
    bookingId: string;
    /** Sân của người thao tác — lượt đặt lệch sân là KHÔNG TÌM THẤY (GOTCHAS #19). */
    venueId: string;
    courtId: string;
    date: Date;
    startMinute: number;
    endMinute: number;
    actorId?: string | null;
    now?: Date;
  }) {
    const now = params.now ?? new Date();
    assertRangeShape(params);

    const booking = await this.requireBooking(params.bookingId, params.venueId);

    if (!CANCELLABLE.includes(booking.status)) {
      throw new BookingStateError(this.describeState(booking.status));
    }
    if (isHoldExpired(booking, now)) {
      throw new BookingStateError(this.describeState("EXPIRED"));
    }

    const quote = await this.availability.quote({
      venueId: booking.venueId,
      courtId: params.courtId,
      date: params.date,
      startMinute: params.startMinute,
      endMinute: params.endMinute,
      now,
      excludeBookingId: params.bookingId,
    });

    if (!quote || quote.total <= 0) throw new SlotUnavailableError("Khung giờ mới không đặt được");

    const priceChanged = quote.total !== booking.subtotal;
    if (priceChanged && booking.status !== "HOLDING") {
      throw new BookingStateError(
        "Khung mới khác giá mà lượt đặt đã thanh toán theo giá cũ. Chọn khung cùng giá, hoặc huỷ rồi đặt lại.",
      );
    }

    // Giảm giá lớn hơn giá mới thì khách không phải trả gì — không bao giờ âm.
    const total = Math.max(0, quote.total - booking.discountTotal);
    const startAt = atMinuteVN(params.date, params.startMinute);
    const endAt = atMinuteVN(params.date, params.endMinute);

    try {
      return await this.db.$transaction(async (tx) => {
        await this.lockCourts(tx, booking.venueId, [params.courtId]);
        await this.assertNoClosure(tx, [{ courtId: params.courtId, startAt, endAt }], () => {
          return `Khung mới ${formatHhMm(params.startMinute)}–${formatHhMm(params.endMinute)}`;
        });

        // Nhả khung cũ trước — nếu không, khung mới gối lên khung cũ sẽ bị
        // chính lượt đặt này chặn. Có điều kiện: trạng thái vừa đổi thì dừng.
        const released = await tx.booking.updateMany({
          where: { id: params.bookingId, venueId: params.venueId, status: booking.status },
          data: { status: "CANCELLED", cancelledAt: now, cancelledBy: params.actorId ?? null },
        });

        if (released.count !== 1) {
          throw new BookingStateError("Lượt đặt vừa đổi trạng thái. Tải lại trang giúp bạn nhé.");
        }

        if (priceChanged) {
          const committed = await tx.payment.count({
            where: { bookingId: params.bookingId, status: { in: MONEY_COMMITTED } },
          });

          if (committed > 0) {
            throw new BookingStateError(
              "Khách đã báo chuyển khoản theo giá cũ nên không đổi sang khung khác giá được. Chọn khung cùng giá giúp bạn nhé.",
            );
          }

          await tx.payment.updateMany({
            where: { bookingId: params.bookingId, status: "PENDING" },
            // Không còn gì phải trả thì huỷ giao dịch — CHECK `amount > 0` không
            // cho giữ một giao dịch 0đ.
            data: total > 0 ? { amount: total } : { status: "CANCELLED", expiresAt: null },
          });
        }

        await this.releaseStaleHolds(tx, params.courtId, startAt, endAt, now);

        return tx.booking.update({
          where: { id: params.bookingId },
          data: {
            status: booking.status,
            courtId: params.courtId,
            startAt,
            endAt,
            slotCount: quote.slotCount,
            subtotal: quote.total,
            total,
            cancelledAt: null,
            cancelledBy: null,
          },
        });
      }, TRANSACTION_OPTIONS);
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
  async expireHolds(
    options: {
      now?: Date;
      /**
       * Chỉ nhả trong MỘT sân. Cron không truyền. Dành cho script kiểm tra chạy
       * trên database dùng chung: gọi cron thật với "một giờ sau" là nhả luôn
       * chỗ đang giữ của người đang thử app trên cùng database.
       */
      venueId?: string;
    } = {},
  ): Promise<number> {
    const result = await this.db.booking.updateMany({
      where: {
        status: "HOLDING",
        holdExpiresAt: { lte: options.now ?? new Date() },
        ...(options.venueId ? { venueId: options.venueId } : {}),
      },
      data: { status: "EXPIRED", holdExpiresAt: null },
    });

    return result.count;
  }

  /**
   * Tra một lượt đặt bằng MÃ — cho nơi đã biết mã (nhân viên sân tra khi khách
   * đọc mã qua điện thoại).
   *
   * Hàm này KHÔNG kiểm ai được xem: nơi gọi phải tự kiểm như màn thanh toán
   * (người đặt hoặc thành viên sân có `booking:read`). Mã 6 ký tự khó đoán
   * nhưng không phải quyền.
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
   * Một LẦN ĐẶT tra từ mã của bất kỳ lượt nào trong đó — nguồn cho màn thanh toán.
   *
   * Đặt một lượt: lần đặt chỉ có lượt đó. Đặt nhiều lượt: mọi lượt mang chung
   * `checkoutCode`, và mã của lần đặt là `checkoutCode` — mã khách thấy trên màn
   * thanh toán và ghi vào nội dung chuyển khoản.
   *
   * Hạn giữ chỗ, "đã quá hạn chưa" và mốc `now` tính Ở ĐÂY chứ không ở trang:
   * trang là Server Component, và đọc đồng hồ khi dựng giao diện là thứ lint của
   * React chặn (kết quả dựng phải thuần).
   *
   * KHÔNG kiểm quyền xem — trang tự kiểm bằng `userId` trả về (người đặt) và
   * quyền `booking:read` trên sân.
   */
  async findCheckout(code: string, options: { now?: Date } = {}) {
    const now = options.now ?? new Date();

    const anchor = await this.db.booking.findUnique({
      where: { code: code.trim().toUpperCase() },
      select: { code: true, checkoutCode: true },
    });

    if (!anchor) return null;

    const rows = await this.db.booking.findMany({
      where: anchor.checkoutCode ? { checkoutCode: anchor.checkoutCode } : { code: anchor.code },
      orderBy: [{ startAt: "asc" }, { court: { sortOrder: "asc" } }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        status: true,
        userId: true,
        courtId: true,
        startAt: true,
        endAt: true,
        slotCount: true,
        total: true,
        holdExpiresAt: true,
        customerName: true,
        customerPhone: true,
        court: { select: { name: true } },
        venue: {
          select: {
            id: true,
            slug: true,
            name: true,
            address: true,
            ward: true,
            province: true,
            phone: true,
          },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, provider: true, amount: true, rejectReason: true },
        },
      },
    });

    const first = rows[0];
    if (!first) return null;

    const bookings = rows.map((row) => {
      const startMinute = minuteOfDayInVN(row.startAt);
      return {
        ...row,
        startMinute,
        endMinute: startMinute + (row.endAt.getTime() - row.startAt.getTime()) / 60_000,
      };
    });

    const holding = bookings.filter((booking) => booking.status === "HOLDING");

    // Hạn của cả lần đặt là hạn SỚM NHẤT. Có lượt không mang hạn (`null`) nghĩa
    // là khách đã báo chuyển khoản — cả lần đặt đang chờ chủ sân, không hết hạn.
    const expiries = holding.map((booking) => booking.holdExpiresAt);
    const holdExpiresAt =
      expiries.length === 0 || expiries.some((expiry) => expiry === null)
        ? null
        : new Date(Math.min(...expiries.map((expiry) => expiry!.getTime())));

    // Lý do chủ sân từ chối lần khai gần nhất — khách phải đọc được để sửa.
    const rejectReason =
      holding
        .flatMap((booking) => booking.payments)
        .find((payment) => payment.status === "FAILED" && payment.rejectReason)?.rejectReason ??
      null;

    return {
      code: anchor.checkoutCode ?? anchor.code,
      /** Người đặt — cả lần đặt do một người tạo. `null` = lượt cũ của khách vãng lai. */
      userId: first.userId,
      venue: first.venue,
      customerName: first.customerName,
      customerPhone: first.customerPhone,
      bookings,
      holding,
      /** Tổng tiền của những lượt CÒN chờ thanh toán — đúng số khách phải chuyển. */
      holdingTotal: holding.reduce((sum, booking) => sum + booking.total, 0),
      holdExpiresAt,
      holdExpired: holdExpiresAt !== null && holdExpiresAt <= now,
      rejectReason,
      /** Mốc "bây giờ" của máy chủ — đồng hồ đếm ngược dùng để bù lệch giờ máy khách. */
      now,
    };
  }

  /**
   * Lượt đặt của MỘT NGƯỜI — nguồn cho màn "Lượt đặt của tôi".
   *
   * Chia hai nhóm ngay ở tầng này chứ không để giao diện tự lọc: "sắp tới" và
   * "đã qua" trả lời hai câu hỏi khác nhau, và người dùng gần như chỉ quan tâm
   * nhóm đầu. Sắp tới thì gần nhất lên trước; đã qua thì mới nhất lên trước.
   *
   * Chỗ giữ QUÁ HẠN mà cron chưa nhả thuộc nhóm "đã qua" cùng với `EXPIRED` và
   * mang `holdExpired: true` — lịch đã coi chỗ đó là trống, hiện nó ở "sắp tới"
   * kèm nút "Thanh toán" là mời khách trả tiền cho một chỗ không còn giữ.
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
      holdExpiresAt: true,
      checkoutCode: true,
      court: { select: { name: true } },
      venue: { select: { slug: true, name: true, address: true, ward: true, province: true } },
      review: { select: { id: true } },
    } as const;

    const [upcoming, past] = await Promise.all([
      this.db.booking.findMany({
        where: {
          userId,
          endAt: { gte: now },
          // Viết dạng KHẲNG ĐỊNH, không dùng `NOT`: `NOT (HOLDING AND hạn <= bây giờ)`
          // gặp `holdExpiresAt = null` ra NULL trong SQL và lượt ĐÃ KHAI CHUYỂN
          // KHOẢN biến mất khỏi danh sách.
          OR: [
            { status: { notIn: ["HOLDING", "CANCELLED", "EXPIRED"] } },
            { status: "HOLDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }] },
          ],
        },
        orderBy: { startAt: "asc" },
        select,
      }),
      this.db.booking.findMany({
        where: {
          userId,
          OR: [
            { endAt: { lt: now } },
            { status: { in: ["CANCELLED", "EXPIRED"] } },
            { status: "HOLDING", holdExpiresAt: { lte: now } },
          ],
        },
        orderBy: { startAt: "desc" },
        take: options.limit ?? 30,
        select,
      }),
    ]);

    const withFlag = <T extends { status: BookingStatus; holdExpiresAt: Date | null }>(row: T) => ({
      ...row,
      holdExpired: isHoldExpired(row, now),
    });

    return { upcoming: upcoming.map(withFlag), past: past.map(withFlag) };
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

  /**
   * Lượt đặt của một sân trong một ngày — nguồn cho màn lịch của chủ sân.
   *
   * Trả `holdExpired` cho từng lượt: chỗ giữ quá hạn mà cron chưa nhả không
   * được tính là "chờ thanh toán" hay cộng vào tiền của ngày — lịch trống đã
   * bán lại chỗ đó cho người khác từ lâu.
   */
  async listForVenueDay(venueId: string, date: Date, options: { now?: Date } = {}) {
    const now = options.now ?? new Date();
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
        customerNote: true,
        startAt: true,
        endAt: true,
        status: true,
        source: true,
        total: true,
        holdExpiresAt: true,
      },
    });

    return bookings.map((booking) => {
      const startMinute = minuteOfDayInVN(booking.startAt);
      const durationMinutes = (booking.endAt.getTime() - booking.startAt.getTime()) / 60_000;

      // Trả phút-trong-ngày để màn lịch đặt khối vào đúng cột mà không phải tự
      // quy đổi múi giờ ở tầng giao diện — chỗ đó chắc chắn sẽ quy đổi sai.
      return {
        ...booking,
        startMinute,
        endMinute: startMinute + durationMinutes,
        holdExpired: isHoldExpired(booking, now),
      };
    });
  }

  /**
   * `venueId` truyền vào = thao tác của NHÂN VIÊN SÂN, lượt đặt phải thuộc đúng sân.
   *
   * `bookingId` đến từ form, người gọi tự đặt được. Quyền thì được kiểm trên
   * `venueId` của URL (`defineVenueAction`) — nhưng trước đây KHÔNG ai kiểm lượt
   * đặt có thuộc sân đó không: nhân viên sân A gửi id lượt đặt của sân B là huỷ
   * được lượt của sân B. Điều kiện sân nằm NGAY TRONG câu truy vấn (GOTCHAS #19),
   * không phải một phép so sánh rời có thể quên. Lệch sân thì báo KHÔNG TÌM
   * THẤY, không báo "không có quyền" — không xác nhận cho người dò rằng id đó
   * tồn tại.
   */
  private async requireBooking(bookingId: string, venueId?: string) {
    const booking = await this.db.booking.findFirst({
      where: { id: bookingId, ...(venueId !== undefined ? { venueId } : {}) },
    });
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
