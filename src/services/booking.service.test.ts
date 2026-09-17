import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  BookingNotFoundError,
  BookingStateError,
  BookingValidationError,
  SlotTakenError,
  SlotUnavailableError,
  VenueNotBookableError,
} from "@/lib/errors";
import type { AvailabilityService, RangeQuote } from "./availability.service";
import { BookingService, DEFAULT_HOLD_MINUTES } from "./booking.service";

/**
 * Đây là chỗ tiền đi qua. Ba loại lỗi ở tầng này đều đắt như nhau:
 * bán trùng một khung cho hai người, giữ chỗ vĩnh viễn không nhả, và cho đổi
 * trạng thái tuỳ tiện (nhận sân khi chưa trả tiền, huỷ lượt đã đá xong).
 *
 * Ngày dùng xuyên suốt: 2026-09-04 (thứ Sáu), giờ Việt Nam.
 */

const VN_MIDNIGHT = new Date("2026-09-03T17:00:00Z"); // 00:00 ngày 04/09 giờ VN
const DATE = new Date("2026-09-04T05:00:00Z"); // 12:00 giờ VN
const NOW = new Date("2026-09-04T03:00:00Z"); // 10:00 giờ VN

function at(minute: number): Date {
  return new Date(VN_MIDNIGHT.getTime() + minute * 60_000);
}

/**
 * Lỗi trùng ràng buộc duy nhất ĐÚNG hình dạng Prisma 7 + adapter-pg — chép theo
 * `src/lib/prisma-errors.test.ts`: tên cột nằm trong
 * `meta.driverAdapterError.cause`, KHÔNG có `meta.target`. Mock theo hình dạng
 * cũ là test xanh trong khi nhánh bắt lỗi thật không bao giờ chạy (GOTCHAS #10).
 */
function uniqueViolation(field: string, constraint: string): Error {
  return Object.assign(
    new Error(
      `\nInvalid \`tx.booking.create()\` invocation:\n\nUnique constraint failed on the fields: (\`${field}\`)`,
    ),
    {
      code: "P2002",
      meta: {
        modelName: "Booking",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage: `duplicate key value violates unique constraint "${constraint}"`,
            kind: "UniqueConstraintViolation",
            constraint: { fields: [field] },
          },
        },
      },
    },
  );
}

/**
 * Lỗi Postgres 23P01 — ràng buộc `EXCLUDE USING gist` bắn ra khi hai người cùng
 * lấy một khung. Prisma không ánh xạ mã này thành P2xxx nào: không có `code`,
 * chỉ có `meta.driverAdapterError.cause.originalCode`.
 */
function exclusionViolation(): Error {
  return Object.assign(
    new Error(
      'conflicting key value violates exclusion constraint "bookings_khong_trung_khung_gio"',
    ),
    {
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "23P01",
            originalMessage:
              'conflicting key value violates exclusion constraint "bookings_khong_trung_khung_gio"',
          },
        },
      },
    },
  );
}

const codeCollision = () => uniqueViolation("code", "bookings_code_key");

const BOOKING = {
  id: "b1",
  code: "8F3K2M",
  venueId: "v1",
  courtId: "c1",
  userId: null as string | null,
  customerName: "Nguyễn Văn A",
  customerPhone: "0900000000",
  startAt: at(19 * 60),
  endAt: at(21 * 60),
  slotCount: 4,
  status: "HOLDING",
  source: "WEB",
  subtotal: 360_000,
  discountTotal: 0,
  total: 360_000,
  holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000) as Date | null,
};

type PaymentRow = {
  id: string;
  bookingId: string;
  status: string;
  amount: number;
  refundedAmount: number;
};

type Options = {
  booking?: (Partial<typeof BOOKING> & { id: string }) | null;
  venue?: {
    status?: string;
    holdMinutes?: number | null;
    freeCancelHours?: number | null;
    cancelFeePercent?: number | null;
  } | null;
  /** Lỗi mà `booking.create` sẽ ném ra, theo thứ tự từng lần gọi. */
  createErrors?: (Error | null)[];
  updateError?: Error | null;
  list?: unknown[];
  payments?: PaymentRow[];
  closure?: { courtId: string; startAt: Date; endAt: Date } | null;
  /** Các sân con mà câu khoá tìm thấy (còn bật, đúng cơ sở). Mặc định: đủ mọi sân được hỏi. */
  lockedCourts?: string[];
};

type BookingWhere = {
  id?: string;
  venueId?: string;
  status?: string | { in: string[] };
  [key: string]: unknown;
};

function statusMatches(status: string, filter: BookingWhere["status"]): boolean {
  if (filter === undefined) return true;
  return typeof filter === "string" ? status === filter : filter.in.includes(status);
}

function createDb(options: Options = {}) {
  const created: Record<string, unknown>[] = [];
  let createCall = 0;

  const stored =
    "booking" in options ? options.booking && { ...BOOKING, ...options.booking } : BOOKING;
  const payments = options.payments ?? [];

  const db = {
    venue: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          "venue" in options
            ? options.venue && { status: "ACTIVE", holdMinutes: 10, ...options.venue }
            : { status: "ACTIVE", holdMinutes: 10 },
        ),
      findUnique: vi
        .fn()
        .mockResolvedValue(
          "venue" in options ? options.venue : { freeCancelHours: null, cancelFeePercent: null },
        ),
    },
    booking: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const error = options.createErrors?.[createCall];
        createCall += 1;
        if (error) return Promise.reject(error);
        created.push(data);
        return Promise.resolve({ ...BOOKING, ...data, id: `b${createCall}` });
      }),
      // Lọc THẬT theo `id` + `venueId`: bài "lượt của sân khác" chỉ có nghĩa khi
      // điều kiện sân nằm trong câu truy vấn và mock tôn trọng nó.
      findFirst: vi.fn(({ where }: { where: BookingWhere }) =>
        Promise.resolve(
          stored &&
            stored.id === where.id &&
            (where.venueId === undefined || stored.venueId === where.venueId)
            ? stored
            : null,
        ),
      ),
      findUnique: vi.fn().mockResolvedValue(stored),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (options.updateError) return Promise.reject(options.updateError);
        return Promise.resolve({ ...stored, ...data, id: where.id });
      }),
      // Có `id` = cập nhật CÓ ĐIỀU KIỆN một lượt: đếm theo trạng thái thật của
      // lượt đó. Không có `id` = cập nhật hàng loạt (nhả chỗ quá hạn, cron).
      updateMany: vi.fn(({ where }: { where: BookingWhere; data: Record<string, unknown> }) => {
        if (where.id === undefined) return Promise.resolve({ count: 3 });
        const hit =
          stored &&
          stored.id === where.id &&
          (where.venueId === undefined || stored.venueId === where.venueId) &&
          statusMatches(stored.status, where.status);
        return Promise.resolve({ count: hit ? 1 : 0 });
      }),
      findMany: vi.fn((_args: { where: Record<string, unknown>; select?: unknown }) =>
        Promise.resolve(options.list ?? []),
      ),
    },
    payment: {
      findMany: vi.fn(({ where }: { where: { bookingId: string } }) =>
        Promise.resolve(payments.filter((payment) => payment.bookingId === where.bookingId)),
      ),
      count: vi.fn(({ where }: { where: { bookingId: string; status: { in: string[] } } }) =>
        Promise.resolve(
          payments.filter(
            (payment) =>
              payment.bookingId === where.bookingId && where.status.in.includes(payment.status),
          ).length,
        ),
      ),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
      ),
    },
    courtClosure: {
      findFirst: vi.fn().mockResolvedValue(options.closure ?? null),
    },
    // Câu khoá sân con trả lại đúng các sân được hỏi — trừ khi test giả lập
    // sân con vừa bị tắt (`lockedCourts`).
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
      const ids = (values[0] as { values?: string[] } | undefined)?.values ?? [];
      const locked = options.lockedCourts ?? ids;
      return Promise.resolve(locked.map((id) => ({ id })));
    }),
    // `tx` chính là db mock, nên mọi lời gọi trong transaction vẫn đếm được.
    $transaction: vi.fn((fn: (tx: unknown) => unknown, _options?: unknown) =>
      Promise.resolve(fn(db)),
    ),
  };

  return { db: db as unknown as PrismaClient, mock: db, created };
}

function createAvailability(
  quote: { slotCount: number; total: number; slots: unknown[] } | null = {
    slotCount: 4,
    total: 360_000,
    slots: [],
  },
) {
  return {
    quote: vi.fn().mockResolvedValue(quote),
    // `holdCheckout` báo giá mọi dãy bằng MỘT lần đọc lịch. Mặc định mỗi dãy
    // nhận cùng báo giá `quote`; tên sân theo thứ tự "Sân 1", "Sân 2"…
    quoteMany: vi.fn(
      ({ ranges }: { ranges: { courtId: string; startMinute: number; endMinute: number }[] }) =>
        Promise.resolve(
          ranges.map((range, index): RangeQuote => ({
            ...range,
            courtName: `Sân ${index + 1}`,
            available: quote !== null,
            reason: quote === null ? "TAKEN" : null,
            slotCount: quote?.slotCount ?? 0,
            total: quote?.total ?? 0,
          })),
        ),
    ),
  } as unknown as AvailabilityService;
}

function holdInput(overrides: Record<string, unknown> = {}) {
  return {
    venueId: "v1",
    courtId: "c1",
    date: DATE,
    startMinute: 19 * 60,
    endMinute: 21 * 60,
    customerName: "  Nguyễn Văn A  ",
    customerPhone: " 0900000000 ",
    now: NOW,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("hold — giữ chỗ", () => {
  it("tạo lượt đặt HOLDING với giá lấy từ báo giá, không tự tính lại", async () => {
    // Tính giá ở hai nơi là có ngày hai nơi lệch nhau, và khách trả theo nơi sai.
    const { db, created } = createDb();
    const booking = await new BookingService(db, createAvailability()).hold(holdInput());

    expect(created[0]).toMatchObject({
      venueId: "v1",
      courtId: "c1",
      status: "HOLDING",
      slotCount: 4,
      subtotal: 360_000,
      total: 360_000,
      source: "WEB",
    });
    expect(booking.status).toBe("HOLDING");
  });

  it("cắt khoảng trắng thừa của tên, số điện thoại và ghi chú", async () => {
    // Số có khoảng trắng ở đầu là số không tra cứu được lúc khách gọi tới hỏi.
    const { db, created } = createDb();
    await new BookingService(db, createAvailability()).hold(
      holdInput({ customerNote: "  Cho mượn vợt  " }),
    );

    expect(created[0]!.customerName).toBe("Nguyễn Văn A");
    expect(created[0]!.customerPhone).toBe("0900000000");
    expect(created[0]!.customerNote).toBe("Cho mượn vợt");
  });

  it("ghi chú toàn khoảng trắng thì để trống, không lưu chuỗi rỗng", async () => {
    const { db, created } = createDb();
    await new BookingService(db, createAvailability()).hold(holdInput({ customerNote: "   " }));

    expect(created[0]!.customerNote).toBeNull();
  });

  it("quy khung giờ ra mốc tuyệt đối theo giờ VN, không theo giờ máy chủ", async () => {
    const { db, created } = createDb();
    await new BookingService(db, createAvailability()).hold(holdInput());

    expect((created[0]!.startAt as Date).toISOString()).toBe("2026-09-04T12:00:00.000Z"); // 19:00 VN
    expect((created[0]!.endAt as Date).toISOString()).toBe("2026-09-04T14:00:00.000Z"); // 21:00 VN
  });

  it("hạn giữ chỗ lấy theo cấu hình của sân", async () => {
    const { db, created } = createDb({ venue: { holdMinutes: 30 } });
    await new BookingService(db, createAvailability()).hold(holdInput());

    expect((created[0]!.holdExpiresAt as Date).getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  it("sân chưa khai thì giữ theo mặc định, không giữ vô thời hạn", async () => {
    // Không có hạn thì một người mở trang thanh toán rồi bỏ đi sẽ khoá khung
    // giờ đẹp nhất mãi mãi.
    const { db, created } = createDb({ venue: { holdMinutes: null } });
    await new BookingService(db, createAvailability()).hold(holdInput());

    expect((created[0]!.holdExpiresAt as Date).getTime()).toBe(
      NOW.getTime() + DEFAULT_HOLD_MINUTES * 60_000,
    );
  });

  it("mã đặt sân 6 ký tự, không chứa 0/O/1/I/L — đọc qua điện thoại là lẫn", async () => {
    const { db, created } = createDb();
    const service = new BookingService(db, createAvailability());

    for (let index = 0; index < 30; index += 1) await service.hold(holdInput());

    for (const data of created) {
      expect(data.code).toMatch(/^[23456789ACDEFGHJKMNPQRTUVWXY]{6}$/);
    }
  });

  it("báo giá không đặt được thì từ chối — khung đã có người hoặc ngoài giờ mở cửa", async () => {
    const { db, mock } = createDb();
    const service = new BookingService(db, createAvailability(null));

    await expect(service.hold(holdInput())).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(mock.booking.create).not.toHaveBeenCalled();
  });

  /**
   * Ca quan trọng nhất của cả tệp: hai người bấm đặt cùng một khung trong cùng
   * một giây. Cả hai đều thấy "còn trống" ở bước kiểm — chỉ ràng buộc EXCLUDE
   * trong database mới quyết được ai thắng.
   */
  it("dịch lỗi 23P01 thành SlotTakenError chứ không để lỗi thô bung ra", async () => {
    const { db } = createDb({ createErrors: [exclusionViolation()] });
    const service = new BookingService(db, createAvailability());

    await expect(service.hold(holdInput())).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("KHÔNG thử lại khi trùng khung giờ — thử lại chỉ tốn thêm một lần ghi hụt", async () => {
    const { db, mock } = createDb({
      createErrors: [exclusionViolation(), exclusionViolation(), exclusionViolation()],
    });

    await expect(
      new BookingService(db, createAvailability()).hold(holdInput()),
    ).rejects.toBeInstanceOf(SlotTakenError);
    expect(mock.booking.create).toHaveBeenCalledTimes(1);
  });

  it("thử lại khi trùng MÃ đặt sân, và lần sau phải là mã khác", async () => {
    const { db, mock, created } = createDb({ createErrors: [codeCollision(), null] });
    const booking = await new BookingService(db, createAvailability()).hold(holdInput());

    expect(mock.booking.create).toHaveBeenCalledTimes(2);
    expect(booking.status).toBe("HOLDING");
    // Lần đầu ném lỗi nên không vào `created`; đủ để biết mã lần hai được sinh mới.
    expect(created).toHaveLength(1);
  });

  it("bỏ cuộc sau 3 lần trùng mã thay vì lặp mãi", async () => {
    const { db, mock } = createDb({
      createErrors: [codeCollision(), codeCollision(), codeCollision()],
    });

    await expect(new BookingService(db, createAvailability()).hold(holdInput())).rejects.toThrow(
      /Unique constraint/,
    );
    expect(mock.booking.create).toHaveBeenCalledTimes(3);
  });

  it("trùng ràng buộc duy nhất KHÁC (không phải mã) thì ném lên, không thử lại", async () => {
    const { db, mock } = createDb({
      createErrors: [uniqueViolation("merchant_ref", "payments_merchant_ref_key")],
    });

    await expect(new BookingService(db, createAvailability()).hold(holdInput())).rejects.toThrow(
      /Unique constraint/,
    );
    expect(mock.booking.create).toHaveBeenCalledTimes(1);
  });

  it("lỗi lạ ném lên nguyên vẹn, không nuốt và không thử lại", async () => {
    // Trước đây chỗ này nhận diện bằng `message.includes("code")`, nên một lỗi
    // mất kết nối cũng bị thử lại ba lần rồi mới hỏng.
    const { db, mock } = createDb({ createErrors: [new Error("Can't reach database server")] });

    await expect(new BookingService(db, createAvailability()).hold(holdInput())).rejects.toThrow(
      "Can't reach database server",
    );
    expect(mock.booking.create).toHaveBeenCalledTimes(1);
  });
});

describe("holdCheckout — chỉ cơ sở đang mở bán", () => {
  /**
   * Lỗi thật trước đây: chỉ lọc `deletedAt`, nên request tự chế đặt được cơ sở
   * nháp, tạm nghỉ hay đang bị admin khoá.
   */
  it("cơ sở không ACTIVE thì từ chối với câu nói đúng lý do, không đọc lịch, không ghi gì", async () => {
    for (const status of ["DRAFT", "PENDING", "SUSPENDED", "UNDER_MAINTENANCE", "ADMIN_LOCKED"]) {
      const { db, mock } = createDb({ venue: { status } });
      const availability = createAvailability();

      await expect(new BookingService(db, availability).hold(holdInput())).rejects.toBeInstanceOf(
        VenueNotBookableError,
      );
      expect(availability.quoteMany).not.toHaveBeenCalled();
      expect(mock.$transaction).not.toHaveBeenCalled();
    }
  });

  it("cơ sở đã xoá hoặc không tồn tại cũng vậy", async () => {
    const { db, mock } = createDb({ venue: null });

    await expect(
      new BookingService(db, createAvailability()).hold(holdInput()),
    ).rejects.toBeInstanceOf(VenueNotBookableError);
    expect(mock.venue.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { id: "v1", deletedAt: null },
    });
  });
});

describe("holdCheckout — tự kiểm dữ liệu vào", () => {
  function checkout(ranges: { courtId: string; startMinute: number; endMinute: number }[]) {
    const { courtId: _c, startMinute: _s, endMinute: _e, ...rest } = holdInput();
    return { ...rest, ranges };
  }

  it("phút lệch khung 30 → VALIDATION, không đọc gì từ database", async () => {
    // Action đã chặn bằng zod, nhưng service là cửa vào chung của web, mobile và
    // script — không tự kiểm là 18:15 đi tới báo giá rồi thành "đã có người đặt".
    const { db, mock } = createDb();

    const error = await new BookingService(db, createAvailability())
      .holdCheckout(checkout([{ courtId: "c1", startMinute: 18 * 60 + 15, endMinute: 19 * 60 }]))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BookingValidationError);
    expect((error as BookingValidationError).code).toBe("VALIDATION_ERROR");
    expect((error as Error).message).toContain("tròn 30 phút");
    expect(mock.venue.findFirst).not.toHaveBeenCalled();
  });

  it("giờ kết thúc không sau giờ bắt đầu → VALIDATION", async () => {
    const { db } = createDb();

    await expect(
      new BookingService(db, createAvailability()).holdCheckout(
        checkout([{ courtId: "c1", startMinute: 19 * 60, endMinute: 19 * 60 }]),
      ),
    ).rejects.toThrow(/kết thúc phải sau giờ bắt đầu/);
  });

  it("ra ngoài một ngày (âm, quá 24:00, không phải số nguyên) → VALIDATION", async () => {
    const { db } = createDb();
    const service = new BookingService(db, createAvailability());

    for (const range of [
      { courtId: "c1", startMinute: -30, endMinute: 30 },
      { courtId: "c1", startMinute: 23 * 60 + 30, endMinute: 24 * 60 + 30 },
      { courtId: "c1", startMinute: 1.5, endMinute: 60 },
    ]) {
      await expect(service.holdCheckout(checkout([range]))).rejects.toBeInstanceOf(
        BookingValidationError,
      );
    }
  });

  it("ngày không hợp lệ → VALIDATION, không ném RangeError thô", async () => {
    const { db } = createDb();

    await expect(
      new BookingService(db, createAvailability()).hold(holdInput({ date: new Date("rác") })),
    ).rejects.toBeInstanceOf(BookingValidationError);
  });

  /**
   * Lỗi thật trước đây: hai dãy chồng nhau trên cùng một sân trong CÙNG lần đặt
   * vấp ràng buộc EXCLUDE ở dãy thứ hai, và khách nhận "vừa có người đặt mất" —
   * trong khi người "đặt mất" chính là họ.
   */
  it("hai dãy CHỒNG nhau trên cùng sân trong một lần đặt → VALIDATION với câu đúng", async () => {
    const { db, mock } = createDb();

    const error = await new BookingService(db, createAvailability())
      .holdCheckout(
        checkout([
          { courtId: "c1", startMinute: 18 * 60, endMinute: 19 * 60 },
          { courtId: "c1", startMinute: 18 * 60 + 30, endMinute: 19 * 60 + 30 },
        ]),
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BookingValidationError);
    expect((error as Error).message).toContain("chồng lên nhau");
    expect((error as Error).message).not.toContain("người đặt mất");
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("dãy LIỀN KỀ cùng sân, hoặc cùng giờ khác sân, thì không phải chồng nhau", async () => {
    const { db, mock } = createDb();

    await new BookingService(db, createAvailability()).holdCheckout(
      checkout([
        { courtId: "c1", startMinute: 18 * 60, endMinute: 19 * 60 },
        { courtId: "c1", startMinute: 19 * 60, endMinute: 20 * 60 },
        { courtId: "c2", startMinute: 18 * 60, endMinute: 19 * 60 },
      ]),
    );

    expect(mock.booking.create).toHaveBeenCalledTimes(3);
  });
});

describe("holdCheckout — khung đã qua", () => {
  it("giờ bắt đầu ĐÚNG BẰNG bây giờ là đã qua — từ chối trước khi đọc database", async () => {
    const { db, mock } = createDb();

    const error = await new BookingService(db, createAvailability())
      .hold(holdInput({ startMinute: 10 * 60, endMinute: 11 * 60 }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SlotUnavailableError);
    expect((error as Error).message).toContain("đã qua giờ");
    expect(mock.venue.findFirst).not.toHaveBeenCalled();
  });

  /**
   * Lỗi thật trước đây: ngày khác hôm nay thì không khung nào bị coi là đã qua,
   * nên gửi `date` của hôm qua là đặt được.
   */
  it("NGÀY ĐÃ QUA bị từ chối kể cả giờ muộn trong ngày", async () => {
    const { db, mock } = createDb();
    const yesterday = new Date("2026-09-03T05:00:00Z");

    await expect(
      new BookingService(db, createAvailability()).hold(
        holdInput({ date: yesterday, startMinute: 22 * 60, endMinute: 23 * 60 }),
      ),
    ).rejects.toThrow(/đã qua giờ/);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("một phút sau bây giờ thì vẫn đặt được", async () => {
    const { db, mock } = createDb();

    await new BookingService(db, createAvailability()).hold(
      holdInput({
        now: new Date(at(10 * 60).getTime() - 60_000),
        startMinute: 600,
        endMinute: 660,
      }),
    );

    expect(mock.booking.create).toHaveBeenCalledTimes(1);
  });
});

describe("holdCheckout — báo đúng lý do không đặt được", () => {
  function availabilityWith(reason: RangeQuote["reason"], total = 0) {
    const availability = createAvailability();
    vi.mocked(availability.quoteMany).mockResolvedValueOnce([
      {
        courtId: "c1",
        startMinute: 19 * 60,
        endMinute: 21 * 60,
        courtName: "Sân 7",
        available: reason === null,
        reason,
        slotCount: reason === null ? 4 : 0,
        total,
      },
    ]);
    return availability;
  }

  it("khung chưa có giá: nói CHƯA CÓ GIÁ, không nói đã có người đặt", async () => {
    const { db } = createDb();

    await expect(
      new BookingService(db, availabilityWith("NOT_FOR_SALE")).hold(holdInput()),
    ).rejects.toThrow(/Sân 7 19:00–21:00 chưa có giá/);
  });

  it("đã có người, bảo trì, ngoài giờ: mỗi lý do một câu", async () => {
    const { db } = createDb();

    await expect(
      new BookingService(db, availabilityWith("TAKEN")).hold(holdInput()),
    ).rejects.toThrow(/đã có người đặt/);
    await expect(
      new BookingService(db, availabilityWith("CLOSED")).hold(holdInput()),
    ).rejects.toThrow(/bảo trì/);
    await expect(
      new BookingService(db, availabilityWith("OUTSIDE_HOURS")).hold(holdInput()),
    ).rejects.toThrow(/ngoài giờ mở cửa/);
  });

  /**
   * Lỗi thật trước đây: khung 0đ giữ được, rồi mở giao dịch vi phạm CHECK
   * `amount > 0` và trang thanh toán ra 500.
   */
  it("báo giá 'đặt được' mà tổng 0đ vẫn KHÔNG giữ chỗ", async () => {
    const { db, mock } = createDb();

    await expect(
      new BookingService(db, availabilityWith(null, 0)).hold(holdInput()),
    ).rejects.toThrow(/chưa có giá/);
    expect(mock.$transaction).not.toHaveBeenCalled();
  });
});

describe("holdCheckout — đua với lịch đóng sân", () => {
  const ranges = [
    { courtId: "c2", startMinute: 19 * 60, endMinute: 20 * 60 },
    { courtId: "c1", startMinute: 19 * 60, endMinute: 20 * 60 },
    { courtId: "c2", startMinute: 21 * 60, endMinute: 22 * 60 },
  ];

  function checkoutInput() {
    const { courtId: _c, startMinute: _s, endMinute: _e, ...rest } = holdInput();
    return { ...rest, ranges };
  }

  it("khoá dòng các sân con — MỘT lần, không trùng, theo thứ tự id — TRƯỚC khi kiểm và ghi", async () => {
    // Cùng thứ tự khoá ở mọi lần đặt thì hai lần đặt nhiều sân không bao giờ
    // chờ lẫn nhau thành vòng.
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).holdCheckout(checkoutInput());

    expect(mock.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ids, venueId] = mock.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      { values: unknown[] },
      string,
    ];
    const sql = strings.join("?");
    expect(sql).toContain("FOR UPDATE OF c");
    expect(sql).toContain("ORDER BY c.id");
    // Cùng câu kiểm lại: sân con còn bật, đúng cơ sở, cơ sở còn mở bán.
    expect(sql).toContain("c.is_active = true");
    expect(sql).toContain("v.status = 'ACTIVE'");
    expect(ids.values).toEqual(["c1", "c2"]);
    expect(venueId).toBe("v1");

    const lockOrder = mock.$queryRaw.mock.invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(mock.courtClosure.findFirst.mock.invocationCallOrder[0]!);
    expect(lockOrder).toBeLessThan(mock.booking.create.mock.invocationCallOrder[0]!);
  });

  it("sân con vừa bị tắt (hoặc cơ sở vừa bị khoá) giữa báo giá và transaction → từ chối, KHÔNG tạo lượt nào", async () => {
    const { db, mock } = createDb({ lockedCourts: ["c1"] });

    await expect(
      new BookingService(db, createAvailability()).holdCheckout(checkoutInput()),
    ).rejects.toThrow(/sân con vừa được tắt/);
    expect(mock.courtClosure.findFirst).not.toHaveBeenCalled();
    expect(mock.booking.create).not.toHaveBeenCalled();
  });

  it("kiểm lịch đóng sân cho MỌI dãy ngay trong transaction", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).holdCheckout(checkoutInput());

    const [{ where }] = mock.courtClosure.findFirst.mock.calls[0] as [
      { where: { OR: { courtId: string }[] } },
    ];
    expect(where.OR.map((item) => item.courtId)).toEqual(["c2", "c1", "c2"]);
  });

  it("sân vừa bị đóng bảo trì chồng giờ → SlotUnavailableError, KHÔNG tạo lượt nào", async () => {
    const { db, mock } = createDb({
      closure: { courtId: "c1", startAt: at(18 * 60), endAt: at(22 * 60) },
    });

    await expect(
      new BookingService(db, createAvailability()).holdCheckout(checkoutInput()),
    ).rejects.toThrow(
      new SlotUnavailableError(
        "Sân 2 19:00–20:00 vừa được sân đóng để bảo trì. Chọn giờ khác giúp bạn nhé.",
      ),
    );
    expect(mock.booking.create).not.toHaveBeenCalled();
  });
});

describe("holdCheckout — một lần đặt nhiều lượt", () => {
  const ranges = [
    { courtId: "c1", startMinute: 19 * 60, endMinute: 20 * 60 },
    { courtId: "c2", startMinute: 21 * 60, endMinute: 21 * 60 + 30 },
  ];

  function checkoutInput(overrides: Record<string, unknown> = {}) {
    const { courtId: _c, startMinute: _s, endMinute: _e, ...rest } = holdInput();
    return { ...rest, ranges, ...overrides };
  }

  it("mọi lượt mang chung checkoutCode = mã của lượt đầu", async () => {
    // Để khách chuyển khoản MỘT lần và chủ sân duyệt MỘT lần cho cả nhóm.
    const { db, created } = createDb();
    const bookings = await new BookingService(db, createAvailability()).holdCheckout(
      checkoutInput(),
    );

    expect(bookings).toHaveLength(2);
    expect(created[0]!.checkoutCode).toBe(created[0]!.code);
    expect(created[1]!.checkoutCode).toBe(created[0]!.code);
    expect(created[1]!.code).not.toBe(created[0]!.code);
  });

  it("đặt MỘT lượt thì checkoutCode để trống — không có nhóm nào để nối", async () => {
    const { db, created } = createDb();
    await new BookingService(db, createAvailability()).hold(holdInput());

    expect(created[0]!.checkoutCode).toBeNull();
  });

  it("giữ mọi lượt trong MỘT transaction — tất cả hoặc không gì", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).holdCheckout(checkoutInput());

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.$transaction.mock.calls[0]![1]).toEqual({ maxWait: 10_000, timeout: 20_000 });
    expect(mock.booking.create).toHaveBeenCalledTimes(2);
  });

  it("lượt thứ hai bị cướp mất thì báo ĐÚNG sân + giờ của lượt đó", async () => {
    // Transaction ném ra là Postgres cuộn lại cả lượt đầu — không còn dòng
    // CANCELLED rác nào phải dọn như cách cũ.
    const { db } = createDb({ createErrors: [null, exclusionViolation()] });

    await expect(
      new BookingService(db, createAvailability()).holdCheckout(checkoutInput()),
    ).rejects.toThrow(
      new SlotTakenError("Sân 2 21:00–21:30 vừa có người đặt mất. Chọn giờ khác giúp bạn nhé."),
    );
  });

  it("một dãy không đặt được thì dừng TRƯỚC khi ghi gì, và nêu đúng dãy đó", async () => {
    const { db, mock } = createDb();
    const availability = createAvailability();
    vi.mocked(availability.quoteMany).mockResolvedValueOnce([
      {
        ...ranges[0]!,
        courtName: "Sân 1",
        available: true,
        reason: null,
        slotCount: 2,
        total: 140_000,
      },
      {
        ...ranges[1]!,
        courtName: "Sân 8",
        available: false,
        reason: "TAKEN",
        slotCount: 0,
        total: 0,
      },
    ]);

    const error = await new BookingService(db, availability)
      .holdCheckout(checkoutInput())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SlotUnavailableError);
    expect((error as Error).message).toContain("Sân 8 21:00–21:30");
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("đọc lịch MỘT lần cho mọi dãy, không phải mỗi dãy một lần", async () => {
    const { db } = createDb();
    const availability = createAvailability();
    await new BookingService(db, availability).holdCheckout(checkoutInput());

    expect(availability.quoteMany).toHaveBeenCalledTimes(1);
    expect(availability.quote).not.toHaveBeenCalled();
  });

  it("trùng mã thì cuộn lại rồi thử CẢ transaction với bộ mã mới", async () => {
    // Không thử lại ngay trong transaction được: INSERT hỏng làm Postgres huỷ cả
    // transaction, mọi câu lệnh sau đó đều bị từ chối.
    const { db, mock } = createDb({ createErrors: [null, codeCollision(), null, null] });
    const bookings = await new BookingService(db, createAvailability()).holdCheckout(
      checkoutInput(),
    );

    expect(mock.$transaction).toHaveBeenCalledTimes(2);
    expect(bookings).toHaveLength(2);
  });

  /**
   * Lịch coi chỗ giữ quá hạn là trống, nhưng ràng buộc EXCLUDE ở database vẫn
   * tính nó. Không nhả trước thì khách thấy ô trống, bấm đặt, rồi nhận "vừa có
   * người đặt mất" từ một người đã bỏ đi từ lâu.
   */
  it("nhả chỗ giữ QUÁ HẠN gối lên khung đó TRƯỚC khi tạo lượt mới", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).hold(holdInput());

    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: {
        courtId: "c1",
        status: "HOLDING",
        holdExpiresAt: { lte: NOW },
        startAt: { lt: at(21 * 60) },
        endAt: { gt: at(19 * 60) },
      },
      data: { status: "EXPIRED", holdExpiresAt: null },
    });
    expect(mock.booking.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.booking.create.mock.invocationCallOrder[0]!,
    );
  });

  it("không có dãy nào thì từ chối", async () => {
    const { db } = createDb();
    await expect(
      new BookingService(db, createAvailability()).holdCheckout(checkoutInput({ ranges: [] })),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
  });
});

describe("findCheckout — màn thanh toán của một lần đặt", () => {
  const VENUE = {
    id: "v1",
    slug: "san-a",
    name: "Sân A",
    address: "1 Phố",
    ward: "Phường",
    province: "Hà Nội",
    phone: "0900000000",
  };

  function row(overrides: Record<string, unknown>) {
    return {
      id: "b1",
      code: "DXWQE3",
      status: "HOLDING",
      userId: "u1",
      courtId: "c1",
      startAt: at(19 * 60),
      endAt: at(20 * 60),
      slotCount: 2,
      total: 140_000,
      holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
      customerName: "Nguyễn Văn A",
      customerPhone: "0900000000",
      court: { name: "Sân 1" },
      venue: VENUE,
      payments: [],
      ...overrides,
    };
  }

  it("tra bằng mã lượt CON vẫn ra cả lần đặt, và mã lần đặt là checkoutCode", async () => {
    const { db, mock } = createDb({
      booking: { id: "b2", code: "QPMV9H", checkoutCode: "DXWQE3" } as never,
      list: [
        row({}),
        row({ id: "b2", code: "QPMV9H", courtId: "c2", total: 70_000, court: { name: "Sân 2" } }),
      ],
    });

    const checkout = await new BookingService(db, createAvailability()).findCheckout("qpmv9h", {
      now: NOW,
    });

    expect(mock.booking.findMany.mock.calls[0]![0].where).toEqual({ checkoutCode: "DXWQE3" });
    expect(checkout?.code).toBe("DXWQE3");
    expect(checkout?.bookings).toHaveLength(2);
    expect(checkout?.holdingTotal).toBe(210_000);
  });

  it("trả người đặt, mốc bây giờ và provider của giao dịch — trang cần để kiểm quyền và đếm ngược", async () => {
    const { db, mock } = createDb({ list: [row({})] });
    const checkout = await new BookingService(db, createAvailability()).findCheckout("DXWQE3", {
      now: NOW,
    });

    expect(checkout?.userId).toBe("u1");
    expect(checkout?.now).toBe(NOW);
    const [{ select }] = mock.booking.findMany.mock.calls[0] as unknown as [
      { select: { userId: boolean; payments: { select: { provider: boolean } } } },
    ];
    expect(select.userId).toBe(true);
    expect(select.payments.select.provider).toBe(true);
  });

  it("lượt đứng riêng thì lần đặt chỉ có chính nó", async () => {
    const { db, mock } = createDb({ list: [row({ code: "8F3K2M" })] });
    const checkout = await new BookingService(db, createAvailability()).findCheckout("8F3K2M");

    expect(mock.booking.findMany.mock.calls[0]![0].where).toEqual({ code: "8F3K2M" });
    expect(checkout?.code).toBe("8F3K2M");
  });

  it("tổng cần trả chỉ tính lượt CÒN chờ thanh toán", async () => {
    // Khách tự huỷ một lượt trước khi chuyển tiền thì QR phải ra số đã trừ lượt đó.
    const { db } = createDb({
      list: [row({}), row({ id: "b2", code: "QPMV9H", status: "CANCELLED", total: 70_000 })],
    });
    const checkout = await new BookingService(db, createAvailability()).findCheckout("DXWQE3", {
      now: NOW,
    });

    expect(checkout?.holding).toHaveLength(1);
    expect(checkout?.holdingTotal).toBe(140_000);
  });

  it("hạn của lần đặt là hạn SỚM NHẤT, và biết đã quá hạn hay chưa", async () => {
    const earliest = new Date(NOW.getTime() + 60_000);
    const { db } = createDb({
      list: [
        row({ holdExpiresAt: new Date(NOW.getTime() + 600_000) }),
        row({ id: "b2", holdExpiresAt: earliest }),
      ],
    });
    const service = new BookingService(db, createAvailability());

    const before = await service.findCheckout("DXWQE3", { now: NOW });
    expect(before?.holdExpiresAt).toEqual(earliest);
    expect(before?.holdExpired).toBe(false);

    const after = await service.findCheckout("DXWQE3", { now: new Date(earliest.getTime() + 1) });
    expect(after?.holdExpired).toBe(true);
  });

  it("đã báo chuyển khoản (hạn bị xoá) thì cả lần đặt KHÔNG hết hạn", async () => {
    const { db } = createDb({ list: [row({ holdExpiresAt: null })] });
    const checkout = await new BookingService(db, createAvailability()).findCheckout("DXWQE3", {
      now: new Date(NOW.getTime() + 24 * 3_600_000),
    });

    expect(checkout?.holdExpiresAt).toBeNull();
    expect(checkout?.holdExpired).toBe(false);
  });

  it("không có mã thì null", async () => {
    const { db } = createDb({ booking: null });
    expect(await new BookingService(db, createAvailability()).findCheckout("KHONGCO")).toBeNull();
  });
});

describe("confirm — thanh toán xong", () => {
  it("chuyển sang CONFIRMED và xoá hạn giữ chỗ", async () => {
    // Còn hạn giữ chỗ thì cron sẽ quét nhầm một lượt đã trả tiền.
    const { db, mock } = createDb();
    const booking = await new BookingService(db, createAvailability()).confirm("b1");

    expect(booking.status).toBe("CONFIRMED");
    expect(mock.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
  });

  it("gọi hai lần không hỏng — webhook thanh toán bắn lại là chuyện thường", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", status: "CONFIRMED" } });
    const booking = await new BookingService(db, createAvailability()).confirm("b1");

    expect(booking.status).toBe("CONFIRMED");
    expect(mock.booking.update).not.toHaveBeenCalled();
  });

  it("không xác nhận lượt đã huỷ hay đã hết hạn", async () => {
    for (const status of ["CANCELLED", "EXPIRED"]) {
      const { db } = createDb({ booking: { id: "b1", status } });
      await expect(
        new BookingService(db, createAvailability()).confirm("b1"),
      ).rejects.toBeInstanceOf(BookingStateError);
    }
  });

  it("không tìm thấy thì báo NOT_FOUND", async () => {
    const { db } = createDb({ booking: null });
    await expect(new BookingService(db, createAvailability()).confirm("b1")).rejects.toBeInstanceOf(
      BookingNotFoundError,
    );
  });
});

describe("checkIn — khách tới sân", () => {
  it("CONFIRMED → CHECKED_IN, có ghi mốc giờ", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", status: "CONFIRMED" } });
    await new BookingService(db, createAvailability()).checkIn("b1", { now: NOW });

    expect(mock.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { status: "CHECKED_IN", checkedInAt: NOW },
    });
  });

  it("chưa thanh toán thì báo đúng lý do, không báo chung chung", async () => {
    // Nhân viên trực sân đọc câu này để biết phải thu tiền, không phải để đoán.
    const { db } = createDb({ booking: { id: "b1", status: "HOLDING" } });

    await expect(new BookingService(db, createAvailability()).checkIn("b1")).rejects.toThrow(
      "chưa thanh toán",
    );
  });

  it("nhận sân hai lần không hỏng — nhân viên bấm lại là chuyện thường", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", status: "CHECKED_IN" } });
    await new BookingService(db, createAvailability()).checkIn("b1");

    expect(mock.booking.update).not.toHaveBeenCalled();
  });

  /**
   * Lỗ hổng thật trước đây: quyền được kiểm trên `venueId` của URL, còn id lượt
   * đặt lấy từ form. Nhân viên sân A gửi id lượt đặt của sân B là thao tác được
   * trên sân B.
   */
  it("lượt đặt của SÂN KHÁC thì coi như không tồn tại — điều kiện sân nằm trong truy vấn", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", status: "CONFIRMED" } });

    await expect(
      new BookingService(db, createAvailability()).checkIn("b1", { venueId: "san-khac" }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mock.booking.findFirst.mock.calls[0]![0].where).toEqual({
      id: "b1",
      venueId: "san-khac",
    });
    expect(mock.booking.update).not.toHaveBeenCalled();
  });
});

describe("cancel — huỷ", () => {
  const PAID = (amount = 360_000, extra: Partial<PaymentRow> = {}): PaymentRow => ({
    id: "p1",
    bookingId: "b1",
    status: "SUCCEEDED",
    amount,
    refundedAmount: 0,
    ...extra,
  });

  it("nhân viên sân khác KHÔNG huỷ được lượt của sân này", async () => {
    const { db, mock } = createDb();

    await expect(
      new BookingService(db, createAvailability()).cancel("b1", {
        actor: "VENUE",
        venueId: "san-khac",
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mock.booking.findFirst.mock.calls[0]![0].where).toMatchObject({ venueId: "san-khac" });
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("huỷ bằng cập nhật CÓ ĐIỀU KIỆN trong transaction — chỉ khi lượt vẫn HOLDING/CONFIRMED", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "VENUE",
      venueId: "v1",
      reason: "Khách bận",
      cancelledBy: "u9",
      now: NOW,
    });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", venueId: "v1", status: { in: ["HOLDING", "CONFIRMED"] } },
      data: {
        status: "CANCELLED",
        cancelledAt: NOW,
        cancelReason: "Khách bận",
        cancelledBy: "u9",
        holdExpiresAt: null,
      },
    });
    expect(mock.booking.update).not.toHaveBeenCalled();
  });

  /**
   * Lỗi thật trước đây: đọc trạng thái rồi `update` không điều kiện. Cron nhả
   * chỗ hay nhân viên nhận sân đúng lúc đó là lượt bị ghi đè thành CANCELLED từ
   * một trạng thái không ai kiểm.
   */
  it("trạng thái vừa đổi giữa lúc đọc và lúc ghi → BookingStateError, không đụng giao dịch", async () => {
    const { db, mock } = createDb({ payments: [PAID()] });
    // Lúc đọc là HOLDING; lúc ghi thì đã thành CHECKED_IN.
    mock.booking.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      new BookingService(db, createAvailability()).cancel("b1", { actor: "CUSTOMER", now: NOW }),
    ).rejects.toBeInstanceOf(BookingStateError);
    expect(mock.payment.findMany).not.toHaveBeenCalled();
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
  });

  it("chỉ HOLDING và CONFIRMED huỷ được — mọi trạng thái khác từ chối, không mở transaction", async () => {
    for (const status of ["CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED", "EXPIRED"]) {
      const { db, mock } = createDb({ booking: { id: "b1", status } });
      await expect(
        new BookingService(db, createAvailability()).cancel("b1", { actor: "VENUE", now: NOW }),
      ).rejects.toBeInstanceOf(BookingStateError);
      expect(mock.$transaction).not.toHaveBeenCalled();
    }
  });

  it("lượt đã diễn ra thì nói rõ là đã diễn ra", async () => {
    for (const status of ["CHECKED_IN", "COMPLETED"]) {
      const { db } = createDb({ booking: { id: "b1", status } });
      await expect(
        new BookingService(db, createAvailability()).cancel("b1", { actor: "CUSTOMER" }),
      ).rejects.toThrow("đã diễn ra");
    }
  });

  it("giao dịch PENDING (chưa ai chuyển gì) huỷ theo trong CÙNG transaction", async () => {
    // Để lại giao dịch sống cho một lượt đã huỷ là mở đường thu tiền cho sân không có.
    const { db, mock } = createDb({
      payments: [PAID(360_000, { status: "PENDING" })],
    });
    await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: NOW,
    });

    expect(mock.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "b1", status: "PENDING" },
      data: { status: "CANCELLED", expiresAt: null },
    });
    expect(mock.booking.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.payment.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it("khách đã BÁO CHUYỂN KHOẢN thì khách tự huỷ bị từ chối — tiền có thể đã về sân", async () => {
    const { db, mock } = createDb({
      payments: [PAID(360_000, { status: "AWAITING_CONFIRMATION" })],
    });

    await expect(
      new BookingService(db, createAvailability()).cancel("b1", { actor: "CUSTOMER", now: NOW }),
    ).rejects.toThrow(
      new BookingStateError(
        "Bạn đã báo chuyển khoản — sân đang kiểm tra. Liên hệ sân nếu muốn huỷ.",
      ),
    );
    // Ném TRONG transaction = Postgres cuộn lại cả bước đổi trạng thái lượt đặt.
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
  });

  /**
   * Lỗi thật trước đây: huỷ lượt mà giao dịch chờ duyệt vẫn nằm trong hàng chờ;
   * chủ sân duyệt là tiền SUCCEEDED cho một lượt đã CANCELLED.
   */
  it("SÂN huỷ lượt khách đã báo chuyển khoản: giao dịch huỷ theo kèm lý do, báo số tiền khách đã khai", async () => {
    const { db, mock } = createDb({
      payments: [PAID(360_000, { id: "p9", status: "AWAITING_CONFIRMATION" })],
    });

    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "VENUE",
      venueId: "v1",
      reason: "Sân mất điện",
      cancelledBy: "u9",
      now: NOW,
    });

    expect(mock.payment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p9"] }, status: "AWAITING_CONFIRMATION" },
      data: {
        status: "CANCELLED",
        failReason: "Sân huỷ lượt đặt: Sân mất điện",
        reviewedBy: "u9",
        reviewedAt: NOW,
        expiresAt: null,
      },
    });
    expect(result.awaitingAmount).toBe(360_000);
    // Tiền mới là lời khai, chưa đối chiếu — không phải tiền đã nhận.
    expect(result.paidAmount).toBe(0);
    expect(result.refundableAmount).toBe(0);
  });

  it("chỉ TRẢ LỜI có được hoàn tiền không, không tự hoàn", async () => {
    const { db } = createDb({ payments: [PAID()] });
    // Lượt đặt 19:00 VN; bây giờ là 10:00 VN — còn 9 tiếng, trước hạn huỷ miễn
    // phí (2 tiếng trước giờ đá) khá xa.
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: NOW,
    });

    expect(result.refundable).toBe(true);
    expect(result.freeUntil.toISOString()).toBe("2026-09-04T10:00:00.000Z"); // 17:00 VN
  });

  it("huỷ sát giờ thì không được hoàn — sân đã mất cơ hội bán lại", async () => {
    const { db } = createDb({ payments: [PAID()] });
    const nearStart = new Date("2026-09-04T11:00:00Z"); // 18:00 VN, trước giờ đá 1 tiếng

    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: nearStart,
    });

    expect(result.refundable).toBe(false);
    expect(result.refundableAmount).toBe(0);
  });

  it("mốc hoàn tiền lấy từ CHÍNH SÁCH CỦA SÂN, không cứng 2 tiếng", async () => {
    // Sân cầu lông trong ngõ cho huỷ trước 1 tiếng; sân bóng 11 người thuê cả
    // buổi thì 24 tiếng cũng là sát. Một hằng số cho mọi sân là sai với cả hai.
    const { db } = createDb({ venue: { freeCancelHours: 24 } });
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: NOW,
    });

    expect(result.freeCancelHours).toBe(24);
    // Hạn huỷ miễn phí lùi về hôm trước, nên huỷ lúc 10:00 hôm nay là muộn.
    expect(result.refundable).toBe(false);
  });

  it("sân chưa khai chính sách thì dùng mặc định 2 tiếng", async () => {
    const { db } = createDb({ venue: { freeCancelHours: undefined } });
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: NOW,
    });

    expect(result.freeCancelHours).toBe(2);
  });

  it("tham số truyền vào ĐÈ chính sách của sân — dùng khi nền tảng huỷ hộ", async () => {
    const { db } = createDb({ venue: { freeCancelHours: 24 } });
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "VENUE",
      now: NOW,
      freeCancelHours: 1,
    });

    expect(result.freeCancelHours).toBe(1);
    expect(result.refundable).toBe(true);
  });

  it("huỷ trễ mà sân cho giữ lại một phần thì tính đúng số hoàn", async () => {
    // Mất trắng là mặc định, nhưng sân nào giữ lại 30% thì phải hoàn 70%.
    const { db } = createDb({
      venue: { freeCancelHours: 2, cancelFeePercent: 30 },
      payments: [PAID()],
    });
    const nearStart = new Date("2026-09-04T11:00:00Z"); // 18:00 VN, trước giờ đá 1 tiếng

    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: nearStart,
    });

    expect(result.refundable).toBe(false);
    expect(result.feePercent).toBe(30);
    expect(result.refundableAmount).toBe(252_000); // 360k − 30%
  });

  it("huỷ sớm thì hoàn nguyên số tiền ĐÃ trả", async () => {
    const { db } = createDb({ payments: [PAID()] });
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: NOW,
    });

    expect(result.paidAmount).toBe(360_000);
    expect(result.refundableAmount).toBe(360_000);
  });

  /**
   * Lỗi thật trước đây: tiền hoàn tính từ GIÁ lượt đặt, nên khách huỷ lượt chưa
   * trả đồng nào vẫn đọc "Sân sẽ hoàn 360.000đ cho bạn".
   */
  it("lượt HOLDING chưa trả tiền thì KHÔNG có gì để hoàn, dù còn trong hạn huỷ miễn phí", async () => {
    const { db } = createDb();
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: NOW,
    });

    expect(result.refundable).toBe(true);
    expect(result.paidAmount).toBe(0);
    expect(result.refundableAmount).toBe(0);
  });

  it("tiền đã hoàn một phần trước đó thì không tính lại", async () => {
    const { db } = createDb({
      payments: [PAID(360_000, { status: "PARTIALLY_REFUNDED", refundedAmount: 60_000 })],
    });
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "VENUE",
      now: NOW,
    });

    expect(result.paidAmount).toBe(300_000);
    expect(result.refundableAmount).toBe(300_000);
  });

  it("giao dịch thất bại hay đã huỷ không phải tiền đã nhận", async () => {
    const { db } = createDb({
      payments: [
        PAID(360_000, { id: "p1", status: "FAILED" }),
        PAID(360_000, { id: "p2", status: "CANCELLED" }),
      ],
    });
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      actor: "CUSTOMER",
      now: NOW,
    });

    expect(result.refundableAmount).toBe(0);
  });
});

describe("reschedule — đổi giờ hoặc đổi sân", () => {
  function params(overrides: Record<string, unknown> = {}) {
    return {
      bookingId: "b1",
      venueId: "v1",
      courtId: "c2",
      date: DATE,
      startMinute: 20 * 60,
      endMinute: 22 * 60,
      actorId: "u9",
      now: NOW,
      ...overrides,
    };
  }

  /** GOTCHAS #19: id từ form của nhân viên sân phải lọc theo sân NGAY TRONG truy vấn. */
  it("lượt đặt của SÂN KHÁC thì coi như không tồn tại, không báo giá, không ghi gì", async () => {
    const { db, mock } = createDb();
    const availability = createAvailability();

    await expect(
      new BookingService(db, availability).reschedule(params({ venueId: "san-khac" })),
    ).rejects.toBeInstanceOf(BookingNotFoundError);
    expect(mock.booking.findFirst.mock.calls[0]![0].where).toEqual({
      id: "b1",
      venueId: "san-khac",
    });
    expect(availability.quote).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("nhả khung cũ TRƯỚC rồi mới giữ khung mới, trong cùng một transaction", async () => {
    // Không nhả trước thì khung mới gối lên khung cũ sẽ bị chính lượt đặt này
    // chặn — ràng buộc chống trùng nằm ở database, nó không biết là cùng một ai.
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).reschedule(params());

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.booking.updateMany.mock.calls[0]![0]).toEqual({
      where: { id: "b1", venueId: "v1", status: "HOLDING" },
      data: { status: "CANCELLED", cancelledAt: NOW, cancelledBy: "u9" },
    });
    expect(mock.booking.update.mock.calls[0]![0].data).toMatchObject({
      status: "HOLDING",
      courtId: "c2",
      cancelledAt: null,
      cancelledBy: null,
    });
    expect(mock.booking.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
      mock.booking.update.mock.invocationCallOrder[0]!,
    );
  });

  it("dùng `now` được truyền vào — không tự đọc đồng hồ giữa chừng", async () => {
    const { db, mock } = createDb();
    const availability = createAvailability();
    await new BookingService(db, availability).reschedule(params());

    expect(availability.quote).toHaveBeenCalledWith(expect.objectContaining({ now: NOW }));
    expect(mock.booking.updateMany.mock.calls[0]![0].data.cancelledAt).toBe(NOW);
  });

  it("khoá sân mới và kiểm lịch đóng sân trong transaction, như lúc giữ chỗ", async () => {
    const { db, mock } = createDb({
      closure: { courtId: "c2", startAt: at(21 * 60), endAt: at(23 * 60) },
    });

    await expect(new BookingService(db, createAvailability()).reschedule(params())).rejects.toThrow(
      /bảo trì/,
    );
    expect(mock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mock.booking.update).not.toHaveBeenCalled();
  });

  /**
   * Lỗi này chỉ database thật mới lộ ra: bước kiểm chạy TRƯỚC transaction, lúc
   * đó khung cũ vẫn còn sống, nên đổi 19:00–21:00 sang 20:00–22:00 bị chính nó
   * chặn. Ràng buộc trong database xử lý được ca này, nhưng code không bao giờ
   * chạy tới đó.
   */
  it("giấu lượt đặt khỏi lịch của chính nó khi báo giá khung mới", async () => {
    const { db } = createDb();
    const availability = createAvailability();

    await new BookingService(db, availability).reschedule(params({ courtId: "c1" }));

    expect(availability.quote).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBookingId: "b1", venueId: "v1" }),
    );
  });

  it("CÙNG GIÁ thì lượt đã thanh toán đổi được và giữ nguyên trạng thái — không đụng giao dịch", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", status: "CONFIRMED" } });
    await new BookingService(db, createAvailability()).reschedule(params());

    expect(mock.booking.update.mock.calls[0]![0].data).toMatchObject({ status: "CONFIRMED" });
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
    expect(mock.payment.count).not.toHaveBeenCalled();
  });

  it("KHÁC GIÁ mà lượt đã thanh toán → từ chối trước khi mở transaction", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", status: "CONFIRMED" } });
    const availability = createAvailability({ slotCount: 4, total: 440_000, slots: [] });

    await expect(new BookingService(db, availability).reschedule(params())).rejects.toBeInstanceOf(
      BookingStateError,
    );
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("KHÁC GIÁ, lượt còn giữ chỗ và chưa ai chuyển gì: sửa số tiền giao dịch PENDING trong cùng transaction", async () => {
    const { db, mock } = createDb({
      payments: [
        { id: "p1", bookingId: "b1", status: "PENDING", amount: 360_000, refundedAmount: 0 },
      ],
    });
    const availability = createAvailability({ slotCount: 4, total: 440_000, slots: [] });

    await new BookingService(db, availability).reschedule(params());

    expect(mock.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: "b1", status: "PENDING" },
      data: { amount: 440_000 },
    });
    expect(mock.booking.update.mock.calls[0]![0].data).toMatchObject({
      subtotal: 440_000,
      total: 440_000,
    });
  });

  it("KHÁC GIÁ mà khách đã báo chuyển khoản theo giá cũ → từ chối, không đổi giờ", async () => {
    const { db, mock } = createDb({
      payments: [
        {
          id: "p1",
          bookingId: "b1",
          status: "AWAITING_CONFIRMATION",
          amount: 360_000,
          refundedAmount: 0,
        },
      ],
    });
    const availability = createAvailability({ slotCount: 4, total: 440_000, slots: [] });

    await expect(new BookingService(db, availability).reschedule(params())).rejects.toThrow(
      /đã báo chuyển khoản theo giá cũ/,
    );
    expect(mock.payment.updateMany).not.toHaveBeenCalled();
    expect(mock.booking.update).not.toHaveBeenCalled();
  });

  it("giữ lại phần đã giảm giá khi tính lại tiền", async () => {
    // Mất dòng này là khách đổi giờ xong bị đòi thêm đúng bằng phần khuyến mãi.
    const { db, mock } = createDb({ booking: { id: "b1", discountTotal: 60_000 } });
    await new BookingService(db, createAvailability()).reschedule(params());

    expect(mock.booking.update.mock.calls[0]![0].data).toMatchObject({
      subtotal: 360_000,
      total: 300_000,
    });
  });

  it("giảm giá lớn hơn giá khung mới thì tổng là 0, KHÔNG âm", async () => {
    // CHECK `bookings_tien_khong_am` sẽ chặn ở database — nhưng đó là lỗi 500.
    const { db, mock } = createDb({
      booking: { id: "b1", discountTotal: 400_000 },
      payments: [{ id: "p1", bookingId: "b1", status: "PENDING", amount: 1, refundedAmount: 0 }],
    });
    const availability = createAvailability({ slotCount: 2, total: 180_000, slots: [] });

    await new BookingService(db, availability).reschedule(params());

    expect(mock.booking.update.mock.calls[0]![0].data).toMatchObject({ total: 0 });
    // Giao dịch 0đ vi phạm CHECK `amount > 0` — không còn gì phải trả thì huỷ nó.
    expect(mock.payment.updateMany.mock.calls[0]![0].data).toEqual({
      status: "CANCELLED",
      expiresAt: null,
    });
  });

  it("khung mới không đặt được thì dừng, KHÔNG huỷ khung cũ", async () => {
    // Huỷ trước rồi mới phát hiện không đổi được là khách mất luôn chỗ đã có.
    const { db, mock } = createDb();
    const service = new BookingService(db, createAvailability(null));

    await expect(service.reschedule(params())).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(mock.booking.update).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("người khác cướp mất khung mới giữa chừng → SlotTakenError, transaction cuộn lại", async () => {
    const { db } = createDb({ updateError: exclusionViolation() });

    await expect(
      new BookingService(db, createAvailability()).reschedule(params()),
    ).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("trạng thái vừa đổi giữa lúc đọc và lúc nhả khung cũ → BookingStateError", async () => {
    const { db, mock } = createDb();
    mock.booking.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      new BookingService(db, createAvailability()).reschedule(params()),
    ).rejects.toBeInstanceOf(BookingStateError);
    expect(mock.booking.update).not.toHaveBeenCalled();
  });

  it("không đổi giờ lượt đã huỷ, đã hết hạn hay đã đá xong", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "CHECKED_IN", "COMPLETED", "NO_SHOW"]) {
      const { db } = createDb({ booking: { id: "b1", status } });
      await expect(
        new BookingService(db, createAvailability()).reschedule(params()),
      ).rejects.toBeInstanceOf(BookingStateError);
    }
  });

  it("chỗ giữ đã QUÁ HẠN thì không đổi giờ được — lịch đã coi nó là trống", async () => {
    const { db } = createDb({
      booking: { id: "b1", holdExpiresAt: new Date(NOW.getTime() - 1) },
    });

    await expect(new BookingService(db, createAvailability()).reschedule(params())).rejects.toThrow(
      /hết hạn giữ chỗ/,
    );
  });

  it("khung mới lệch 30 phút → VALIDATION, không đọc gì", async () => {
    const { db, mock } = createDb();

    await expect(
      new BookingService(db, createAvailability()).reschedule(
        params({ startMinute: 20 * 60 + 10 }),
      ),
    ).rejects.toBeInstanceOf(BookingValidationError);
    expect(mock.booking.findFirst).not.toHaveBeenCalled();
  });
});

describe("expireHolds — cron nhả chỗ hết hạn", () => {
  it("chỉ đụng vào HOLDING đã quá hạn, bằng MỘT câu lệnh", async () => {
    // Đọc-rồi-ghi từng dòng thì hai bản worker chạy song song sẽ giẫm lên nhau.
    const { db, mock } = createDb();
    const count = await new BookingService(db, createAvailability()).expireHolds({ now: NOW });

    expect(count).toBe(3);
    expect(mock.booking.updateMany).toHaveBeenCalledWith({
      where: { status: "HOLDING", holdExpiresAt: { lte: NOW } },
      data: { status: "EXPIRED", holdExpiresAt: null },
    });
  });

  it("giới hạn trong một sân khi được yêu cầu — không đụng chỗ giữ của sân khác", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).expireHolds({ now: NOW, venueId: "v1" });

    expect(mock.booking.updateMany.mock.calls[0]![0].where).toEqual({
      status: "HOLDING",
      holdExpiresAt: { lte: NOW },
      venueId: "v1",
    });
  });
});

describe("listForUser — lượt đặt của tôi", () => {
  const EXPIRED_HOLD = {
    ...BOOKING,
    id: "b-het-han",
    holdExpiresAt: new Date(NOW.getTime() - 60_000),
  };

  it("chỗ giữ QUÁ HẠN thuộc nhóm 'đã qua' và mang cờ hết hạn, dù cron chưa đổi trạng thái", async () => {
    const { db, mock } = createDb();
    mock.booking.findMany.mockResolvedValueOnce([BOOKING]).mockResolvedValueOnce([EXPIRED_HOLD]);

    const { upcoming, past } = await new BookingService(db, createAvailability()).listForUser(
      "u1",
      { now: NOW },
    );

    expect(upcoming.map((row) => [row.id, row.holdExpired])).toEqual([["b1", false]]);
    expect(past.map((row) => [row.id, row.holdExpired])).toEqual([["b-het-han", true]]);

    const pastWhere = mock.booking.findMany.mock.calls[1]![0].where as { OR: unknown[] };
    expect(pastWhere.OR).toContainEqual({ status: "HOLDING", holdExpiresAt: { lte: NOW } });
  });

  it("'sắp tới' loại chỗ giữ quá hạn bằng điều kiện KHẲNG ĐỊNH — lượt đã khai chuyển khoản không biến mất", async () => {
    // `NOT (HOLDING AND hạn <= bây giờ)` gặp `holdExpiresAt = null` ra NULL trong
    // SQL và làm rơi đúng lượt đang chờ chủ sân đối chiếu tiền.
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).listForUser("u1", { now: NOW });

    const upcomingWhere = mock.booking.findMany.mock.calls[0]![0].where;
    expect(upcomingWhere).not.toHaveProperty("NOT");
    expect(upcomingWhere).toMatchObject({
      userId: "u1",
      endAt: { gte: NOW },
      OR: [
        { status: { notIn: ["HOLDING", "CANCELLED", "EXPIRED"] } },
        { status: "HOLDING", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: NOW } }] },
      ],
    });
  });
});

describe("listForVenueDay — lịch của chủ sân", () => {
  it("trả phút-trong-ngày theo giờ VN để giao diện không phải tự quy đổi", async () => {
    // Quy đổi múi giờ ở tầng giao diện là chỗ chắc chắn sẽ sai.
    const { db } = createDb({
      list: [{ ...BOOKING, startAt: at(19 * 60), endAt: at(21 * 60) }],
    });

    const [row] = await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE, {
      now: NOW,
    });

    expect(row!.startMinute).toBe(19 * 60);
    expect(row!.endMinute).toBe(21 * 60);
  });

  it("khung nửa tiếng cũng ra đúng, không làm tròn lên giờ", async () => {
    const { db } = createDb({
      list: [{ ...BOOKING, startAt: at(6 * 60 + 30), endAt: at(7 * 60) }],
    });

    const [row] = await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE, {
      now: NOW,
    });

    expect(row!.startMinute).toBe(390);
    expect(row!.endMinute).toBe(420);
  });

  it("chỉ lấy lượt chạm vào ngày được hỏi", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE, { now: NOW });

    const [{ where }] = mock.booking.findMany.mock.calls[0] as [
      { where: { venueId: string; startAt: { lt: Date }; endAt: { gt: Date } } },
    ];

    expect(where.venueId).toBe("v1");
    expect(where.startAt.lt.toISOString()).toBe("2026-09-04T17:00:00.000Z"); // 00:00 ngày 05
    expect(where.endAt.gt.toISOString()).toBe("2026-09-03T17:00:00.000Z"); // 00:00 ngày 04
  });

  it("đánh dấu chỗ giữ QUÁ HẠN để lịch không tính nó là chờ thanh toán", async () => {
    const { db } = createDb({
      list: [
        { ...BOOKING, id: "con-han" },
        { ...BOOKING, id: "qua-han", holdExpiresAt: new Date(NOW.getTime() - 1) },
        { ...BOOKING, id: "da-khai", holdExpiresAt: null },
      ],
    });

    const rows = await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE, {
      now: NOW,
    });

    expect(rows.map((row) => [row.id, row.holdExpired])).toEqual([
      ["con-han", false],
      ["qua-han", true],
      ["da-khai", false],
    ]);
  });

  it("đọc kèm ghi chú của khách — sân phải thấy điều khách dặn", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE, { now: NOW });

    const [{ select }] = mock.booking.findMany.mock.calls[0] as unknown as [
      { select: Record<string, boolean> },
    ];
    expect(select.customerNote).toBe(true);
  });
});

describe("transferNote", () => {
  it("khớp với nội dung khách thấy trên mã QR", () => {
    // Lệch một ký tự là tiền vào tài khoản mà không đối soát được của lượt nào.
    expect(new BookingService(createDb().db, createAvailability()).transferNote("8F3K2M")).toBe(
      "CS 8F3K2M",
    );
  });
});
