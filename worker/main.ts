import { isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isMailerConfigured } from "@/lib/mailer";
import { prisma } from "@/lib/prisma";
import { isPhoneVerificationEnabled, isSmserConfigured } from "@/lib/smser";
import { buildSchedules } from "@/jobs/schedules";
import { workerEnv } from "./env";
import { startWorker } from "./worker";

/**
 * Entry của tiến trình worker.
 *
 * Tách khỏi `worker.ts` để test gọi được từng phần của worker mà không tự chạy
 * nó — import một file là nó tự chạy và không tắt được thì không test nổi.
 */
function main() {
  /*
   * Chốt chặn cho cấu hình tự mâu thuẫn: hàng đợi đã tắt mà worker vẫn được
   * dựng lên. Lúc đó `enqueue()` chạy job thẳng trong request và job theo lịch
   * do chính tiến trình web chạy, còn tiến trình này ngồi chờ một hàng đợi không
   * bao giờ có gì — tốn RAM và, tệ hơn, trông y như đang hoạt động bình thường.
   *
   * Đường tắt ĐÚNG là không dựng tiến trình này ngay từ đầu; cùng biến
   * `QUEUE_ENABLED` lo việc đó ở cả ba đường deploy (`replicas` trong compose,
   * lọc app trong ecosystem.config.cjs, `scripts/deploy-vps.sh` với systemd).
   * Nhánh dưới đây chỉ để trường hợp lọt lưới không diễn ra trong im lặng.
   */
  if (!workerEnv.QUEUE_ENABLED) {
    logger.warn(
      "QUEUE_ENABLED=0 — hàng đợi đã tắt nên worker không có việc gì để làm. Thoát.\n" +
        "Nếu đây là ngoài ý muốn: đặt QUEUE_ENABLED=1 rồi dựng lại.\n" +
        "Nếu đúng ý: gỡ tiến trình này khỏi cấu hình deploy (docker compose up -d " +
        "sẽ tự gỡ container, systemd thì `systemctl disable --now chotsan-worker`).",
    );
    process.exit(0);
  }

  // `env.ts` đã chặn QUEUE_ENABLED=1 mà thiếu REDIS_URL; dòng này chỉ để kiểu thu hẹp.
  if (!workerEnv.REDIS_URL) throw new Error("Thiếu REDIS_URL");

  /*
   * Email và SMS đi qua hàng đợi được gửi TỪ ĐÂY, nên cấu hình thiếu phải lộ ở
   * log của worker lúc khởi động — không phải ở job thất bại đầu tiên.
   * Cắm nhà cung cấp thật (`setMailer`/`setSmser`) phải đặt TRƯỚC khối này.
   */
  if (isProduction) {
    if (!isMailerConfigured()) {
      logger.error(
        "Chưa cấu hình gửi email (thiếu SMTP_HOST, chưa gọi setMailer) — mọi job email:send sẽ LỖI.",
      );
    }
    if (isPhoneVerificationEnabled() && !isSmserConfigured()) {
      logger.error(
        "PHONE_VERIFICATION_ENABLED=1 nhưng chưa cắm nhà cung cấp SMS (setSmser) — mọi job sms:send sẽ LỖI.",
      );
    }
  }

  const worker = startWorker({
    redisUrl: workerEnv.REDIS_URL,
    concurrency: workerEnv.WORKER_CONCURRENCY,
    healthPort: workerEnv.WORKER_HEALTH_PORT,
    healthHost: workerEnv.HOST,
    schedules: buildSchedules(workerEnv),
  });

  const shutdown = () => {
    logger.info("Đang tắt worker…");

    // `stop()` ĐỢI các job đang chạy dở hoàn tất. Đây là điểm quan trọng nhất
    // của việc tắt gọn gàng: cắt ngang một job đã trừ tiền nhưng chưa ghi nhận
    // là để lại dữ liệu sai. Job chưa bắt đầu vẫn nằm nguyên trong Redis, một
    // worker khác (hoặc chính tiến trình này sau khi khởi động lại) sẽ nhận.
    //
    // ⚠️ Trình quản lý tiến trình phải cho đủ thời gian: mặc định Docker chỉ
    // đợi 10 giây sau SIGTERM rồi SIGKILL. Job dài hơn thế thì nâng
    // `stop_grace_period` trong compose.
    worker
      .stop()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error("Tắt worker không sạch", error);
        process.exit(1);
      });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

try {
  main();
} catch (error: unknown) {
  logger.error("Worker không khởi động được", error);
  process.exit(1);
}
