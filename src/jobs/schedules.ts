import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import type { JobName, JobPayloads } from "@/jobs/types";

/**
 * Job theo lịch — danh sách DUY NHẤT, dùng chung cho hai nơi chạy.
 *
 * ---
 * HAI NƠI CHẠY, MỘT DANH SÁCH
 *
 *   - Có hàng đợi thật (`QUEUE_ENABLED=1` + `REDIS_URL`): `worker/worker.ts` đăng ký
 *     từng mục thành job scheduler của BullMQ. Redis chốt mỗi mốc chỉ sinh MỘT job.
 *   - Chọn không dùng hàng đợi (`QUEUE_ENABLED=0`): `startInProcessScheduler()`
 *     chạy chúng ngay trong tiến trình web (gọi từ `register()` của
 *     `src/instrumentation.ts`). Bật cờ mà thiếu Redis thì không ai chạy lịch —
 *     xem `schedulingMode`.
 *
 * Trước đây lịch chỉ nằm trong worker, nên tắt hàng đợi (hoặc máy dev không có
 * Redis) là KHÔNG lịch nào chạy: giao dịch PENDING quá hạn không bị huỷ, hoá đơn
 * hoa hồng không được xuất — và không có dòng log nào báo. Hai bản danh sách thì
 * sớm muộn lệch nhau, nên chúng nằm chung một chỗ ở đây.
 *
 * ---
 * CHẠY TRÙNG GIỮA NHIỀU INSTANCE LÀ CHẤP NHẬN ĐƯỢC
 *
 * Bộ chạy trong tiến trình không có khoá phân tán: chạy 3 instance web với
 * `QUEUE_ENABLED=0` là 3 lượt mỗi mốc. Điều đó an toàn vì mọi handler ở đây đều
 * idempotent — `updateMany`/`deleteMany` theo điều kiện trạng thái + thời gian
 * (lượt sau không còn gì để đụng), hoá đơn chốt bằng
 * `@@unique([venueId, periodStart])`. Job mới thêm vào danh sách PHẢI giữ được
 * tính chất đó.
 */

/**
 * Múi giờ diễn giải mọi biểu thức cron.
 *
 * Máy chủ (Docker, VPS) chạy UTC. Không đặt múi giờ thì "02:00 ngày mùng 1" thành
 * 09:00 giờ Việt Nam và "3 giờ sáng ít người dùng" thành 10 giờ sáng — lệch đúng
 * luật "mọi ngày giờ theo Asia/Ho_Chi_Minh" của dự án.
 */
export const SCHEDULE_TIMEZONE = "Asia/Ho_Chi_Minh";

/**
 * `true` khi biểu thức parse được VÀ có mốc chạy kế tiếp.
 *
 * Gọi thử `next()` chứ không chỉ parse: `0 0 31 2 *` (ngày 31 tháng 2) parse vẫn
 * qua nhưng không bao giờ tới — lỗi đó phải lộ lúc khởi động, không phải thành
 * một lịch câm.
 */
export function isValidCronPattern(pattern: string): boolean {
  if (pattern.trim() === "") return false;

  try {
    CronExpressionParser.parse(pattern, { tz: SCHEDULE_TIMEZONE }).next();
    return true;
  } catch {
    return false;
  }
}

function cronPattern(fallback: string) {
  return z.preprocess(
    // Dòng `CRON_X=` bỏ trống trong `.env` = không khai, dùng mặc định — cùng
    // quy ước với `optionalString` của `src/lib/env.ts`.
    (value) => (value === "" ? undefined : value),
    z.string().default(fallback).refine(isValidCronPattern, {
      error:
        "biểu thức cron không hợp lệ hoặc không bao giờ tới (dạng `phút giờ ngày tháng thứ`, vd `0 3 * * *`)",
    }),
  );
}

/**
 * Biến môi trường của lịch. Worker gộp vào schema của nó (`worker/env.ts`), web
 * đọc qua `parseScheduleEnv()` — một định nghĩa, một bộ mặc định.
 */
export const scheduleEnvSchema = z.object({
  /**
   * Nhả chỗ giữ + huỷ giao dịch quá hạn. MỖI PHÚT: thưa hơn thì khách thấy
   * "đã có người đặt" lâu hơn đúng bằng khoảng đó cho một khung đang trống.
   */
  CRON_EXPIRE_HOLDS: cronPattern("* * * * *"),
  /** Dọn token/nhật ký/thiết bị cũ. 03:00 — giờ ít người dùng nhất. */
  CRON_PURGE_EXPIRED: cronPattern("0 3 * * *"),
  /**
   * Xuất hoá đơn hoa hồng cho các tháng đã kết thúc còn thiếu: 02:30 MỖI NGÀY.
   *
   * Không phải chỉ mùng 1: handler tự bù mọi tháng còn thiếu trong 3 tháng gần
   * nhất và bỏ qua kỳ đã xuất, nên chạy hằng ngày gần như không tốn gì — còn nếu
   * chỉ chạy mùng 1 thì một lần hỏng (database bảo trì, deploy đúng giờ đó) là
   * phải đợi tới tháng sau mới có hoá đơn.
   */
  CRON_INVOICE_MONTHLY: cronPattern("30 2 * * *"),
  /** Đánh dấu hoá đơn quá hạn: 04:00 mỗi ngày. */
  CRON_INVOICE_OVERDUE: cronPattern("0 4 * * *"),
});

export type ScheduleEnv = z.infer<typeof scheduleEnvSchema>;

export function parseScheduleEnv(source: Record<string, string | undefined>): ScheduleEnv {
  const parsed = scheduleEnvSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Cấu hình lịch chạy job không hợp lệ:\n${details}`);
  }

  return parsed.data;
}

/**
 * Job chạy theo lịch không nhận dữ liệu: mọi thứ nó cần tự đọc từ database lúc
 * chạy. Kiểu này loại ra các job CÓ payload (email, SMS, push) ngay lúc biên dịch.
 */
export type ScheduledJobName = {
  [TName in JobName]: JobPayloads[TName] extends Record<string, never> ? TName : never;
}[JobName];

export type ScheduleDefinition = {
  /**
   * Khoá của lịch (`upsertJobScheduler` của BullMQ). ĐỔI id là đẻ ra lịch THỨ HAI
   * trong Redis — lịch cũ vẫn chạy cho tới khi bị xoá tay.
   */
  id: string;
  name: ScheduledJobName;
  pattern: string;
  /** Số lần chạy tối đa của MỘT mốc, tính cả lần đầu. */
  attempts: number;
  /** Chờ trước lần thử lại thứ n: `delay * 2^(n-1)` — đúng công thức `exponential` của BullMQ. */
  backoff?: { type: "exponential"; delay: number };
};

/**
 * Hoá đơn là job hiếm (tháng một lần / ngày một lần) và đụng tiền: hỏng vì
 * database chập chờn mà đợi tới mốc sau là trễ cả tháng. Thử lại 3 lần, giãn
 * 1 rồi 2 phút — đủ vượt một lần khởi động lại database hay mất mạng ngắn.
 */
const INVOICE_RETRY = { attempts: 3, backoff: { type: "exponential", delay: 60_000 } } as const;

export function buildSchedules(env: ScheduleEnv): readonly ScheduleDefinition[] {
  return [
    /*
     * Job mỗi phút KHÔNG thử lại: mốc kế tiếp tới sau chưa đầy một phút và tự
     * dọn nốt phần còn sót. Thử lại chỉ chồng thêm việc lên một hệ thống đang lỗi.
     */
    {
      id: "booking-expire-holds",
      name: "booking:expire-holds",
      pattern: env.CRON_EXPIRE_HOLDS,
      attempts: 1,
    },
    {
      id: "payment-expire-pending",
      name: "payment:expire-pending",
      pattern: env.CRON_EXPIRE_HOLDS,
      attempts: 1,
    },
    // Dọn dẹp trễ một ngày không hại gì — bảng chỉ to thêm một ngày.
    {
      id: "maintenance-purge-expired",
      name: "maintenance:purge-expired",
      pattern: env.CRON_PURGE_EXPIRED,
      attempts: 1,
    },
    {
      id: "invoice-generate-monthly",
      name: "invoice:generate-monthly",
      pattern: env.CRON_INVOICE_MONTHLY,
      ...INVOICE_RETRY,
    },
    {
      id: "invoice-mark-overdue",
      name: "invoice:mark-overdue",
      pattern: env.CRON_INVOICE_OVERDUE,
      ...INVOICE_RETRY,
    },
  ];
}

/**
 * Ai chạy job theo lịch — cũng là giá trị `features.schedules` của `/api/health`.
 *
 *   - `worker`     — có hàng đợi thật: tiến trình worker đăng ký lịch vào Redis.
 *   - `in-process` — CHỌN không dùng hàng đợi (`QUEUE_ENABLED=0`): tiến trình web
 *                    tự chạy lịch.
 *   - `off`        — bật cờ mà thiếu `REDIS_URL`. Không ai chạy lịch.
 *                    Production: `enqueue()` vốn đã ném lỗi ở cấu hình này ("thiếu
 *                    là quên"), lịch không lặng lẽ chữa cháy cho một cấu hình sai.
 *                    Máy dev: đây là cấu hình MẶC ĐỊNH (không ai cài Redis để code
 *                    giao diện) — xem lý do ngay dưới.
 *
 * ---
 * VÌ SAO MÁY DEV THIẾU REDIS KHÔNG TỰ CHẠY LỊCH
 *
 * Lịch nhả chỗ giữ chạy MỖI PHÚT. Database dev là Neon: compute chỉ tự ngủ khi
 * không có truy vấn nào trong vài phút. `pnpm dev` để chạy qua đêm mà hỏi database
 * mỗi phút là compute thức 24/7 — đốt hết giờ compute của gói, rồi database ngừng
 * phục vụ tới cuối tháng. Mà ở dev không lịch nào là bắt buộc: lịch trống đã coi
 * chỗ giữ quá hạn là trống, trang thanh toán đã tự từ chối giao dịch quá hạn.
 * Cần thử lịch thì chạy `pnpm worker:dev` (có Redis) hoặc đặt `QUEUE_ENABLED=0`.
 */
export type SchedulingMode = "worker" | "in-process" | "off";

export function schedulingMode(config: {
  QUEUE_ENABLED: boolean;
  REDIS_URL?: string | undefined;
}): SchedulingMode {
  if (!config.QUEUE_ENABLED) return "in-process";
  return config.REDIS_URL ? "worker" : "off";
}

// ---------------------------------------------------------------------------
// Bộ chạy lịch trong tiến trình
// ---------------------------------------------------------------------------

/**
 * Hẹn giờ tối đa cho MỘT lần chờ.
 *
 * `setTimeout` quá 2^31−1 ms (~24,8 ngày) bị Node coi là 1 ms: lịch hằng tháng
 * sẽ chạy NGAY rồi chạy liên tục. Chờ từng quãng ngắn rồi so lại đồng hồ thật
 * còn né được cả chuyện đồng hồ máy nhảy (NTP chỉnh, máy ảo ngủ rồi thức).
 */
export const MAX_TIMER_DELAY_MS = 60_000;

type Context = Record<string, unknown>;

export type SchedulerLog = {
  info(message: string, context?: Context): void;
  warn(message: string, context?: Context): void;
  error(message: string, error?: unknown, context?: Context): void;
};

export type InProcessScheduler = { stop(): void };

type SchedulerState = { running: Set<string>; active: InProcessScheduler | null };

const STATE_KEY = Symbol.for("chotsan.in-process-scheduler");

/**
 * Trạng thái dùng chung cho CẢ tiến trình, gắn vào `globalThis`.
 *
 * `next dev` có thể nạp lại module mà không khởi động lại tiến trình. Giữ trạng
 * thái trong biến module thì bản nạp sau không thấy lượt đang chạy của bản trước
 * — và một lịch chạy chồng hai lượt lên nhau.
 */
function sharedState(): SchedulerState {
  const holder = globalThis as unknown as Record<symbol, SchedulerState | undefined>;
  holder[STATE_KEY] ??= { running: new Set(), active: null };
  return holder[STATE_KEY];
}

/**
 * Chạy danh sách lịch ngay trong tiến trình hiện tại.
 *
 * Bảo đảm trong MỘT tiến trình:
 *   - mỗi lịch không bao giờ chạy chồng hai lượt — lượt trước chưa xong (tính cả
 *     các lần thử lại) thì mốc mới bị bỏ qua kèm cảnh báo;
 *   - gọi lại hàm này (nạp lại module ở dev) thay bộ cũ chứ không nhân đôi lịch;
 *   - timer không giữ tiến trình sống (`unref`) — tắt máy chủ không phải đợi mốc sau.
 *
 * Không bảo đảm: chạy bù mốc đã lỡ khi tiến trình đang tắt (worker BullMQ thì có),
 * và không chống trùng giữa nhiều instance — xem đầu tệp.
 */
export function startInProcessScheduler(options: {
  schedules: readonly ScheduleDefinition[];
  runJob: (name: ScheduledJobName) => Promise<void>;
  log: SchedulerLog;
  timeZone?: string;
}): InProcessScheduler {
  const { schedules, runJob, log, timeZone = SCHEDULE_TIMEZONE } = options;
  const state = sharedState();

  state.active?.stop();

  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const sleepers = new Set<() => void>();

  function later(callback: () => void, delayMs: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timer.unref?.();
    timers.add(timer);
  }

  /** Chờ giữa hai lần thử lại. `stop()` đánh thức ngay để lượt đang dở được giải phóng. */
  function sleep(delayMs: number): Promise<void> {
    if (stopped) return Promise.resolve();

    return new Promise((resolve) => {
      const wake = () => {
        sleepers.delete(wake);
        resolve();
      };
      sleepers.add(wake);
      later(wake, delayMs);
    });
  }

  async function fire(schedule: ScheduleDefinition): Promise<void> {
    const context = { schedule: schedule.id, job: schedule.name };

    if (state.running.has(schedule.id)) {
      log.warn("Bỏ qua một mốc của job theo lịch: lượt trước chưa chạy xong", context);
      return;
    }

    state.running.add(schedule.id);
    try {
      for (let attempt = 1; attempt <= schedule.attempts && !stopped; attempt += 1) {
        try {
          await runJob(schedule.name);
          return;
        } catch (error) {
          const attemptContext = { ...context, attempt, attempts: schedule.attempts };

          if (attempt >= schedule.attempts) {
            log.error("Job theo lịch thất bại HẲN — chờ tới mốc kế tiếp", error, attemptContext);
            return;
          }

          const delayMs = (schedule.backoff?.delay ?? 0) * 2 ** (attempt - 1);
          log.warn("Job theo lịch thất bại, sẽ thử lại", {
            ...attemptContext,
            delayMs,
            message: error instanceof Error ? error.message : String(error),
          });
          await sleep(delayMs);
        }
      }
    } finally {
      state.running.delete(schedule.id);
    }
  }

  function arm(schedule: ScheduleDefinition): void {
    let dueAt: number;
    try {
      dueAt = CronExpressionParser.parse(schedule.pattern, {
        currentDate: new Date(Date.now()),
        tz: timeZone,
      })
        .next()
        .getTime();
    } catch (error) {
      // Ném trong callback của timer là giết cả máy chủ web. Biểu thức đã được
      // kiểm lúc khởi động, nên nhánh này chỉ còn cho trường hợp không lường trước.
      log.error("Không tính được mốc chạy kế tiếp — lịch này dừng", error, {
        schedule: schedule.id,
        pattern: schedule.pattern,
      });
      return;
    }

    const check = () => {
      if (stopped) return;

      const remaining = dueAt - Date.now();
      if (remaining > 0) {
        later(check, Math.min(remaining, MAX_TIMER_DELAY_MS));
        return;
      }

      // Không `await`: mốc kế tiếp phải được hẹn NGAY, dù lượt này chạy lâu.
      // Chạy chồng đã có `state.running` chặn.
      void fire(schedule);
      arm(schedule);
    };

    check();
  }

  const scheduler: InProcessScheduler = {
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const wake of [...sleepers]) wake();
      if (state.active === scheduler) state.active = null;
    },
  };

  state.active = scheduler;

  log.info("Job theo lịch chạy NGAY TRONG tiến trình này (không có worker)", {
    timeZone,
    schedules: schedules.map((schedule) => `${schedule.id} (${schedule.pattern})`),
  });

  for (const schedule of schedules) arm(schedule);

  return scheduler;
}
