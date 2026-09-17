import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type * as BookingServiceModule from "@/services/booking.service";
import { BookingStateError } from "@/lib/errors";

/**
 * Khách tự huỷ. Câu trả về là thứ khách đọc để biết MẤT BAO NHIÊU TIỀN — nói
 * sai ở đây là cuộc gọi khiếu nại tới sân.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/booking.service", async (importOriginal) => {
  const actual = await importOriginal<typeof BookingServiceModule>();
  return { ...actual, bookingService: { findOwnedByUser: vi.fn(), cancel: vi.fn() } };
});

import { getSession } from "@/lib/auth";
import { bookingService } from "@/services/booking.service";
import { cancelOwnBookingAction } from "./actions";

const SESSION: SessionPayload = { typ: "access", sub: "u1", email: "a@b.com", roles: ["USER"] };

function form(bookingId: string): FormData {
  const data = new FormData();
  data.append("bookingId", bookingId);
  return data;
}

function cancelResult(overrides: Record<string, unknown>) {
  return {
    booking: { code: "8F3K2M" },
    refundable: true,
    freeUntil: new Date(),
    freeCancelHours: 2,
    feePercent: 0,
    paidAmount: 0,
    refundableAmount: 0,
    awaitingAmount: 0,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(SESSION);
  vi.mocked(bookingService.findOwnedByUser).mockResolvedValue({
    id: "b1",
    code: "8F3K2M",
  } as never);
});

describe("cancelOwnBookingAction", () => {
  it("chưa đăng nhập thì từ chối, không chạm tới service", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await cancelOwnBookingAction({}, form("b1"));

    expect(result.error).toContain("đăng nhập");
    expect(bookingService.cancel).not.toHaveBeenCalled();
  });

  it("lượt không phải của mình → như không tìm thấy, không huỷ", async () => {
    vi.mocked(bookingService.findOwnedByUser).mockResolvedValue(null);

    expect(await cancelOwnBookingAction({}, form("b-nguoi-khac"))).toEqual({
      error: "Không tìm thấy lượt đặt này",
    });
    expect(bookingService.findOwnedByUser).toHaveBeenCalledWith("b-nguoi-khac", "u1");
    expect(bookingService.cancel).not.toHaveBeenCalled();
  });

  it("huỷ với tư cách KHÁCH — service mới biết mà chặn lượt đã báo chuyển khoản", async () => {
    vi.mocked(bookingService.cancel).mockResolvedValue(cancelResult({}));

    await cancelOwnBookingAction({}, form("b1"));

    expect(bookingService.cancel).toHaveBeenCalledWith("b1", {
      actor: "CUSTOMER",
      reason: "Khách tự huỷ",
      cancelledBy: "u1",
    });
  });

  /** Lỗi thật trước đây: lượt chưa trả đồng nào vẫn đọc "Sân sẽ hoàn 360.000đ". */
  it("chưa trả tiền thì nói KHÔNG có gì cần hoàn — dù còn trong hạn huỷ miễn phí", async () => {
    vi.mocked(bookingService.cancel).mockResolvedValue(cancelResult({ refundable: true }));

    const result = await cancelOwnBookingAction({}, form("b1"));

    expect(result.ok).toBe(
      "Đã huỷ lượt 8F3K2M. Bạn chưa thanh toán nên không có khoản nào cần hoàn.",
    );
  });

  it("đã trả và còn trong hạn huỷ miễn phí thì báo hoàn đủ", async () => {
    vi.mocked(bookingService.cancel).mockResolvedValue(
      cancelResult({ paidAmount: 360_000, refundableAmount: 360_000 }),
    );

    expect((await cancelOwnBookingAction({}, form("b1"))).ok).toContain(
      "Sân sẽ hoàn 360.000đ cho bạn.",
    );
  });

  /**
   * Lỗi thật trước đây: huỷ trễ ở sân chỉ giữ lại 30% vẫn đọc "không được hoàn
   * tiền" — khách bỏ luôn 70% còn lại vì tưởng mất trắng.
   */
  it("huỷ trễ mà phí dưới 100% thì báo ĐÚNG phần giữ lại và phần được hoàn", async () => {
    vi.mocked(bookingService.cancel).mockResolvedValue(
      cancelResult({
        refundable: false,
        feePercent: 30,
        paidAmount: 360_000,
        refundableAmount: 252_000,
      }),
    );

    expect((await cancelOwnBookingAction({}, form("b1"))).ok).toBe(
      "Đã huỷ lượt 8F3K2M. Đã quá hạn huỷ miễn phí nên sân giữ lại 30% — bạn được hoàn 252.000đ.",
    );
  });

  it("huỷ trễ ở sân giữ lại 100% thì nói không được hoàn", async () => {
    vi.mocked(bookingService.cancel).mockResolvedValue(
      cancelResult({ refundable: false, feePercent: 100, paidAmount: 360_000 }),
    );

    expect((await cancelOwnBookingAction({}, form("b1"))).ok).toContain("không được hoàn tiền");
  });

  it("service từ chối (đã báo chuyển khoản) thì trả nguyên câu của service", async () => {
    vi.mocked(bookingService.cancel).mockRejectedValue(
      new BookingStateError(
        "Bạn đã báo chuyển khoản — sân đang kiểm tra. Liên hệ sân nếu muốn huỷ.",
      ),
    );

    expect(await cancelOwnBookingAction({}, form("b1"))).toEqual({
      error: "Bạn đã báo chuyển khoản — sân đang kiểm tra. Liên hệ sân nếu muốn huỷ.",
    });
  });
});
