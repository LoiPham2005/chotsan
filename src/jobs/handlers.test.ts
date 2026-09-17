import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Job theo lịch là chỗ hỏng trong im lặng: không ai mở trang nào để phát hiện,
 * và triệu chứng (lịch kín trong khi sân trống, tháng không có hoá đơn) không
 * hề trỏ về đây.
 *
 * Test này chốt: **danh mục job và handler khớp nhau**, và job tiền (hoá đơn)
 * KHÔNG nuốt lỗi. Thiếu handler cho một job đã đăng ký lịch thì worker ném lỗi
 * mỗi phút, mãi mãi.
 */

const expireHolds = vi.fn().mockResolvedValue(0);
const expirePending = vi.fn().mockResolvedValue(0);
const generateMissing = vi.fn();
const markOverdue = vi.fn().mockResolvedValue(0);

vi.mock("@/services/booking.service", () => ({
  BookingService: class {
    expireHolds = expireHolds;
  },
}));

vi.mock("@/services/payment.service", () => ({
  PaymentService: class {
    expirePending = expirePending;
  },
}));

vi.mock("@/services/invoice.service", () => ({
  InvoiceService: class {
    generateMissing = generateMissing;
    markOverdue = markOverdue;
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { jobHandlers } = await import("./handlers");

beforeEach(() => {
  vi.clearAllMocks();
  generateMissing.mockResolvedValue({
    periods: ["2026-06", "2026-07", "2026-08"],
    created: 2,
    skipped: 5,
    failed: [],
  });
});

describe("danh mục job", () => {
  it("mọi job theo lịch đều có handler", () => {
    // Worker đăng ký lịch theo tên chuỗi; thiếu handler chỉ lộ ra lúc chạy.
    for (const name of [
      "booking:expire-holds",
      "payment:expire-pending",
      "maintenance:purge-expired",
      "invoice:generate-monthly",
      "invoice:mark-overdue",
    ] as const) {
      expect(typeof jobHandlers[name]).toBe("function");
    }
  });
});

describe("booking:expire-holds", () => {
  it("gọi đúng BookingService.expireHolds", async () => {
    await jobHandlers["booking:expire-holds"]({});
    expect(expireHolds).toHaveBeenCalledTimes(1);
  });

  it("chạy hai lần không hỏng — BullMQ có thể giao lại job", async () => {
    await jobHandlers["booking:expire-holds"]({});
    await jobHandlers["booking:expire-holds"]({});
    expect(expireHolds).toHaveBeenCalledTimes(2);
  });
});

describe("payment:expire-pending", () => {
  it("gọi đúng PaymentService.expirePending", async () => {
    await jobHandlers["payment:expire-pending"]({});
    expect(expirePending).toHaveBeenCalledTimes(1);
  });
});

describe("invoice:generate-monthly", () => {
  /**
   * Lỗi thật trước đây: job chỉ chốt "tháng trước" một lần (`now − 5 ngày`) —
   * lần chạy đó hỏng là mất hẳn hoá đơn tháng đó.
   */
  it("gọi bản TỰ BÙ các tháng còn thiếu, không phải chỉ tháng trước", async () => {
    await jobHandlers["invoice:generate-monthly"]({});

    expect(generateMissing).toHaveBeenCalledTimes(1);
  });

  it("còn cơ sở/tháng xuất hỏng thì NÉM LỖI để BullMQ ghi thất bại và thử lại", async () => {
    generateMissing.mockResolvedValue({
      periods: ["2026-06", "2026-07", "2026-08"],
      created: 1,
      skipped: 0,
      failed: [
        {
          period: "2026-08",
          venueId: "v1",
          message: "Unique constraint failed on the fields: (`number`)",
        },
        { period: "2026-07", venueId: null, message: "Can't reach database server" },
      ],
    });

    await expect(jobHandlers["invoice:generate-monthly"]({})).rejects.toThrow(
      /hỏng 2 chỗ — 2026-08 v1: Unique constraint.*2026-07 \(cả tháng\): Can't reach/,
    );
  });

  it("chạy lại sau khi đã xuất đủ thì êm — không có gì để ném", async () => {
    generateMissing.mockResolvedValue({ periods: [], created: 0, skipped: 3, failed: [] });

    await expect(jobHandlers["invoice:generate-monthly"]({})).resolves.toBeUndefined();
  });
});

describe("invoice:mark-overdue", () => {
  it("gọi đúng InvoiceService.markOverdue", async () => {
    await jobHandlers["invoice:mark-overdue"]({});
    expect(markOverdue).toHaveBeenCalledTimes(1);
  });
});
