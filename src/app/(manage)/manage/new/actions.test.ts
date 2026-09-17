import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import { VenueDraftLimitError } from "@/lib/errors";
import type * as VenueServiceModule from "@/services/venue.service";

/**
 * Đăng ký cơ sở mới là cửa mở cho MỌI người đã đăng nhập. Hai thứ phải giữ:
 * chủ sở hữu luôn là người đang đăng nhập (không bao giờ lấy từ form), và gõ
 * sai một ô thì không mất cả hồ sơ vừa điền.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  // `redirect()` thật ném một lỗi đặc biệt để dừng action — giả lập đúng như vậy.
  redirect: vi.fn((path: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { path });
  }),
}));
vi.mock("@/services/venue.service", async (importOriginal) => {
  const actual = await importOriginal<typeof VenueServiceModule>();
  return { ...actual, venueService: { create: vi.fn() } };
});

import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { venueService } from "@/services/venue.service";
import { createVenueAction } from "./actions";

const session: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "chu@example.com",
  roles: ["USER"],
};

const VALID = {
  name: "Sân cầu lông Thành Công",
  sportId: "sport-1",
  address: "168 Thái Hà",
  ward: "Phường Láng Hạ",
  province: "Hà Nội",
  phone: "0987654321",
  description: "",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
});

describe("createVenueAction — đăng ký cơ sở mới", () => {
  it("chưa đăng nhập thì từ chối và KHÔNG tạo gì", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await createVenueAction({}, form(VALID));

    expect(result.error).toContain("đăng nhập");
    expect(venueService.create).not.toHaveBeenCalled();
  });

  it("chủ sở hữu lấy từ PHIÊN — `ownerId` gửi kèm form bị bỏ qua", async () => {
    vi.mocked(venueService.create).mockResolvedValue({ id: "venue-9" } as never);

    await expect(
      createVenueAction({}, form({ ...VALID, ownerId: "another-user" })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(vi.mocked(venueService.create).mock.calls[0]![0]).toEqual({
      name: "Sân cầu lông Thành Công",
      sportId: "sport-1",
      address: "168 Thái Hà",
      ward: "Phường Láng Hạ",
      province: "Hà Nội",
      phone: "0987654321",
      description: null,
      ownerId: "user-1",
    });
  });

  it("tạo xong thì sang trang cài đặt của cơ sở vừa tạo — nơi có danh sách việc cần làm", async () => {
    vi.mocked(venueService.create).mockResolvedValue({ id: "venue-9" } as never);

    await expect(createVenueAction({}, form(VALID))).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/manage/venue-9/settings");
  });

  it("gõ sai một ô thì báo đúng ô đó và TRẢ LẠI mọi chữ đã gõ, không gọi service", async () => {
    const typed = { ...VALID, phone: "12345", description: "Có bãi đỗ xe" };

    const result = await createVenueAction({}, form(typed));

    expect(result.error).toMatch(/Số điện thoại/);
    expect(result.values).toEqual(typed);
    expect(venueService.create).not.toHaveBeenCalled();
  });

  it("lỗi nghiệp vụ (quá số hồ sơ chưa duyệt) hiện thành câu, vẫn giữ chữ đã gõ", async () => {
    vi.mocked(venueService.create).mockRejectedValue(new VenueDraftLimitError(3));

    const result = await createVenueAction({}, form(VALID));

    expect(result.error).toMatch(/3 cơ sở chưa được duyệt/);
    expect(result.values?.name).toBe(VALID.name);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lỗi lạ ném lên nguyên vẹn, không lộ thành câu cho người dùng", async () => {
    vi.mocked(venueService.create).mockRejectedValue(new Error("Can't reach database server"));

    await expect(createVenueAction({}, form(VALID))).rejects.toThrow("reach database");
  });
});
