import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { oauthFlowCookieOptions } from "./flow-cookie";
import { pendingTwoFactorCookieOptions } from "./two-factor-cookie";

describe("cookie của luồng OAuth", () => {
  it("Apple (form_post, POST cross-site): SameSite=None kèm Secure — bắt buộc", () => {
    /*
     * appleid.apple.com tự POST form về callback. Trình duyệt KHÔNG gửi cookie
     * `Lax` theo POST cross-site, callback mất `state` và mọi lượt đăng nhập
     * Apple dừng ở `state_mismatch`. `None` lại chỉ được nhận khi có `Secure`.
     */
    expect(oauthFlowCookieOptions("apple")).toMatchObject({
      sameSite: "none",
      secure: true,
      httpOnly: true,
    });
  });

  it.each(["google", "github", "facebook"] as const)(
    "%s (chuyển hướng GET): giữ SameSite=Lax — không nới hơn mức cần",
    (provider) => {
      expect(oauthFlowCookieOptions(provider)).toMatchObject({ sameSite: "lax", httpOnly: true });
    },
  );

  it("vé 2FA của OAuth: httpOnly, chỉ gửi kèm /login, sống đúng bằng hạn vé", () => {
    expect(pendingTwoFactorCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/login",
      maxAge: 5 * 60,
    });
  });
});
