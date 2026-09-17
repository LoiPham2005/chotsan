import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearRateLimits,
  claimOnce,
  clientIpFromHeaders,
  rateLimit,
  resetRateLimit,
} from "./rate-limit";

/**
 * Không set `REDIS_URL` trong môi trường test, nên đây là bài test của store
 * trong RAM — đúng thứ chạy trên máy dev và trong CI.
 *
 * Nhánh Redis cố ý không mock: mock một client Redis chỉ kiểm được rằng ta đã
 * gọi đúng những lệnh ta tự nghĩ ra, không kiểm được Redis có hiểu như vậy
 * không. Phần đó thuộc về test tích hợp với một Redis thật.
 */
afterEach(async () => {
  await __clearRateLimits();
});

describe("rateLimit", () => {
  it("cho qua đúng bằng số lần cho phép rồi mới chặn", async () => {
    const options = { limit: 3, windowSeconds: 60 };

    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(false);
  });

  it("đếm riêng cho từng key", async () => {
    const options = { limit: 1, windowSeconds: 60 };

    expect((await rateLimit("ip-1", options)).success).toBe(true);
    expect((await rateLimit("ip-2", options)).success).toBe(true);
    expect((await rateLimit("ip-1", options)).success).toBe(false);
  });

  it("báo số lần còn lại", async () => {
    const options = { limit: 2, windowSeconds: 60 };

    expect((await rateLimit("ip-1", options)).remaining).toBe(1);
    expect((await rateLimit("ip-1", options)).remaining).toBe(0);
  });

  it("reset xoá sạch bộ đếm", async () => {
    const options = { limit: 1, windowSeconds: 60 };

    await rateLimit("ip-1", options);
    expect((await rateLimit("ip-1", options)).success).toBe(false);

    await resetRateLimit("ip-1");
    expect((await rateLimit("ip-1", options)).success).toBe(true);
  });

  it("luôn trả retryAfterSeconds ít nhất là 1", async () => {
    const result = await rateLimit("ip-1", { limit: 1, windowSeconds: 1 });
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("claimOnce — thứ chỉ được tiêu một lần", () => {
  it("lần đầu true, lần sau false cho tới khi hết hạn", async () => {
    expect(await claimOnce("ticket:abc", 60)).toBe(true);
    expect(await claimOnce("ticket:abc", 60)).toBe(false);
    expect(await claimOnce("ticket:khac", 60)).toBe(true);
  });

  it("hai lần gọi SONG SONG: chỉ một bên thắng", async () => {
    const results = await Promise.all([claimOnce("ticket:dua", 60), claimOnce("ticket:dua", 60)]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("clientIpFromHeaders — IP nào là IP thật", () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("một proxy tin cậy (mặc định): phần tử CUỐI — thứ proxy của ta thêm vào", () => {
    // Client gửi sẵn `X-Forwarded-For: 6.6.6.6`; nginx nối IP thật vào cuối.
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
    // Caddy ghi đè hẳn header: chuỗi chỉ còn IP thật.
    expect(clientIpFromHeaders(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("hai tầng tin cậy (CDN + proxy): đếm từ phải qua hai phần tử", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    vi.resetModules();
    const fresh = await import("./rate-limit");

    expect(
      fresh.clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" })),
    ).toBe("203.0.113.7");
  });

  it("TRUSTED_PROXY_HOPS=0: không tin X-Forwarded-For, chỉ đọc x-real-ip", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    vi.resetModules();
    const fresh = await import("./rate-limit");

    expect(
      fresh.clientIpFromHeaders(
        headers({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.4" }),
      ),
    ).toBe("198.51.100.4");
  });

  it("không có header nào → 'unknown' (mọi người chung một xô, không mở toang)", () => {
    expect(clientIpFromHeaders(headers({}))).toBe("unknown");
  });
});
