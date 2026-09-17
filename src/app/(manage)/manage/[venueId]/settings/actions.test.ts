import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import { VenueNotReadyError } from "@/lib/errors";
import type * as VenueServiceModule from "@/services/venue.service";

/**
 * Action của trang cài đặt sân: quyền theo SÂN, dữ liệu hỏng không được văng
 * ra error boundary, và gõ sai thì không mất dữ liệu đã nhập.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/permission.service", () => ({
  permissionService: { canOnVenue: vi.fn() },
}));
vi.mock("@/services/venue.service", async (importOriginal) => {
  const actual = await importOriginal<typeof VenueServiceModule>();
  return {
    ...actual,
    venueService: { update: vi.fn(), setHours: vi.fn(), setStatus: vi.fn() },
  };
});

import { getSession } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";
import {
  submitForReviewAction,
  updateBankAction,
  updateHoursAction,
  updateVenueAction,
} from "./actions";

const session: SessionPayload = {
  typ: "access",
  sub: "owner-1",
  email: "chu@example.com",
  roles: ["USER"],
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const WEEK = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  openMinute: 360,
  closeMinute: 1320,
  isClosed: false,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(permissionService.canOnVenue).mockResolvedValue(true);
});

describe("updateHoursAction — giờ mở cửa", () => {
  /** Lỗi thật trước đây: `JSON.parse` nằm ngoài `try`, chuỗi hỏng ra error boundary. */
  it("JSON hỏng trả lỗi kiểm dữ liệu, KHÔNG ném ra ngoài và không gọi service", async () => {
    for (const hours of ["{không phải json", "", "null"]) {
      const result = await updateHoursAction("v1", {}, form({ hours }));

      expect(result.error, hours).toBe(
        "Không đọc được bảng giờ mở cửa gửi lên — tải lại trang rồi sửa lại giúp bạn nhé",
      );
    }
    expect(venueService.setHours).not.toHaveBeenCalled();
  });

  it("một ngày hỏng thì câu lỗi gọi đúng TÊN ngày đó", async () => {
    const broken = WEEK.map((day) => (day.weekday === 3 ? { ...day, closeMinute: 99_999 } : day));

    const result = await updateHoursAction("v1", {}, form({ hours: JSON.stringify(broken) }));

    expect(result.error).toBe(
      "Không đọc được giờ mở cửa của Thứ 4 — tải lại trang rồi chọn lại giờ giúp bạn nhé",
    );
    expect(venueService.setHours).not.toHaveBeenCalled();
  });

  it("dữ liệu đúng thì ghi cả tuần cho ĐÚNG sân của URL", async () => {
    const result = await updateHoursAction("v1", {}, form({ hours: JSON.stringify(WEEK) }));

    expect(result.ok).toBe("Đã lưu giờ mở cửa");
    expect(venueService.setHours).toHaveBeenCalledWith("v1", WEEK);
  });
});

describe("updateVenueAction — hồ sơ sân", () => {
  const PROFILE = {
    name: "Sân ABC",
    description: "Mô tả mới",
    address: "1 Nguyễn Trãi",
    ward: "Phường Thanh Xuân",
    province: "Hà Nội",
    phone: "12",
    amenities: "Wifi, Bãi xe",
    holdMinutes: "15",
    freeCancelHours: "2",
    cancelFeePercent: "50",
  };

  it("gõ sai số điện thoại thì báo lỗi và TRẢ LẠI mọi ô đã gõ — React 19 đã xoá trắng form", async () => {
    const result = await updateVenueAction("v1", {}, form(PROFILE));

    expect(result.error).toMatch(/Số điện thoại/);
    expect(result.values).toEqual(PROFILE);
    expect(venueService.update).not.toHaveBeenCalled();
  });

  it("số ngoài khoảng: câu lỗi gọi đúng tên ô trên màn, không phải câu tiếng Anh của Zod", async () => {
    const result = await updateVenueAction(
      "v1",
      {},
      form({ ...PROFILE, phone: "0987654321", holdMinutes: "3" }),
    );

    expect(result.error).toBe("Giữ chỗ (phút) phải từ 5 trở lên");
    expect(result.values?.holdMinutes).toBe("3");
  });

  it("chữ ở ô số: nói ô đó phải là số", async () => {
    const result = await updateVenueAction(
      "v1",
      {},
      form({ ...PROFILE, phone: "0987654321", cancelFeePercent: "nửa" }),
    );

    expect(result.error).toBe("Phí huỷ trễ (%) phải là một con số");
  });

  it("không có `venue:update` trên sân này thì bị chặn trước khi chạm service", async () => {
    vi.mocked(permissionService.canOnVenue).mockResolvedValue(false);

    const result = await updateVenueAction("v1", {}, form({ ...PROFILE, phone: "0987654321" }));

    expect(result.error).toContain("không có quyền");
    expect(permissionService.canOnVenue).toHaveBeenCalledWith("owner-1", "venue:update", "v1");
    expect(venueService.update).not.toHaveBeenCalled();
  });
});

describe("updateBankAction — tài khoản nhận tiền", () => {
  it("khai một nửa thì báo và giữ nguyên ba ô đã gõ", async () => {
    const typed = { bankName: "VCB", bankAccountNumber: "1234567890", bankAccountName: "" };

    const result = await updateBankAction("v1", {}, form(typed));

    expect(result.error).toMatch(/đủ cả ba ô/);
    expect(result.values).toEqual(typed);
  });
});

describe("submitForReviewAction — gửi duyệt", () => {
  it("chuyển ĐÚNG sân của URL sang chờ duyệt, với vai chủ sân", async () => {
    const result = await submitForReviewAction("v1", {}, new FormData());

    expect(venueService.setStatus).toHaveBeenCalledWith("v1", "PENDING", { actor: "owner" });
    expect(result.ok).toMatch(/Đã gửi hồ sơ/);
  });

  it("chưa đủ điều kiện thì hiện đúng câu còn thiếu gì", async () => {
    vi.mocked(venueService.setStatus).mockRejectedValue(
      new VenueNotReadyError(["tài khoản nhận tiền"], "gửi duyệt"),
    );

    const result = await submitForReviewAction("v1", {}, new FormData());

    expect(result.error).toBe("Chưa gửi duyệt được: sân còn thiếu tài khoản nhận tiền");
  });

  it("không có quyền trên sân thì không gửi được", async () => {
    vi.mocked(permissionService.canOnVenue).mockResolvedValue(false);

    await submitForReviewAction("v1", {}, new FormData());

    expect(venueService.setStatus).not.toHaveBeenCalled();
  });
});
