import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `env.ts` validate MỘT LẦN lúc nạp module, nên mỗi bài nạp lại module sau khi
 * đổi biến (`vi.stubEnv` + `vi.resetModules`). Sửa `process.env` rồi gọi hàm
 * trên module cũ là "xanh vì lý do sai".
 *
 * Lỗi thật trước đây: `.env.example` chỉ khai `NEXT_PUBLIC_APP_URL`, còn link
 * trong email đòi `APP_URL` — thiếu nó thì email đăng ký/quên mật khẩu hỏng
 * IM LẶNG (lỗi gửi thư bị nuốt có chủ đích) và nút passkey biến mất.
 */
async function loadEnv(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  vi.resetModules();
  return import("./env");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("URL công khai — một nguồn cho email, OAuth và passkey", () => {
  it("thiếu APP_URL thì dùng NEXT_PUBLIC_APP_URL", async () => {
    const env = await loadEnv({ APP_URL: "", NEXT_PUBLIC_APP_URL: "https://chotsan.vn" });

    expect(env.appUrl("/reset-password?token=abc")).toBe(
      "https://chotsan.vn/reset-password?token=abc",
    );
    expect(env.webAuthnConfig()).toMatchObject({
      rpID: "chotsan.vn",
      origins: ["https://chotsan.vn"],
    });
  });

  it("có cả hai thì APP_URL thắng", async () => {
    const env = await loadEnv({
      APP_URL: "https://chotsan.vn",
      NEXT_PUBLIC_APP_URL: "https://khac.example",
    });

    expect(env.appBaseUrl()).toBe("https://chotsan.vn");
  });

  it("thiếu cả hai: email báo lỗi CHỈ ĐÚNG biến cần đặt, passkey báo lỗi cấu hình", async () => {
    const env = await loadEnv({ APP_URL: "", NEXT_PUBLIC_APP_URL: "" });

    expect(() => env.appUrl("/verify-email")).toThrow(/APP_URL/);
    // So theo `code` chứ không `instanceof`: `resetModules` nạp lại cả
    // `errors.ts`, lớp lỗi của module mới khác lớp import ở đầu tệp.
    expect(() => env.webAuthnConfig()).toThrow(expect.objectContaining({ code: "PROVIDER_ERROR" }));
    expect(env.isWebAuthnConfigured()).toBe(false);
  });
});

describe("mặc định", () => {
  it("APP_NAME là ChốtSân — tên hiện trong app xác thực và hộp thoại passkey", async () => {
    // Bộ khung để "Base Template": người dùng bật 2FA thấy tài khoản mang tên
    // lạ trong Google Authenticator và tưởng bị lừa.
    const { env } = await import("./env");

    expect(env.APP_NAME).toBe("ChốtSân");
  });

  it("TRUSTED_PROXY_HOPS mặc định 1 — một Caddy/nginx trước app", async () => {
    const { env } = await import("./env");

    expect(env.TRUSTED_PROXY_HOPS).toBe(1);
  });
});
