import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type * as BookingServiceModule from "@/services/booking.service";
import type * as PaymentServiceModule from "@/services/payment.service";
import { BookingStateError } from "@/lib/errors";

/**
 * Hai thao tác của NGƯỜI ĐẶT trên màn thanh toán. Lỗi đắt nhất ở đây: người
 * không phải người đặt (chỉ biết mã) khai "đã chuyển khoản" hay mở giao dịch
 * cho lượt của người khác — bản trước để công khai với lý do "khách vãng lai".
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/booking.service", async (importOriginal) => {
  const actual = await importOriginal<typeof BookingServiceModule>();
  return { ...actual, bookingService: { findCheckout: vi.fn() } };
});
vi.mock("@/services/payment.service", async (importOriginal) => {
  const actual = await importOriginal<typeof PaymentServiceModule>();
  return { ...actual, paymentService: { declareTransfer: vi.fn(), start: vi.fn() } };
});

import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { bookingService } from "@/services/booking.service";
import { paymentService } from "@/services/payment.service";
import { declareTransferAction, openTransferAction } from "./actions";

const BOOKER: SessionPayload = { typ: "access", sub: "u1", email: "a@b.com", roles: ["USER"] };
const STRANGER: SessionPayload = { typ: "access", sub: "u2", email: "c@d.com", roles: ["USER"] };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

type Payment = { id: string; status: string; provider: string };

function checkout(payments: Payment[][], overrides: Record<string, unknown> = {}) {
  const holding = payments.map((list, index) => ({ id: `b${index + 1}`, payments: list }));
  return { code: "DXWQE3", userId: "u1", holdExpired: false, holding, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(BOOKER);
});

describe("declareTransferAction — 'Tôi đã chuyển khoản'", () => {
  it("chưa đăng nhập thì từ chối, không đọc lần đặt", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await declareTransferAction({}, form({ code: "DXWQE3" }));

    expect(result.error).toContain("đăng nhập");
    expect(bookingService.findCheckout).not.toHaveBeenCalled();
  });

  it("người KHÁC người đặt (chỉ biết mã) → như không tìm thấy, không khai gì", async () => {
    vi.mocked(getSession).mockResolvedValue(STRANGER);
    vi.mocked(bookingService.findCheckout).mockResolvedValue(
      checkout([[{ id: "p1", status: "PENDING", provider: "BANK_TRANSFER" }]]) as never,
    );

    const result = await declareTransferAction({}, form({ code: "DXWQE3" }));

    expect(result).toEqual({ error: "Không tìm thấy lượt đặt này" });
    expect(paymentService.declareTransfer).not.toHaveBeenCalled();
  });

  it("người đặt khai cho MỌI lượt đang giữ, kèm ghi chú đã cắt khoảng trắng", async () => {
    vi.mocked(bookingService.findCheckout).mockResolvedValue(
      checkout([
        [{ id: "p1", status: "PENDING", provider: "BANK_TRANSFER" }],
        [
          { id: "p0", status: "FAILED", provider: "BANK_TRANSFER" },
          { id: "p2", status: "PENDING", provider: "BANK_TRANSFER" },
        ],
      ]) as never,
    );

    const result = await declareTransferAction(
      {},
      form({ code: "DXWQE3", note: "  Chuyển từ tài khoản của vợ  " }),
    );

    expect(result).toEqual({ ok: true });
    expect(paymentService.declareTransfer).toHaveBeenCalledWith({
      paymentIds: ["p1", "p2"],
      note: "Chuyển từ tài khoản của vợ",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/bookings/DXWQE3");
  });

  it("có lượt chưa có giao dịch chuyển khoản sống thì không khai một nửa", async () => {
    vi.mocked(bookingService.findCheckout).mockResolvedValue(
      checkout([
        [{ id: "p1", status: "PENDING", provider: "BANK_TRANSFER" }],
        [{ id: "p2", status: "PENDING", provider: "VNPAY" }],
      ]) as never,
    );

    const result = await declareTransferAction({}, form({ code: "DXWQE3" }));

    expect(result.error).toContain("Tải lại trang");
    expect(paymentService.declareTransfer).not.toHaveBeenCalled();
  });

  it("ghi chú quá dài báo đúng lý do", async () => {
    const result = await declareTransferAction({}, form({ code: "DXWQE3", note: "x".repeat(301) }));

    expect(result.error).toContain("300");
    expect(bookingService.findCheckout).not.toHaveBeenCalled();
  });

  it("lỗi nghiệp vụ trả thành câu, không ném", async () => {
    vi.mocked(bookingService.findCheckout).mockResolvedValue(
      checkout([[{ id: "p1", status: "PENDING", provider: "BANK_TRANSFER" }]]) as never,
    );
    vi.mocked(paymentService.declareTransfer).mockRejectedValue(
      new BookingStateError("Chỗ giữ đã hết hạn"),
    );

    expect(await declareTransferAction({}, form({ code: "DXWQE3" }))).toEqual({
      error: "Chỗ giữ đã hết hạn",
    });
  });
});

describe("openTransferAction — 'Tạo mã chuyển khoản'", () => {
  it("chỉ mở giao dịch cho lượt CHƯA có giao dịch chuyển khoản sống", async () => {
    vi.mocked(bookingService.findCheckout).mockResolvedValue(
      checkout([
        [{ id: "p1", status: "PENDING", provider: "BANK_TRANSFER" }],
        [{ id: "p2", status: "FAILED", provider: "BANK_TRANSFER" }],
        [],
      ]) as never,
    );

    const result = await openTransferAction({}, form({ code: "DXWQE3" }));

    expect(result).toEqual({});
    expect(paymentService.start).toHaveBeenCalledTimes(2);
    expect(paymentService.start).toHaveBeenCalledWith({
      bookingId: "b2",
      provider: "BANK_TRANSFER",
      receivedBy: "VENUE",
    });
    expect(paymentService.start).toHaveBeenCalledWith({
      bookingId: "b3",
      provider: "BANK_TRANSFER",
      receivedBy: "VENUE",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/bookings/DXWQE3");
  });

  it("người KHÁC người đặt không mở được giao dịch", async () => {
    vi.mocked(getSession).mockResolvedValue(STRANGER);
    vi.mocked(bookingService.findCheckout).mockResolvedValue(checkout([[]]) as never);

    expect(await openTransferAction({}, form({ code: "DXWQE3" }))).toEqual({
      error: "Không tìm thấy lượt đặt này",
    });
    expect(paymentService.start).not.toHaveBeenCalled();
  });

  it("chỗ giữ đã hết hạn thì không mở — mời đặt lại", async () => {
    vi.mocked(bookingService.findCheckout).mockResolvedValue(
      checkout([[]], { holdExpired: true }) as never,
    );

    const result = await openTransferAction({}, form({ code: "DXWQE3" }));

    expect(result.error).toContain("hết thời gian giữ chỗ");
    expect(paymentService.start).not.toHaveBeenCalled();
  });

  it("lỗi nghiệp vụ của service trả thành câu", async () => {
    vi.mocked(bookingService.findCheckout).mockResolvedValue(checkout([[]]) as never);
    vi.mocked(paymentService.start).mockRejectedValue(
      new BookingStateError("Lượt đặt này chưa có giá nên chưa thanh toán online được."),
    );

    expect((await openTransferAction({}, form({ code: "DXWQE3" }))).error).toContain("chưa có giá");
  });
});
