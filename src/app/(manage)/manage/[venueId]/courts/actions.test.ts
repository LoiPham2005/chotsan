import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import { VenueConfigError } from "@/lib/errors";
import type * as CourtServiceModule from "@/services/court.service";

/**
 * Action sân con + bảng giá: quyền theo SÂN, id sân con từ form luôn đi kèm
 * `venueId` của URL, và dữ liệu hỏng không được văng ra error boundary.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/permission.service", () => ({
  permissionService: { canOnVenue: vi.fn() },
}));
vi.mock("@/services/court.service", async (importOriginal) => {
  const actual = await importOriginal<typeof CourtServiceModule>();
  return {
    ...actual,
    courtService: { create: vi.fn(), update: vi.fn(), setPriceRules: vi.fn() },
  };
});

import { getSession } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { courtService } from "@/services/court.service";
import { createCourtAction, savePriceRulesAction, toggleCourtAction } from "./actions";

const session: SessionPayload = {
  typ: "access",
  sub: "staff-1",
  email: "nv@example.com",
  roles: ["USER"],
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  vi.mocked(permissionService.canOnVenue).mockResolvedValue(true);
});

describe("savePriceRulesAction — lưu bảng giá", () => {
  /** Lỗi thật trước đây: `JSON.parse` nằm ngoài `try`, chuỗi hỏng ra error boundary. */
  it("JSON hỏng trả lỗi kiểm dữ liệu, KHÔNG ném ra ngoài và không gọi service", async () => {
    for (const rules of ["[{hỏng", "", "{}"]) {
      const result = await savePriceRulesAction("v1", {}, form({ rules }));

      expect(result.error, rules).toBe(
        "Không đọc được bảng giá gửi lên — tải lại trang rồi sửa lại giúp bạn nhé",
      );
    }
    expect(courtService.setPriceRules).not.toHaveBeenCalled();
  });

  it("một dòng sai thì câu lỗi chỉ đúng LUẬT NÀO và Ô NÀO — không phải 'bảng giá không hợp lệ'", async () => {
    const good = {
      courtId: null,
      weekdays: [],
      startMinute: 360,
      endMinute: 1320,
      pricePerSlot: 70_000,
      isPeak: false,
      priority: 0,
    };
    const rules = [good, good, { ...good, pricePerSlot: -5_000 }];

    const result = await savePriceRulesAction("v1", {}, form({ rules: JSON.stringify(rules) }));

    expect(result.error).toBe("Luật 3: Giá / 30 phút phải từ 0 trở lên");
    expect(courtService.setPriceRules).not.toHaveBeenCalled();
  });

  it("giá có phần lẻ cũng nói rõ luật và cách sửa", async () => {
    const rule = {
      courtId: null,
      weekdays: [],
      startMinute: 360,
      endMinute: 1320,
      pricePerSlot: 70_000.5,
      isPeak: false,
      priority: 0,
    };

    const result = await savePriceRulesAction("v1", {}, form({ rules: JSON.stringify([rule]) }));

    expect(result.error).toBe("Luật 1: Giá / 30 phút phải là số nguyên, không có phần lẻ");
  });

  it("luật chồng nhau thì hiện đúng câu service báo (chỉ ra luật nào)", async () => {
    vi.mocked(courtService.setPriceRules).mockRejectedValue(
      new VenueConfigError("Luật 2 và luật 3 chồng nhau: cùng ưu tiên 10"),
    );
    const rule = {
      courtId: null,
      weekdays: [],
      startMinute: 360,
      endMinute: 1320,
      pricePerSlot: 70_000,
      isPeak: false,
      priority: 10,
    };

    const result = await savePriceRulesAction("v1", {}, form({ rules: JSON.stringify([rule]) }));

    expect(result.error).toBe("Luật 2 và luật 3 chồng nhau: cùng ưu tiên 10");
    expect(courtService.setPriceRules).toHaveBeenCalledWith("v1", [rule]);
  });

  it("thiếu `pricing:update` thì bị chặn trước khi chạm service", async () => {
    vi.mocked(permissionService.canOnVenue).mockResolvedValue(false);

    await savePriceRulesAction("v1", {}, form({ rules: "[]" }));

    expect(permissionService.canOnVenue).toHaveBeenCalledWith("staff-1", "pricing:update", "v1");
    expect(courtService.setPriceRules).not.toHaveBeenCalled();
  });
});

describe("createCourtAction — thêm sân con", () => {
  it("lỗi thì TRẢ LẠI tên, mặt sân, trong nhà đã chọn — React 19 đã xoá trắng form", async () => {
    vi.mocked(courtService.create).mockRejectedValue(new VenueConfigError("Tên sân đã có"));

    const result = await createCourtAction(
      "v1",
      {},
      form({ name: "Sân 11", surface: "WOOD", isIndoor: "true" }),
    );

    expect(result.error).toBe("Tên sân đã có");
    expect(result.values).toEqual({ name: "Sân 11", surface: "WOOD", isIndoor: "true" });
  });

  it("tên trống thì báo ngay, không gọi service", async () => {
    const result = await createCourtAction("v1", {}, form({ name: "   ", surface: "" }));

    expect(result.error).toBe("Đặt tên cho sân");
    expect(courtService.create).not.toHaveBeenCalled();
  });

  it("mặt sân ngoài danh sách: câu lỗi nói đúng ô, không phải 'dữ liệu không hợp lệ'", async () => {
    const result = await createCourtAction("v1", {}, form({ name: "Sân 11", surface: "BANG" }));

    expect(result.error).toBe("Mặt sân: chọn một giá trị trong danh sách");
    expect(result.values).toEqual({ name: "Sân 11", surface: "BANG", isIndoor: "" });
  });

  it("thêm xong thì không trả `values` — form trống để thêm sân tiếp", async () => {
    vi.mocked(courtService.create).mockResolvedValue({ id: "c11" } as never);

    const result = await createCourtAction("v1", {}, form({ name: "Sân 11", surface: "" }));

    expect(result).toEqual({ ok: "Đã thêm Sân 11" });
    expect(vi.mocked(courtService.create).mock.calls[0]![0]).toMatchObject({
      venueId: "v1",
      name: "Sân 11",
      surface: null,
    });
  });
});

describe("toggleCourtAction — bật/tắt sân con", () => {
  it("id sân con từ form luôn đi kèm `venueId` của URL (GOTCHAS #19)", async () => {
    await toggleCourtAction("v1", {}, form({ courtId: "c9", isActive: "" }));

    expect(courtService.update).toHaveBeenCalledWith("c9", { isActive: false }, { venueId: "v1" });
  });

  it("thiếu id sân con (trang cũ trong tab): câu lỗi nói phải làm gì", async () => {
    const result = await toggleCourtAction("v1", {}, form({ isActive: "true" }));

    expect(result.error).toBe(
      "Không biết đang bật/tắt sân nào — tải lại trang rồi bấm lại giúp bạn nhé.",
    );
    expect(courtService.update).not.toHaveBeenCalled();
  });
});
