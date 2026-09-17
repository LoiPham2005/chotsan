import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import { VenueStatusTransitionError } from "@/lib/errors";
import type * as VenueServiceModule from "@/services/venue.service";

/**
 * Duyệt / trả hồ sơ cơ sở. Trả hồ sơ là về BẢN NHÁP kèm lý do — không phải khoá
 * vì vi phạm — và lý do là bắt buộc.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn() },
}));
vi.mock("@/services/venue.service", async (importOriginal) => {
  const actual = await importOriginal<typeof VenueServiceModule>();
  return { ...actual, venueService: { setStatus: vi.fn() } };
});

import { getSession } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { venueService } from "@/services/venue.service";
import { decideVenueAction } from "./actions";

const admin: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(permissionService.can).mockResolvedValue(true);
});

describe("decideVenueAction", () => {
  it("duyệt → mở bán, với vai admin", async () => {
    const result = await decideVenueAction({}, form({ venueId: "v1", decision: "ACTIVE" }));

    expect(venueService.setStatus).toHaveBeenCalledWith("v1", "ACTIVE", {
      actor: "admin",
      inactiveNote: null,
    });
    expect(result.ok).toMatch(/Đã duyệt/);
  });

  it("trả hồ sơ → BẢN NHÁP kèm lý do, không phải khoá", async () => {
    const result = await decideVenueAction(
      {},
      form({ venueId: "v1", decision: "DRAFT", note: "  Thiếu ảnh sân  " }),
    );

    expect(venueService.setStatus).toHaveBeenCalledWith("v1", "DRAFT", {
      actor: "admin",
      inactiveNote: "Thiếu ảnh sân",
    });
    expect(result.ok).toMatch(/trả hồ sơ/);
  });

  it("KHÔNG còn nhận quyết định khoá ở màn duyệt — từ chối không phải hình phạt", async () => {
    const result = await decideVenueAction(
      {},
      form({ venueId: "v1", decision: "ADMIN_LOCKED", note: "vi phạm" }),
    );

    expect(result.error).toBeDefined();
    expect(venueService.setStatus).not.toHaveBeenCalled();
  });

  it("trả hồ sơ mà thiếu lý do thì chặn, và trả lại chữ đã gõ", async () => {
    const result = await decideVenueAction(
      {},
      form({ venueId: "v1", decision: "DRAFT", note: "  " }),
    );

    expect(result.error).toMatch(/Ghi lý do/);
    expect(result.note).toBe("  ");
    expect(venueService.setStatus).not.toHaveBeenCalled();
  });

  it("service từ chối (hồ sơ vừa bị người khác xử lý) thì hiện câu đó, giữ nguyên lý do", async () => {
    vi.mocked(venueService.setStatus).mockRejectedValue(
      new VenueStatusTransitionError("Trạng thái cơ sở vừa được người khác thay đổi."),
    );

    const result = await decideVenueAction(
      {},
      form({ venueId: "v1", decision: "DRAFT", note: "Thiếu ảnh sân" }),
    );

    expect(result).toEqual({
      error: "Trạng thái cơ sở vừa được người khác thay đổi.",
      note: "Thiếu ảnh sân",
    });
  });

  it("thiếu mã cơ sở (trang cũ trong tab): câu lỗi nói phải làm gì, không phải 'thiếu thông tin'", async () => {
    const result = await decideVenueAction({}, form({ decision: "ACTIVE" }));

    expect(result.error).toBe(
      "Không biết đang duyệt cơ sở nào — tải lại trang rồi bấm lại giúp bạn nhé.",
    );
    expect(venueService.setStatus).not.toHaveBeenCalled();
  });

  it("không có `venue:approve` thì bị chặn trước khi chạm service", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(false);

    const result = await decideVenueAction({}, form({ venueId: "v1", decision: "ACTIVE" }));

    expect(result.error).toContain("không có quyền");
    expect(venueService.setStatus).not.toHaveBeenCalled();
  });
});
