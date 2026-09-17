import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type * as BookingServiceModule from "@/services/booking.service";
import type * as PaymentServiceModule from "@/services/payment.service";
import { BookingStateError, SlotTakenError } from "@/lib/errors";

/**
 * Action giữ chỗ là cửa vào duy nhất tạo lượt đặt từ web. Hai thứ phải chặn ở
 * đây: ngày không hợp lệ/đã qua lọt xuống service, và màn thanh toán phải tự
 * GHI database khi được mở bằng GET (giao dịch giờ mở ngay trong POST này).
 *
 * Mốc dùng xuyên suốt: 10:00 ngày 04/09/2026 giờ VN.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("next/navigation", () => ({
  // `redirect` thật ném một lỗi đặc biệt của Next — giả lập đúng kiểu đó để
  // biết action KHÔNG chạy tiếp sau khi chuyển hướng.
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { path });
  }),
}));
vi.mock("@/services/user.service", () => ({ userService: { findById: vi.fn() } }));
vi.mock("@/services/booking.service", async (importOriginal) => {
  const actual = await importOriginal<typeof BookingServiceModule>();
  return { ...actual, bookingService: { holdCheckout: vi.fn() } };
});
vi.mock("@/services/payment.service", async (importOriginal) => {
  const actual = await importOriginal<typeof PaymentServiceModule>();
  return { ...actual, paymentService: { start: vi.fn() } };
});

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { redirect } from "next/navigation";
import { bookingService } from "@/services/booking.service";
import { paymentService } from "@/services/payment.service";
import { userService } from "@/services/user.service";
import { holdBookingAction } from "./actions";

const NOW = new Date("2026-09-04T03:00:00Z");

const SESSION: SessionPayload = {
  typ: "access",
  sub: "u1",
  email: "khach@example.com",
  roles: ["USER"],
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function bookingForm(overrides: Record<string, string> = {}) {
  return form({
    venueId: "v1",
    date: "2026-09-04",
    slots: JSON.stringify([
      { courtId: "c1", minute: 18 * 60 },
      { courtId: "c1", minute: 18 * 60 + 30 },
      { courtId: "c2", minute: 20 * 60 },
    ]),
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  vi.mocked(getSession).mockResolvedValue(SESSION);
  vi.mocked(userService.findById).mockResolvedValue({
    id: "u1",
    email: "khach@example.com",
    fullName: "Nguyễn Văn A",
    phone: "0900000000",
  } as never);
  vi.mocked(bookingService.holdCheckout).mockResolvedValue([
    { id: "b1", code: "DXWQE3" },
    { id: "b2", code: "QPMV9H" },
  ] as never);
  vi.mocked(paymentService.start).mockResolvedValue({ id: "p1" } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("holdBookingAction", () => {
  it("chưa đăng nhập thì từ chối, không chạm tới service", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await holdBookingAction({}, bookingForm());

    expect(result.error).toContain("đăng nhập");
    expect(bookingService.holdCheckout).not.toHaveBeenCalled();
  });

  /**
   * Lỗi thật trước đây: action chỉ kiểm ĐỊNH DẠNG ngày — gửi `date` của hôm qua
   * là giữ được chỗ cho một ngày đã qua.
   */
  it("ngày ĐÃ QUA (theo giờ VN) bị từ chối với câu rõ ràng, không giữ chỗ", async () => {
    const result = await holdBookingAction({}, bookingForm({ date: "2026-09-03" }));

    expect(result.error).toContain("Ngày này đã qua");
    expect(bookingService.holdCheckout).not.toHaveBeenCalled();
  });

  it("ngày không có thật (31/02) bị từ chối — không lặng lẽ cuộn sang tháng sau", async () => {
    const result = await holdBookingAction({}, bookingForm({ date: "2026-02-31" }));

    expect(result.error).toContain("dữ liệu gửi lên không hợp lệ");
    expect(bookingService.holdCheckout).not.toHaveBeenCalled();
  });

  it("gom ô thành lượt đặt, gửi kèm ghi chú của khách và thông tin từ hồ sơ", async () => {
    await expect(
      holdBookingAction({}, bookingForm({ customerNote: "  Cho mượn vợt  " })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(bookingService.holdCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        venueId: "v1",
        ranges: [
          { courtId: "c1", startMinute: 18 * 60, endMinute: 19 * 60 },
          { courtId: "c2", startMinute: 20 * 60, endMinute: 20 * 60 + 30 },
        ],
        customerName: "Nguyễn Văn A",
        customerPhone: "0900000000",
        customerNote: "Cho mượn vợt",
        userId: "u1",
        source: "WEB",
      }),
    );
  });

  /**
   * Lỗi thật trước đây: màn thanh toán mở giao dịch mỗi lần GET — trình xem
   * trước link hay bot cũng ghi database. Giờ giao dịch mở ở đây, trong POST.
   */
  it("mở giao dịch chuyển khoản cho TỪNG lượt ngay sau khi giữ chỗ, rồi mới chuyển hướng", async () => {
    await expect(holdBookingAction({}, bookingForm())).rejects.toThrow("NEXT_REDIRECT");

    expect(paymentService.start).toHaveBeenCalledTimes(2);
    expect(paymentService.start).toHaveBeenCalledWith({
      bookingId: "b1",
      provider: "BANK_TRANSFER",
      receivedBy: "VENUE",
    });
    expect(paymentService.start).toHaveBeenCalledWith({
      bookingId: "b2",
      provider: "BANK_TRANSFER",
      receivedBy: "VENUE",
    });
    expect(vi.mocked(paymentService.start).mock.invocationCallOrder.at(-1)!).toBeLessThan(
      vi.mocked(redirect).mock.invocationCallOrder[0]!,
    );
    expect(redirect).toHaveBeenCalledWith("/bookings/DXWQE3");
  });

  it("mở giao dịch hỏng thì VẪN tới màn thanh toán — chỗ đã giữ, trang có nút tạo lại mã", async () => {
    vi.mocked(paymentService.start)
      .mockRejectedValueOnce(new BookingStateError("Lượt đặt này không còn nhận thanh toán"))
      .mockRejectedValueOnce(new Error("Can't reach database server"));

    await expect(holdBookingAction({}, bookingForm())).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/bookings/DXWQE3");
    // Lỗi hạ tầng phải nằm trong log; lỗi nghiệp vụ thì trang tự nói với khách.
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("giữ chỗ hỏng vì lý do nghiệp vụ thì trả câu lỗi, không mở giao dịch, không chuyển hướng", async () => {
    vi.mocked(bookingService.holdCheckout).mockRejectedValue(
      new SlotTakenError("Sân 2 20:00–20:30 vừa có người đặt mất. Chọn giờ khác giúp bạn nhé."),
    );

    const result = await holdBookingAction({}, bookingForm());

    expect(result.error).toContain("Sân 2 20:00–20:30");
    expect(paymentService.start).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("ghi chú quá dài báo theo trường, không gửi xuống service", async () => {
    const result = await holdBookingAction({}, bookingForm({ customerNote: "x".repeat(301) }));

    expect(result.fields?.customerNote?.[0]).toContain("300");
    expect(bookingService.holdCheckout).not.toHaveBeenCalled();
  });
});
