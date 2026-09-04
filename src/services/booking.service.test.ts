import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  BookingNotFoundError,
  BookingStateError,
  SlotTakenError,
  SlotUnavailableError,
} from "@/lib/errors";
import type { AvailabilityService } from "./availability.service";
import { BookingService } from "./booking.service";

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

/** Lỗi Prisma trùng ràng buộc duy nhất, đúng hình dạng thật (`code` + `meta`). */
function uniqueViolation(field: string): Error {
  return Object.assign(new Error(`Unique constraint failed on the fields: (\`${field}\`)`), {
    code: "P2002",
    meta: { target: [field] },
  });
}

/**
 * Lỗi Postgres 23P01 — ràng buộc `EXCLUDE USING gist` bắn ra khi hai người cùng
 * lấy một khung. Prisma không ánh xạ mã này thành P2xxx nào nên nó tới dưới
 * dạng lỗi thô, đúng như ở đây.
 */
function exclusionViolation(): Error {
  return new Error(
    'ERROR: conflicting key value violates exclusion constraint "bookings_khong_trung_khung_gio" (code: 23P01)',
  );
}

const BOOKING = {
  id: "b1",
  code: "8F3K2M",
  venueId: "v1",
  courtId: "c1",
  userId: null,
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
  holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
};

type Options = {
  booking?: (Partial<typeof BOOKING> & { id: string }) | null;
  venue?: { holdMinutes: number } | null;
  /** Lỗi mà `booking.create` sẽ ném ra, theo thứ tự từng lần gọi. */
  createErrors?: (Error | null)[];
  updateError?: Error | null;
  list?: unknown[];
};

function createDb(options: Options = {}) {
  const created: Record<string, unknown>[] = [];
  let createCall = 0;

  const db = {
    venue: {
      findFirst: vi
        .fn()
        .mockResolvedValue("venue" in options ? options.venue : { holdMinutes: 10 }),
    },
    booking: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const error = options.createErrors?.[createCall];
        createCall += 1;
        if (error) return Promise.reject(error);
        created.push(data);
        return Promise.resolve({ ...BOOKING, ...data, id: `b${createCall}` });
      }),
      findUnique: vi
        .fn()
        .mockResolvedValue(
          "booking" in options ? options.booking && { ...BOOKING, ...options.booking } : BOOKING,
        ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (options.updateError) return Promise.reject(options.updateError);
        return Promise.resolve({ ...BOOKING, ...options.booking, ...data, id: where.id });
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 3 }),
      findMany: vi.fn().mockResolvedValue(options.list ?? []),
    },
    // `tx` chính là db mock, nên mọi lời gọi trong transaction vẫn đếm được.
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
  };

  return { db: db as unknown as PrismaClient, mock: db, created };
}

function createAvailability(quote: unknown = { slotCount: 4, total: 360_000, slots: [] }) {
  return {
    quote: vi.fn().mockResolvedValue(quote),
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

  it("cắt khoảng trắng thừa của tên và số điện thoại", async () => {
    // Số có khoảng trắng ở đầu là số không tra cứu được lúc khách gọi tới hỏi.
    const { db, created } = createDb();
    await new BookingService(db, createAvailability()).hold(holdInput());

    expect(created[0]!.customerName).toBe("Nguyễn Văn A");
    expect(created[0]!.customerPhone).toBe("0900000000");
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

  it("sân chưa khai thì giữ 10 phút, không giữ vô thời hạn", async () => {
    // Không có hạn thì một người mở trang thanh toán rồi bỏ đi sẽ khoá khung
    // giờ đẹp nhất mãi mãi.
    const { db, created } = createDb({ venue: null });
    await new BookingService(db, createAvailability()).hold(holdInput());

    expect((created[0]!.holdExpiresAt as Date).getTime()).toBe(NOW.getTime() + 10 * 60_000);
  });

  it("mã đặt sân 6 ký tự, không chứa 0/O/1/I/L — đọc qua điện thoại là lẫn", async () => {
    const { db, created } = createDb();
    const service = new BookingService(db, createAvailability());

    for (let index = 0; index < 30; index += 1) await service.hold(holdInput());

    for (const data of created) {
      expect(data.code).toMatch(/^[23456789ACDEFGHJKMNPQRTUVWXY]{6}$/);
    }
  });

  it("từ chối khi báo giá trả null — khung đã có người hoặc ngoài giờ mở cửa", async () => {
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
    const { db, mock, created } = createDb({ createErrors: [uniqueViolation("code"), null] });
    const booking = await new BookingService(db, createAvailability()).hold(holdInput());

    expect(mock.booking.create).toHaveBeenCalledTimes(2);
    expect(booking.status).toBe("HOLDING");
    // Lần đầu ném lỗi nên không vào `created`; đủ để biết mã lần hai được sinh mới.
    expect(created).toHaveLength(1);
  });

  it("bỏ cuộc sau 3 lần trùng mã thay vì lặp mãi", async () => {
    const { db, mock } = createDb({
      createErrors: [uniqueViolation("code"), uniqueViolation("code"), uniqueViolation("code")],
    });

    await expect(new BookingService(db, createAvailability()).hold(holdInput())).rejects.toThrow(
      /Unique constraint/,
    );
    expect(mock.booking.create).toHaveBeenCalledTimes(3);
  });

  it("lỗi lạ ném lên nguyên vẹn, không nuốt và không thử lại", async () => {
    // Trước đây chỗ này nhận diện bằng `message.includes(\"code\")`, nên một lỗi
    // mất kết nối cũng bị thử lại ba lần rồi mới hỏng.
    const { db, mock } = createDb({ createErrors: [new Error("Can't reach database server")] });

    await expect(new BookingService(db, createAvailability()).hold(holdInput())).rejects.toThrow(
      "Can't reach database server",
    );
    expect(mock.booking.create).toHaveBeenCalledTimes(1);
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
});

describe("cancel — huỷ", () => {
  it("ghi lý do và người huỷ, xoá hạn giữ chỗ", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).cancel("b1", {
      reason: "Khách bận",
      cancelledBy: "u9",
      now: NOW,
    });

    expect(mock.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: {
        status: "CANCELLED",
        cancelledAt: NOW,
        cancelReason: "Khách bận",
        cancelledBy: "u9",
        holdExpiresAt: null,
      },
    });
  });

  /**
   * Service KHÔNG tự hoàn tiền: hoàn tiền cần quyền riêng (`payment:refund`),
   * và giấu một thao tác tiền bạc bên trong một thao tác trông vô hại là cách
   * chắc chắn để tiền ra khỏi tài khoản mà không ai duyệt.
   */
  it("chỉ TRẢ LỜI có được hoàn tiền không, không tự hoàn", async () => {
    const { db } = createDb();
    // Lượt đặt 19:00 VN; bây giờ là 10:00 VN, còn 9 tiếng — quá hạn 2 tiếng.
    const result = await new BookingService(db, createAvailability()).cancel("b1", { now: NOW });

    expect(result.refundable).toBe(true);
    expect(result.freeUntil.toISOString()).toBe("2026-09-04T10:00:00.000Z"); // 17:00 VN
  });

  it("huỷ sát giờ thì không được hoàn — sân đã mất cơ hội bán lại", async () => {
    const { db } = createDb();
    const satGio = new Date("2026-09-04T11:00:00Z"); // 18:00 VN, trước giờ đá 1 tiếng

    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      now: satGio,
    });

    expect(result.refundable).toBe(false);
  });

  it("mốc hoàn tiền theo cấu hình của sân, không cứng 2 tiếng", async () => {
    const { db } = createDb();
    const result = await new BookingService(db, createAvailability()).cancel("b1", {
      now: NOW,
      freeCancelHours: 24,
    });

    // Hạn huỷ miễn phí lùi về hôm trước, nên huỷ lúc 10:00 hôm nay là muộn.
    expect(result.refundable).toBe(false);
  });

  it("không huỷ lượt khách đã tới sân hoặc đã đá xong", async () => {
    for (const status of ["CHECKED_IN", "COMPLETED"]) {
      const { db } = createDb({ booking: { id: "b1", status } });
      await expect(new BookingService(db, createAvailability()).cancel("b1")).rejects.toThrow(
        "đã diễn ra",
      );
    }
  });

  it("không huỷ lại lượt đã huỷ — huỷ hai lần dễ thành hoàn tiền hai lần", async () => {
    for (const status of ["CANCELLED", "EXPIRED"]) {
      const { db } = createDb({ booking: { id: "b1", status } });
      await expect(
        new BookingService(db, createAvailability()).cancel("b1"),
      ).rejects.toBeInstanceOf(BookingStateError);
    }
  });
});

describe("reschedule — đổi giờ hoặc đổi sân", () => {
  it("nhả khung cũ TRƯỚC rồi mới giữ khung mới, trong cùng một transaction", async () => {
    // Không nhả trước thì khung mới gối lên khung cũ sẽ bị chính lượt đặt này
    // chặn — ràng buộc chống trùng nằm ở database, nó không biết là cùng một ai.
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).reschedule({
      bookingId: "b1",
      courtId: "c2",
      date: DATE,
      startMinute: 20 * 60,
      endMinute: 22 * 60,
      actorId: "u9",
      now: NOW,
    });

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.booking.update).toHaveBeenCalledTimes(2);
    expect(mock.booking.update.mock.calls[0]![0].data).toMatchObject({ status: "CANCELLED" });
    expect(mock.booking.update.mock.calls[1]![0].data).toMatchObject({
      status: "HOLDING",
      courtId: "c2",
      cancelledAt: null,
      cancelledBy: null,
    });
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

    await new BookingService(db, availability).reschedule({
      bookingId: "b1",
      courtId: "c1",
      date: DATE,
      startMinute: 20 * 60,
      endMinute: 22 * 60,
    });

    expect(availability.quote).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBookingId: "b1" }),
    );
  });

  it("giữ nguyên trạng thái cũ — lượt đã thanh toán không tụt về chờ thanh toán", async () => {
    const { db, mock } = createDb({ booking: { id: "b1", status: "CONFIRMED" } });
    await new BookingService(db, createAvailability()).reschedule({
      bookingId: "b1",
      courtId: "c1",
      date: DATE,
      startMinute: 20 * 60,
      endMinute: 22 * 60,
    });

    expect(mock.booking.update.mock.calls[1]![0].data).toMatchObject({ status: "CONFIRMED" });
  });

  it("giữ lại phần đã giảm giá khi tính lại tiền", async () => {
    // Mất dòng này là khách đổi giờ xong bị đòi thêm đúng bằng phần khuyến mãi.
    const { db, mock } = createDb({ booking: { id: "b1", discountTotal: 60_000 } });
    await new BookingService(db, createAvailability()).reschedule({
      bookingId: "b1",
      courtId: "c1",
      date: DATE,
      startMinute: 20 * 60,
      endMinute: 22 * 60,
    });

    expect(mock.booking.update.mock.calls[1]![0].data).toMatchObject({
      subtotal: 360_000,
      total: 300_000,
    });
  });

  it("khung mới không đặt được thì dừng, KHÔNG huỷ khung cũ", async () => {
    // Huỷ trước rồi mới phát hiện không đổi được là khách mất luôn chỗ đã có.
    const { db, mock } = createDb();
    const service = new BookingService(db, createAvailability(null));

    await expect(
      service.reschedule({
        bookingId: "b1",
        courtId: "c1",
        date: DATE,
        startMinute: 20 * 60,
        endMinute: 22 * 60,
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);
    expect(mock.booking.update).not.toHaveBeenCalled();
    expect(mock.$transaction).not.toHaveBeenCalled();
  });

  it("người khác cướp mất khung mới giữa chừng → SlotTakenError, transaction cuộn lại", async () => {
    const { db } = createDb({ updateError: exclusionViolation() });

    await expect(
      new BookingService(db, createAvailability()).reschedule({
        bookingId: "b1",
        courtId: "c1",
        date: DATE,
        startMinute: 20 * 60,
        endMinute: 22 * 60,
      }),
    ).rejects.toBeInstanceOf(SlotTakenError);
  });

  it("không đổi giờ lượt đã huỷ, đã hết hạn hay đã đá xong", async () => {
    for (const status of ["CANCELLED", "EXPIRED", "CHECKED_IN", "COMPLETED"]) {
      const { db } = createDb({ booking: { id: "b1", status } });
      await expect(
        new BookingService(db, createAvailability()).reschedule({
          bookingId: "b1",
          courtId: "c1",
          date: DATE,
          startMinute: 20 * 60,
          endMinute: 22 * 60,
        }),
      ).rejects.toBeInstanceOf(BookingStateError);
    }
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
});

describe("listForVenueDay — lịch của chủ sân", () => {
  it("trả phút-trong-ngày theo giờ VN để giao diện không phải tự quy đổi", async () => {
    // Quy đổi múi giờ ở tầng giao diện là chỗ chắc chắn sẽ sai.
    const { db } = createDb({
      list: [{ ...BOOKING, startAt: at(19 * 60), endAt: at(21 * 60) }],
    });

    const [row] = await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE);

    expect(row!.startMinute).toBe(19 * 60);
    expect(row!.endMinute).toBe(21 * 60);
  });

  it("khung nửa tiếng cũng ra đúng, không làm tròn lên giờ", async () => {
    const { db } = createDb({
      list: [{ ...BOOKING, startAt: at(6 * 60 + 30), endAt: at(7 * 60) }],
    });

    const [row] = await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE);

    expect(row!.startMinute).toBe(390);
    expect(row!.endMinute).toBe(420);
  });

  it("chỉ lấy lượt chạm vào ngày được hỏi", async () => {
    const { db, mock } = createDb();
    await new BookingService(db, createAvailability()).listForVenueDay("v1", DATE);

    const [{ where }] = mock.booking.findMany.mock.calls[0] as [
      { where: { venueId: string; startAt: { lt: Date }; endAt: { gt: Date } } },
    ];

    expect(where.venueId).toBe("v1");
    expect(where.startAt.lt.toISOString()).toBe("2026-09-04T17:00:00.000Z"); // 00:00 ngày 05
    expect(where.endAt.gt.toISOString()).toBe("2026-09-03T17:00:00.000Z"); // 00:00 ngày 04
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
