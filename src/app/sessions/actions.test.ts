import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";

/**
 * Tự đăng xuất một thiết bị từ web phải để lại CÙNG dấu vết với khi làm qua
 * REST API (`DELETE /auth/sessions/[id]`). Trước đây chỉ API ghi nhật ký —
 * "ai đăng xuất thiết bị nào" phụ thuộc vào việc bấm ở đâu.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/services/token.service", () => ({ tokenService: { revokeById: vi.fn() } }));

import { getSession } from "@/lib/auth";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { tokenService } from "@/services/token.service";
import { revokeSessionAction } from "./actions";

const session: SessionPayload = { typ: "access", sub: "u1", email: "an@example.com", roles: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
});

describe("revokeSessionAction", () => {
  it("thu hồi phiên CỦA MÌNH và ghi nhật ký như API", async () => {
    vi.mocked(tokenService.revokeById).mockResolvedValue(true);

    await expect(revokeSessionAction("fam-1")).resolves.toEqual({});

    expect(tokenService.revokeById).toHaveBeenCalledWith("fam-1", "u1");
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.SESSION_REVOKED,
        actorId: "u1",
        metadata: expect.objectContaining({ sessionId: "fam-1" }),
      }),
    );
  });

  it("id không phải của mình (hoặc không tồn tại) → báo lỗi, không ghi nhật ký", async () => {
    vi.mocked(tokenService.revokeById).mockResolvedValue(false);

    const result = await revokeSessionAction("fam-nguoi-khac");

    expect(result.error).toBeDefined();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
