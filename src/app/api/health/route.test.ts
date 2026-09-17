import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/health` là thứ người trực `curl` đầu tiên sau mỗi lần deploy.
 *
 * Lỗi thật trước đây: tắt hàng đợi là không job theo lịch nào chạy, và không có
 * chỗ nào cho thấy điều đó. `features.schedules` phải nói đúng AI đang chạy lịch —
 * nói sai thì người trực yên tâm với một hệ thống đang không xuất hoá đơn.
 */

const checkDatabase = vi.hoisted(() => vi.fn());

vi.mock("@/services/health.service", () => ({ healthService: { checkDatabase } }));

type HealthBody = {
  status: string;
  database: string;
  features: { queue: string; realtime: string; schedules: string };
};

async function health(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  const { GET } = await import("./route");
  const response = await GET();
  return { status: response.status, body: (await response.json()) as HealthBody };
}

beforeEach(() => {
  checkDatabase.mockResolvedValue({ status: "up", latencyMs: 3 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/health — features.schedules", () => {
  it("QUEUE_ENABLED=0 → in-process (web tự chạy lịch)", async () => {
    const { body } = await health({ QUEUE_ENABLED: "0" });

    expect(body.features).toEqual({ queue: "off", realtime: "on", schedules: "in-process" });
  });

  it("có hàng đợi Redis → worker", async () => {
    const { body } = await health({ QUEUE_ENABLED: "1", REDIS_URL: "redis://redis:6379" });

    expect(body.features.queue).toBe("redis");
    expect(body.features.schedules).toBe("worker");
  });

  it("production bật cờ mà thiếu Redis → off, để người trực thấy ngay", async () => {
    const { body } = await health({ NODE_ENV: "production", QUEUE_ENABLED: "1" });

    expect(body.features.queue).toBe("inline");
    expect(body.features.schedules).toBe("off");
  });

  it("database chết vẫn trả features kèm 503", async () => {
    checkDatabase.mockResolvedValue({ status: "down", latencyMs: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { status, body } = await health({ QUEUE_ENABLED: "0" });

    expect(status).toBe(503);
    expect(body.features.schedules).toBe("in-process");
  });
});
