import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

/**
 * Ảnh tài khoản (khoá/xoá/đổi mật khẩu) đọc từ database — giả lập ở đây, thứ
 * đang kiểm là route PHẢN ỨNG thế nào với kết quả đó.
 */
vi.mock("@/services/security-stamp.service", () => ({
  securityStampService: { isTokenStillValid: vi.fn() },
}));
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn(), canOnVenue: vi.fn() },
}));

import { signSession } from "@/lib/session";
import { __clearRateLimits } from "@/lib/rate-limit";
import { permissionService } from "@/services/permission.service";
import { securityStampService } from "@/services/security-stamp.service";
import { ApiError } from "./response";
import {
  clientIp,
  enforceRateLimit,
  getApiSession,
  requireApiPermission,
  requireApiUser,
} from "./auth";

const adminPayload: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};
const userPayload: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "user@example.com",
  roles: ["USER"],
};

function requestWith(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/users", { headers });
}

beforeEach(async () => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
  vi.mocked(securityStampService.isTokenStillValid).mockResolvedValue(true);
  await __clearRateLimits();
});

describe("getApiSession", () => {
  it("đọc token từ header Authorization: Bearer", async () => {
    const token = await signSession(userPayload);

    await expect(
      getApiSession(requestWith({ authorization: `Bearer ${token}` })),
    ).resolves.toMatchObject(userPayload);
  });

  it("chấp nhận chữ 'bearer' viết thường", async () => {
    const token = await signSession(userPayload);

    await expect(
      getApiSession(requestWith({ authorization: `bearer ${token}` })),
    ).resolves.toMatchObject(userPayload);
  });

  it("bỏ qua scheme khác Bearer", async () => {
    const token = await signSession(userPayload);

    await expect(
      getApiSession(requestWith({ authorization: `Basic ${token}` })),
    ).resolves.toBeNull();
  });

  it("fallback về cookie khi không có header — để web dùng chung endpoint", async () => {
    const token = await signSession(adminPayload);
    cookieStore.get.mockReturnValue({ value: token });

    await expect(getApiSession(requestWith())).resolves.toMatchObject(adminPayload);
  });

  it("trả null khi không có nguồn nào", async () => {
    await expect(getApiSession(requestWith())).resolves.toBeNull();
  });

  it("trả null với token rác trong header", async () => {
    await expect(getApiSession(requestWith({ authorization: "Bearer rac" }))).resolves.toBeNull();
  });

  it("token ĐÚNG chữ ký của phiên đã bị thu hồi → như chưa đăng nhập", async () => {
    // Lỗi thật trước đây: khoá tài khoản hay đổi mật khẩu không cắt access
    // token đang cầm — kẻ đã chiếm tài khoản còn thao tác được tới hết hạn.
    vi.mocked(securityStampService.isTokenStillValid).mockResolvedValue(false);
    const token = await signSession(userPayload);

    await expect(
      getApiSession(requestWith({ authorization: `Bearer ${token}` })),
    ).resolves.toBeNull();
    await expect(
      requireApiUser(requestWith({ authorization: `Bearer ${token}` })),
    ).rejects.toMatchObject({ status: 401 });
    expect(securityStampService.isTokenStillValid).toHaveBeenCalledWith(
      "user-1",
      expect.any(Number),
    );
  });
});

describe("requireApiUser / requireApiPermission", () => {
  it("ném 401 khi chưa đăng nhập", async () => {
    await expect(requireApiUser(requestWith())).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
  });

  it("ném 403 — không phải 404 — khi thiếu quyền", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(false);
    const token = await signSession(userPayload);

    // Web trả 404 để giấu tài nguyên khỏi trình duyệt; API phải nói rõ để
    // client phân biệt được "đăng nhập lại" với "không đủ quyền".
    await expect(
      requireApiPermission(requestWith({ authorization: `Bearer ${token}` }), "user:read"),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("hỏi quyền theo userId từ database, không theo vai trò trong token", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(true);
    const token = await signSession(adminPayload);

    await expect(
      requireApiPermission(requestWith({ authorization: `Bearer ${token}` }), "user:read"),
    ).resolves.toMatchObject(adminPayload);
    expect(permissionService.can).toHaveBeenCalledWith("admin-1", "user:read");
  });
});

describe("clientIp", () => {
  it("lấy IP do proxy TIN CẬY thêm vào — phần tử cuối với TRUSTED_PROXY_HOPS=1", () => {
    // Phần tử ĐẦU do client tự gửi: nginx nối IP thật vào cuối chuỗi, nên
    // `X-Forwarded-For: 1.2.3.4` tự chế thành `1.2.3.4, <ip thật>`. Lấy phần tử
    // đầu là để kẻ dò tự chọn xô đếm, mỗi request một IP bịa.
    expect(clientIp(requestWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("fallback x-real-ip rồi tới 'unknown'", () => {
    expect(clientIp(requestWith({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(requestWith())).toBe("unknown");
  });
});

describe("enforceRateLimit", () => {
  it("ném ApiError 429 kèm số giây chờ khi vượt ngưỡng", async () => {
    const request = requestWith({ "x-forwarded-for": "1.1.1.1" });
    const options = { limit: 2, windowSeconds: 60 };

    await enforceRateLimit(request, "login", options);
    await enforceRateLimit(request, "login", options);

    await expect(enforceRateLimit(request, "login", options)).rejects.toThrowError(ApiError);
    await expect(enforceRateLimit(request, "login", options)).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: expect.any(Number),
    });
  });

  it("đếm riêng theo IP", async () => {
    const options = { limit: 1, windowSeconds: 60 };

    await enforceRateLimit(requestWith({ "x-forwarded-for": "1.1.1.1" }), "login", options);

    // IP khác thì có bộ đếm riêng, nên vẫn qua được dù IP kia đã chạm ngưỡng.
    await expect(
      enforceRateLimit(requestWith({ "x-forwarded-for": "2.2.2.2" }), "login", options),
    ).resolves.toBeTypeOf("string");
  });

  it("khoá đếm trùng khoá của Server Action cùng luồng — web và API chung một xô", async () => {
    const key = await enforceRateLimit(requestWith({ "x-forwarded-for": "3.3.3.3" }), "login", {
      limit: 5,
      windowSeconds: 60,
    });

    expect(key).toBe("login:3.3.3.3");
  });
});
