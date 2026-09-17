import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";

/**
 * Form tự phục vụ trên `/security`. Ba điều phải giữ:
 *
 *   1. Đổi mật khẩu KHÔNG đá chính trình duyệt đang thao tác ra: cookie mới
 *      được cấp SAU khi đổi, mang nguyên danh tính và `mfa` của phiên cũ.
 *   2. Mọi luồng có trần theo IP dùng CHUNG xô với REST API — không thì kẻ dò
 *      mật khẩu hiện tại chỉ việc chuyển sang gọi action.
 *   3. Lỗi nghiệp vụ hiện đúng ô sai, không hiện câu của luồng đăng nhập.
 *
 * Service được giả lập (luật của chúng có test riêng); rate limit chạy thật
 * trên store RAM.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(), createSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.7" })),
}));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/services/auth.service", () => ({
  authService: {
    changePassword: vi.fn(),
    sendEmailVerification: vi.fn(),
    requestEmailChange: vi.fn(),
  },
}));
vi.mock("@/services/two-factor.service", () => ({
  twoFactorService: { disable: vi.fn(), confirmSetup: vi.fn(), regenerateRecoveryCodes: vi.fn() },
}));
vi.mock("@/services/webauthn.service", () => ({ webauthnService: { remove: vi.fn() } }));

import { createSession, getSession } from "@/lib/auth";
import { DuplicateFieldError, InvalidCredentialsError } from "@/lib/errors";
import { __clearRateLimits, ipRateLimitKey, rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";
import { twoFactorService } from "@/services/two-factor.service";
import {
  changePasswordAction,
  disableTwoFactorAction,
  requestEmailChangeAction,
  resendVerificationEmailAction,
} from "./actions";

const session: SessionPayload = {
  typ: "access",
  sub: "u1",
  email: "an@example.com",
  roles: ["USER"],
  mfa: "2026-09-17T08:00:00.000Z",
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const PASSWORD_FORM = { currentPassword: "mat-khau-cu-1", newPassword: "Mat-khau-moi-2026" };

/** Đốt hết lượt của một xô như thể REST API vừa bị gọi từ cùng IP. */
async function exhaust(bucket: Parameters<typeof ipRateLimitKey>[0], limit: number) {
  for (let i = 0; i < limit; i++) {
    await rateLimit(ipRateLimitKey(bucket, "203.0.113.7"), { limit, windowSeconds: 900 });
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(session);
  await __clearRateLimits();
});

describe("changePasswordAction", () => {
  it("chưa đăng nhập → từ chối, không chạm service", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await changePasswordAction({}, form(PASSWORD_FORM));

    expect(result.error).toBeDefined();
    expect(authService.changePassword).not.toHaveBeenCalled();
  });

  it("đổi xong cấp lại cookie CÙNG danh tính và `mfa` — trình duyệt này không bị đá ra", async () => {
    const result = await changePasswordAction({}, form(PASSWORD_FORM));

    expect(result.success).toBeDefined();
    expect(authService.changePassword).toHaveBeenCalledWith(
      "u1",
      PASSWORD_FORM.currentPassword,
      PASSWORD_FORM.newPassword,
    );
    expect(createSession).toHaveBeenCalledWith({
      typ: "access",
      sub: "u1",
      email: "an@example.com",
      roles: ["USER"],
      mfa: "2026-09-17T08:00:00.000Z",
    });
    // Cookie cấp SAU khi service đã ghi mốc đổi mật khẩu — cấp trước thì chính
    // cookie mới cũng bị coi là phiên cũ.
    expect(vi.mocked(createSession).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(authService.changePassword).mock.invocationCallOrder[0]!,
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.PASSWORD_CHANGED, entityId: "u1" }),
    );
  });

  it("sai mật khẩu hiện tại → lỗi ĐÚNG ô đó, không cấp cookie, không ghi nhật ký", async () => {
    vi.mocked(authService.changePassword).mockRejectedValue(new InvalidCredentialsError("u1"));

    const result = await changePasswordAction({}, form(PASSWORD_FORM));

    expect(result.fieldErrors?.currentPassword).toEqual(["Mật khẩu hiện tại không đúng"]);
    expect(createSession).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it("mật khẩu mới trùng mật khẩu cũ → lỗi ô, không gọi service", async () => {
    const result = await changePasswordAction(
      {},
      form({ currentPassword: "Mat-khau-moi-2026", newPassword: "Mat-khau-moi-2026" }),
    );

    expect(result.fieldErrors?.newPassword).toBeDefined();
    expect(authService.changePassword).not.toHaveBeenCalled();
  });

  it("dùng CHUNG xô với `POST /auth/change-password`: API đã hết lượt thì action cũng hết", async () => {
    await exhaust("password-change", RATE_LIMITS.passwordChange.limit);

    const result = await changePasswordAction({}, form(PASSWORD_FORM));

    expect(result.error).toMatch(/quá nhiều lần/);
    expect(authService.changePassword).not.toHaveBeenCalled();
  });
});

describe("resendVerificationEmailAction", () => {
  it("gửi tới địa chỉ của CHÍNH tài khoản — không nhận địa chỉ từ form", async () => {
    const result = await resendVerificationEmailAction({});

    expect(result.success).toBeDefined();
    expect(authService.sendEmailVerification).toHaveBeenCalledWith("u1");
  });

  it("quá trần gửi thư → báo đợi, không gửi thêm", async () => {
    for (let i = 0; i < RATE_LIMITS.emailVerificationRequest.limit; i++) {
      await resendVerificationEmailAction({});
    }
    vi.mocked(authService.sendEmailVerification).mockClear();

    const result = await resendVerificationEmailAction({});

    expect(result.error).toMatch(/đợi/);
    expect(authService.sendEmailVerification).not.toHaveBeenCalled();
  });
});

describe("requestEmailChangeAction", () => {
  const EMAIL_FORM = { newEmail: "moi@example.com", password: "mat-khau-cu-1" };

  it("gửi liên kết, ghi nhật ký, báo địa chỉ đang chờ", async () => {
    const result = await requestEmailChangeAction({}, form(EMAIL_FORM));

    expect(authService.requestEmailChange).toHaveBeenCalledWith(
      "u1",
      "moi@example.com",
      "mat-khau-cu-1",
    );
    expect(result.success).toContain("moi@example.com");
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.EMAIL_CHANGE_REQUESTED,
        metadata: expect.objectContaining({ newEmail: "moi@example.com" }),
      }),
    );
  });

  it("sai mật khẩu → lỗi ở ô mật khẩu", async () => {
    vi.mocked(authService.requestEmailChange).mockRejectedValue(new InvalidCredentialsError());

    const result = await requestEmailChangeAction({}, form(EMAIL_FORM));

    expect(result.fieldErrors?.password).toEqual(["Mật khẩu hiện tại không đúng"]);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it("báo lỗi thì trả lại email mới vừa gõ để form dựng lại — KHÔNG trả mật khẩu", async () => {
    vi.mocked(authService.requestEmailChange).mockRejectedValue(new InvalidCredentialsError());

    const result = await requestEmailChangeAction({}, form(EMAIL_FORM));

    expect(result.values).toEqual({ newEmail: "moi@example.com" });
    expect(JSON.stringify(result)).not.toContain(EMAIL_FORM.password);
  });

  it("email đã thuộc tài khoản khác → lỗi ở ô email mới", async () => {
    vi.mocked(authService.requestEmailChange).mockRejectedValue(
      new DuplicateFieldError("email", "moi@example.com"),
    );

    const result = await requestEmailChangeAction({}, form(EMAIL_FORM));

    expect(result.fieldErrors?.newEmail).toBeDefined();
  });

  it("email sai định dạng → lỗi ô, không gọi service", async () => {
    const result = await requestEmailChangeAction(
      {},
      form({ newEmail: "khong-phai-email", password: "x" }),
    );

    expect(result.fieldErrors?.newEmail).toBeDefined();
    expect(authService.requestEmailChange).not.toHaveBeenCalled();
  });
});

describe("action 2FA có trần theo IP", () => {
  it("tắt 2FA: hết lượt thì không chạm service — service so MẬT KHẨU trước mã", async () => {
    await exhaust("2fa", RATE_LIMITS.twoFactor.limit);

    const result = await disableTwoFactorAction("mat-khau-doan", "123456");

    expect(result.error).toMatch(/quá nhiều lần/);
    expect(twoFactorService.disable).not.toHaveBeenCalled();
  });
});
