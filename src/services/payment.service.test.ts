import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  BookingNotFoundError,
  BookingStateError,
  ManualApprovalNotAllowedError,
  PaymentNotFoundError,
  PaymentStateError,
  RefundAmountError,
  VenueBankAccountMissingError,
} from "@/lib/errors";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from "@/lib/logger";
import { PaymentService } from "./payment.service";

/**
 * Đây là tầng động vào tiền thật. Ba loại lỗi phải chặn bằng test:
 * thu hai lần cho một lượt đặt, webhook chạy lại xác nhận lần nữa, và xác nhận
 * một giao dịch mà cổng báo về số tiền khác.
 *
 * Mốc dùng xuyên suốt: 10:00 ngày 04/09/2026 giờ VN.
 */

const NOW = new Date("2026-09-04T03:00:00Z");
const HOLD_EXPIRES = new Date("2026-09-04T03:10:00Z");

const BOOKING = {
  id: "b1",
  code: "8F3K2M",
  checkoutCode: null as string | null,
  total: 360_000,
  status: "HOLDING",
  holdExpiresAt: HOLD_EXPIRES as Date | null,
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

/**
 * Lỗi trùng chỉ số "một giao dịch sống cho mỗi lượt đặt" — CHÉP theo hình dạng
 * thật của Prisma 7 + adapter-pg trong `src/lib/prisma-errors.test.ts`: tên ràng
 * buộc chỉ nằm trong `meta.driverAdapterError.cause`, không có `meta.target`.
 */
function duplicateLivePayment(): Error {
  return Object.assign(
    new Error(
      "\nInvalid `db.payment.create()` invocation:\n\n" +
        "Unique constraint failed on the fields: (`booking_id`)",
    ),
    {
      code: "P2002",
      meta: {
        modelName: "Payment",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage:
              'duplicate key value violates unique constraint "payments_mot_giao_dich_song_cho_moi_booking"',
            kind: "UniqueConstraintViolation",
            constraint: { fields: ["booking_id"] },
          },
        },
      },
    },
  );
}

/** Lỗi trùng `@@unique([provider, externalEventId])` — webhook gửi lại. */
function duplicateEvent(): Error {
  return Object.assign(
    new Error("Unique constraint failed on the fields: (`provider`,`external_event_id`)"),
    {
      code: "P2002",
      meta: {
        modelName: "PaymentEvent",
        driverAdapterError: {
          cause: {
            originalCode: "23505",
            originalMessage:
              'duplicate key value violates unique constraint "payment_events_provider_external_event_id_key"',
            constraint: { fields: ["provider", "external_event_id"] },
          },
        },
      },
    },
  );
}

/** Trùng một ràng buộc KHÁC — không được nhầm thành "đã có giao dịch sống". */
function duplicateMerchantRef(): Error {
  return Object.assign(new Error("Unique constraint failed on the fields: (`merchant_ref`)"), {
    code: "P2002",
    meta: {
      modelName: "Payment",
      driverAdapterError: {
        cause: {
          originalCode: "23505",
          originalMessage:
            'duplicate key value violates unique constraint "payments_merchant_ref_key"',
          constraint: { fields: ["merchant_ref"] },
        },
      },
    },
  });
}

type PaymentBooking = {
  code: string;
  checkoutCode: string | null;
  venueId: string;
  status: string;
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

type RefundRow = {
  id: string;
  status: string;
  amount: number;
  paymentId: string;
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
  refund?: RefundRow | null;
  /** Tổng các khoản hoàn PENDING của giao dịch. */
  pendingRefundSum?: number | null;
  /** Giao dịch sống mà `start()` đọc thấy TRƯỚC khi tạo. Mặc định: chưa có. */
  existingLivePayment?: Record<string, unknown> | null;
  /** Số lượt đặt mà `booking.updateMany` báo đã cập nhật. Mặc định: đủ số id gửi vào. */
  bookingUpdateCount?: number;
  /** Số giao dịch mà `payment.updateMany` báo đã cập nhật. Mặc định: đủ số id gửi vào. */
  paymentUpdateCount?: number;
};

function countOf(where: { id?: string | { in: string[] } }): number {
  if (where.id === undefined) return 1;
  return typeof where.id === "string" ? 1 : where.id.in.length;
}

function createDb(options: Options = {}) {
  const payment =
    "payment" in options ? options.payment && { ...PAYMENT, ...options.payment } : PAYMENT;

  const venue = "venueBank" in options ? (options.venueBank ?? null) : VENUE_BANK;

  const baseBooking: PaymentBooking = {
    code: BOOKING.code,
    checkoutCode: null,
    venueId: "v1",
    status: "HOLDING",
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

  let refund: RefundRow | null =
    "refund" in options
      ? (options.refund ?? null)
      : { id: "r1", status: "PENDING", amount: 360_000, paymentId: "p1" };

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
        ({ where }: { where: { id?: string | { in: string[] } }; data: Record<string, unknown> }) =>
          Promise.resolve({ count: options.bookingUpdateCount ?? countOf(where) }),
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
      findUnique: vi.fn(() => Promise.resolve(payment)),
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
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
          select?: unknown;
        }) => Promise.resolve({ ...payment, ...data, id: where.id }),
      ),
      updateMany: vi.fn(
        ({ where }: { where: { id?: string | { in: string[] } }; data: Record<string, unknown> }) =>
          Promise.resolve({ count: options.paymentUpdateCount ?? countOf(where) }),
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
        Promise.resolve({ ...data, id: "r-moi" }),
      ),
      findUnique: vi.fn(() => Promise.resolve(refund)),
      findUniqueOrThrow: vi.fn(() => Promise.resolve(refund)),
      // Cập nhật CÓ ĐIỀU KIỆN theo trạng thái thật của khoản hoàn — lần đánh dấu
      // thứ hai không được khớp nữa.
      updateMany: vi.fn(
        ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
          if (!refund || refund.status !== where.status) return Promise.resolve({ count: 0 });
          refund = { ...refund, ...(data as Partial<RefundRow>) };
          return Promise.resolve({ count: 1 });
        },
      ),
      aggregate: vi.fn(() =>
        Promise.resolve({ _sum: { amount: options.pendingRefundSum ?? null } }),
      ),
    },
    $queryRaw: vi.fn((..._args: unknown[]) => Promise.resolve([])),
    $transaction: vi.fn((fn: (tx: unknown) => unknown, _options?: unknown) =>
      Promise.resolve(fn(db)),
    ),
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

    expect(mock.payment.create.mock.calls[0]![0].data.expiresAt).toBe(HOLD_EXPIRES);
  });

  it("chuyển khoản tay được gắn sẵn nội dung đối soát", async () => {
    const { db, mock } = createDb();
    await new PaymentService(db).start({ bookingId: "b1", provider: "BANK_TRANSFER", now: NOW });

    expect(mock.payment.create.mock.calls[0]![0].data.transferNote).toBe("CS 8F3K2M");
  });

  it("lượt thuộc lần đặt nhiều lượt thì mang nội dung CHUNG của lần đặt", async () => {
    // Khách chuyển MỘT lần cho cả nhóm; chủ sân tìm MỘT dòng trong sao kê.
    const { db, mock } = createDb({
      booking: { id: "b2", code: "QPMV9H", checkoutCode: "8F3K2M" },
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
   * Khách tải lại trang hay bấm "Tạo mã chuyển khoản" hai lần. Cứ tạo rồi bắt
   * lỗi trùng thì dữ liệu vẫn đúng, nhưng mỗi lần là một khối `prisma:error`
   * trong log — y như sự cố thật.
   */
  it("đã có giao dịch sống CÙNG cách trả thì trả về NGAY, không thử INSERT", async () => {
    const { db, mock } = createDb({ existingLivePayment: { ...PAYMENT, id: "p-cu" } });
    const payment = await new PaymentService(db).start({
      bookingId: "b1",
      provider: "BANK_TRANSFER",
      now: NOW,
    });

    expect(payment.id).toBe("p-cu");
    expect(mock.payment.create).not.toHaveBeenCalled();
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Lỗi thật trước đây: giao dịch sống của cách trả KHÁC được trả về im lặng —
   * xin chuyển khoản mà nhận giao dịch VNPay, và màn thanh toán dựng QR cho nó.
   */
  it("giao dịch sống KHÁC cách trả còn PENDING: huỷ có điều kiện rồi mở cái mới", async () => {
    const { db, mock } = createDb({
      existingLivePayment: { ...PAYMENT, id: "p-vnpay", provider: "VNPAY", status: "PENDING" },
    });

    const payment = await new PaymentService(db).start({
      bookingId: "b1",
      provider: "BANK_TRANSFER",
      now: NOW,
    });

    expect(mock.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "p-vnpay", status: "PENDING" },
      data: { status: "CANCELLED", expiresAt: null },
    });
    expect(mock.payment.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.payment.create.mock.invocationCallOrder[0]!,
    );
    expect(payment.provider).toBe("BANK_TRANSFER");
  });

  it("giao dịch KHÁC cách trả mà khách ĐÃ BÁO CHUYỂN KHOẢN: từ chối, không huỷ, không tạo", async () => {
    // Huỷ nó là vứt đi lời khai về một khoản tiền có thể đã về tài khoản sân.
    const { db, mock } = createDb({
      existingLivePayment: {
        ...PAYMENT,
        id: "p-ck",
        provider: "BANK_TRANSFER",
        status: "AWAITING_CONFIRMATION",
      },
    });

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY", now: NOW }),
    ).rejects.toBeInstanceOf(BookingStateError);
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
    expect(mock.payment.create).not.toHaveBeenCalled();
  });

  it("giao dịch cũ vừa được khai đúng lúc định huỷ (huỷ có điều kiện khớp 0 dòng) → dừng, không tạo", async () => {
    const { db, mock } = createDb({
      existingLivePayment: { ...PAYMENT, id: "p-vnpay", provider: "VNPAY", status: "PENDING" },
      paymentUpdateCount: 0,
    });

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "BANK_TRANSFER", now: NOW }),
    ).rejects.toBeInstanceOf(PaymentStateError);
    expect(mock.payment.create).not.toHaveBeenCalled();
  });

  /**
   * Hai request cùng lúc đều đọc thấy "chưa có". Chỉ chỉ số trong database
   * quyết được ai tạo — bên thua phải trả về giao dịch của bên thắng.
   */
  it("thua cuộc đua tạo giao dịch thì TRẢ VỀ cái đang có, không tạo cái thứ hai", async () => {
    const { db, mock } = createDb({ createPaymentError: duplicateLivePayment() });
    mock.payment.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...PAYMENT,
      id: "p-cu",
      provider: "VNPAY",
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

  it("thua cuộc đua vào tay một giao dịch KHÁC cách trả → báo đổi trạng thái, không trả nhầm", async () => {
    const { db, mock } = createDb({ createPaymentError: duplicateLivePayment() });
    mock.payment.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...PAYMENT, id: "p-momo", provider: "MOMO" });

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "BANK_TRANSFER", now: NOW }),
    ).rejects.toBeInstanceOf(PaymentStateError);
  });

  it("lỗi trùng khác thì ném lên, không âm thầm trả về giao dịch bất kỳ", async () => {
    const { db } = createDb({ createPaymentError: duplicateMerchantRef() });

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "VNPAY", now: NOW }),
    ).rejects.toThrow("merchant_ref");
  });

  it("chỉ lượt đang GIỮ CHỖ mới mở giao dịch — đã xác nhận, đã huỷ, hết hạn, xong đều từ chối", async () => {
    // Lỗi thật trước đây: lượt CONFIRMED vẫn mở được giao dịch PENDING mới —
    // mời khách trả lần hai cho lượt đã trả.
    for (const status of ["CONFIRMED", "CANCELLED", "EXPIRED", "COMPLETED"]) {
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
    const after = new Date(HOLD_EXPIRES.getTime() + 1_000);

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "BANK_TRANSFER", now: after }),
    ).rejects.toBeInstanceOf(BookingStateError);
    expect(mock.payment.findFirst).not.toHaveBeenCalled();
    expect(mock.payment.create).not.toHaveBeenCalled();
  });

  it("lượt đặt 0đ không mở giao dịch — câu dùng được thay vì lỗi CHECK của database", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", total: 0 } });

    await expect(
      new PaymentService(db).start({ bookingId: "b1", provider: "BANK_TRANSFER", now: NOW }),
    ).rejects.toThrow(/chưa có giá/);
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
   * Lỗi thật trước đây: chỉ xoá hạn của GIAO DỊCH. Chủ sân đối chiếu chậm hơn
   * hạn giữ chỗ là cron nhả chỗ của một khách đã trả tiền.
   */
  it("đang chờ người duyệt thì KHÔNG tự hết hạn — cả giao dịch lẫn LƯỢT ĐẶT, lượt đặt khoá trước", async () => {
    const { db, mock } = createDb();
    await new PaymentService(db).declareTransfer({ paymentIds: ["p1"], now: NOW });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.payment.updateMany.mock.calls[0]![0].data.expiresAt).toBeNull();
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, status: "HOLDING" },
      data: { holdExpiresAt: null },
    });
    expect(mock.booking.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.payment.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("khai cho CẢ lần đặt nhiều lượt trong một transaction", async () => {
    const { db, mock } = createDb({
      payments: [
        { id: "p1", bookingId: "b1" },
        { id: "p2", bookingId: "b2" },
      ],
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

  it("giao dịch vừa bị cron huỷ đúng lúc khai → từ chối cả lần khai, không khai một nửa", async () => {
    const { db } = createDb({
      payments: [
        { id: "p1", bookingId: "b1" },
        { id: "p2", bookingId: "b2" },
      ],
      paymentUpdateCount: 1,
    });

    await expect(
      new PaymentService(db).declareTransfer({ paymentIds: ["p1", "p2"], now: NOW }),
    ).rejects.toBeInstanceOf(PaymentStateError);
  });

  /**
   * Giao dịch của cổng tự động mà thành AWAITING_CONFIRMATION thì kẹt: cổng
   * không báo về nữa, còn chủ sân không được duyệt tay.
   */
  it("CHỈ khai được cho giao dịch chuyển khoản ngân hàng", async () => {
    for (const provider of ["VNPAY", "MOMO", "CASH"]) {
      const { db, mock } = createDb({ payment: { id: "p1", provider } });
      await expect(
        new PaymentService(db).declareTransfer({ paymentIds: ["p1"], now: NOW }),
      ).rejects.toBeInstanceOf(PaymentStateError);
      expect(mock.$transaction).not.toHaveBeenCalled();
    }
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
  const APPROVE = { paymentIds: ["p1"], venueId: "v1", reviewerId: "u9", now: NOW };

  it("xác nhận lượt đặt VÀ tiền trong cùng một transaction — lượt đặt khoá trước", async () => {
    // Tiền đã nhận mà lượt đặt vẫn treo "chờ thanh toán" thì cron sẽ nhả chỗ
    // của một khách đã trả tiền.
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).approveManual(APPROVE);

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
    // Cùng thứ tự khoá với huỷ lượt đặt — hai bên không chờ nhau thành vòng.
    expect(mock.booking.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.payment.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("MỘT lần bấm xác nhận cả lần chuyển khoản trả cho nhiều lượt", async () => {
    const { db, mock } = createDb({
      payments: [
        { id: "p1", bookingId: "b1", status: "AWAITING_CONFIRMATION" },
        { id: "p2", bookingId: "b2", status: "AWAITING_CONFIRMATION" },
      ],
    });
    await new PaymentService(db).approveManual({ ...APPROVE, paymentIds: ["p1", "p2"] });

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
      new PaymentService(db).approveManual({ ...APPROVE, venueId: "san-khac" }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  /**
   * Lỗi thật trước đây: lượt đã huỷ hay hết hạn vẫn duyệt được — tiền SUCCEEDED
   * mà không có sân, không ai được nhắc phải hoàn.
   */
  it("lượt đặt đã huỷ hoặc hết hạn → từ chối kèm câu chỉ việc phải làm, không ghi gì", async () => {
    for (const status of ["CANCELLED", "EXPIRED"]) {
      const { db, mock } = createDb({
        payments: [{ id: "p1", status: "AWAITING_CONFIRMATION", booking: { status } }],
      });

      await expect(new PaymentService(db).approveManual(APPROVE)).rejects.toThrow(
        new BookingStateError(
          "Lượt đặt đã huỷ hoặc hết hạn nên không xác nhận được. Hãy từ chối khoản chuyển và hoàn tiền cho khách nếu đã nhận.",
        ),
      );
      expect(mock.$transaction).not.toHaveBeenCalled();
    }
  });

  it("khách huỷ đúng lúc chủ sân bấm duyệt (xác nhận có điều kiện khớp thiếu) → từ chối, không đụng tiền", async () => {
    const { db, mock } = createDb({
      payment: { id: "p1", status: "AWAITING_CONFIRMATION" },
      bookingUpdateCount: 0,
    });

    await expect(new PaymentService(db).approveManual(APPROVE)).rejects.toThrow(
      /không xác nhận được/,
    );
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
  });

  it("giao dịch vừa đổi trạng thái giữa lúc đọc và lúc ghi → từ chối, transaction cuộn lại", async () => {
    const { db } = createDb({
      payment: { id: "p1", status: "AWAITING_CONFIRMATION" },
      paymentUpdateCount: 0,
    });

    await expect(new PaymentService(db).approveManual(APPROVE)).rejects.toBeInstanceOf(
      PaymentStateError,
    );
  });

  it("duyệt được cả khi khách chưa kịp khai — chủ sân thấy tiền về là đủ", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "PENDING" } });
    await new PaymentService(db).approveManual(APPROVE);

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
      await expect(new PaymentService(db).approveManual(APPROVE)).rejects.toBeInstanceOf(
        ManualApprovalNotAllowedError,
      );
      expect(mock.payment.updateMany).not.toHaveBeenCalled();
    }
  });

  it("hàng chờ duyệt chuyển khoản chỉ nhận giao dịch chuyển khoản — tiền mặt không duyệt ở đây", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", provider: "CASH", status: "PENDING" } });

    await expect(new PaymentService(db).approveManual(APPROVE)).rejects.toBeInstanceOf(
      PaymentStateError,
    );
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("duyệt hai lần không thu hai lần", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });
    await new PaymentService(db).approveManual(APPROVE);

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("không duyệt được giao dịch đã huỷ hay đã thất bại", async () => {
    for (const status of ["CANCELLED", "FAILED", "REFUNDED"]) {
      const { db } = createDb({ payment: { id: "p1", status } });
      await expect(new PaymentService(db).approveManual(APPROVE)).rejects.toBeInstanceOf(
        PaymentStateError,
      );
    }
  });

  it("không tìm thấy giao dịch thì báo NOT_FOUND", async () => {
    const { db } = createDb({ payment: null });
    await expect(new PaymentService(db).approveManual(APPROVE)).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it("danh sách rỗng thì báo NOT_FOUND, không duyệt 'tất cả'", async () => {
    const { db, mock } = createDb();
    await expect(
      new PaymentService(db).approveManual({ ...APPROVE, paymentIds: [] }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mock.payment.findMany).not.toHaveBeenCalled();
  });
});

describe("rejectManual — chủ sân không thấy tiền về", () => {
  const REJECT = {
    paymentIds: ["p1"],
    venueId: "v1",
    reviewerId: "u9",
    reason: "Không thấy tiền về",
    now: NOW,
  };

  it("đánh dấu thất bại kèm lý do, lượt đặt vẫn HOLDING và được cấp HẠN GIỮ MỚI", async () => {
    // Lúc khách khai, hạn giữ chỗ đã bị xoá. Không cấp lại hạn là chỗ bị giữ
    // vĩnh viễn; cấp lại để khách kịp đọc lý do, sửa và báo lại.
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });
    await new PaymentService(db).rejectManual(REJECT);

    expect(mock.payment.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: "FAILED",
      rejectReason: "Không thấy tiền về",
      reviewedBy: "u9",
    });
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1"] }, status: "HOLDING", holdExpiresAt: null },
      data: { holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000) },
    });
    expect(mock.booking.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.payment.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("giao dịch của SÂN KHÁC thì coi như không tồn tại", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "AWAITING_CONFIRMATION" } });

    await expect(
      new PaymentService(db).rejectManual({ ...REJECT, venueId: "san-khac" }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("CHỈ từ chối được giao dịch chuyển khoản ngân hàng", async () => {
    for (const provider of ["VNPAY", "CASH"]) {
      const { db, mock } = createDb({
        payment: { id: "p1", provider, status: "AWAITING_CONFIRMATION" },
      });
      await expect(new PaymentService(db).rejectManual(REJECT)).rejects.toBeInstanceOf(
        PaymentStateError,
      );
      expect(mock.$transaction).not.toHaveBeenCalled();
    }
  });

  it("giao dịch vừa được duyệt đúng lúc bấm từ chối → dừng, transaction cuộn lại", async () => {
    const { db } = createDb({
      payment: { id: "p1", status: "AWAITING_CONFIRMATION" },
      paymentUpdateCount: 0,
    });

    await expect(new PaymentService(db).rejectManual(REJECT)).rejects.toBeInstanceOf(
      PaymentStateError,
    );
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

  it("thành công thì ghi sự kiện, xác nhận lượt đặt và tiền trong MỘT transaction", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", provider: "VNPAY" } });
    const result = await new PaymentService(db).handleWebhook({
      ...base,
      succeeded: true,
      providerTxnId: "vnp-999",
    });

    expect(result).toEqual({ handled: true });
    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.payment.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: { in: ["PENDING", "AWAITING_CONFIRMATION"] } },
      data: expect.objectContaining({ status: "SUCCEEDED", providerTxnId: "vnp-999" }) as unknown,
    });
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", status: "HOLDING" },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
    expect(mock.refund.create).not.toHaveBeenCalled();
  });

  /**
   * Cổng nào cũng gửi lại khi không nhận được 200. Không có chốt này thì gửi
   * lại lần hai là xác nhận lần hai.
   */
  it("gửi lại cùng một sự kiện thì KHÔNG xử lý lần nữa, và không ném lỗi", async () => {
    const { db, mock } = createDb({ createEventError: duplicateEvent() });
    const result = await new PaymentService(db).handleWebhook({ ...base, succeeded: true });

    expect(result).toEqual({ handled: false, reason: "Sự kiện đã xử lý rồi" });
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
    expect(mock.booking.updateMany).not.toHaveBeenCalled();
  });

  it("ghi sự kiện TRƯỚC khi đụng vào tiền", async () => {
    // Ngược lại thì có một khe: xác nhận xong, ghi sự kiện hỏng, cổng gửi lại,
    // xác nhận lần nữa.
    const { db, mock } = createDb();
    await new PaymentService(db).handleWebhook({ ...base, succeeded: true });

    const eventOrder = mock.paymentEvent.create.mock.invocationCallOrder[0]!;
    expect(eventOrder).toBeLessThan(mock.booking.updateMany.mock.invocationCallOrder[0]!);
    expect(eventOrder).toBeLessThan(mock.payment.updateMany.mock.invocationCallOrder[0]!);
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
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Lệch tiền nghĩa là hoặc mã đối soát bị dùng lại, hoặc có người sửa số tiền
   * giữa đường. Cả hai đều phải có người xem, không được tự xác nhận.
   *
   * Lỗi thật trước đây: ghi sự kiện rồi mới NÉM lỗi — cổng gửi lại bị coi là
   * trùng, và chuyện lệch tiền chỉ lộ ra đúng một lần trong log.
   */
  it("số tiền lệch: ghi sự kiện VÀ đánh dấu giao dịch FAILED trong cùng transaction, không ném lỗi", async () => {
    const { db, mock } = createDb();

    const result = await new PaymentService(db).handleWebhook({
      ...base,
      succeeded: true,
      amount: 1_000,
    });

    expect(result).toEqual({
      handled: false,
      reason: "Số tiền không khớp: giao dịch 360000đ, cổng báo 1000đ",
      amountMismatch: { expected: 360_000, received: 1_000 },
    });
    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.paymentEvent.create).toHaveBeenCalledTimes(1);
    expect(mock.payment.updateMany.mock.calls[0]![0].data).toMatchObject({
      status: "FAILED",
      failReason: "Số tiền không khớp: giao dịch 360000đ, cổng báo 1000đ",
    });
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
    expect(mock.payment.updateMany.mock.calls[0]![0].data).toMatchObject({
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

  /**
   * Lỗi thật trước đây: tiền về cho lượt đã huỷ/hết hạn vẫn đặt SUCCEEDED im
   * lặng — không xác nhận lượt thì đúng, nhưng không ai được nhắc phải hoàn.
   */
  it("tiền về khi lượt đặt KHÔNG còn giữ chỗ: ghi tiền, KHÔNG xác nhận lượt, tạo yêu cầu hoàn PENDING, báo lỗi vào log", async () => {
    const { db, mock } = createDb({ bookingUpdateCount: 0 });
    mock.booking.findUnique.mockResolvedValueOnce({ status: "CANCELLED" });

    const result = await new PaymentService(db).handleWebhook({ ...base, succeeded: true });

    expect(mock.payment.updateMany.mock.calls[0]![0].data).toMatchObject({ status: "SUCCEEDED" });
    expect(mock.refund.create.mock.calls[0]![0].data).toMatchObject({
      paymentId: "p1",
      amount: 360_000,
      status: "PENDING",
      requestedBy: null,
    });
    expect(String(mock.refund.create.mock.calls[0]![0].data.reason)).toContain("bị huỷ");
    expect(result).toMatchObject({ handled: true, refundId: "r-moi" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("giao dịch vừa đổi trạng thái giữa chừng → ném để cuộn lại CẢ sự kiện, lần gửi lại sẽ xử lý", async () => {
    const { db, mock } = createDb({ paymentUpdateCount: 0 });

    await expect(
      new PaymentService(db).handleWebhook({ ...base, succeeded: true }),
    ).rejects.toBeInstanceOf(PaymentStateError);
    expect(mock.refund.create).not.toHaveBeenCalled();
  });
});

describe("expirePending — cron huỷ giao dịch quá hạn", () => {
  it("chỉ đụng PENDING, KHÔNG đụng giao dịch đang chờ người duyệt", async () => {
    // Tự huỷ một khoản khách đã chuyển thật là mất tiền của khách.
    const { db, mock } = createDb();
    mock.payment.updateMany.mockResolvedValueOnce({ count: 2 });
    const count = await new PaymentService(db).expirePending({ now: NOW });

    expect(count).toBe(2);
    expect(mock.payment.updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING", expiresAt: { lte: NOW } },
      data: { status: "CANCELLED", expiresAt: null },
    });
  });
});

describe("requestRefund — đề nghị hoàn tiền", () => {
  const REQUEST = { paymentId: "p1", amount: 200_000, reason: "Khách huỷ sớm", requestedBy: "u9" };

  it("chỉ tạo bản ghi PENDING, không tự đánh dấu đã hoàn", async () => {
    // Đánh dấu đã hoàn ngay là sổ sách nói tiền đã ra trong khi tiền còn nguyên.
    const { db, mock } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });
    await new PaymentService(db).requestRefund(REQUEST);

    expect(mock.refund.create.mock.calls[0]![0].data).toMatchObject({
      status: "PENDING",
      amount: 200_000,
      requestedBy: "u9",
    });
    expect(mock.payment.update).not.toHaveBeenCalled();
  });

  it("khoá dòng giao dịch TRƯỚC khi đọc — hai yêu cầu đồng thời xếp hàng và thấy nhau", async () => {
    const { db, mock } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });
    await new PaymentService(db).requestRefund(REQUEST);

    const [strings] = mock.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(mock.$queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.payment.findUnique.mock.invocationCallOrder[0]!,
    );
  });

  /**
   * Lỗi thật trước đây: không trừ khoản hoàn đang PENDING — hai yêu cầu liên
   * tiếp đều thấy "còn nguyên", tổng yêu cầu vượt số tiền đã nhận.
   */
  it("trừ cả khoản hoàn đang CHỜ, không chỉ khoản đã xong", async () => {
    const { db, mock } = createDb({
      payment: { id: "p1", status: "SUCCEEDED" },
      pendingRefundSum: 300_000,
    });

    const error = await new PaymentService(db)
      .requestRefund({ ...REQUEST, amount: 100_000 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RefundAmountError);
    expect((error as RefundAmountError).remaining).toBe(60_000);
    expect(mock.refund.create).not.toHaveBeenCalled();
  });

  it("trừ khoản đã hoàn xong (refundedAmount) — không hoàn quá số tiền còn lại", async () => {
    const { db } = createDb({
      payment: { id: "p1", status: "PARTIALLY_REFUNDED", refundedAmount: 300_000 },
    });

    await expect(
      new PaymentService(db).requestRefund({ ...REQUEST, amount: 100_000 }),
    ).rejects.toBeInstanceOf(RefundAmountError);
  });

  it("không hoàn số âm, số 0 hay số lẻ", async () => {
    const { db } = createDb({ payment: { id: "p1", status: "SUCCEEDED" } });

    for (const amount of [0, -1000, 1000.5]) {
      await expect(
        new PaymentService(db).requestRefund({ ...REQUEST, amount }),
      ).rejects.toBeInstanceOf(RefundAmountError);
    }
  });

  it("không hoàn tiền giao dịch chưa thành công", async () => {
    for (const status of ["PENDING", "FAILED", "CANCELLED"]) {
      const { db } = createDb({ payment: { id: "p1", status } });
      await expect(
        new PaymentService(db).requestRefund({ ...REQUEST, amount: 1_000 }),
      ).rejects.toBeInstanceOf(PaymentStateError);
    }
  });

  it("không có giao dịch thì NOT_FOUND", async () => {
    const { db } = createDb({ payment: null });
    await expect(new PaymentService(db).requestRefund(REQUEST)).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });
});

describe("settleRefund — tiền đã thật sự ra", () => {
  it("đánh dấu CÓ ĐIỀU KIỆN (chỉ khi còn PENDING) và cộng tiền bằng `increment` trong transaction", async () => {
    const { db, mock } = createDb();
    mock.payment.update.mockResolvedValueOnce({
      amount: 360_000,
      refundedAmount: 360_000,
    } as never);

    await new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9", now: NOW });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.refund.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", status: "PENDING" },
      data: { status: "SUCCEEDED", approvedBy: "u9", refundedAt: NOW },
    });
    expect(mock.payment.update.mock.calls[0]![0].data).toEqual({
      refundedAmount: { increment: 360_000 },
    });
  });

  it("hoàn hết thì giao dịch thành REFUNDED", async () => {
    const { db, mock } = createDb();
    mock.payment.update.mockResolvedValueOnce({
      amount: 360_000,
      refundedAmount: 360_000,
    } as never);

    await new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9", now: NOW });

    expect(mock.payment.update.mock.calls[1]![0].data).toEqual({ status: "REFUNDED" });
  });

  it("hoàn một phần thì thành PARTIALLY_REFUNDED — tính từ số ĐÃ cộng dồn trong database", async () => {
    // Cộng dồn sai là đối soát cuối tháng không bao giờ khớp.
    const { db, mock } = createDb({
      refund: { id: "r1", status: "PENDING", amount: 100_000, paymentId: "p1" },
    });
    mock.payment.update.mockResolvedValueOnce({
      amount: 360_000,
      refundedAmount: 160_000,
    } as never);

    await new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9" });

    expect(mock.payment.update.mock.calls[0]![0].data).toEqual({
      refundedAmount: { increment: 100_000 },
    });
    expect(mock.payment.update.mock.calls[1]![0].data).toEqual({ status: "PARTIALLY_REFUNDED" });
  });

  /**
   * Lỗi thật trước đây: đọc khoản hoàn NGOÀI transaction — hai lần bấm "đã
   * hoàn" gần như cùng lúc đều thấy PENDING và cộng tiền hai lần.
   */
  it("đánh dấu hai lần không cộng tiền hai lần", async () => {
    const { db, mock } = createDb();
    const service = new PaymentService(db);
    mock.payment.update.mockResolvedValueOnce({
      amount: 360_000,
      refundedAmount: 360_000,
    } as never);

    await service.settleRefund({ refundId: "r1", approvedBy: "u9" });
    const again = await service.settleRefund({ refundId: "r1", approvedBy: "u9" });

    expect(again.status).toBe("SUCCEEDED");
    expect(mock.payment.update).toHaveBeenCalledTimes(2); // chỉ của lần đầu
  });

  it("khoản hoàn đã thất bại thì không đánh dấu xong được", async () => {
    const { db, mock } = createDb({
      refund: { id: "r1", status: "FAILED", amount: 100_000, paymentId: "p1" },
    });

    await expect(
      new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9" }),
    ).rejects.toBeInstanceOf(PaymentStateError);
    expect(mock.payment.update).not.toHaveBeenCalled();
  });

  it("không có khoản hoàn thì NOT_FOUND", async () => {
    const { db } = createDb({ refund: null });

    await expect(
      new PaymentService(db).settleRefund({ refundId: "r1", approvedBy: "u9" }),
    ).rejects.toBeInstanceOf(PaymentNotFoundError);
  });
});
