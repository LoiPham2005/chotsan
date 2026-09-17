import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSchedules, parseScheduleEnv, SCHEDULE_TIMEZONE } from "@/jobs/schedules";
import type { JobHandlers } from "@/jobs/types";

/**
 * Worker hỏng là hỏng ở tiến trình không ai nhìn: email không gửi, lịch không
 * chạy, và web vẫn xanh. Tệp này khoá hai thứ không cần Redis thật để kiểm:
 *
 *   - ĐĂNG KÝ LỊCH: đúng danh sách dùng chung (`src/jobs/schedules.ts`), đúng
 *     attempts/backoff, đúng múi giờ — lệch là hoá đơn xuất sai giờ hoặc không thử lại.
 *   - ĐIỀU PHỐI JOB: tên job → đúng handler; tên lạ phải NÉM để BullMQ giữ job lại.
 */

// Handler thật kéo Prisma và toàn bộ tầng service vào; ở đây chỉ kiểm điều phối.
vi.mock("@/jobs/handlers", () => ({ jobHandlers: {} }));

const { healthHandler, processJob, registerSchedules } = await import("./worker");

const SCHEDULES = buildSchedules(parseScheduleEnv({}));

function fakeQueue(error?: Error) {
  return {
    upsertJobScheduler: vi.fn(() => (error ? Promise.reject(error) : Promise.resolve())),
  };
}

type UpsertCall = [
  string,
  { pattern: string; tz: string },
  {
    name: string;
    data: unknown;
    opts: { attempts: number; backoff?: unknown; removeOnComplete: number; removeOnFail: number };
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("registerSchedules — đăng ký lịch vào BullMQ", () => {
  it("đăng ký ĐÚNG danh sách dùng chung, mỗi lịch một lần", async () => {
    const queue = fakeQueue();

    await registerSchedules(queue as never, SCHEDULES);

    const calls = queue.upsertJobScheduler.mock.calls as unknown as UpsertCall[];
    expect(calls.map((call) => call[0])).toEqual(SCHEDULES.map((schedule) => schedule.id));
    expect(calls.map((call) => call[2].name)).toEqual(SCHEDULES.map((schedule) => schedule.name));
  });

  it("biểu thức cron diễn giải theo giờ Việt Nam, không theo giờ máy chủ", async () => {
    const queue = fakeQueue();

    await registerSchedules(queue as never, SCHEDULES);

    for (const [, repeat] of queue.upsertJobScheduler.mock.calls as unknown as UpsertCall[]) {
      expect(repeat.tz).toBe(SCHEDULE_TIMEZONE);
    }
  });

  it("job hoá đơn: attempts ≥ 3 + backoff luỹ thừa; job mỗi phút: không thử lại", async () => {
    const queue = fakeQueue();

    await registerSchedules(queue as never, SCHEDULES);

    const opts = new Map(
      (queue.upsertJobScheduler.mock.calls as unknown as UpsertCall[]).map((call) => [
        call[2].name,
        call[2].opts,
      ]),
    );
    for (const name of ["invoice:generate-monthly", "invoice:mark-overdue"]) {
      expect(opts.get(name)!.attempts).toBeGreaterThanOrEqual(3);
      expect(opts.get(name)!.backoff).toMatchObject({ type: "exponential" });
    }
    expect(opts.get("booking:expire-holds")!.attempts).toBe(1);
    expect(opts.get("booking:expire-holds")!.backoff).toBeUndefined();
    // Dọn job cũ trong Redis — không có thì Redis phình vô hạn, mỗi phút hai job.
    expect(opts.get("booking:expire-holds")!.removeOnComplete).toBeGreaterThan(0);
  });

  it("Redis lỗi thì GHI LỖI chứ không giết tiến trình — worker vẫn chạy job thường", async () => {
    const queue = fakeQueue(new Error("ECONNREFUSED"));

    await expect(registerSchedules(queue as never, SCHEDULES)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("KHÔNG đăng ký được"));
  });
});

describe("processJob — điều phối job tới handler dùng chung", () => {
  const JOB = { id: "42", attemptsMade: 0, data: { to: "a@b.c" } };

  it("gọi đúng handler theo tên, truyền nguyên payload", async () => {
    const send = vi.fn(() => Promise.resolve());
    const other = vi.fn(() => Promise.resolve());
    const handlers = { "email:send": send, "sms:send": other } as unknown as JobHandlers;

    await processJob({ ...JOB, name: "email:send" }, handlers);

    expect(send).toHaveBeenCalledWith({ to: "a@b.c" });
    expect(other).not.toHaveBeenCalled();
  });

  it("job lạ (worker cũ hơn web) thì NÉM — BullMQ giữ job lại để chạy sau khi deploy", async () => {
    await expect(
      processJob({ ...JOB, name: "job:khong-ton-tai" }, {} as JobHandlers),
    ).rejects.toThrow(/Không có handler/);
  });

  it("handler lỗi thì lỗi bung ra nguyên vẹn — để BullMQ tính lượt thử lại", async () => {
    const handlers = {
      "email:send": () => Promise.reject(new Error("SMTP nghẽn")),
    } as unknown as JobHandlers;

    await expect(processJob({ ...JOB, name: "email:send" }, handlers)).rejects.toThrow(
      "SMTP nghẽn",
    );
  });
});

describe("healthHandler — /health của worker", () => {
  function fakeResponse() {
    let resolveEnd: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => {
      resolveEnd = resolve;
    });
    const res = {
      statusCode: 0,
      body: "",
      writeHead: vi.fn((status: number) => {
        res.statusCode = status;
        return res;
      }),
      end: vi.fn((body?: string) => {
        res.body = body ?? "";
        resolveEnd();
        return res;
      }),
    };
    return { res, ended };
  }

  it("đếm được job → 200 kèm số job", async () => {
    const counts = { waiting: 1, active: 0, delayed: 2, failed: 0 };
    const { res, ended } = fakeResponse();

    healthHandler({ getJobCounts: () => Promise.resolve(counts) } as never)(
      { url: "/health" },
      res as never,
    );
    await ended;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok", counts });
  });

  it("Redis không tới được (lệnh treo) → 503 sau trần thời gian, KHÔNG treo vô hạn", async () => {
    // Lỗi thật khi chạy thử bundle: ioredis giữ lệnh chờ kết nối lại mãi,
    // `curl /health` không bao giờ trả lời.
    const { res, ended } = fakeResponse();

    healthHandler({ getJobCounts: () => new Promise(() => undefined) } as never, 20)(
      { url: "/health" },
      res as never,
    );
    await ended;

    expect(res.statusCode).toBe(503);
  });

  it("đường dẫn khác → 404", () => {
    const { res } = fakeResponse();

    healthHandler({ getJobCounts: vi.fn() } as never)({ url: "/" }, res as never);

    expect(res.statusCode).toBe(404);
  });
});
