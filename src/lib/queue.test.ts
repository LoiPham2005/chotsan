import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Bài test của hai CÔNG TẮC, không phải của BullMQ.
 *
 * Nhánh Redis cố ý không mock — cùng lý do đã ghi trong `cache.test.ts`: mock
 * một client Redis chỉ chứng minh ta gọi đúng những lệnh ta tự nghĩ ra. Thứ
 * đáng test ở đây là câu hỏi "job có chạy không, và ai quyết định", vì trả lời
 * sai câu đó nghĩa là email biến mất trong im lặng.
 *
 * Mỗi bài phải nạp lại module: `src/lib/env.ts` đọc `process.env` đúng MỘT lần
 * lúc được import, nên đổi biến sau đó không có tác dụng gì.
 */
const handler = vi.fn(async () => {});

vi.mock("@/jobs/handlers", () => ({
  jobHandlers: {
    get "email:send"() {
      return handler;
    },
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  handler.mockClear();
});

async function loadQueue() {
  vi.resetModules();
  return import("./queue");
}

const payload = { to: "a@b.c", subject: "x", text: "y" };

describe("QUEUE_ENABLED=0", () => {
  it("chạy job ngay tại chỗ, không cần Redis", async () => {
    vi.stubEnv("QUEUE_ENABLED", "0");

    const { enqueue } = await loadQueue();
    await enqueue("email:send", payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it("KHÔNG ném lỗi trên production — tắt hàng đợi là lựa chọn, không phải thiếu sót", async () => {
    vi.stubEnv("QUEUE_ENABLED", "0");
    vi.stubEnv("NODE_ENV", "production");

    const { enqueue } = await loadQueue();

    await expect(enqueue("email:send", payload)).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("để lỗi của handler BUNG RA, không nuốt", async () => {
    vi.stubEnv("QUEUE_ENABLED", "0");
    handler.mockRejectedValueOnce(new Error("SMTP chết"));

    const { enqueue } = await loadQueue();

    // Nuốt lỗi ở đây sẽ biến "tắt hàng đợi" thành "job im lặng biến mất" —
    // đúng thứ mà cả lớp queue tồn tại để ngăn.
    await expect(enqueue("email:send", payload)).rejects.toThrow("SMTP chết");
  });

  it("isQueueEnabled() báo false", async () => {
    vi.stubEnv("QUEUE_ENABLED", "0");

    const { isQueueEnabled } = await loadQueue();

    expect(isQueueEnabled()).toBe(false);
  });
});

describe("QUEUE_ENABLED=1 nhưng thiếu REDIS_URL", () => {
  it("ở dev thì vẫn chạy tại chỗ", async () => {
    const { enqueue } = await loadQueue();
    await enqueue("email:send", payload);

    expect(handler).toHaveBeenCalledOnce();
  });

  it("ở production thì NÉM LỖI, và chỉ ra cả hai đường sửa", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { enqueue } = await loadQueue();

    // Thông báo phải nêu ĐỦ hai lựa chọn. Chỉ nói "thiếu REDIS_URL" thì người
    // đọc tưởng bắt buộc phải dựng Redis, trong khi tắt hàng đợi cũng hợp lệ.
    await expect(enqueue("email:send", payload)).rejects.toThrow(/REDIS_URL/);
    await expect(enqueue("email:send", payload)).rejects.toThrow(/QUEUE_ENABLED=0/);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("giá trị cờ không hợp lệ", () => {
  it("từ chối true/false ngay lúc khởi động, kèm hướng dẫn dùng 1/0", async () => {
    vi.stubEnv("QUEUE_ENABLED", "false");

    // `docker-compose.yml` dùng chính biến này làm `replicas` (chỉ hiểu số),
    // nên chấp nhận "false" ở tầng app là để hai bên hiểu khác nhau.
    await expect(loadQueue()).rejects.toThrow(/QUEUE_ENABLED/);
    await expect(loadQueue()).rejects.toThrow(/1 \(bật\) hoặc 0 \(tắt\)/);
  });
});

describe("gói ioredis — BullMQ nạp lười, không import nào trong mã trỏ tới", () => {
  it("BullMQ tìm thấy `ioredis` từ CHÍNH vị trí của nó", async () => {
    // Lỗi thật trước đây: package.json không có `ioredis`. BullMQ 6 chỉ
    // `require("ioredis")` lúc dựng kết nối, nên typecheck/lint/build đều xanh —
    // còn worker và mọi `enqueue()` có Redis thì chết lúc chạy với
    // "BullMQ could not load the optional 'ioredis' package".
    const { createRequire } = await import("node:module");
    const fromHere = createRequire(import.meta.url);
    const fromBullmq = createRequire(fromHere.resolve("bullmq"));

    const IORedis = fromBullmq("ioredis") as { default?: unknown };

    expect(typeof (IORedis.default ?? IORedis)).toBe("function");
  });
});
