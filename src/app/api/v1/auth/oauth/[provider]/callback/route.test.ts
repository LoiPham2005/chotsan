import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Callback OAuth là nơi một tài khoản bên ngoài biến thành PHIÊN ChốtSân. Ba
 * lỗi đã có thật ở đây:
 *
 *   1. Lớp lỗi khai hai nơi → `instanceof` không khớp → "không có email" hiện
 *      thành "Có lỗi xảy ra" và bị ghi log như sự cố.
 *   2. Tài khoản đã bật 2FA vẫn được cấp phiên — Google thành đường vòng
 *      qua TOTP.
 *   3. (Chặn ở service) liên kết vào tài khoản chưa xác thực email.
 *
 * Mọi bước bên ngoài (đổi code, đọc hồ sơ, cookie) được giả lập; thứ đang kiểm
 * là route phản ứng ĐÚNG với từng kết cục.
 */

vi.mock("@/lib/oauth/flow-cookie", () => ({ consumeOAuthFlowCookie: vi.fn() }));
vi.mock("@/lib/oauth/client", () => ({ exchangeCodeForToken: vi.fn() }));
vi.mock("@/lib/oauth/profile", () => ({ fetchOAuthProfile: vi.fn() }));
vi.mock("@/lib/oauth/two-factor-cookie", () => ({ setPendingTwoFactor: vi.fn() }));
vi.mock("@/lib/auth", () => ({ createSession: vi.fn() }));
vi.mock("@/lib/landing", () => ({ landingPathFor: vi.fn().mockResolvedValue("/manage") }));
vi.mock("@/services/oauth.service", () => ({ oauthService: { loginWithProfile: vi.fn() } }));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

import { createSession } from "@/lib/auth";
import {
  AccountBannedError,
  AccountInactiveError,
  InvalidCredentialsError,
  OAuthEmailRequiredError,
  OAuthEmailUnverifiedError,
  ProviderExchangeError,
  TwoFactorRequiredError,
} from "@/lib/errors";
import { exchangeCodeForToken } from "@/lib/oauth/client";
import { consumeOAuthFlowCookie } from "@/lib/oauth/flow-cookie";
import { fetchOAuthProfile } from "@/lib/oauth/profile";
import { setPendingTwoFactor } from "@/lib/oauth/two-factor-cookie";
import { verifyTicket } from "@/lib/tickets";
import { oauthService } from "@/services/oauth.service";
import { GET } from "./route";

const FLOW = { provider: "google" as const, state: "state-1", next: "/venues/san-a" };
const USER = { id: "u1", email: "an@example.com", roles: ["USER"] };

function callback(query = "code=abc&state=state-1") {
  return GET(new Request(`http://localhost/api/v1/auth/oauth/google/callback?${query}`), {
    params: Promise.resolve({ provider: "google" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(consumeOAuthFlowCookie).mockResolvedValue(FLOW);
  vi.mocked(exchangeCodeForToken).mockResolvedValue({ accessToken: "at" });
  vi.mocked(fetchOAuthProfile).mockResolvedValue({
    provider: "google",
    providerAccountId: "g-1",
    email: USER.email,
    fullName: "An",
  });
  vi.mocked(oauthService.loginWithProfile).mockResolvedValue(USER as never);
});

describe("OAuth callback", () => {
  it("thành công: tạo phiên rồi về đúng `next`", async () => {
    const response = await callback();

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ sub: "u1" }));
    expect(response.headers.get("Location")).toBe("/venues/san-a");
  });

  it.each([
    [new OAuthEmailRequiredError("google"), "email_required"],
    [new OAuthEmailUnverifiedError(), "email_unverified"],
    [new ProviderExchangeError("google"), "exchange_failed"],
    [new AccountBannedError(), "banned"],
    [new AccountInactiveError(), "account_unavailable"],
    // Liên kết cũ trỏ vào tài khoản đã xoá mềm.
    [new InvalidCredentialsError(), "account_unavailable"],
  ])("%s → ?oauthError=%s, không tạo phiên", async (error, code) => {
    vi.mocked(oauthService.loginWithProfile).mockRejectedValue(error);

    const response = await callback();

    expect(response.headers.get("Location")).toBe(`/login?oauthError=${code}`);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("state không khớp → state_mismatch, không đổi code lấy token", async () => {
    const response = await callback("code=abc&state=khac");

    expect(response.headers.get("Location")).toBe("/login?oauthError=state_mismatch");
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("tài khoản đã bật 2FA: KHÔNG tạo phiên, vé nằm trong cookie — không bao giờ trên URL", async () => {
    vi.mocked(oauthService.loginWithProfile).mockRejectedValue(new TwoFactorRequiredError("u1"));

    const response = await callback();
    const location = response.headers.get("Location")!;

    expect(createSession).not.toHaveBeenCalled();
    expect(location).toBe("/login?twoFactor=1");

    const [pending] = vi.mocked(setPendingTwoFactor).mock.calls[0]!;
    expect(pending.next).toBe("/venues/san-a");
    // Vé thật, đúng loại, đúng người — và KHÔNG xuất hiện ở đâu trong URL.
    await expect(verifyTicket(pending.ticket, "2fa")).resolves.toMatchObject({ sub: "u1" });
    expect(location).not.toContain(pending.ticket);
  });

  it("`next` trong cookie bị sửa thành đích ngoài site → về trang chủ", async () => {
    // Cookie `oauth_flow` không ký: ai đặt được cookie trên tên miền là sửa được.
    vi.mocked(consumeOAuthFlowCookie).mockResolvedValue({ ...FLOW, next: "/\\evil.com" });

    const response = await callback();

    expect(response.headers.get("Location")).toBe("/");
  });
});
