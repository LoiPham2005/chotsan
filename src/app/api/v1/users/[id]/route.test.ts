import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as UserServiceModule from "@/services/user.service";

/**
 * `PATCH /api/v1/users/[id]` là endpoint dễ mở đường leo thang đặc quyền nhất
 * trong repo: nó vừa phục vụ "người dùng tự sửa hồ sơ của mình", vừa phục vụ
 * "quản trị viên sửa hồ sơ người khác". Chỉ cần một nhánh quyền viết lỏng là
 * mọi tài khoản đều tự phong ADMIN được bằng một field trong body.
 *
 * Hai lỗi thật trước đây, hai chiều ngược nhau:
 *   • Tự sửa hồ sơ LUÔN bị 403 — chốt bậc vai trò chặn thao tác lên người
 *     ngang bậc, kể cả chính mình.
 *   • "Sửa" ngây thơ bằng cách bỏ chốt cho tự sửa sẽ cho tự đổi email (giữ dấu
 *     đã xác thực), số điện thoại, trạng thái.
 */

const cookieStore = { get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStore) }));

vi.mock("@/services/user.service", async (importOriginal) => {
  const actual = await importOriginal<typeof UserServiceModule>();
  return {
    ...actual,
    userService: {
      findById: vi.fn(),
      update: vi.fn(),
      updateProfile: vi.fn(),
      softDelete: vi.fn(),
    },
  };
});

vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn(), canActOnResource: vi.fn() },
}));
vi.mock("@/services/security-stamp.service", () => ({
  securityStampService: { isTokenStillValid: vi.fn().mockResolvedValue(true) },
}));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

import { signSession, type SessionPayload } from "@/lib/session";
import { userService } from "@/services/user.service";
import { permissionService } from "@/services/permission.service";
import { PATCH } from "./route";

const admin: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};
const user: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "user@example.com",
  roles: ["USER"],
};

type ErrorBody = { error: { code: string; message: string; fields?: Record<string, string[]> } };

const updated = {
  id: "user-1",
  email: "user@example.com",
  username: "user",
  fullName: "Tên mới",
  roles: ["USER"],
  phone: null,
  avatarUrl: null,
  twoFactorEnabled: false,
  lockedUntil: null,
  emailVerifiedAt: null,
  status: "ACTIVE" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function patch(id: string, body: unknown, token?: string) {
  return PATCH(
    new Request(`http://localhost/api/v1/users/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
  vi.mocked(userService.update).mockResolvedValue(updated);
  vi.mocked(userService.updateProfile).mockResolvedValue(updated);
  // Quyền theo bảng thật: USER có `profile:update:own`, chỉ ADMIN có `user:update`.
  vi.mocked(permissionService.can).mockImplementation((userId, permission) =>
    Promise.resolve(
      permission === "profile:update:own" || (userId === admin.sub && permission === "user:update"),
    ),
  );
});

describe("PATCH /api/v1/users/[id] — tự sửa hồ sơ", () => {
  it("401 khi không có token", async () => {
    const response = await patch("user-1", { fullName: "Tên mới" });

    expect(response.status).toBe(401);
    expect(userService.updateProfile).not.toHaveBeenCalled();
  });

  it("người dùng thường sửa được hồ sơ CỦA MÌNH — qua `updateProfile`, không qua chốt bậc", async () => {
    const response = await patch("user-1", { fullName: "Tên mới" }, await signSession(user));

    expect(response.status).toBe(200);
    expect(userService.updateProfile).toHaveBeenCalledWith("user-1", { fullName: "Tên mới" });
    expect(userService.update).not.toHaveBeenCalled();
  });

  it("ADMIN tự sửa tên của chính mình cũng được — bản cũ luôn trả 403", async () => {
    const response = await patch("admin-1", { fullName: "Quản trị" }, await signSession(admin));

    expect(response.status).toBe(200);
    expect(userService.updateProfile).toHaveBeenCalledWith("admin-1", { fullName: "Quản trị" });
  });

  /**
   * Bài test quan trọng nhất của file này.
   *
   * `profile:update:own` đủ để sửa hồ sơ của chính mình — nhưng KHÔNG được đủ
   * để đổi vai trò, trạng thái, email của chính mình.
   */
  it.each([
    [{ roleKeys: ["ADMIN"] }, "roleKeys", "vai trò"],
    [{ status: "ACTIVE" }, "status", "trạng thái"],
    [{ email: "moi@example.com" }, "email", "/api/v1/auth/change-email"],
    [{ phone: "0912345678" }, "phone", "/api/v1/auth/phone/request-otp"],
    [{ password: "matkhaumoi1" }, "password", "/api/v1/auth/change-password"],
  ])("tự gửi %j → 422 chỉ đúng luồng, không đụng service", async (body, field, hint) => {
    const response = await patch("user-1", { fullName: "x", ...body }, await signSession(user));
    const payload = (await response.json()) as ErrorBody;

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.fields?.[field]?.[0]).toContain(hint);
    expect(userService.update).not.toHaveBeenCalled();
    expect(userService.updateProfile).not.toHaveBeenCalled();
  });

  it("khoá trùng tên thuộc tính prototype (`constructor`, `toString`) không bị coi là trường cấm", async () => {
    const response = await patch(
      "user-1",
      { fullName: "Tên mới", constructor: 1, toString: "x" },
      await signSession(user),
    );

    expect(response.status).toBe(200);
    // Zod bỏ khoá lạ — chỉ trường hồ sơ tới được service.
    expect(userService.updateProfile).toHaveBeenCalledWith("user-1", { fullName: "Tên mới" });
  });

  it("thiếu `profile:update:own` thì 403", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(false);

    const response = await patch("user-1", { fullName: "Tên mới" }, await signSession(user));

    expect(response.status).toBe(403);
    expect(userService.updateProfile).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/users/[id] — sửa người khác", () => {
  it("403 khi người dùng thường sửa hồ sơ NGƯỜI KHÁC", async () => {
    const response = await patch("victim-9", { fullName: "Tên mới" }, await signSession(user));

    expect(response.status).toBe(403);
    expect(userService.update).not.toHaveBeenCalled();
  });

  it("ADMIN sửa người khác: actorId đi xuống service để chốt Role.level chạy", async () => {
    const response = await patch("user-1", { roleKeys: ["USER"] }, await signSession(admin));

    expect(response.status).toBe(200);
    expect(vi.mocked(userService.update).mock.calls[0]).toEqual([
      "user-1",
      { roleKeys: ["USER"] },
      { actorId: "admin-1" },
    ]);
  });

  it("422 khi body sai định dạng", async () => {
    const response = await patch(
      "user-1",
      { username: "CHỮ HOA CÓ DẤU" },
      await signSession(admin),
    );

    expect(response.status).toBe(422);
    expect(userService.update).not.toHaveBeenCalled();
  });
});
