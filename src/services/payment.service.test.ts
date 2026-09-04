import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
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
import { PaymentService } from "./payment.service";

/**
 * Đây là tầng động vào tiền thật. Ba loại lỗi phải chặn bằng test:
 * thu hai lần cho một lượt đặt, webhook chạy lại xác nhận lần nữa, và xác nhận
 * một giao dịch mà cổng báo về số tiền khác.
 */

const NOW = new Date("2026-09-04T03:00:00Z");
const HET_HAN = new Date("2026-09-04T03:10:00Z");

const BOOKING = {
  id: "b1",
  code: "8F3K2M",
  total: 360_000,
  status: "HOLDING",
  holdExpiresAt: HET_HAN,
  venueId: "v1",
};

const PAYMENT = {
  id: "p1",
  bookingId: "b1",
  provider: "BANK_TRANSFER",
  status: "PENDING",
  amount: 360_000,
  merchantRef: "8F3K2M-AB12CD34",
  refundedAmount: 0,
  transferNote: "CS 8F3K2M",
};

const VENUE_BANK = {
  bankName: "VCB",
  bankAccountNumber: "1234567890",
  bankAccountName: "NGUYEN VAN A",
};

/** Lỗi trùng chỉ số "một giao dịch sống cho mỗi lượt đặt". */
function duplicateLivePayment(): Error {
  return Object.assign(
    new Error(
      "Unique constraint failed on the constraint: `payments_mot_giao_dich_song_cho_moi_booking`",
    ),
    { code: "P2002" },
  );
}

/** Lỗi trùng `@@unique([provider, externalEventId])` — webhook gửi lại. */
function duplicateEvent(): Error {
  return Object.assign(
    new Error("Unique constraint failed on the fields: (`provider`,`external_event_id`)"),
    { code: "P2002", meta: { target: ["provider", "external_event_id"] } },
  );
}

type Options = {
  booking?: (Partial<typeof BOOKING> & { id: string }) | null;
  payment?: (Partial<typeof PAYMENT> & { id: string }) | null;
  venueBank?: Partial<Record<keyof typeof VENUE_BANK, string | null>> | null;
  createPaymentError?: Error;
  createEventError?: Error;
  refund?: Record<string, unknown> | null;
  existingLivePayment?: Record<string, unknown> | null;
};

function createDb(options: Options = {}) {
  const payment =
    "payment" in options ? options.payment && { ...PAYMENT, ...options.payment } : PAYMENT;

  const db = {
    booking: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          "booking" in options ? options.booking && { ...BOOKING, ...options.booking } : BOOKING,
        ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        options.createPaymentError
          ? Promise.reject(options.createPaymentError)
          : Promise.resolve({ ...PAYMENT, ...data, id: "p-moi" }),
      ),
      findUnique: vi.fn(() =>
        Promise.resolve(
          payment && {
            ...payment,
            booking: {
              code: BOOKING.code,
              venue: "venueBank" in options ? options.venueBank : VENUE_BANK,
            },
          },
        ),
      ),
      findFirst: vi
        .fn()
        .mockResolvedValue(options.existingLivePayment ?? { ...PAYMENT, id: "p-cu" }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ ...payment, ...data, id: where.id }),
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    paymentEvent: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        options.createEventError
          ? Promise.reject(options.createEventError)
          : Promise.resolve({ ...data, id: "e1" }),
      ),
    },
    refund: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...data, id: "r1" }),
      ),
      findUnique: vi.fn().mockResolvedValue(
        "refund" in options
          ? options.refund
          : {
              id: "r1",
              status: "PENDING",
              amount: 360_000,
              payment: { id: "p1", amount: 360_000, refundedAmount: 0 },
            },
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "r1", ...data }),
      ),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
  };

  return { db: db as unknown as PrismaClient, mock: db };
}

beforeEach(() => vi.clearAllMocks());

describe("start — mở giao dịch", () => {
  it("lấy số tiền từ lượt đặt, không nhận số tiền do người gọi truyền vào", async () => {
    // Nhận số tiền từ bên ngoài là để ngỏ cửa cho một request tự khai 1.000đ.
    const { db, mock } = createDb();
    await new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY", now: NOW });

    expect(mock.payment.create.mock.calls[0]![0].data).toMatchObject({
      amount: 360_000,
      status: "PENDING",
      provider: "VNPAY",
    });
  });

  it("giao dịch hết hạn cùng lúc với chỗ đang giữ, không sống lâu hơn", async () => {
    const { db, mock } = createDb();
    await new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY", now: NOW });

    expect(mock.payment.create.mock.calls[0]![0].data.expiresAt).toBe(HET_HAN);
  });

  it("chuyển khoản tay được gắn sẵn nội dung đối soát", async () => {
    const { db, mock } = createDb();
    await new PaymentService(db).start({ bookingId: "b1", provider: "BANK_TRANSFER", now: NOW });

    expect(mock.payment.create.mock.calls[0]![0].data.transferNote).toBe("CS 8F3K2M");
  });

  it("mã đối soát mang mã đặt sân + phần ngẫu nhiên", async () => {
    // Tiền tố để đọc log biết ngay của lượt nào; phần ngẫu nhiên để lần trả
    // lại sau không đụng mã cũ — cổng nào cũng từ chối mã đã dùng.
    const { db, mock } = createDb();
    await new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY", now: NOW });

    expect(mock.payment.create.mock.calls[0]![0].data.merchantRef).toMatch(/^8F3K2M-[0-9A-F]{8}$/);
  });

  /**
   * Khách bấm "Thanh toán" hai lần khi mạng chậm là chuyện hằng ngày. Tạo hai
   * giao dịch nghĩa là mở được hai trang thanh toán cho cùng một lượt đặt.
   */
  it("đã có giao dịch sống thì TRẢ VỀ cái đang có, không tạo cái thứ hai", async () => {
    const { db, mock } = createDb({ createPaymentError: duplicateLivePayment() });
    const payment = await new PaymentService(db).start({
      bookingId: "b1",
      provider: "VNPAY",
      now: NOW,
    });

    expect(payment.id).toBe("p-cu");
    expect(mock.payment.findFirst).toHaveBeenCalledWith({
      where: { bookingId: "b1", status: { in: ["PENDING", "AWAITING_CONFIRMATION"] } },
    });
  });

  it("lỗi trùng khác thì ném lên, không âm thầm trả về giao dịch bất kỳ", async () => {
    const other = Object.assign(new Error("Unique constraint failed on `merchant_ref`"), {
      code: "P2002",
    });
    const { db } = createDb({ createPaymentError: other });

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY" }),
    ).rejects.toThrow("merchant_ref");
  });

  it("không nhận tiền cho lượt đã huỷ hay đã hết hạn", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "COMPLETED"]) {
      const { db, mock } = createDb({ booking: { id: "b1", status } });
      await expect(
        new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY" }),
      ).rejects.toBeInstanceOf(BookingStateError);
      expect(mock.payment.create).not.toHaveBeenCalled();
    }
  });

  it("không tìm thấy lượt đặt thì báo NOT_FOUND", async () => {
    const { db } = createDb({ booking: null });
    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY" }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
  });
});

describe("transferInstruction — mã QR chuyển khoản", () => {
  it("dựng QR VietQR từ tài khoản của SÂN, kèm đúng số tiền và nội dung", async () => {
    const { db } = createDb();
    const instruction = await new PaymentService(db).transferInstruction("p1");

    expect(instruction.accountNumber).toBe("1234567890");
    expect(instruction.transferNote).toBe("CS 8F3K2M");
    expect(instruction.amount).toBe(360_000);
    expect(instruction.qrPayload).toContain("970436"); // BIN Vietcombank
    expect(instruction.qrPayload).toContain("5406360000"); // số tiền
  });

  it("ngân hàng ngoài danh sách BIN: vẫn chuyển tay được, chỉ là không có QR", async () => {
    // Thà không có QR còn hơn có một QR sai — khách quét rồi tiền đi đâu không ai biết.
    const { db } = createDb({ venueBank: { ...VENUE_BANK, bankName: "NGAN_HANG_LA" } });
    const instruction = await new PaymentService(db).transferInstruction("p1");

    expect(instruction.qrPayload).toBeNull();
    expect(instruction.accountNumber).toBe("1234567890");
  });

  it("sân chưa khai tài khoản thì báo rõ, không dựng QR rỗng", async () => {
    const { db } = createDb({ venueBank: { bankName: null, bankAccountNumber: null } });
    await expect(new PaymentService(db).transferInstruction("p1")).rejects.toBeInstanceOf(
      VenueBankAccountMissingError,
    );
  });
});

describe("declareTransfer — khách bấm 'tôi đã chuyển'", () => {
  it("chỉ đẩy vào hàng chờ duyệt, TUYỆT ĐỐI không xác nhận lượt đặt", async () => {
    // Tin lời khách là ai cũng đặt được sân miễn phí.
    const { db, mock } = createDb();
    await new PaymentService(db).declareTransfer({
      paymentId: "p1",
      note: "Đã chuyển lúc 10:05",
      now: NOW,
    });

    expect(mock.payment.update.mock.calls[0]![0].data).toMatchObject({
      status: "AWAITING_CONFIRMATION",
      declaredAt: NOW,
      declaredNote: "Đã chuyển lúc 10:05",
      expiresAt: null,
    });
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("đang chờ người duyệt thì KHÔNG tự hết hạn giữa chừng", async () => {
    const { db, mock } = createDb();
    await new PaymentService(db).declareTransfer({ paymentId: "p1", now: NOW });

    expect(mock.payment.update.mock.calls[0]![0].data.expiresAt).toBeNull();
  });

  it("khai hai lần không hỏng", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).declareTransfer({ paymentId: "p1" });

    expect(mock.payment.update).not.toHaveBeenCalled();
  });

  it("không khai được cho giao dịch đã xong hoặc đã huỷ", async () => {
    for (const status of ["SUCCEEDED", "CANCELLED", "FAILED"]) {
      const { db } = createDb({ payment: { id: "p1", status } });
      await expect(
        new PaymentService(db).declareTransfer({ paymentId: "p1" }),
      ).rejects.toBeInstanceOf(PaymentStateError);
    }
  });
});

describe("approveManual — chủ sân duyệt", () => {
  it("xác nhận tiền VÀ xác nhận lượt đặt trong cùng một transaction", async () => {
    // Tiền đã nhận mà lượt đặt vẫn treo "chờ thanh toán" thì cron sẽ nhả chỗ
    // của một khách đã trả tiền.
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9", now: NOW });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.payment.update.mock.calls[0]![0].data).toMatchObject({
      status: "SUCCEEDED",
      paidAt: NOW,
      reviewedBy: "u9",
    });
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", status: "HOLDING" },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
  });

  it("chỉ đụng lượt đặt còn HOLDING — không hồi sinh lượt đã huỷ", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9" });

    const [{ where }] = mock.booking.updateMany.mock.calls[0] as [{ where: { status: string } }];
    expect(where.status).toBe("HOLDING");
  });

  it("duyệt được cả khi khách chưa kịp khai — chủ sân thấy tiền về là đủ", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "PENDING" } });
    await new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9" });

    expect(mock.payment.update.mock.calls[0]![0].data.status).toBe("SUCCEEDED");
  });

  /**
   * Cổng tự báo về bằng webhook. Cho duyệt tay nghĩa là bất kỳ ai có quyền
   * `payment:confirm` cũng đánh dấu được "đã trả tiền" cho một lượt chưa trả
   * một đồng nào.
   */
  it("TỪ CHỐI duyệt tay giao dịch của cổng thanh toán", async () => {
    for (const provider of ["VNPAY", "MOMO", "ZALOPAY", "SEPAY"]) {
      const { db, mock } = createDb({ payment: { id: "p1", provider, status: "PENDING" } });
      await expect(
        new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9" }),
      ).rejects.toBeInstanceOf(ManualApprovalNotAllowedError);
      expect(mock.payment.update).not.toHaveBeenCalled();
    }
  });

  it("tiền mặt tại quầy thì duyệt tay được", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", provider: "CASH", status: "PENDING" } });
    await new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9" });

    expect(mock.payment.update.mock.calls[0]![0].data.status).toBe("SUCCEEDED");
  });

  it("duyệt hai lần không thu hai lần", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });
    await new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9" });

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("không duyệt được giao dịch đã huỷ hay đã thất bại", async () => {
    for (const status of ["CANCELLED", "FAILED", "REFUNDED"]) {
      const { db } = createDb({ payment: { id: "p1", status } });
      await expect(
        new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9" }),
      ).rejects.toBeInstanceOf(PaymentStateError);
    }
  });

  it("không tìm thấy giao dịch thì báo NOT_FOUND", async () => {
    const { db } = createDb({ payment: null });
    await expect(
      new PaymentService(db).approveManual({ paymentId: "p1", reviewerId: "u9" }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });
});

describe("rejectManual — chủ sân không thấy tiền về", () => {
  it("đánh dấu thất bại kèm lý do, GIỮ NGUYÊN lượt đặt để khách trả lại", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).rejectManual({
      paymentId: "p1",
      reviewerId: "u9",
      reason: "Không thấy tiền về",
      now: NOW,
    });

    expect(mock.payment.update.mock.calls[0]![0].data).toMatchObject({
      status: "FAILED",
      rejectReason: "Không thấy tiền về",
      reviewedBy: "u9",
    });
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });
});

describe("handleWebhook — cổng thanh toán báo về", () => {
  const base = {
    provider: "VNPAY" as const,
    externalEventId: "evt-1",
    merchantRef: "8F3K2M-AB12CD34",
    amount: 360_000,
    payload: { ok: true },
    verified: true,
    now: NOW,
  };

  it("thành công thì xác nhận tiền và lượt đặt trong một transaction", async () => {
    const { db, mock } = createDb();
    const result = await new PaymentService(db).handleWebhook({
      ...base,
      succeeded: true,
      providerTxnId: "vnp-999",
    });

    expect(result.handled).toBe(true);
    expect(mock.payment.update.mock.calls[0]![0].data).toMatchObject({
      status: "SUCCEEDED",
      providerTxnId: "vnp-999",
    });
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", status: "HOLDING" },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
  });

  /**
   * Cổng nào cũng gửi lại khi không nhận được 200. Không có chốt này thì gửi
   * lại lần hai là xác nhận lần hai.
   */
  it("gửi lại cùng một sự kiện thì KHÔNG xử lý lần nữa", async () => {
    const { db, mock } = createDb({ createEventError: duplicateEvent() });
    const result = await new PaymentService(db).handleWebhook({ ...base, succeeded: true });

    expect(result).toEqual({ handled: false, reason: "Sự kiện đã xử lý rồi" });
    expect(mock.payment.update).not.toHaveBeenCalled();
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("ghi sự kiện TRƯỚC khi đụng vào tiền", async () => {
    // Ngược lại thì có một khe: xác nhận xong, ghi sự kiện hỏng, cổng gửi lại,
    // xác nhận lần nữa.
    const { db, mock } = createDb();
    await new PaymentService(db).handleWebhook({ ...base, succeeded: true });

    const thuTuGoi = mock.paymentEvent.create.mock.invocationCallOrder[0]!;
    expect(thuTuGoi).toBeLessThan(mock.payment.update.mock.invocationCallOrder[0]!);
  });

  it("chữ ký sai thì VẪN LƯU sự kiện nhưng không đụng vào tiền", async () => {
    // Lưu để lần ra ai đang bắn webhook giả vào hệ thống.
    const { db, mock } = createDb();
    const result = await new PaymentService(db).handleWebhook({
      ...base,
      succeeded: true,
      verified: false,
    });

    expect(result).toEqual({ handled: false, reason: "Chữ ký không hợp lệ" });
    expect(mock.paymentEvent.create).toHaveBeenCalledTimes(1);
    expect(mock.payment.update).not.toHaveBeenCalled();
  });

  /**
   * Lệch tiền nghĩa là hoặc mã đối soát bị dùng lại, hoặc có người sửa số tiền
   * giữa đường. Cả hai đều phải có người xem, không được tự xác nhận.
   */
  it("số tiền lệch thì DỪNG dù webhook nói thành công", async () => {
    const { db, mock } = createDb();

    await expect(
      new PaymentService(db).handleWebhook({ ...base, succeeded: true, amount: 1_000 }),
    ).rejects.toBeInstanceOf(PaymentAmountMismatchError);
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("cổng báo thất bại thì đánh dấu thất bại, không đụng lượt đặt", async () => {
    const { db, mock } = createDb();
    const result = await new PaymentService(db).handleWebhook({
      ...base,
      succeeded: false,
      responseCode: "24",
      failReason: "Khách huỷ giao dịch",
    });

    expect(result.handled).toBe(true);
    expect(mock.payment.update.mock.calls[0]![0].data).toMatchObject({
      status: "FAILED",
      responseCode: "24",
      failReason: "Khách huỷ giao dịch",
    });
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("giao dịch đã thành công rồi thì bỏ qua, không xác nhận lại", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });
    const result = await new PaymentService(db).handleWebhook({ ...base, succeeded: true });

    expect(result.handled).toBe(false);
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("không tìm thấy mã đối soát: lưu sự kiện để lần ra, không ném lỗi", async () => {
    // Ném lỗi ở đây là cổng thanh toán thấy 500 rồi gửi lại mãi mãi.
    const { db, mock } = createDb({ payment: null });
    const result = await new PaymentService(db).handleWebhook({ ...base, succeeded: true });

    expect(result.handled).toBe(false);
    expect(mock.paymentEvent.create).toHaveBeenCalledTimes(1);
  });
});

describe("expirePending — cron huỷ giao dịch quá hạn", () => {
  it("chỉ đụng PENDING, KHÔNG đụng giao dịch đang chờ người duyệt", async () => {
    // Tự huỷ một khoản khách đã chuyển thật là mất tiền của khách.
    const { db, mock } = createDb();
    const count = await new PaymentService(db).expirePending({ now: NOW });

    expect(count).toBe(2);
    expect(mock.payment.updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING", expiresAt: { lte: NOW } },
      data: { status: "CANCELLED", expiresAt: null },
    });
  });
});

describe("requestRefund — đề nghị hoàn tiền", () => {
  it("chỉ tạo bản ghi PENDING, không tự đánh dấu đã hoàn", async () => {
    // Đánh dấu đã hoàn ngay là sổ sách nói tiền đã ra trong khi tiền còn nguyên.
    const { db, mock } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });
    await new PaymentService(db).requestRefund({
      paymentId: "p1",
      amount: 200_000,
      reason: "Khách huỷ sớm",
      requestedBy: "u9",
    });

    expect(mock.refund.create.mock.calls[0]![0].data).toMatchObject({
      status: "PENDING",
      amount: 200_000,
      requestedBy: "u9",
    });
    expect(mock.payment.update).not.toHaveBeenCalled();
  });

  it("không hoàn quá số tiền còn lại", async () => {
    const { db } = createDb({
      payment: { id: "p1", status: "PARTIALLY_REFUNDED", refundedAmount: 300_000 },
    });

    await expect(
      new PaymentService(db).requestRefund({
        paymentId: "p1",
        amount: 100_000,
        reason: "x",
        requestedBy: "u9",
      }),
    ).rejects.toBeInstanceOf(RefundAmountError);
  });

  it("không hoàn số âm hoặc số 0", async () => {
    const { db } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });

    for (const amount of [0, -1000]) {
      await expect(
        new PaymentService(db).requestRefund({
          paymentId: "p1",
          amount,
          reason: "x",
          requestedBy: "u9",
        }),
      ).rejects.toBeInstanceOf(RefundAmountError);
    }
  });

  it("không hoàn tiền giao dịch chưa thành công", async () => {
    for (const status of ["PENDING", "FAILED", "CANCELLED"]) {
      const { db } = createDb({ payment: { id: "p1", status } });
      await expect(
        new PaymentService(db).requestRefund({
          paymentId: "p1",
          amount: 1_000,
          reason: "x",
          requestedBy: "u9",
        }),
      ).rejects.toBeInstanceOf(PaymentStateError);
    }
  });
});

describe("settleRefund — tiền đã thật sự ra", () => {
  it("hoàn hết thì giao dịch thành REFUNDED", async () => {
    const { db, mock } = createDb();
    await new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9", now: NOW });

    expect(mock.payment.update.mock.calls[0]![0].data).toMatchObject({
      refundedAmount: 360_000,
      status: "REFUNDED",
    });
  });

  it("hoàn một phần thì thành PARTIALLY_REFUNDED và CỘNG DỒN, không ghi đè", async () => {
    // Cộng dồn sai là đối soát cuối tháng không bao giờ khớp.
    const { db, mock } = createDb({
      refund: {
        id: "r1",
        status: "PENDING",
        amount: 100_000,
        payment: { id: "p1", amount: 360_000, refundedAmount: 60_000 },
      },
    });

    await new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9" });

    expect(mock.payment.update.mock.calls[0]![0].data).toMatchObject({
      refundedAmount: 160_000,
      status: "PARTIALLY_REFUNDED",
    });
  });

  it("đánh dấu hai lần không cộng tiền hai lần", async () => {
    const { db, mock } = createDb({
      refund: {
        id: "r1",
        status: "SUCCEEDED",
        amount: 100_000,
        payment: { id: "p1", amount: 360_000, refundedAmount: 100_000 },
      },
    });

    await new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9" });

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.payment.update).not.toHaveBeenCalled();
  });
});
