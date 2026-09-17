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

type PaymentBooking = {
  code: string;
  checkoutCode: string | null;
  venueId: string;
  customerName: string;
  customerPhone: string;
  startAt: Date;
  endAt: Date;
  court: { name: string };
  venue: Partial<Record<keyof typeof VENUE_BANK, string | null>> | null;
};

type PaymentRow = Omit<typeof PAYMENT, "status" | "provider"> & {
  status: string;
  provider: string;
  declaredAt?: Date | null;
  declaredNote?: string | null;
  proofImageUrl?: string | null;
  booking: PaymentBooking;
};

type Options = {
  booking?: (Partial<typeof BOOKING> & { id: string }) | null;
  payment?: (Partial<typeof PAYMENT> & { id: string }) | null;
  /**
   * Các giao dịch mà `findMany` thấy — dùng cho các thao tác trên CẢ LẦN ĐẶT.
   * Không truyền thì là một giao dịch dựng từ `payment`.
   */
  payments?: (Partial<Omit<PaymentRow, "booking">> & {
    id: string;
    booking?: Partial<PaymentBooking>;
  })[];
  venueBank?: Partial<Record<keyof typeof VENUE_BANK, string | null>> | null;
  createPaymentError?: Error;
  createEventError?: Error;
  refund?: Record<string, unknown> | null;
  /** Giao dịch sống mà `start()` đọc thấy TRƯỚC khi tạo. Mặc định: chưa có. */
  existingLivePayment?: Record<string, unknown> | null;
  /** Số lượt đặt mà `booking.updateMany` báo đã cập nhật. */
  bookingUpdateCount?: number;
};

function createDb(options: Options = {}) {
  const payment =
    "payment" in options ? options.payment && { ...PAYMENT, ...options.payment } : PAYMENT;

  const venue = "venueBank" in options ? (options.venueBank ?? null) : VENUE_BANK;

  const baseBooking: PaymentBooking = {
    code: BOOKING.code,
    checkoutCode: null,
    venueId: "v1",
    customerName: "Nguyễn Văn A",
    customerPhone: "0900000000",
    startAt: new Date("2026-09-04T12:00:00Z"),
    endAt: new Date("2026-09-04T13:00:00Z"),
    court: { name: "Sân 1" },
    venue,
  };

  const rows: PaymentRow[] = options.payments
    ? options.payments.map((row) => ({
        ...PAYMENT,
        ...row,
        booking: { ...baseBooking, ...row.booking },
      }))
    : payment
      ? [{ ...payment, booking: baseBooking }]
      : [];

  type FindManyArgs = {
    where?: {
      id?: { in: string[] };
      status?: string;
      booking?: { venueId?: string };
    };
  };

  const db = {
    booking: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          "booking" in options ? options.booking && { ...BOOKING, ...options.booking } : BOOKING,
        ),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: options.bookingUpdateCount ?? 1 }),
      ),
    },
    venue: {
      findUnique: vi.fn().mockResolvedValue({ holdMinutes: null }),
    },
    payment: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        options.createPaymentError
          ? Promise.reject(options.createPaymentError)
          : Promise.resolve({ ...PAYMENT, ...data, id: "p-moi" }),
      ),
      findUnique: vi.fn(() =>
        Promise.resolve(payment && { ...payment, booking: { code: BOOKING.code, venue } }),
      ),
      findFirst: vi.fn().mockResolvedValue(options.existingLivePayment ?? null),
      // Lọc thật theo `id` và `booking.venueId` — bài kiểm "sân khác không duyệt
      // được" chỉ có nghĩa khi mock không trả bừa mọi thứ.
      findMany: vi.fn(({ where }: FindManyArgs = {}) =>
        Promise.resolve(
          rows.filter(
            (row) =>
              (!where?.id || where.id.in.includes(row.id)) &&
              (!where?.status || row.status === where.status) &&
              (!where?.booking?.venueId || row.booking.venueId === where.booking.venueId),
          ),
        ),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ ...payment, ...data, id: where.id }),
      ),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: 2 }),
      ),
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

  it("lượt thuộc lần đặt nhiều lượt thì mang nội dung CHUNG của lần đặt", async () => {
    // Khách chuyển MỘT lần cho cả nhóm; chủ sân tìm MỘT dòng trong sao kê.
    const { db, mock } = createDb({
      booking: { id: "b2", code: "QPMV9H", checkoutCode: "8F3K2M" } as never,
    });
    await new PaymentService(db).start({ bookingId: "b2", provider: "BANK_TRANSFER", now: NOW });

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
   * Màn thanh toán gọi `start()` MỖI LẦN tải trang. Cứ tạo rồi bắt lỗi trùng thì
   * dữ liệu vẫn đúng, nhưng mỗi lần mở trang là một khối `prisma:error` trong
   * log — y như sự cố thật.
   */
  it("đã có giao dịch sống thì trả về NGAY, không thử INSERT", async () => {
    const { db, mock } = createDb({ existingLivePayment: { ...PAYMENT, id: "p-cu" } });
    const payment = await new PaymentService(db).start({
      bookingId: "b1",
      provider: "BANK_TRANSFER",
      now: NOW,
    });

    expect(payment.id).toBe("p-cu");
    expect(mock.payment.create).not.toHaveBeenCalled();
  });

  /**
   * Hai lần tải trang cùng lúc đều đọc thấy "chưa có". Chỉ chỉ số trong database
   * quyết được ai tạo — bên thua phải trả về giao dịch của bên thắng.
   */
  it("thua cuộc đua tạo giao dịch thì TRẢ VỀ cái đang có, không tạo cái thứ hai", async () => {
    const { db, mock } = createDb({ createPaymentError: duplicateLivePayment() });
    mock.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...PAYMENT,
      id: "p-cu",
    });

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
      new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY", now: NOW }),
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

  it("chỗ giữ QUÁ HẠN mà cron chưa kịp nhả thì cũng không mở giao dịch", async () => {
    // Lịch đã coi các khung đó là trống — mở QR là mời khách trả tiền cho một
    // chỗ người khác đặt được bất cứ lúc nào.
    const { db, mock } = createDb();
    const sau = new Date(HET_HAN.getTime() + 1_000);

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "BANK_TRANSFER", now: sau }),
    ).rejects.toBeInstanceOf(BookingStateError);
    expect(mock.payment.findFirst).not.toHaveBeenCalled();
    expect(mock.payment.create).not.toHaveBeenCalled();
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
    const instruction = await new PaymentService(db).transferInstruction(["p1"]);

    expect(instruction.accountNumber).toBe("1234567890");
    expect(instruction.transferNote).toBe("CS 8F3K2M");
    expect(instruction.amount).toBe(360_000);
    expect(instruction.qrPayload).toContain("970436"); // BIN Vietcombank
    expect(instruction.qrPayload).toContain("5406360000"); // số tiền
  });

  it("nhiều lượt của một lần đặt thành MỘT lần chuyển: tiền là tổng, nội dung chung", async () => {
    const { db } = createDb({
      payments: [
        { id: "p1", amount: 220_000, transferNote: "CS 8F3K2M" },
        { id: "p2", bookingId: "b2", amount: 110_000, transferNote: "CS 8F3K2M" },
      ],
    });
    const instruction = await new PaymentService(db).transferInstruction(["p1", "p2"]);

    expect(instruction.amount).toBe(330_000);
    expect(instruction.transferNote).toBe("CS 8F3K2M");
    expect(instruction.qrPayload).toContain("5406330000");
  });

  it("KHÔNG gộp giao dịch của hai sân khác nhau vào một mã QR", async () => {
    // Gộp là chuyển tiền của sân này vào tài khoản sân kia.
    const { db } = createDb({
      payments: [
        { id: "p1", booking: { venueId: "v1" } },
        { id: "p2", booking: { venueId: "v2" } },
      ],
    });

    await expect(new PaymentService(db).transferInstruction(["p1", "p2"])).rejects.toBeInstanceOf(
      PaymentStateError,
    );
  });

  it("thiếu một giao dịch thì báo NOT_FOUND, không dựng QR thiếu tiền", async () => {
    const { db } = createDb();
    await expect(
      new PaymentService(db).transferInstruction(["p1", "khong-co"]),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it("ngân hàng ngoài danh sách BIN: vẫn chuyển tay được, chỉ là không có QR", async () => {
    // Thà không có QR còn hơn có một QR sai — khách quét rồi tiền đi đâu không ai biết.
    const { db } = createDb({ venueBank: { ...VENUE_BANK, bankName: "NGAN_HANG_LA" } });
    const instruction = await new PaymentService(db).transferInstruction(["p1"]);

    expect(instruction.qrPayload).toBeNull();
    expect(instruction.accountNumber).toBe("1234567890");
  });

  it("sân chưa khai tài khoản thì báo rõ, không dựng QR rỗng", async () => {
    const { db } = createDb({ venueBank: { bankName: null, bankAccountNumber: null } });
    await expect(new PaymentService(db).transferInstruction(["p1"])).rejects.toBeInstanceOf(
      VenueBankAccountMissingError,
    );
  });
});

describe("declareTransfer — khách bấm 'tôi đã chuyển'", () => {
  it("chỉ đẩy vào hàng chờ duyệt, TUYỆT ĐỐI không xác nhận lượt đặt", async () => {
    // Tin lời khách là ai cũng đặt được sân miễn phí.
    const { db, mock } = createDb();
    await new PaymentService(db).declareTransfer({
      paymentIds: ["p1"],
      note: "Đã chuyển lúc 10:05",
      now: NOW,
    });

    expect(mock.payment.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: "AWAITING_CONFIRMATION",
      declaredAt: NOW,
      declaredNote: "Đã chuyển lúc 10:05",
      expiresAt: null,
    });
    // Lượt đặt chỉ bị xoá HẠN, trạng thái vẫn là HOLDING.
    expect(mock.booking.updateMany.mock.calls[0]![0].data).toEqual({ holdExpiresAt: null });
  });

  /**
   * Lỗi thật trước đây: chỉ xoá hạn của GIAO DỊCH. Chủ sân đối chiếu chậm hơn 10
   * phút là cron nhả chỗ của một khách đã trả tiền.
   */
  it("đang chờ người duyệt thì KHÔNG tự hết hạn — cả giao dịch lẫn LƯỢT ĐẶT", async () => {
    const { db, mock } = createDb();
    await new PaymentService(db).declareTransfer({ paymentIds: ["p1"], now: NOW });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.payment.updateMany.mock.calls[0]![0].data.expiresAt).toBeNull();
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, status: "HOLDING" },
      data: { holdExpiresAt: null },
    });
  });

  it("khai cho CẢ lần đặt nhiều lượt trong một transaction", async () => {
    const { db, mock } = createDb({
      payments: [
        { id: "p1", bookingId: "b1" },
        { id: "p2", bookingId: "b2" },
      ],
      bookingUpdateCount: 2,
    });
    await new PaymentService(db).declareTransfer({ paymentIds: ["p1", "p2"], now: NOW });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.booking.updateMany.mock.calls[0]![0].where).toEqual({
      id: { in: ["b1", "b2"] },
      status: "HOLDING",
    });
    expect(mock.payment.updateMany.mock.calls[0]![0].where).toEqual({
      id: { in: ["p1", "p2"] },
      status: "PENDING",
    });
  });

  it("lượt đặt đã bị nhả cho người khác thì từ chối CẢ lần khai", async () => {
    // Nhận khai cho một chỗ đã bán cho người khác là tiền vào mà không có sân.
    const { db, mock } = createDb({ bookingUpdateCount: 0 });

    await expect(
      new PaymentService(db).declareTransfer({ paymentIds: ["p1"], now: NOW }),
    ).rejects.toBeInstanceOf(BookingStateError);
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
  });

  it("khai hai lần không hỏng", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).declareTransfer({ paymentIds: ["p1"] });

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
  });

  it("không khai được cho giao dịch đã xong hoặc đã huỷ", async () => {
    for (const status of ["SUCCEEDED", "CANCELLED", "FAILED"]) {
      const { db } = createDb({ payment: { id: "p1", status } });
      await expect(
        new PaymentService(db).declareTransfer({ paymentIds: ["p1"] }),
      ).rejects.toBeInstanceOf(PaymentStateError);
    }
  });

  it("không có giao dịch nào thì báo NOT_FOUND", async () => {
    const { db } = createDb({ payment: null });
    await expect(
      new PaymentService(db).declareTransfer({ paymentIds: ["p1"] }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });
});

describe("approveManual — chủ sân duyệt", () => {
  it("xác nhận tiền VÀ xác nhận lượt đặt trong cùng một transaction", async () => {
    // Tiền đã nhận mà lượt đặt vẫn treo "chờ thanh toán" thì cron sẽ nhả chỗ
    // của một khách đã trả tiền.
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).approveManual({
      paymentIds: ["p1"],
      venueId: "v1",
      reviewerId: "u9",
      now: NOW,
    });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.payment.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: "SUCCEEDED",
      paidAt: NOW,
      reviewedBy: "u9",
    });
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, status: "HOLDING" },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
  });

  it("MỘT lần bấm xác nhận cả lần chuyển khoản trả cho nhiều lượt", async () => {
    const { db, mock } = createDb({
      payments: [
        { id: "p1", bookingId: "b1", status: "AWAITING_CONFIRMATION" },
        { id: "p2", bookingId: "b2", status: "AWAITING_CONFIRMATION" },
      ],
    });
    await new PaymentService(db).approveManual({
      paymentIds: ["p1", "p2"],
      venueId: "v1",
      reviewerId: "u9",
    });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.booking.updateMany.mock.calls[0]![0].where).toEqual({
      id: { in: ["b1", "b2"] },
      status: "HOLDING",
    });
  });

  /**
   * Lỗ hổng thật trước đây: quyền được kiểm trên `venueId` của URL, còn id giao
   * dịch lấy từ form — nhân viên sân A gửi id giao dịch của sân B là duyệt được
   * tiền của sân B.
   */
  it("giao dịch của SÂN KHÁC thì coi như không tồn tại", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });

    await expect(
      new PaymentService(db).approveManual({
        paymentIds: ["p1"],
        venueId: "san-khac",
        reviewerId: "u9",
      }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("chỉ đụng lượt đặt còn HOLDING — không hồi sinh lượt đã huỷ", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).approveManual({
      paymentIds: ["p1"],
      venueId: "v1",
      reviewerId: "u9",
    });

    expect(mock.booking.updateMany.mock.calls[0]![0].where.status).toBe("HOLDING");
  });

  it("duyệt được cả khi khách chưa kịp khai — chủ sân thấy tiền về là đủ", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "PENDING" } });
    await new PaymentService(db).approveManual({
      paymentIds: ["p1"],
      venueId: "v1",
      reviewerId: "u9",
    });

    expect(mock.payment.updateMany.mock.calls[0]![0].data.status).toBe("SUCCEEDED");
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
        new PaymentService(db).approveManual({
          paymentIds: ["p1"],
          venueId: "v1",
          reviewerId: "u9",
        }),
      ).rejects.toBeInstanceOf(ManualApprovalNotAllowedError);
      expect(mock.payment.updateMany).not.toHaveBeenCalled();
    }
  });

  it("tiền mặt tại quầy thì duyệt tay được", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", provider: "CASH", status: "PENDING" } });
    await new PaymentService(db).approveManual({
      paymentIds: ["p1"],
      venueId: "v1",
      reviewerId: "u9",
    });

    expect(mock.payment.updateMany.mock.calls[0]![0].data.status).toBe("SUCCEEDED");
  });

  it("duyệt hai lần không thu hai lần", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });
    await new PaymentService(db).approveManual({
      paymentIds: ["p1"],
      venueId: "v1",
      reviewerId: "u9",
    });

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("không duyệt được giao dịch đã huỷ hay đã thất bại", async () => {
    for (const status of ["CANCELLED", "FAILED", "REFUNDED"]) {
      const { db } = createDb({ payment: { id: "p1", status } });
      await expect(
        new PaymentService(db).approveManual({
          paymentIds: ["p1"],
          venueId: "v1",
          reviewerId: "u9",
        }),
      ).rejects.toBeInstanceOf(PaymentStateError);
    }
  });

  it("không tìm thấy giao dịch thì báo NOT_FOUND", async () => {
    const { db } = createDb({ payment: null });
    await expect(
      new PaymentService(db).approveManual({ paymentIds: ["p1"], venueId: "v1", reviewerId: "u9" }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it("danh sách rỗng thì báo NOT_FOUND, không duyệt 'tất cả'", async () => {
    const { db, mock } = createDb();
    await expect(
      new PaymentService(db).approveManual({ paymentIds: [], venueId: "v1", reviewerId: "u9" }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mock.payment.findMany).not.toHaveBeenCalled();
  });
});

describe("rejectManual — chủ sân không thấy tiền về", () => {
  it("đánh dấu thất bại kèm lý do, lượt đặt vẫn HOLDING và được cấp HẠN GIỮ MỚI", async () => {
    // Lúc khách khai, hạn giữ chỗ đã bị xoá. Không cấp lại hạn là chỗ bị giữ
    // vĩnh viễn; cấp lại để khách kịp đọc lý do, sửa và báo lại.
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).rejectManual({
      paymentIds: ["p1"],
      venueId: "v1",
      reviewerId: "u9",
      reason: "Không thấy tiền về",
      now: NOW,
    });

    expect(mock.payment.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: "FAILED",
      rejectReason: "Không thấy tiền về",
      reviewedBy: "u9",
    });
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, status: "HOLDING", holdExpiresAt: null },
      data: { holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000) },
    });
  });

  it("giao dịch của SÂN KHÁC thì coi như không tồn tại", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });

    await expect(
      new PaymentService(db).rejectManual({
        paymentIds: ["p1"],
        venueId: "san-khac",
        reviewerId: "u9",
        reason: "Không thấy tiền về",
      }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });
});

describe("pendingApprovals — hàng chờ của chủ sân", () => {
  it("gộp các lượt của MỘT lần đặt thành một mục với tổng tiền", async () => {
    // Khách chuyển một lần cho hai sân; hiện hai dòng hai số tiền là bắt chủ
    // sân đi tìm hai giao dịch không tồn tại trong sao kê.
    const { db } = createDb({
      payments: [
        {
          id: "p1",
          amount: 220_000,
          status: "AWAITING_CONFIRMATION",
          transferNote: "CS DXWQE3",
          booking: { code: "DXWQE3", checkoutCode: "DXWQE3", court: { name: "Sân 1" } },
        },
        {
          id: "p2",
          amount: 110_000,
          status: "AWAITING_CONFIRMATION",
          transferNote: "CS DXWQE3",
          booking: { code: "QPMV9H", checkoutCode: "DXWQE3", court: { name: "Sân 2" } },
        },
        {
          id: "p3",
          amount: 70_000,
          status: "AWAITING_CONFIRMATION",
          transferNote: "CS 8F3K2M",
          booking: { code: "8F3K2M", checkoutCode: null },
        },
      ],
    });

    const groups = await new PaymentService(db).pendingApprovals("v1");

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ checkoutCode: "DXWQE3", amount: 330_000 });
    expect(groups[0]!.items.map((item) => item.courtName)).toEqual(["Sân 1", "Sân 2"]);
    expect(groups[1]).toMatchObject({ checkoutCode: "8F3K2M", amount: 70_000 });
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
