import { beforeEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { __clearRateLimits } from "./rate-limit";
import { signSession, verifySession } from "./session";
import { consumeTicket, issueTwoFactorTicket, issueWebAuthnTicket, verifyTicket } from "./tickets";

/**
 * Vé chứng minh "đã qua bước một" (mật khẩu đúng, hoặc máy chủ vừa phát
 * challenge). Hai lỗi đắt:
 *
 *   1. Vé dùng thay phiên, hoặc phiên dùng thay vé — cùng một khoá ký.
 *   2. Vé NỘP LẠI được: passkey đồng bộ giữ bộ đếm chữ ký bằng 0 nên thư viện
 *      không phát hiện phản hồi phát lại; một cặp vé + phản hồi từng được nhận
 *      thì đăng nhập lại được suốt 5 phút.
 */

beforeEach(async () => {
  // Dấu "vé đã dùng" nằm trong store của rate limit.
  await __clearRateLimits();
});

describe("phân loại vé", () => {
  it("vé 2FA đọc được đúng loại, không dùng thay phiên đăng nhập", async () => {
    const { challengeToken } = await issueTwoFactorTicket("u1");

    await expect(verifyTicket(challengeToken, "2fa")).resolves.toMatchObject({ sub: "u1" });
    await expect(verifyTicket(challengeToken, "webauthn_auth")).resolves.toBeNull();
    await expect(verifySession(challengeToken)).resolves.toBeNull();
  });

  it("phiên đăng nhập không dùng thay vé", async () => {
    const session = await signSession({ typ: "access", sub: "u1", email: null, roles: [] });

    await expect(verifyTicket(session, "2fa")).resolves.toBeNull();
  });

  it("vé không mang `jti` (cấp trước khi có luật dùng-một-lần) bị từ chối", async () => {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const legacy = await new SignJWT({ typ: "2fa", sub: "u1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(secret);

    await expect(verifyTicket(legacy, "2fa")).resolves.toBeNull();
  });
});

describe("consumeTicket — mỗi vé dùng đúng một lần", () => {
  it("lần đầu tiêu được, lần sau bị từ chối", async () => {
    const ticket = await verifyTicket(
      await issueWebAuthnTicket("webauthn_auth", "challenge-1"),
      "webauthn_auth",
    );

    await expect(consumeTicket(ticket!)).resolves.toBe(true);
    await expect(consumeTicket(ticket!)).resolves.toBe(false);
  });

  it("vé khác (jti khác) không bị vạ lây", async () => {
    const first = await verifyTicket((await issueTwoFactorTicket("u1")).challengeToken, "2fa");
    const second = await verifyTicket((await issueTwoFactorTicket("u1")).challengeToken, "2fa");

    expect(first!.jti).not.toBe(second!.jti);
    await expect(consumeTicket(first!)).resolves.toBe(true);
    await expect(consumeTicket(second!)).resolves.toBe(true);
  });

  it("chỉ ĐỌC vé thì không tiêu — vé 2FA phải dùng lại được khi gõ nhầm mã", async () => {
    const token = (await issueTwoFactorTicket("u1")).challengeToken;

    await verifyTicket(token, "2fa");
    await verifyTicket(token, "2fa");

    await expect(consumeTicket((await verifyTicket(token, "2fa"))!)).resolves.toBe(true);
  });
});
