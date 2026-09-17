import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { jobHandlers } from "@/jobs/handlers";

/**
 * Dọn dữ liệu chỉ-tăng (token hết hạn, nhật ký cũ, thiết bị chết) — chạy TAY
 * hoặc theo lịch của máy chủ.
 *
 * ---
 * VÌ SAO GỌI THẲNG HANDLER CỦA JOB
 *
 * Việc dọn đã chạy tự động theo lịch `maintenance-purge-expired` (worker, hoặc
 * chính tiến trình web khi `QUEUE_ENABLED=0` — xem `src/jobs/schedules.ts`).
 * Script này là đường chạy tay của CÙNG handler đó.
 *
 * Bản trước tự viết lại các bước dọn và lệch khỏi handler: giữ nhật ký 90 ngày
 * trong khi `AUDIT_RETENTION_DAYS` mặc định 365, và không dọn thiết bị cũ. Chạy
 * tay một lần là xoá mất 9 tháng nhật ký mà cấu hình nói phải giữ.
 *
 * ---
 * CÁCH CHẠY
 *
 *   pnpm db:purge
 *
 * Trên máy chủ, gọi nó theo lịch — xem `deploy/chotsan-purge.timer` (systemd).
 * An toàn khi chạy nhiều lần và chạy song song: mọi truy vấn đều là
 * `deleteMany` theo điều kiện thời gian, không có bước đọc-rồi-ghi nào để tranh.
 */
async function main() {
  const startedAt = Date.now();

  // Handler tự ghi log số dòng đã xoá của từng bảng.
  await jobHandlers["maintenance:purge-expired"]({});

  logger.info("Dọn dữ liệu hết hạn xong", { durationMs: Date.now() - startedAt });
}

main()
  .catch((error: unknown) => {
    logger.error("Dọn dữ liệu hết hạn thất bại", error);
    // Thoát khác 0 để cron/systemd ghi nhận là chạy hỏng. Im lặng thất bại thì
    // bảng vẫn phình mà không ai biết.
    process.exitCode = 1;
  })
  .finally(() => {
    // Script ngắn hạn phải tự đóng kết nối, nếu không tiến trình treo cho tới
    // khi pool tự hết hạn — với cron thì đó là một tiến trình zombie mỗi lần chạy.
    void prisma.$disconnect();
  });
