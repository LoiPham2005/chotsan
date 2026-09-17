import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Form xác thực trả lại chữ vừa gõ KÈM LỖI (React 19 xoá trắng form sau action),
 * nhưng mật khẩu KHÔNG BAO GIỜ nằm trong phản hồi — nó không được đi ngược từ
 * máy chủ về HTML.
 *
 * Service được giả lập; rate limit chạy thật trên store RAM.
 */

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-forwarded-for": "203.0.113.9" })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/auth", () => ({ createSession: vi.fn(), destroySession: vi.fn() }));
vi.mock("@/lib/landing", () => ({ landingPathFor: vi.fn().mockResolvedValue("/") }));
vi.mock("@/lib/oauth/two-factor-cookie", () => ({
  clearPendingTwoFactor: vi.fn(),
  readPendingTwoFactor: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/tickets", () => ({
  consumeTicket: vi.fn(),
  issueTwoFactorTicket: vi.fn(),
  verifyTicket: vi.fn(),
}));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn(), recordLoginFailure: vi.fn() },
}));
vi.mock("@/services/auth.service", () => ({
  authService: {
    validateCredentials: vi.fn(),
    register: vi.fn(),
    requestPasswordReset: vi.fn(),
  },
}));
vi.mock("@/services/two-factor.service", () => ({ twoFactorService: { verifyCode: vi.fn() } }));

import { DuplicateFieldError, InvalidCredentialsError } from "@/lib/errors";
import { __clearRateLimits } from "@/lib/rate-limit";
import { authService } from "@/services/auth.service";
import { forgotPasswordAction, loginAction, registerAction } from "./actions";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await __clearRateLimits();
});

describe("loginAction", () => {
  it("sai mật khẩu: trả lại email đã gõ, KHÔNG trả mật khẩu", async () => {
    vi.mocked(authService.validateCredentials).mockRejectedValue(new InvalidCredentialsError());

    const result = await loginAction(
      {},
      form({ identifier: "an@example.com", password: "mat-khau-bi-mat" }),
    );

    expect(result.error).toBe("Thông tin đăng nhập không chính xác");
    expect(result.values).toEqual({ identifier: "an@example.com" });
    expect(JSON.stringify(result)).not.toContain("mat-khau-bi-mat");
  });

  it("bỏ trống mật khẩu: lỗi đúng ô, email vẫn được trả lại", async () => {
    const result = await loginAction({}, form({ identifier: "an@example.com", password: "" }));

    expect(result.fieldErrors?.password).toEqual(["Vui lòng nhập mật khẩu"]);
    expect(result.values).toEqual({ identifier: "an@example.com" });
    expect(authService.validateCredentials).not.toHaveBeenCalled();
  });
});

describe("registerAction", () => {
  it("email đã có tài khoản: trả lại tên + email, KHÔNG trả mật khẩu", async () => {
    vi.mocked(authService.register).mockRejectedValue(
      new DuplicateFieldError("email", "an@example.com"),
    );

    const result = await registerAction(
      {},
      form({ fullName: "Nguyễn Văn An", email: "an@example.com", password: "mat-khau-dai-123" }),
    );

    expect(result.error).toBeDefined();
    expect(result.values).toEqual({ email: "an@example.com", fullName: "Nguyễn Văn An" });
    expect(JSON.stringify(result)).not.toContain("mat-khau-dai-123");
  });

  it("tên quá dài: câu lỗi tiếng Việt nói đúng ô, không phải câu mặc định của Zod", async () => {
    const result = await registerAction(
      {},
      form({ fullName: "A".repeat(101), email: "an@example.com", password: "mat-khau-dai-123" }),
    );

    expect(result.fieldErrors?.fullName).toEqual(["Tên hiển thị dài quá — tối đa 100 ký tự"]);
    expect(authService.register).not.toHaveBeenCalled();
  });
});

describe("forgotPasswordAction", () => {
  it("email sai dạng: lỗi ở ô email, chữ vừa gõ được trả lại", async () => {
    const result = await forgotPasswordAction({}, form({ email: "an@example" }));

    expect(result.fieldErrors?.email).toBeDefined();
    expect(result.values).toEqual({ email: "an@example" });
    expect(authService.requestPasswordReset).not.toHaveBeenCalled();
  });
});
