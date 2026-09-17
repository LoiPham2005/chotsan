import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";

/**
 * Form tạo vai trò trên `/roles`: báo lỗi thì trả lại chữ vừa gõ (React 19 xoá
 * trắng form sau action) và câu lỗi nói đúng ô nào sai — không phải câu tiếng
 * Anh mặc định của Zod.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn().mockResolvedValue(true) },
}));
vi.mock("@/services/role.service", () => ({
  roleService: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

import { getSession } from "@/lib/auth";
import { RoleKeyAlreadyExistsError } from "@/lib/errors";
import { roleService } from "@/services/role.service";
import { createRoleAction, updateRolePermissionsAction } from "./actions";

const adminSession: SessionPayload = {
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
  vi.mocked(getSession).mockResolvedValue(adminSession);
});

describe("createRoleAction", () => {
  it("mã vai trò sai dạng: lỗi đúng ô, chữ vừa gõ được trả lại, không gọi service", async () => {
    const result = await createRoleAction(
      {},
      form({ key: "ke toan", name: "Kế toán", description: "Đối soát" }),
    );

    expect(result.fieldErrors?.key).toEqual(["Mã vai trò chỉ gồm CHỮ HOA, số và dấu gạch dưới"]);
    expect(result.values).toEqual({ key: "ke toan", name: "Kế toán", description: "Đối soát" });
    expect(roleService.create).not.toHaveBeenCalled();
  });

  it("mã quá dài: câu lỗi tiếng Việt nói giới hạn", async () => {
    const result = await createRoleAction({}, form({ key: "A".repeat(41), name: "Kế toán" }));

    expect(result.fieldErrors?.key).toEqual(["Mã vai trò dài quá — tối đa 40 ký tự"]);
  });

  it("mã đã tồn tại: lỗi ở ô mã, vẫn trả lại chữ vừa gõ", async () => {
    vi.mocked(roleService.create).mockRejectedValue(new RoleKeyAlreadyExistsError("KE_TOAN"));

    const result = await createRoleAction({}, form({ key: "KE_TOAN", name: "Kế toán" }));

    expect(result.fieldErrors?.key).toBeDefined();
    expect(result.values).toEqual({ key: "KE_TOAN", name: "Kế toán", description: "" });
  });

  it("tạo được thì KHÔNG trả `values` — form trống để tạo vai trò tiếp theo", async () => {
    vi.mocked(roleService.create).mockResolvedValue(undefined as never);

    const result = await createRoleAction({}, form({ key: "KE_TOAN", name: "Kế toán" }));

    expect(result.success).toContain("KE_TOAN");
    expect(result.values).toBeUndefined();
    expect(roleService.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "KE_TOAN", permissions: [] }),
      { actorId: "admin-1" },
    );
  });
});

describe("updateRolePermissionsAction", () => {
  it("thiếu mã vai trò (trang cũ, request tự chế): câu lỗi nói phải làm gì", async () => {
    const result = await updateRolePermissionsAction({}, form({}));

    expect(result.error).toBe(
      "Không biết đang lưu vai trò nào — tải lại trang rồi lưu lại giúp bạn nhé.",
    );
    expect(roleService.update).not.toHaveBeenCalled();
  });
});
