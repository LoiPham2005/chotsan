import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SchedulesModule from "@/jobs/schedules";
import { onRequestError } from "./instrumentation";

/**
 * Dòng nhắc "khởi động lại pnpm dev" — xem chú thích trong instrumentation.ts.
 *
 * Nhắc SAI chỗ cũng hại như không nhắc: mọi lỗi đều kèm câu "khởi động lại" thì
 * người ta học được cách lờ nó đi. Nên chỉ đúng lỗi Prisma không biết trường.
 */

const REQUEST = { path: "/venues/san-a", method: "POST", headers: {} };
const CONTEXT = {
  routerKind: "App Router",
  routePath: "/venues/[slug]",
  routeType: "action",
  renderSource: "react-server-components",
  revalidateReason: undefined,
  renderType: "dynamic",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("onRequestError — nhắc Prisma Client cũ", () => {
  it("lỗi `Unknown argument` của Prisma thì in lời nhắc khởi động lại", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await onRequestError(
      new Error("Invalid `prisma.booking.create()` invocation: Unknown argument `checkoutCode`."),
      REQUEST,
      CONTEXT,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("pnpm dev");
  });

  it("lỗi khác thì im lặng", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await onRequestError(new Error("Can't reach database server"), REQUEST, CONTEXT);
    await onRequestError("không phải Error", REQUEST, CONTEXT);

    expect(warn).not.toHaveBeenCalled();
  });

  it("production thì không nhắc — build mới luôn nạp client mới nhất", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await onRequestError(new Error("Unknown argument `checkoutCode`"), REQUEST, CONTEXT);

    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * `register()` — việc lúc máy chủ Next khởi động.
 *
 * Lỗi thật trước đây: job theo lịch CHỈ worker chạy, nên `QUEUE_ENABLED=0` (hoặc
 * máy dev không Redis) là không lịch nào chạy — giao dịch PENDING quá hạn nằm mãi,
 * hoá đơn hoa hồng không xuất, và không dòng log nào báo.
 */
const mocks = vi.hoisted(() => ({
  startInProcessScheduler: vi.fn(() => ({ stop: () => undefined })),
  handler: vi.fn((_payload: unknown) => Promise.resolve()),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/jobs/schedules", async (importOriginal) => ({
  ...(await importOriginal<typeof SchedulesModule>()),
  startInProcessScheduler: mocks.startInProcessScheduler,
}));

// Handler thật kéo Prisma vào; ở đây chỉ cần biết bộ chạy gọi ĐÚNG handler.
vi.mock("@/jobs/handlers", () => ({
  jobHandlers: new Proxy({}, { get: () => mocks.handler }),
}));

vi.mock("@/lib/logger", () => ({ logger: mocks.log }));

type StartOptions = Parameters<typeof SchedulesModule.startInProcessScheduler>[0];

async function register(env: Record<string, string>) {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NODE_ENV", "development");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

  // `src/lib/env.ts` đọc process.env đúng MỘT lần lúc nạp — phải nạp lại.
  vi.resetModules();
  const instrumentation = await import("./instrumentation");
  await instrumentation.register();
}

function errorMessages(): string[] {
  return mocks.log.error.mock.calls.map((call: unknown[]) => String(call[0]));
}

describe("register — job theo lịch khi không có worker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("QUEUE_ENABLED=0 → web tự chạy đủ danh sách lịch dùng chung", async () => {
    await register({ QUEUE_ENABLED: "0" });

    expect(mocks.startInProcessScheduler).toHaveBeenCalledTimes(1);
    const options = (
      mocks.startInProcessScheduler.mock.calls as unknown as [StartOptions][]
    )[0]![0];
    expect(options.schedules.map((item) => item.id)).toEqual(
      expect.arrayContaining(["booking-expire-holds", "invoice-generate-monthly"]),
    );
    expect(options.schedules).toHaveLength(5);
    expect(options.log).toBe(mocks.log);

    // Bộ chạy gọi đúng handler dùng chung, payload rỗng.
    await options.runJob("payment:expire-pending");
    expect(mocks.handler).toHaveBeenCalledWith({});
  });

  it("máy dev bật cờ nhưng thiếu Redis → KHÔNG chạy lịch (để Neon được ngủ), chỉ nhắc", async () => {
    await register({ QUEUE_ENABLED: "1" });

    expect(mocks.startInProcessScheduler).not.toHaveBeenCalled();
    // Cấu hình mặc định của máy dev — không phải lỗi, không được kêu như lỗi.
    expect(errorMessages()).toEqual([]);
  });

  it("có Redis → để worker lo, web KHÔNG chạy lịch (nếu không là chạy hai nơi)", async () => {
    await register({ QUEUE_ENABLED: "1", REDIS_URL: "redis://127.0.0.1:6379" });

    expect(mocks.startInProcessScheduler).not.toHaveBeenCalled();
  });

  it("production bật cờ mà thiếu REDIS_URL → không chạy lịch, và KÊU TO", async () => {
    await register({ NODE_ENV: "production", QUEUE_ENABLED: "1" });

    expect(mocks.startInProcessScheduler).not.toHaveBeenCalled();
    expect(errorMessages().some((message) => message.includes("KHÔNG job theo lịch"))).toBe(true);
  });

  it("CRON_* sai → máy chủ dừng ngay, lỗi nêu tên biến", async () => {
    await expect(register({ QUEUE_ENABLED: "0", CRON_EXPIRE_HOLDS: "99 * * * *" })).rejects.toThrow(
      /CRON_EXPIRE_HOLDS/,
    );
    expect(mocks.startInProcessScheduler).not.toHaveBeenCalled();
  });

  it.each([
    ["runtime Edge", { NEXT_RUNTIME: "edge" }],
    ["lúc next build", { NEXT_PHASE: "phase-production-build" }],
    ["trong Vitest", { NODE_ENV: "test" }],
  ])("không làm gì %s", async (_label, env) => {
    await register({ QUEUE_ENABLED: "0", ...env });

    expect(mocks.startInProcessScheduler).not.toHaveBeenCalled();
    expect(mocks.log.error).not.toHaveBeenCalled();
  });
});

describe("register — báo cấu hình production còn thiếu ngay lúc khởi động", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bật OTP mà chưa setSmser → log LỖI chỉ đúng chỗ phải sửa", async () => {
    await register({ NODE_ENV: "production", QUEUE_ENABLED: "0", PHONE_VERIFICATION_ENABLED: "1" });

    expect(errorMessages().some((message) => message.includes("setSmser"))).toBe(true);
  });

  it("tắt OTP thì không kêu về SMS", async () => {
    await register({ NODE_ENV: "production", QUEUE_ENABLED: "0", PHONE_VERIFICATION_ENABLED: "0" });

    expect(errorMessages().some((message) => message.includes("setSmser"))).toBe(false);
  });

  it("thiếu SMTP lẫn kho lưu trữ → lỗi email, cảnh báo tải tệp", async () => {
    await register({ NODE_ENV: "production", QUEUE_ENABLED: "0", PHONE_VERIFICATION_ENABLED: "0" });

    expect(errorMessages().some((message) => message.includes("SMTP_HOST"))).toBe(true);
    expect(
      mocks.log.warn.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes("/api/v1/files"),
      ),
    ).toBe(true);
  });

  it("có SMTP_HOST thì không kêu về email", async () => {
    await register({
      NODE_ENV: "production",
      QUEUE_ENABLED: "0",
      PHONE_VERIFICATION_ENABLED: "0",
      SMTP_HOST: "smtp.example.com",
    });

    expect(errorMessages().some((message) => message.includes("SMTP_HOST"))).toBe(false);
  });

  it("dev không kêu — bản ghi log/đĩa cục bộ là đúng thiết kế ở dev", async () => {
    await register({ QUEUE_ENABLED: "0", PHONE_VERIFICATION_ENABLED: "1" });

    expect(mocks.log.error).not.toHaveBeenCalled();
    expect(mocks.log.warn).not.toHaveBeenCalled();
  });
});
