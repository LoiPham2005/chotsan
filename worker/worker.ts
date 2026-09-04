import { createServer, type Server as HttpServer } from "node:http";
import { Queue, Worker, type Job } from "bullmq";
import { logger } from "@/lib/logger";
import { jobHandlers } from "@/jobs/handlers";
import type { JobName } from "@/jobs/types";
import { workerEnv } from "./env";

/**
 * Tiến trình chạy job nền — RIÊNG với web, giống cách `realtime/` tách ra.
 *
 * ---
 * VÌ SAO PHẢI LÀ TIẾN TRÌNH RIÊNG
 *
 * Ba lý do, xếp theo mức quan trọng:
 *
 * 1. **Deploy web không được giết job đang chạy.** Chạy chung tiến trình thì
 *    mỗi lần restart web là một job đang xử lý dở bị cắt ngang.
 * 2. **Job nặng không được làm chậm request.** Xuất một file Excel 50MB mà
 *    chung tiến trình với web thì mọi người dùng khác đều cảm nhận được.
 * 3. **Scale độc lập.** Web cần nhiều instance vì nhiều request; worker cần
 *    nhiều instance vì nhiều job. Hai con số đó không liên quan gì tới nhau.
 *
 * ---
 * NHIỀU WORKER CÙNG LÚC THÌ SAO
 *
 * An toàn. BullMQ dùng Redis để khoá job: một job chỉ được giao cho đúng một
 * worker. Chạy 3 instance worker là xử lý nhanh gấp 3, không phải chạy trùng.
 */

export type WorkerHandle = {
  stop: () => Promise<void>;
};

/**
 * Endpoint `/health` — cách duy nhất để bên ngoài biết worker còn sống.
 *
 * Worker không phục vụ request nghiệp vụ, nên không có gì để ping. Thiếu
 * endpoint này thì Docker, systemd và PM2 đều chỉ biết "tiến trình còn tồn
 * tại" — một worker treo vì mất kết nối Redis vẫn được coi là khoẻ.
 *
 * Trả kèm số job trong hàng đợi. Đây là phần đáng giá nhất: nó biến việc "xem
 * hàng đợi có ùn không" từ chuyện phải SSH vào gõ `redis-cli` thành một lệnh
 * `curl`. Job hỏng mà không ai nhìn thấy là job không tồn tại.
 */
function startHealthServer(queue: Queue): HttpServer {
  const server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }

    void queue
      .getJobCounts("waiting", "active", "delayed", "failed")
      .then((counts) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", counts }));
      })
      .catch(() => {
        // Không đếm được job nghĩa là mất kết nối Redis — worker vẫn "chạy"
        // nhưng không làm được việc gì. Phải trả 503 để trình quản lý tiến
        // trình xoay vòng nó, thay vì để nó ngồi im và trông như đang khoẻ.
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error", queue: "unreachable" }));
      });
  });

  server.listen(workerEnv.WORKER_HEALTH_PORT, "0.0.0.0");
  return server;
}

/**
 * Đăng ký các job chạy theo lịch.
 *
 * ---
 * VÌ SAO DÙNG JOB SCHEDULER CỦA BULLMQ CHỨ KHÔNG PHẢI `setInterval`
 *
 * Chạy 3 bản worker thì `setInterval` cho ra BA lượt chạy mỗi phút. Với job
 * dọn dẹp thì vô hại; với job đụng tiền thì không. Job scheduler dùng Redis
 * làm điểm chốt: mỗi mốc thời gian chỉ sinh ra ĐÚNG MỘT job, và đúng một
 * worker nhận nó — không cần khoá phân tán tự viết.
 *
 * `upsertJobScheduler` là idempotent theo `id`: mọi bản worker gọi cùng một id
 * thì kết quả vẫn là một lịch duy nhất. Đổi biểu thức cron rồi deploy lại là
 * lịch tự cập nhật, không đẻ ra lịch thứ hai.
 */
async function registerSchedules(queue: Queue): Promise<void> {
  const schedules = [
    { id: "booking-expire-holds", cron: workerEnv.CRON_EXPIRE_HOLDS, name: "booking:expire-holds" },
    {
      id: "payment-expire-pending",
      cron: workerEnv.CRON_EXPIRE_HOLDS,
      name: "payment:expire-pending",
    },
    {
      id: "maintenance-purge-expired",
      cron: workerEnv.CRON_PURGE_EXPIRED,
      name: "maintenance:purge-expired",
    },
  ] as const;

  try {
    for (const schedule of schedules) {
      await queue.upsertJobScheduler(
        schedule.id,
        { pattern: schedule.cron },
        {
          name: schedule.name,
          data: {},
          /*
           * Job theo lịch KHÔNG thử lại: mốc tiếp theo tới sau vài giây tới vài
           * phút nữa và sẽ tự dọn nốt phần còn sót. Thử lại chỉ chồng thêm việc
           * lên một hệ thống đang có vấn đề.
           */
          opts: { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
        },
      );
    }

    logger.info("Đã đăng ký job theo lịch", {
      expireHolds: workerEnv.CRON_EXPIRE_HOLDS,
      purgeExpired: workerEnv.CRON_PURGE_EXPIRED,
    });
  } catch (error) {
    // Không giết tiến trình: worker vẫn xử lý được job thường. Nhưng phải kêu
    // to — thiếu lịch này thì chỗ giữ quá hạn không bao giờ được nhả, và triệu
    // chứng (lịch kín trong khi sân trống) không hề trỏ về đây.
    logger.error("KHÔNG đăng ký được job theo lịch — chỗ giữ quá hạn sẽ không được nhả", error);
  }
}

export function startWorker(): WorkerHandle {
  const worker = new Worker(
    "app",
    async (job: Job) => {
      const name = job.name as JobName;
      /*
       * Ép kiểu handler về `(payload: unknown) => Promise<void>`.
       *
       * `name` đến từ Redis dưới dạng chuỗi nên nó là HỢP của mọi tên job, và
       * `jobHandlers[name]` có kiểu tham số là GIAO của mọi payload — một kiểu
       * không giá trị nào thoả mãn. TypeScript không thu hẹp được vì `name` và
       * `job.data` là hai giá trị độc lập.
       *
       * An toàn ở tầng chạy: `enqueue()` là hàm generic, nên payload sai kiểu
       * bị chặn ngay lúc biên dịch ở phía ĐẨY job — chỗ duy nhất kiểm được thật.
       */
      const handler = jobHandlers[name] as ((payload: unknown) => Promise<void>) | undefined;

      if (!handler) {
        // Job lạ = phiên bản worker cũ hơn phiên bản web đang chạy. Ném lỗi để
        // BullMQ giữ job lại trong danh sách thất bại thay vì coi như đã xong
        // — nhờ vậy sau khi deploy worker mới, job vẫn còn để chạy lại.
        throw new Error(`Không có handler cho job "${name}" — worker cũ hơn app?`);
      }

      const startedAt = Date.now();
      await handler(job.data);

      logger.info("Job xong", {
        name,
        jobId: job.id,
        attempt: job.attemptsMade + 1,
        durationMs: Date.now() - startedAt,
      });
    },
    {
      connection: { url: workerEnv.REDIS_URL },
      concurrency: workerEnv.WORKER_CONCURRENCY,
    },
  );

  // Job thất bại là thứ PHẢI thấy được. Không có listener này thì lần thử cuối
  // cùng thất bại rơi vào im lặng, và bạn chỉ phát hiện khi có người hỏi vì sao
  // không nhận được email.
  worker.on("failed", (job, error) => {
    const isFinalAttempt = !job || job.attemptsMade >= (job.opts.attempts ?? 1);
    const context = { name: job?.name, jobId: job?.id, attempt: job?.attemptsMade };

    // Tách hai nhánh thay vì `logger[cond]`: `warn` nhận (message, context)
    // còn `error` nhận (message, error, context) — hai chữ ký khác nhau, gộp
    // lại bằng truy cập theo chỉ số là mất luôn đối số `error`.
    if (isFinalAttempt) {
      logger.error("Job thất bại HẲN, không thử lại nữa", error, context);
    } else {
      logger.warn("Job thất bại, sẽ thử lại", { ...context, message: error.message });
    }
  });

  // Lỗi ở tầng kết nối (Redis rớt), không thuộc job nào. Không nghe thì nó
  // thành unhandled error và giết tiến trình.
  worker.on("error", (error) => {
    logger.error("Worker lỗi", error);
  });

  const queue = new Queue("app", { connection: { url: workerEnv.REDIS_URL } });
  const healthServer = startHealthServer(queue);

  void registerSchedules(queue);

  logger.info("Worker đã chạy", {
    concurrency: workerEnv.WORKER_CONCURRENCY,
    healthPort: workerEnv.WORKER_HEALTH_PORT,
  });

  return {
    // `close()` đợi các job ĐANG chạy xong rồi mới thoát. Đây là điều kiện để
    // deploy không làm mất việc — xem xử lý SIGTERM trong `main.ts`.
    stop: async () => {
      // Đóng health server TRƯỚC: trình quản lý tiến trình lập tức thấy worker
      // không còn nhận request, thay vì thấy nó vẫn "khoẻ" trong lúc đang tắt.
      healthServer.close();
      await worker.close();
      await queue.close();
    },
  };
}
