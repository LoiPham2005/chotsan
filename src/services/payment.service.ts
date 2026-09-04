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

    try {
      return await this.db.payment.create({
        data: {
          bookingId: booking.id,
          provider: params.provider,
          status: "PENDING",
          amount: booking.total,
          merchantRef: buildMerchantRef(booking.code),
          receivedBy: params.receivedBy ?? "PLATFORM",
          transferNote:
            params.provider === "BANK_TRANSFER" ? transferNoteForBooking(booking.code) : null,
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
   * Chuỗi QR dựng tại máy chủ của ta, trình duyệt tự vẽ — không đẩy số tài
   * khoản của chủ sân qua dịch vụ sinh ảnh QR nào. Xem `src/lib/vietqr.ts`.
   */
  async transferInstruction(paymentId: string): Promise<TransferInstruction> {
    const payment = await this.db.payment.findUnique({
      where: { id: paymentId },
      select: {
        amount: true,
        transferNote: true,
        booking: {
          select: {
            code: true,
            venue: {
              select: { bankName: true, bankAccountNumber: true, bankAccountName: true },
            },
          },
        },
      },
    });

    if (!payment) throw new PaymentNotFoundError();

    const venue = payment.booking.venue;
    if (!venue.bankName || !venue.bankAccountNumber || !venue.bankAccountName) {
      throw new VenueBankAccountMissingError();
    }

    const transferNote = payment.transferNote ?? transferNoteForBooking(payment.booking.code);

    return {
      bankName: venue.bankName,
      accountNumber: venue.bankAccountNumber,
      accountName: venue.bankAccountName,
      transferNote,
      amount: payment.amount,
      // Ngân hàng ngoài danh sách BIN thì vẫn chuyển khoản tay được, chỉ là
      // không có QR. Thà không có QR còn hơn có một QR sai.
      qrPayload: buildVietQrPayload({
        bankBin: BANK_BINS[venue.bankName] ?? "",
        accountNumber: venue.bankAccountNumber,
        amount: payment.amount,
        transferNote,
      }),
    };
  }

  /**
   * Khách bấm "Tôi đã chuyển khoản".
   *
   * KHÔNG xác nhận lượt đặt — chỉ đẩy giao dịch vào hàng chờ duyệt của chủ sân.
   * Tin lời khách là ai cũng đặt được sân miễn phí.
   */
  async declareTransfer(params: {
    paymentId: string;
    note?: string | null;
    proofImageUrl?: string | null;
    now?: Date;
  }) {
    const payment = await this.requirePayment(params.paymentId);

    if (payment.status === "AWAITING_CONFIRMATION") return payment;
    if (payment.status !== "PENDING") {
      throw new PaymentStateError(this.describeState(payment.status));
    }

    return this.db.payment.update({
      where: { id: params.paymentId },
      data: {
        status: "AWAITING_CONFIRMATION",
        declaredAt: params.now ?? new Date(),
        declaredNote: params.note ?? null,
        proofImageUrl: params.proofImageUrl ?? null,
        // Chờ người duyệt thì không được tự hết hạn giữa chừng.
        expiresAt: null,
      },
    });
  }

  /**
   * Chủ sân xác nhận đã nhận được tiền → xác nhận luôn lượt đặt.
   *
   * Hai việc trong MỘT transaction: tiền đã nhận mà lượt đặt vẫn treo "chờ
   * thanh toán" thì cron sẽ nhả chỗ của một khách đã trả tiền.
   *
   * Chỉ áp dụng cho tiền mặt và chuyển khoản tay — xem `ManualApprovalNotAllowedError`.
   */
  async approveManual(params: { paymentId: string; reviewerId: string; now?: Date }) {
    const payment = await this.requirePayment(params.paymentId);

    if (AUTO_PROVIDERS.includes(payment.provider)) {
      throw new ManualApprovalNotAllowedError(payment.provider);
    }
    if (payment.status === "SUCCEEDED") return payment;
    if (!LIVE_STATUSES.includes(payment.status)) {
      throw new PaymentStateError(this.describeState(payment.status));
    }

    const now = params.now ?? new Date();

    return this.db.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: params.paymentId },
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
        where: { id: payment.bookingId, status: "HOLDING" },
        data: { status: "CONFIRMED", holdExpiresAt: null },
      });

      return updated;
    });
  }

  /**
   * Chủ sân không thấy tiền về.
   *
   * Giao dịch thành FAILED, lượt đặt GIỮ NGUYÊN trạng thái — khách còn hạn giữ
   * chỗ thì mở giao dịch khác được, hết hạn thì cron nhả chỗ như thường lệ.
   */
  async rejectManual(params: {
    paymentId: string;
    reviewerId: string;
    reason: string;
    now?: Date;
  }) {
    const payment = await this.requirePayment(params.paymentId);

    if (!LIVE_STATUSES.includes(payment.status)) {
      throw new PaymentStateError(this.describeState(payment.status));
    }

    const now = params.now ?? new Date();

    return this.db.payment.update({
      where: { id: params.paymentId },
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

  /** Hàng chờ duyệt chuyển khoản tay của một sân. */
  async pendingApprovals(venueId: string) {
    return this.db.payment.findMany({
      where: { status: "AWAITING_CONFIRMATION", booking: { venueId } },
      orderBy: { declaredAt: "asc" },
      select: {
        id: true,
        amount: true,
        declaredAt: true,
        declaredNote: true,
        proofImageUrl: true,
        transferNote: true,
        provider: true,
        booking: {
          select: {
            id: true,
            code: true,
            customerName: true,
            customerPhone: true,
            startAt: true,
            endAt: true,
            courtId: true,
          },
        },
      },
    });
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
