import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSchedules,
  isValidCronPattern,
  MAX_TIMER_DELAY_MS,
  parseScheduleEnv,
  schedulingMode,
  startInProcessScheduler,
  type InProcessScheduler,
  type ScheduleDefinition,
  type ScheduledJobName,
} from "./schedules";

/**
 * Job theo lịch hỏng là hỏng trong im lặng: không trang nào đỏ, không request
 * nào lỗi — chỉ có giao dịch quá hạn nằm mãi và hoá đơn tháng không xuất. Lỗi
 * thật trước đây: tắt hàng đợi (hoặc máy dev không Redis) là không lịch nào chạy.
 *
 * Mốc thời gian dùng xuyên suốt: 2026-09-04 (thứ Sáu), giờ Việt Nam (+07:00).
 * Máy chủ chạy UTC, nên mọi khẳng định về "02:00" đều so theo giờ VN.
 */

const DEFAULT_ENV = parseScheduleEnv({});

function fakeLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function schedule(overrides: Partial<ScheduleDefinition> & { id: string }): ScheduleDefinition {
  return {
    name: "booking:expire-holds",
    pattern: "* * * * *",
    attempts: 1,
    ...overrides,
  };
}

describe("schedulingMode — ai chạy job theo lịch", () => {
  it.each([
    [{ QUEUE_ENABLED: true, REDIS_URL: "redis://r:6379" }, "worker"],
    [{ QUEUE_ENABLED: false, REDIS_URL: "redis://r:6379" }, "in-process"],
    [{ QUEUE_ENABLED: false, REDIS_URL: undefined }, "in-process"],
    // Máy dev mặc định (không Redis) cũng `off`: hỏi database mỗi phút là Neon
    // không bao giờ được ngủ.
    [{ QUEUE_ENABLED: true, REDIS_URL: undefined }, "off"],
  ] as const)("%o → %s", (config, expected) => {
    // Nhầm `off` thành `in-process` là che một cấu hình sai; nhầm `in-process`
    // thành `off` là mất lịch — đúng lỗi cũ.
    expect(schedulingMode(config)).toBe(expected);
  });
});

describe("parseScheduleEnv — biến CRON_*", () => {
  it("không khai gì thì dùng mặc định", () => {
    expect(DEFAULT_ENV).toEqual({
      CRON_EXPIRE_HOLDS: "* * * * *",
      CRON_PURGE_EXPIRED: "0 3 * * *",
      CRON_INVOICE_MONTHLY: "30 2 * * *",
      CRON_INVOICE_OVERDUE: "0 4 * * *",
    });
  });

  it("dòng `CRON_X=` bỏ trống cũng là không khai", () => {
    expect(parseScheduleEnv({ CRON_PURGE_EXPIRED: "" }).CRON_PURGE_EXPIRED).toBe("0 3 * * *");
  });

  it("biểu thức sai thì ném lỗi NÊU TÊN BIẾN ngay lúc khởi động", () => {
    expect(() => parseScheduleEnv({ CRON_INVOICE_MONTHLY: "61 2 1 * *" })).toThrow(
      /CRON_INVOICE_MONTHLY/,
    );
  });

  it("biểu thức không bao giờ tới (31/2) cũng bị từ chối — nếu không nó thành lịch câm", () => {
    expect(isValidCronPattern("0 0 31 2 *")).toBe(false);
    expect(isValidCronPattern("   ")).toBe(false);
    expect(isValidCronPattern("0 4 * * *")).toBe(true);
  });
});

describe("buildSchedules — danh sách dùng chung cho worker và web", () => {
  const schedules = buildSchedules(DEFAULT_ENV);
  const byName = (name: ScheduledJobName) => schedules.find((item) => item.name === name)!;

  it("đủ năm lịch, id không trùng", () => {
    expect(schedules.map((item) => item.name).sort()).toEqual([
      "booking:expire-holds",
      "invoice:generate-monthly",
      "invoice:mark-overdue",
      "maintenance:purge-expired",
      "payment:expire-pending",
    ]);
    // Trùng id thì BullMQ ghi đè lịch này bằng lịch kia — một job biến mất.
    expect(new Set(schedules.map((item) => item.id)).size).toBe(schedules.length);
  });

  it("job hoá đơn thử lại ≥ 3 lần, giãn cách luỹ thừa — hỏng là trễ cả tháng", () => {
    for (const name of ["invoice:generate-monthly", "invoice:mark-overdue"] as const) {
      expect(byName(name).attempts).toBeGreaterThanOrEqual(3);
      expect(byName(name).backoff).toEqual({ type: "exponential", delay: expect.any(Number) });
    }
  });

  it("job mỗi phút không thử lại — mốc sau tự dọn nốt", () => {
    expect(byName("booking:expire-holds").attempts).toBe(1);
    expect(byName("payment:expire-pending").attempts).toBe(1);
  });

  it("lấy biểu thức từ biến môi trường", () => {
    const custom = buildSchedules(parseScheduleEnv({ CRON_INVOICE_OVERDUE: "30 5 * * *" }));
    expect(custom.find((item) => item.name === "invoice:mark-overdue")!.pattern).toBe("30 5 * * *");
  });
});

describe("startInProcessScheduler — chạy lịch trong tiến trình web", () => {
  let scheduler: InProcessScheduler | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-04T01:59:30+07:00") });
  });

  afterEach(() => {
    scheduler?.stop();
    scheduler = undefined;
    vi.useRealTimers();
  });

  it("chạy ĐÚNG mốc cron, không chạy ngay lúc khởi động", async () => {
    const runJob = vi.fn(() => Promise.resolve());
    scheduler = startInProcessScheduler({
      schedules: [schedule({ id: "minutely" })],
      runJob,
      log: fakeLog(),
    });

    await vi.advanceTimersByTimeAsync(29_000);
    expect(runJob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000); // 02:00:00
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob).toHaveBeenCalledWith("booking:expire-holds");

    await vi.advanceTimersByTimeAsync(60_000); // 02:01:00
    expect(runJob).toHaveBeenCalledTimes(2);
  });

  it("diễn giải cron theo GIỜ VIỆT NAM dù máy chủ chạy UTC", async () => {
    const firedAt: string[] = [];
    scheduler = startInProcessScheduler({
      schedules: [schedule({ id: "vn-time", name: "invoice:mark-overdue", pattern: "0 4 * * *" })],
      runJob: () => {
        firedAt.push(new Date(Date.now()).toISOString());
        return Promise.resolve();
      },
      log: fakeLog(),
    });

    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);

    // 04:00 giờ VN = 21:00 UTC hôm trước. Theo UTC thì phải tới 11:00 VN mới chạy.
    expect(firedAt).toEqual(["2026-09-03T21:00:00.000Z"]);
  });

  it("lịch HẰNG THÁNG không chạy ngay — setTimeout > 24,8 ngày bị Node rút còn 1 ms", async () => {
    const runJob = vi.fn(() => Promise.resolve());
    scheduler = startInProcessScheduler({
      schedules: [
        schedule({ id: "monthly", name: "invoice:generate-monthly", pattern: "0 2 1 * *" }),
      ],
      runJob,
      log: fakeLog(),
    });

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runJob).not.toHaveBeenCalled();

    // Đồng hồ nhảy tới sát mốc (máy ảo ngủ dậy, NTP chỉnh): lần thức kế tiếp phải
    // nhận ra đã tới giờ, không ngủ tiếp theo con số tính từ trước.
    vi.setSystemTime(new Date("2026-10-01T01:59:59+07:00"));
    await vi.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS);

    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG chạy chồng: lượt trước chưa xong thì bỏ mốc mới, kèm cảnh báo", async () => {
    let finish: () => void = () => undefined;
    const runJob = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const log = fakeLog();
    scheduler = startInProcessScheduler({
      schedules: [schedule({ id: "slow" })],
      runJob,
      log,
    });

    await vi.advanceTimersByTimeAsync(30_000); // 02:00 — bắt đầu, chưa xong
    await vi.advanceTimersByTimeAsync(60_000); // 02:01 — phải bỏ qua
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("lượt trước chưa chạy xong"),
      expect.objectContaining({ schedule: "slow" }),
    );

    finish();
    await vi.advanceTimersByTimeAsync(60_000); // 02:02 — chạy lại bình thường
    expect(runJob).toHaveBeenCalledTimes(2);
    finish();
  });

  it("thử lại theo attempts, giãn cách luỹ thừa, không báo lỗi khi lần sau thành công", async () => {
    const runJob = vi
      .fn<(name: ScheduledJobName) => Promise<void>>()
      .mockRejectedValueOnce(new Error("database chập chờn"))
      .mockRejectedValueOnce(new Error("database chập chờn"))
      .mockResolvedValue(undefined);
    const log = fakeLog();
    scheduler = startInProcessScheduler({
      schedules: [
        schedule({
          id: "retry",
          name: "invoice:mark-overdue",
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
        }),
      ],
      runJob,
      log,
    });

    await vi.advanceTimersByTimeAsync(30_000); // 02:00 — lần 1 hỏng
    expect(runJob).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(runJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // +1s — lần 2 hỏng
    expect(runJob).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000); // +2s — lần 3 thành công
    expect(runJob).toHaveBeenCalledTimes(3);

    expect(log.warn.mock.calls.map((call) => (call[1] as { delayMs: number }).delayMs)).toEqual([
      1_000, 2_000,
    ]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("hết lượt thử thì ghi lỗi MỘT lần, và mốc sau vẫn chạy", async () => {
    const runJob = vi.fn(() => Promise.reject(new Error("hỏng hẳn")));
    const log = fakeLog();
    scheduler = startInProcessScheduler({
      schedules: [schedule({ id: "fail" })],
      runJob,
      log,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("thất bại HẲN"),
      expect.any(Error),
      expect.objectContaining({ schedule: "fail", attempt: 1, attempts: 1 }),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runJob).toHaveBeenCalledTimes(2);
  });

  it("khởi động lại (dev nạp lại module) thay bộ cũ, không nhân đôi lịch", async () => {
    const runJob = vi.fn(() => Promise.resolve());
    startInProcessScheduler({ schedules: [schedule({ id: "reload" })], runJob, log: fakeLog() });
    scheduler = startInProcessScheduler({
      schedules: [schedule({ id: "reload" })],
      runJob,
      log: fakeLog(),
    });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("stop() dừng hẳn, kể cả đang chờ thử lại — và nhả khoá chống chồng", async () => {
    const runJob = vi.fn(() => Promise.reject(new Error("hỏng")));
    const first = startInProcessScheduler({
      schedules: [
        schedule({ id: "stop", attempts: 3, backoff: { type: "exponential", delay: 1_000 } }),
      ],
      runJob,
      log: fakeLog(),
    });

    await vi.advanceTimersByTimeAsync(30_000); // lần 1 hỏng, đang chờ thử lại
    first.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(runJob).toHaveBeenCalledTimes(1);

    // Bộ mới cùng id phải chạy được — nếu khoá không nhả, lịch này câm vĩnh viễn.
    const succeed = vi.fn(() => Promise.resolve());
    scheduler = startInProcessScheduler({
      schedules: [schedule({ id: "stop" })],
      runJob: succeed,
      log: fakeLog(),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(succeed).toHaveBeenCalledTimes(1);
  });

  it("ghi log lúc khởi động: có những lịch nào, theo múi giờ nào", () => {
    const log = fakeLog();
    scheduler = startInProcessScheduler({
      schedules: buildSchedules(DEFAULT_ENV),
      runJob: () => Promise.resolve(),
      log,
    });

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("NGAY TRONG tiến trình"),
      expect.objectContaining({
        timeZone: "Asia/Ho_Chi_Minh",
        schedules: expect.arrayContaining(["invoice-generate-monthly (30 2 * * *)"]),
      }),
    );
  });
});
