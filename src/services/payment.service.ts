import { randomBytes } from "node:crypto";
import type { PaymentProvider, PaymentStatus, PrismaClient } from "@prisma/client";
import {
  BookingNotFoundError,
  BookingStateError,
  ManualApprovalNotAllowedError,
  PaymentAmountMismatchError,
  PaymentNotFoundError,
  PaymentStateError,
  RefundAmountError,
  VenueBankAccountMissingError,
} from "@/lib/errors";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { prisma } from "@/lib/prisma";
import { BANK_BINS, buildVietQrPayload, transferNoteForBooking } from "@/lib/vietqr";
import { DEFAULT_HOLD_MINUTES } from "./booking.service";

/**
 * Thanh toán — cổng tự động (VNPay/MoMo/ZaloPay/SePay), chuyển khoản tay có
 * chủ sân duyệt, và tiền mặt tại quầy.
 *
 * ---
 * BA THỨ Ở TẦNG NÀY KHÔNG ĐƯỢC PHÉP SAI
 *
 * 1. **Một lượt đặt chỉ có một giao dịch đang sống.** Chặn ở database bằng chỉ
 *    số `payments_mot_giao_dich_song_cho_moi_booking`. `ngay()` bắt lỗi trùng
 *    và TRẢ VỀ giao dịch đang có thay vì tạo cái thứ hai — khách bấm hai lần
 *    khi mạng chậm là chuyện xảy ra hằng ngày.
 *
 * 2. **Webhook chạy lại không được xác nhận hai lần.** Cổng thanh toán nào cũng
 *    gửi lại khi không nhận được 200. Chốt chặn là `@@unique([provider,
 *    externalEventId])` trên `payment_events`.
 *
 * 3. **Số tiền cổng báo về phải khớp.** Lệch thì DỪNG, kể cả webhook nói
 *    "thành công" — hoặc mã đối soát bị dùng lại, hoặc có người sửa số tiền
 *    giữa đường.
 */

/** Cổng tự báo về bằng webhook; người không xác nhận tay được. */
const AUTO_PROVIDERS: PaymentProvider[] = ["VNPAY", "MOMO", "ZALOPAY", "SEPAY"];

/** Trạng thái coi là còn sống — khớp chỉ số một-giao-dịch-cho-mỗi-booking. */
const LIVE_STATUSES: PaymentStatus[] = ["PENDING", "AWAITING_CONFIRMATION"];

/** Lượt đặt còn nhận tiền được. Trả tiền cho lượt đã huỷ là tạo việc hoàn tiền. */
const PAYABLE_BOOKING_STATUSES = ["HOLDING", "CONFIRMED"];

/**
 * Mã đối soát gửi sang cổng thanh toán.
 *
 * Có tiền tố mã đặt sân để đọc log là biết ngay của lượt nào, và phần ngẫu
 * nhiên để lần trả lại sau (khách huỷ rồi trả lại) không đụng mã cũ — mọi cổng
 * đều từ chối mã đã dùng.
 */
function buildMerchantRef(bookingCode: string): string {
  return `${bookingCode}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/** Ràng buộc "một giao dịch đang sống cho mỗi lượt đặt" — xem migration cùng tên. */
const RANG_BUOC_MOT_GIAO_DICH = "payments_mot_giao_dich_song_cho_moi_booking";

function isDuplicateLivePayment(error: unknown): boolean {
  return (
    isUniqueViolation(error, RANG_BUOC_MOT_GIAO_DICH) || isUniqueViolation(error, "booking_id")
  );
}

function isDuplicateEvent(error: unknown): boolean {
  return isUniqueViolation(error, "external_event_id");
}

export type TransferInstruction = {
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** Nội dung khách PHẢI ghi — thiếu là tiền vào mà không biết của lượt nào. */
  transferNote: string;
  amount: number;
  /** Chuỗi để trình duyệt tự vẽ mã QR. `null` khi ngân hàng chưa tra được BIN. */
  qrPayload: string | null;
};

export class PaymentService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Mở một giao dịch cho lượt đặt.
   *
   * Gọi lại khi đã có giao dịch sống thì TRẢ VỀ giao dịch đó, không ném lỗi và
   * không tạo cái thứ hai. Khách bấm hai lần không phải là lỗi của khách.
   *
   * ---
   * ĐỌC TRƯỚC, TẠO SAU — KHÔNG "CỨ TẠO RỒI BẮT LỖI TRÙNG"
   *
   * Màn thanh toán gọi hàm này MỖI LẦN tải trang. Trước đây nó luôn `create`
   * trước rồi bắt lỗi trùng: đúng về dữ liệu, nhưng từ lần tải thứ hai trở đi
   * MỖI lần mở trang là một câu `INSERT` hỏng, và Prisma in nguyên một khối
   * `prisma:error ... Unique constraint failed on the fields: (booking_id)` ra
   * log dù lỗi đã được xử lý — trông y như sự cố thật.
   *
   * Khối bắt lỗi trùng VẪN GIỮ: hai lần tải trang cùng lúc đều đọc thấy "chưa
   * có", và chỉ chỉ số trong database quyết được ai tạo.
   */
  async start(params: {
    bookingId: string;
    provider: PaymentProvider;
    /** Tiền vào tài khoản nền tảng hay tài khoản sân. Xem `Payment.receivedBy`. */
    receivedBy?: "PLATFORM" | "VENUE";
    now?: Date;
  }) {
    const booking = await this.db.booking.findUnique({
      where: { id: params.bookingId },
      select: {
        id: true,
        code: true,
        checkoutCode: true,
        total: true,
        status: true,
        holdExpiresAt: true,
        venueId: true,
      },
    });

    if (!booking) throw new BookingNotFoundError();
    if (!PAYABLE_BOOKING_STATUSES.includes(booking.status)) {
      throw new BookingStateError("Lượt đặt này không còn nhận thanh toán");
    }

    const now = params.now ?? new Date();

    // Chỗ giữ đã quá hạn thì lịch coi là trống, người khác đặt được bất cứ lúc
    // nào. Mở giao dịch cho nó là mời khách trả tiền cho một chỗ có thể mất.
    if (booking.status === "HOLDING" && booking.holdExpiresAt && booking.holdExpiresAt <= now) {
      throw new BookingStateError("Đã hết thời gian giữ chỗ. Đặt lại giúp bạn nhé.");
    }

    const live = await this.db.payment.findFirst({
      where: { bookingId: booking.id, status: { in: LIVE_STATUSES } },
    });
    if (live) return live;

    try {
      return await this.db.payment.create({
        data: {
          bookingId: booking.id,
          provider: params.provider,
          status: "PENDING",
          amount: booking.total,
          merchantRef: buildMerchantRef(booking.code),
          receivedBy: params.receivedBy ?? "PLATFORM",
          // Đặt nhiều lượt một lần thì MỌI giao dịch mang chung nội dung của lần
          // đặt: khách chuyển một lần, chủ sân tìm một dòng trong sao kê.
          transferNote:
            params.provider === "BANK_TRANSFER"
              ? transferNoteForBooking(booking.checkoutCode ?? booking.code)
              : null,
          // Giao dịch không sống lâu hơn chỗ nó đang giữ.
          expiresAt: booking.holdExpiresAt ?? new Date(now.getTime() + 15 * 60_000),
        },
      });
    } catch (error) {
      if (!isDuplicateLivePayment(error)) throw error;

      const existing = await this.db.payment.findFirst({
        where: { bookingId: booking.id, status: { in: LIVE_STATUSES } },
      });

      if (!existing) throw error;
      return existing;
    }
  }

  /**
   * Thông tin để khách chuyển khoản tay: số tài khoản của sân + mã QR VietQR.
   *
   * Nhận NHIỀU giao dịch — các lượt của một lần đặt — và gộp thành MỘT lần
   * chuyển: số tiền là tổng, nội dung là nội dung chung của lần đặt.
   *
   * Chuỗi QR dựng tại máy chủ của ta, trình duyệt tự vẽ — không đẩy số tài
   * khoản của chủ sân qua dịch vụ sinh ảnh QR nào. Xem `src/lib/vietqr.ts`.
   */
  async transferInstruction(paymentIds: readonly string[]): Promise<TransferInstruction> {
    const ids = [...new Set(paymentIds)];

    const payments = await this.db.payment.findMany({
      where: { id: { in: ids } },
      select: {
        amount: true,
        transferNote: true,
        booking: {
          select: {
            code: true,
            checkoutCode: true,
            venueId: true,
            venue: {
              select: { bankName: true, bankAccountNumber: true, bankAccountName: true },
            },
          },
        },
      },
    });

    const first = payments[0];
    if (!first || payments.length !== ids.length) throw new PaymentNotFoundError();

    // Gộp giao dịch của hai sân khác nhau vào một mã QR là chuyển tiền của sân
    // này vào tài khoản sân kia. Không bao giờ được xảy ra, kể cả do nơi gọi sai.
    if (payments.some((payment) => payment.booking.venueId !== first.booking.venueId)) {
      throw new PaymentStateError("Không gộp được giao dịch của nhiều sân khác nhau");
    }

    const venue = first.booking.venue;
    if (!venue.bankName || !venue.bankAccountNumber || !venue.bankAccountName) {
      throw new VenueBankAccountMissingError();
    }

    const transferNote =
      first.transferNote ??
      transferNoteForBooking(first.booking.checkoutCode ?? first.booking.code);
    const amount = payments.reduce((sum, payment) => sum + payment.amount, 0);

    return {
      bankName: venue.bankName,
      accountNumber: venue.bankAccountNumber,
      accountName: venue.bankAccountName,
      transferNote,
      amount,
      // Ngân hàng ngoài danh sách BIN thì vẫn chuyển khoản tay được, chỉ là
      // không có QR. Thà không có QR còn hơn có một QR sai.
      qrPayload: buildVietQrPayload({
        bankBin: BANK_BINS[venue.bankName] ?? "",
        accountNumber: venue.bankAccountNumber,
        amount,
        transferNote,
      }),
    };
  }

  /**
   * Khách bấm "Tôi đã chuyển khoản" — cho MỌI giao dịch của một lần đặt.
   *
   * KHÔNG xác nhận lượt đặt — chỉ đẩy giao dịch vào hàng chờ duyệt của chủ sân.
   * Tin lời khách là ai cũng đặt được sân miễn phí.
   *
   * ---
   * TỪ LÚC NÀY CHỖ GIỮ KHÔNG ĐƯỢC HẾT HẠN
   *
   * Trước đây hàm này chỉ xoá hạn của GIAO DỊCH, còn hạn của LƯỢT ĐẶT vẫn chạy.
   * Chủ sân đối chiếu chậm hơn 10 phút là cron nhả chỗ của một khách ĐÃ TRẢ
   * TIỀN; chủ sân bấm "đã nhận tiền" sau đó thì tiền thành công mà lượt đặt vẫn
   * nằm `EXPIRED`, và khung giờ có thể đã bán cho người khác.
   *
   * Nên xoá `holdExpiresAt` của lượt đặt trong CÙNG transaction. Lượt đặt không
   * còn `HOLDING` (đã bị nhả cho người khác) thì từ chối cả lần khai.
   */
  async declareTransfer(params: {
    paymentIds: readonly string[];
    note?: string | null;
    proofImageUrl?: string | null;
    now?: Date;
  }) {
    const ids = [...new Set(params.paymentIds)];

    const payments = await this.db.payment.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, bookingId: true },
    });

    if (payments.length === 0 || payments.length !== ids.length) {
      throw new PaymentNotFoundError();
    }

    const invalid = payments.find((payment) => !LIVE_STATUSES.includes(payment.status));
    if (invalid) throw new PaymentStateError(this.describeState(invalid.status));

    // Khai hai lần không hỏng: đã chờ duyệt hết rồi thì không còn gì để làm.
    const pending = payments.filter((payment) => payment.status === "PENDING");
    if (pending.length === 0) return { count: 0 };

    const now = params.now ?? new Date();
    const bookingIds = [...new Set(pending.map((payment) => payment.bookingId))];

    return this.db.$transaction(async (tx) => {
      const held = await tx.booking.updateMany({
        where: { id: { in: bookingIds }, status: "HOLDING" },
        data: { holdExpiresAt: null },
      });

      if (held.count !== bookingIds.length) {
        throw new BookingStateError(
          "Chỗ giữ đã hết hạn và được nhả cho người khác nên không nhận chuyển khoản cho lần đặt này nữa. Nếu bạn đã chuyển, gọi sân để được hoàn tiền.",
        );
      }

      return tx.payment.updateMany({
        where: { id: { in: pending.map((payment) => payment.id) }, status: "PENDING" },
        data: {
          status: "AWAITING_CONFIRMATION",
          declaredAt: now,
          declaredNote: params.note ?? null,
          proofImageUrl: params.proofImageUrl ?? null,
          // Chờ người duyệt thì không được tự hết hạn giữa chừng.
          expiresAt: null,
        },
      });
    });
  }

  /**
   * Chủ sân xác nhận đã nhận được tiền → xác nhận luôn các lượt đặt.
   *
   * Nhận NHIỀU giao dịch vì một lần chuyển khoản có thể trả cho nhiều lượt. Tất
   * cả trong MỘT transaction: tiền đã nhận mà một lượt vẫn treo "chờ thanh
   * toán" thì khách đến sân chỉ được chơi một nửa số giờ đã trả.
   *
   * `venueId` là của sân người duyệt CÓ QUYỀN. Giao dịch không thuộc sân đó thì
   * coi như không tồn tại — xem chú thích ở `requireBooking` của BookingService.
   *
   * Chỉ áp dụng cho tiền mặt và chuyển khoản tay — xem `ManualApprovalNotAllowedError`.
   */
  async approveManual(params: {
    paymentIds: readonly string[];
    venueId: string;
    reviewerId: string;
    now?: Date;
  }) {
    const payments = await this.requireVenuePayments(params.paymentIds, params.venueId);

    const auto = payments.find((payment) => AUTO_PROVIDERS.includes(payment.provider));
    if (auto) throw new ManualApprovalNotAllowedError(auto.provider);

    const live = payments.filter((payment) => LIVE_STATUSES.includes(payment.status));
    const invalid = payments.find(
      (payment) => !LIVE_STATUSES.includes(payment.status) && payment.status !== "SUCCEEDED",
    );
    if (invalid) throw new PaymentStateError(this.describeState(invalid.status));

    // Duyệt hai lần không thu hai lần.
    if (live.length === 0) return { count: 0 };

    const now = params.now ?? new Date();

    return this.db.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: { id: { in: live.map((payment) => payment.id) }, status: { in: LIVE_STATUSES } },
        data: {
          status: "SUCCEEDED",
          paidAt: now,
          reviewedBy: params.reviewerId,
          reviewedAt: now,
          rejectReason: null,
          expiresAt: null,
        },
      });

      await tx.booking.updateMany({
        where: { id: { in: live.map((payment) => payment.bookingId) }, status: "HOLDING" },
        data: { status: "CONFIRMED", holdExpiresAt: null },
      });

      return updated;
    });
  }

  /**
   * Chủ sân không thấy tiền về.
   *
   * Giao dịch thành FAILED, lượt đặt vẫn `HOLDING`. Lúc khách báo chuyển khoản
   * thì hạn giữ chỗ đã bị xoá (xem `declareTransfer`) — không trả lại hạn là chỗ
   * bị giữ VĨNH VIỄN. Nên cấp một hạn mới tính từ lúc từ chối: đủ để khách đọc
   * lý do, sửa nội dung chuyển khoản và báo lại; quá hạn thì nhả như thường lệ.
   */
  async rejectManual(params: {
    paymentIds: readonly string[];
    venueId: string;
    reviewerId: string;
    reason: string;
    now?: Date;
  }) {
    const payments = await this.requireVenuePayments(params.paymentIds, params.venueId);

    const invalid = payments.find((payment) => !LIVE_STATUSES.includes(payment.status));
    if (invalid) throw new PaymentStateError(this.describeState(invalid.status));

    const now = params.now ?? new Date();

    const venue = await this.db.venue.findUnique({
      where: { id: params.venueId },
      select: { holdMinutes: true },
    });
    const holdMinutes = venue?.holdMinutes ?? DEFAULT_HOLD_MINUTES;

    return this.db.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: { id: { in: payments.map((payment) => payment.id) }, status: { in: LIVE_STATUSES } },
        data: {
          status: "FAILED",
          failedAt: now,
          failReason: params.reason,
          rejectReason: params.reason,
          reviewedBy: params.reviewerId,
          reviewedAt: now,
          expiresAt: null,
        },
      });

      await tx.booking.updateMany({
        where: {
          id: { in: payments.map((payment) => payment.bookingId) },
          status: "HOLDING",
          holdExpiresAt: null,
        },
        data: { holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000) },
      });

      return updated;
    });
  }

  /**
   * Xử lý một sự kiện từ cổng thanh toán.
   *
   * Chống chạy lại bằng `@@unique([provider, externalEventId])`: ghi sự kiện
   * TRƯỚC, trùng thì dừng ngay. Cổng nào cũng gửi lại khi không nhận được 200,
   * và không có chốt này thì gửi lại lần hai là xác nhận lần hai.
   *
   * `verified` phải do nơi gọi kiểm chữ ký rồi truyền vào — service này không
   * biết cách kiểm chữ ký của từng cổng, và cũng không nên biết.
   */
  async handleWebhook(params: {
    provider: PaymentProvider;
    externalEventId: string;
    merchantRef: string;
    succeeded: boolean;
    amount: number;
    payload: object;
    verified: boolean;
    providerTxnId?: string | null;
    responseCode?: string | null;
    failReason?: string | null;
    now?: Date;
  }): Promise<{ handled: boolean; reason?: string }> {
    const now = params.now ?? new Date();

    const payment = await this.db.payment.findUnique({
      where: { merchantRef: params.merchantRef },
    });

    try {
      await this.db.paymentEvent.create({
        data: {
          paymentId: payment?.id ?? null,
          provider: params.provider,
          externalEventId: params.externalEventId,
          payload: params.payload as never,
          verified: params.verified,
          processedAt: now,
        },
      });
    } catch (error) {
      if (isDuplicateEvent(error)) return { handled: false, reason: "Sự kiện đã xử lý rồi" };
      throw error;
    }

    // Sự kiện vẫn được lưu để lần ra nguồn gốc, nhưng không đụng vào tiền.
    if (!params.verified) return { handled: false, reason: "Chữ ký không hợp lệ" };
    if (!payment) return { handled: false, reason: "Không tìm thấy giao dịch khớp mã đối soát" };

    if (payment.status === "SUCCEEDED")
      return { handled: false, reason: "Giao dịch đã thành công" };
    if (!LIVE_STATUSES.includes(payment.status)) {
      return { handled: false, reason: this.describeState(payment.status) };
    }

    if (!params.succeeded) {
      await this.db.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          failedAt: now,
          failReason: params.failReason ?? "Cổng thanh toán báo thất bại",
          responseCode: params.responseCode ?? null,
          providerTxnId: params.providerTxnId ?? null,
          expiresAt: null,
        },
      });

      return { handled: true };
    }

    // Lệch tiền thì DỪNG, kể cả webhook nói thành công.
    if (params.amount !== payment.amount) {
      throw new PaymentAmountMismatchError(payment.amount, params.amount);
    }

    await this.db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCEEDED",
          paidAt: now,
          providerPaidAt: now,
          providerTxnId: params.providerTxnId ?? null,
          responseCode: params.responseCode ?? null,
          expiresAt: null,
        },
      });

      await tx.booking.updateMany({
        where: { id: payment.bookingId, status: "HOLDING" },
        data: { status: "CONFIRMED", holdExpiresAt: null },
      });
    });

    return { handled: true };
  }

  /**
   * Huỷ những giao dịch quá hạn — cron chạy cùng nhịp với `expireHolds`.
   *
   * Chỉ đụng `PENDING`: `AWAITING_CONFIRMATION` đang chờ NGƯỜI duyệt, tự huỷ
   * nó là huỷ mất một khoản tiền khách đã chuyển thật.
   */
  async expirePending(options: { now?: Date } = {}): Promise<number> {
    const result = await this.db.payment.updateMany({
      where: { status: "PENDING", expiresAt: { lte: options.now ?? new Date() } },
      data: { status: "CANCELLED", expiresAt: null },
    });

    return result.count;
  }

  /**
   * Hàng chờ duyệt chuyển khoản tay của một sân — MỖI LẦN CHUYỂN KHOẢN MỘT MỤC.
   *
   * Khách đặt ba sân trong một lần thì chuyển một lần, với một nội dung. Hiện
   * ba dòng ba số tiền là bắt chủ sân đi tìm ba giao dịch không tồn tại trong
   * sao kê. Nên gộp theo lần đặt (`checkoutCode`, lượt đứng riêng thì theo mã
   * của nó): số tiền là tổng, bên dưới liệt kê từng sân + giờ.
   */
  async pendingApprovals(venueId: string) {
    const payments = await this.db.payment.findMany({
      where: { status: "AWAITING_CONFIRMATION", booking: { venueId } },
      orderBy: [{ declaredAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        amount: true,
        declaredAt: true,
        declaredNote: true,
        proofImageUrl: true,
        transferNote: true,
        booking: {
          select: {
            code: true,
            checkoutCode: true,
            customerName: true,
            customerPhone: true,
            startAt: true,
            endAt: true,
            court: { select: { name: true } },
          },
        },
      },
    });

    type Group = {
      checkoutCode: string;
      transferNote: string;
      amount: number;
      declaredAt: Date | null;
      declaredNote: string | null;
      proofImageUrl: string | null;
      customerName: string;
      customerPhone: string;
      items: {
        paymentId: string;
        bookingCode: string;
        courtName: string;
        startAt: Date;
        endAt: Date;
        amount: number;
      }[];
    };

    const groups = new Map<string, Group>();

    for (const payment of payments) {
      const key = payment.booking.checkoutCode ?? payment.booking.code;
      const group = groups.get(key) ?? {
        checkoutCode: key,
        transferNote: payment.transferNote ?? transferNoteForBooking(key),
        amount: 0,
        declaredAt: payment.declaredAt,
        declaredNote: payment.declaredNote,
        proofImageUrl: payment.proofImageUrl,
        customerName: payment.booking.customerName,
        customerPhone: payment.booking.customerPhone,
        items: [],
      };

      group.amount += payment.amount;
      group.items.push({
        paymentId: payment.id,
        bookingCode: payment.booking.code,
        courtName: payment.booking.court.name,
        startAt: payment.booking.startAt,
        endAt: payment.booking.endAt,
        amount: payment.amount,
      });
      groups.set(key, group);
    }

    return [...groups.values()];
  }

  /**
   * Ghi nhận một khoản hoàn tiền.
   *
   * Chỉ TẠO BẢN GHI ở trạng thái `PENDING` — chuyển tiền thật là việc của cổng
   * thanh toán hoặc của người, và cả hai đều xảy ra sau. Đánh dấu đã hoàn ngay
   * ở đây là sổ sách nói tiền đã ra trong khi tiền còn nguyên.
   */
  async requestRefund(params: {
    paymentId: string;
    amount: number;
    reason: string;
    requestedBy: string;
  }) {
    const payment = await this.requirePayment(params.paymentId);

    if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") {
      throw new PaymentStateError("Chỉ hoàn được tiền của giao dịch đã thành công");
    }

    const remaining = payment.amount - payment.refundedAmount;
    if (params.amount <= 0 || params.amount > remaining) {
      throw new RefundAmountError(remaining);
    }

    return this.db.refund.create({
      data: {
        paymentId: payment.id,
        amount: params.amount,
        reason: params.reason,
        status: "PENDING",
        merchantRef: buildMerchantRef(payment.merchantRef.split("-")[0] ?? "RF"),
        requestedBy: params.requestedBy,
      },
    });
  }

  /**
   * Tiền đã thật sự ra khỏi tài khoản.
   *
   * Cộng dồn `refundedAmount` và hạ trạng thái giao dịch xuống `REFUNDED` hoặc
   * `PARTIALLY_REFUNDED` trong cùng một transaction — hai con số này lệch nhau
   * là đối soát cuối tháng không bao giờ khớp.
   */
  async settleRefund(params: { refundId: string; approvedBy: string; now?: Date }) {
    const refund = await this.db.refund.findUnique({
      where: { id: params.refundId },
      include: { payment: { select: { id: true, amount: true, refundedAmount: true } } },
    });

    if (!refund) throw new PaymentNotFoundError();
    if (refund.status === "SUCCEEDED") return refund;
    if (refund.status !== "PENDING") {
      throw new PaymentStateError("Khoản hoàn này đã thất bại, không đánh dấu lại được");
    }

    const now = params.now ?? new Date();
    const refunded = refund.payment.refundedAmount + refund.amount;

    return this.db.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: refund.payment.id },
        data: {
          refundedAmount: refunded,
          status: refunded >= refund.payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED",
        },
      });

      return tx.refund.update({
        where: { id: refund.id },
        data: { status: "SUCCEEDED", approvedBy: params.approvedBy, refundedAt: now },
      });
    });
  }

  /**
   * Các giao dịch được gửi lên từ form của nhân viên sân — PHẢI thuộc đúng sân.
   *
   * Lọc theo sân NGAY TRONG câu truy vấn. Thiếu một cái (sai id, hoặc id của sân
   * khác) là từ chối CẢ lô bằng "không tìm thấy": duyệt một nửa lô là ghi nhận
   * tiền cho một nửa lần chuyển khoản.
   */
  private async requireVenuePayments(paymentIds: readonly string[], venueId: string) {
    const ids = [...new Set(paymentIds)];
    if (ids.length === 0) throw new PaymentNotFoundError();

    const payments = await this.db.payment.findMany({
      where: { id: { in: ids }, booking: { venueId } },
      select: { id: true, status: true, provider: true, bookingId: true },
    });

    if (payments.length !== ids.length) throw new PaymentNotFoundError();
    return payments;
  }

  private async requirePayment(paymentId: string) {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new PaymentNotFoundError();
    return payment;
  }

  private describeState(status: PaymentStatus): string {
    const labels: Record<PaymentStatus, string> = {
      PENDING: "Giao dịch đang chờ thanh toán",
      AWAITING_CONFIRMATION: "Giao dịch đang chờ chủ sân duyệt",
      SUCCEEDED: "Giao dịch đã thanh toán thành công",
      FAILED: "Giao dịch đã thất bại",
      CANCELLED: "Giao dịch đã bị huỷ",
      REFUNDED: "Giao dịch đã hoàn tiền",
      PARTIALLY_REFUNDED: "Giao dịch đã hoàn một phần",
    };

    return labels[status] ?? "Không thao tác được với giao dịch này";
  }
}

export const paymentService = new PaymentService();
