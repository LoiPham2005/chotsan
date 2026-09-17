import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sessionId` là thứ client dùng để tự nhận ra mình trong danh sách "thiết bị
 * đang đăng nhập". Nó phải là `familyId` — giá trị ỔN ĐỊNH qua mọi lần refresh
 * — chứ không phải `id` của bản ghi token, thứ đổi sau mỗi lần xoay vòng.
 *
 * Đây là lỗi ĐÃ XẢY RA: `/auth/login` trả `familyId` còn `/auth/refresh` trả
 * `id`. Không request nào lỗi, chỉ là sau lần refresh đầu tiên client giữ một
 * giá trị không khớp dòng nào — màn thiết bị không đánh dấu được máy hiện tại,
 * và `DELETE /auth/sessions/{id}` với giá trị đó trả 404.
 */

vi.mock("@/services/token.service", () => ({
  tokenService: { rotate: vi.fn() },
}));

vi.mock("@/services/user.service", () => ({
  userService: { findById: vi.fn() },
}));

vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

import { RefreshTokenReuseError } from "@/lib/errors";
import { __clearRateLimits } from "@/lib/rate-limit";
import { verifySession } from "@/lib/session";
import { auditService } from "@/services/audit.service";
import { tokenService } from "@/services/token.service";
import { userService } from "@/services/user.service";
import { POST } from "./route";

const ROTATED = {
  userId: "u-1",
  refresh: {
    id: "row-id-đổi-mỗi-lần-xoay",
    familyId: "family-id-ổn-định",
    token: "refresh-token-mới",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  },
  twoFactorAt: null,
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await __clearRateLimits();
  vi.mocked(tokenService.rotate).mockResolvedValue(ROTATED);
  vi.mocked(userService.findById).mockResolvedValue({
    id: "u-1",
    email: "a@b.com",
    phone: null,
    username: null,
    fullName: null,
    avatarUrl: null,
    status: "ACTIVE",
    emailVerifiedAt: null,
    lockedUntil: null,
    twoFactorEnabled: false,
    roles: ["USER"],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("POST /api/v1/auth/refresh", () => {
  it("trả familyId làm sessionId, KHÔNG phải id bản ghi token", async () => {
    const response = await post({ refreshToken: "cũ" });
    const body = (await response.json()) as { data: { sessionId: string } };

    expect(response.status).toBe(200);
    expect(body.data.sessionId).toBe(ROTATED.refresh.familyId);
    expect(body.data.sessionId).not.toBe(ROTATED.refresh.id);
  });

  it("401 khi refresh token không tồn tại hoặc đã hết hạn", async () => {
    vi.mocked(tokenService.rotate).mockResolvedValue(null);

    const response = await post({ refreshToken: "rác" });

    expect(response.status).toBe(401);
  });

  it("tra lại user thay vì tin dữ liệu gắn kèm token cũ", async () => {
    // Refresh là đúng thời điểm nhặt thay đổi: vai trò vừa bị gỡ, tài khoản
    // vừa bị khoá. Ký lại token mang vai trò cũ là kéo dài thêm một vòng đời
    // cho trạng thái đã lỗi thời.
    await post({ refreshToken: "cũ" });

    expect(userService.findById).toHaveBeenCalledWith("u-1");
  });

  it("401 khi user đã bị xoá giữa hai lần gọi", async () => {
    vi.mocked(userService.findById).mockResolvedValue(null);

    const response = await post({ refreshToken: "cũ" });

    expect(response.status).toBe(401);
  });

  it("phiên đã qua 2FA thì access token MỚI vẫn mang `mfa`, và IP được lưu vào token mới", async () => {
    // Lỗi thật trước đây: từ lần refresh đầu tiên access token mất `mfa`, token
    // mới cũng không lưu `ip` — màn thiết bị hiện IP trống.
    const twoFactorAt = new Date("2026-09-10T08:00:00Z");
    vi.mocked(tokenService.rotate).mockResolvedValue({ ...ROTATED, twoFactorAt });

    const response = await post({ refreshToken: "cũ" });
    const body = (await response.json()) as { data: { accessToken: string } };

    expect((await verifySession(body.data.accessToken))?.mfa).toBe(twoFactorAt.toISOString());
    expect(vi.mocked(tokenService.rotate).mock.calls[0]?.[1]).toMatchObject({ ip: "203.0.113.5" });
  });

  it("token đã thu hồi bị nộp lại → 401 VÀ một dòng nhật ký theo tài khoản", async () => {
    vi.mocked(tokenService.rotate).mockRejectedValue(new RefreshTokenReuseError("u-1"));

    const response = await post({ refreshToken: "bi-danh-cap" });

    expect(response.status).toBe(401);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.refresh_token_reused", entityId: "u-1" }),
    );
  });
});
