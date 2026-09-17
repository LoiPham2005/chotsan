import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type * as BookingServiceModule from "@/services/booking.service";

/**
 * Chủ sân huỷ hộ khách. Hai thứ phải đúng: lượt đặt chỉ được huỷ trên đúng sân
 * người bấm có quyền (GOTCHAS #19), và câu trả về nói ĐÚNG việc phải làm với
 * tiền — nhất là khi khách đã báo chuyển khoản.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/permission.service", () => ({
  permissionService: { canOnVenue: vi.fn() },
}));
vi.mock("@/services/booking.service", async (importOriginal) => {
  const actual = await importOriginal<typeof BookingServiceModule>();
  return { ...actual, bookingService: { cancel: vi.fn(), checkIn: vi.fn() } };
});

import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { bookingService } from "@/services/booking.service";
import { permissionService } from "@/services/permission.service";
import { cancelBookingAction } from "./actions";

const OWNER: SessionPayload = { typ: "access", sub: "u9", email: "o@b.com", roles: ["USER"] };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
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
  vi.mocked(getSession).mockResolvedValue(OWNER);
  vi.mocked(permissionService.canOnVenue).mockResolvedValue(true);
  vi.mocked(bookingService.cancel).mockResolvedValue(cancelResult({}));
});

describe("cancelBookingAction — chủ sân huỷ hộ", () => {
  it("thiếu quyền `booking:cancel` trên sân thì từ chối, không huỷ gì", async () => {
    vi.mocked(permissionService.canOnVenue).mockResolvedValue(false);

    const result = await cancelBookingAction("v1", {}, form({ bookingId: "b1" }));

    expect(result.error).toContain("không có quyền");
    expect(permissionService.canOnVenue).toHaveBeenCalledWith("u9", "booking:cancel", "v1");
    expect(bookingService.cancel).not.toHaveBeenCalled();
  });

  it("huỷ với tư cách SÂN, kèm lý do đã nhập và `venueId` của URL", async () => {
    await cancelBookingAction("v1", {}, form({ bookingId: "b1", reason: "  Sân mất điện  " }));

    expect(bookingService.cancel).toHaveBeenCalledWith("b1", {
      actor: "VENUE",
      reason: "Sân mất điện",
      cancelledBy: "u9",
      venueId: "v1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/manage/v1");
    expect(revalidatePath).toHaveBeenCalledWith("/manage/v1/payments");
  });

  it("không nhập lý do thì ghi 'Sân huỷ'", async () => {
    await cancelBookingAction("v1", {}, form({ bookingId: "b1", reason: "   " }));

    expect(vi.mocked(bookingService.cancel).mock.calls[0]![1].reason).toBe("Sân huỷ");
  });

  it("lý do quá dài báo đúng lý do, không huỷ", async () => {
    const result = await cancelBookingAction(
      "v1",
      {},
      form({ bookingId: "b1", reason: "x".repeat(301) }),
    );

    expect(result.error).toContain("300");
    expect(bookingService.cancel).not.toHaveBeenCalled();
  });

  it("thiếu mã lượt đặt (trang cũ trong tab): câu lỗi nói phải làm gì", async () => {
    const result = await cancelBookingAction("v1", {}, form({}));

    expect(result.error).toBe(
      "Không biết đang thao tác với lượt đặt nào — tải lại trang rồi bấm lại giúp bạn nhé.",
    );
    expect(bookingService.cancel).not.toHaveBeenCalled();
  });

  it("khách chưa trả tiền: nói không phải hoàn — không bịa ra số tiền cần hoàn", async () => {
    expect((await cancelBookingAction("v1", {}, form({ bookingId: "b1" }))).ok).toBe(
      "Đã huỷ lượt 8F3K2M. Khách chưa thanh toán nên không phải hoàn tiền.",
    );
  });

  it("khách đã BÁO chuyển khoản: nhắc đối chiếu sao kê trước khi hoàn", async () => {
    vi.mocked(bookingService.cancel).mockResolvedValue(cancelResult({ awaitingAmount: 360_000 }));

    expect((await cancelBookingAction("v1", {}, form({ bookingId: "b1" }))).ok).toContain(
      "Khách đã báo chuyển 360.000đ — đối chiếu sao kê",
    );
  });

  it("đã nhận tiền: nói số phải hoàn, kể cả khi ngoài hạn mà phí dưới 100%", async () => {
    vi.mocked(bookingService.cancel).mockResolvedValue(
      cancelResult({ refundable: false, paidAmount: 360_000, refundableAmount: 180_000 }),
    );

    expect((await cancelBookingAction("v1", {}, form({ bookingId: "b1" }))).ok).toContain(
      "vẫn cần hoàn 180.000đ",
    );
  });
});
