import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Job theo lịch là chỗ hỏng trong im lặng: không ai mở trang nào để phát hiện,
 * và triệu chứng (lịch kín trong khi sân trống) không hề trỏ về đây.
 *
 * Test này chốt đúng một điều: **danh mục job và handler khớp nhau**. Thiếu
 * handler cho một job đã đăng ký lịch thì worker ném lỗi mỗi phút, mãi mãi.
 */

const expireHolds = vi.fn().mockResolvedValue(0);
const expirePending = vi.fn().mockResolvedValue(0);

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

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { jobHandlers } = await import("./handlers");

beforeEach(() => vi.clearAllMocks());

describe("danh mục job", () => {
  it("mọi job dọn theo lịch đều có handler", () => {
    // Worker đăng ký lịch theo tên chuỗi; thiếu handler chỉ lộ ra lúc chạy.
    for (const name of [
      "booking:expire-holds",
      "payment:expire-pending",
      "maintenance:purge-expired",
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
