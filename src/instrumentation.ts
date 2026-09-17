import type { Instrumentation } from "next";

/**
 * Móc khởi động và móc lỗi phía máy chủ của Next.
 *
 * Mọi import nằm TRONG hàm (import động): tệp này được biên dịch cho cả runtime
 * Edge, và được Vitest nạp — nạp Prisma/logger ở đầu tệp là kéo chúng vào những
 * nơi đó.
 */

/**
 * Chạy MỘT lần khi tiến trình máy chủ Next khởi động (`next dev`, `next start`,
 * `server.js` của bản standalone), trước request đầu tiên.
 *
 * Hai việc:
 *
 * 1. **Báo to cấu hình production còn thiếu** ngay lúc khởi động — thay vì để
 *    người dùng đầu tiên bấm "gửi mã OTP" hay "tải ảnh lên" mới lộ.
 * 2. **Chạy job theo lịch khi chọn không dùng hàng đợi** (`QUEUE_ENABLED=0`).
 *    Trước đây lịch chỉ worker chạy: tắt hàng đợi là giao dịch PENDING quá hạn
 *    không bao giờ bị huỷ, hoá đơn hoa hồng không bao giờ xuất. Danh sách lịch và
 *    lý do máy dev thiếu Redis KHÔNG tự chạy lịch: `src/jobs/schedules.ts`.
 */
export async function register(): Promise<void> {
  // Edge không có Prisma lẫn timer sống lâu. Next 16 đã tự bỏ qua `register` lúc
  // `next build`, chặn thêm ở đây cho chắc: build mà dựng timer thì treo build.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Vitest nạp tệp này để test `onRequestError`; test không được tự dựng timer.
  if (process.env.NODE_ENV === "test") return;

  const [{ env, isProduction }, { logger }, schedules] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/logger"),
    import("@/jobs/schedules"),
  ]);

  /*
   * ⚠️ Cắm nhà cung cấp thật (`setMailer`/`setSmser`/`setStorage`/
   * `setErrorReporter`) phải đặt TRƯỚC khối kiểm dưới đây — và cắm cả trong
   * `worker/main.ts`, vì email/SMS đi qua hàng đợi được gửi từ tiến trình worker.
   */
  if (isProduction) {
    const [{ isMailerConfigured }, { isPhoneVerificationEnabled, isSmserConfigured }, storage] =
      await Promise.all([import("@/lib/mailer"), import("@/lib/smser"), import("@/lib/storage")]);

    if (!isMailerConfigured()) {
      logger.error(
        "Chưa cấu hình gửi email (thiếu SMTP_HOST, chưa gọi setMailer) — mọi email xác thực, " +
          "đặt lại mật khẩu sẽ LỖI trên production.",
      );
    }

    if (isPhoneVerificationEnabled() && !isSmserConfigured()) {
      logger.error(
        "PHONE_VERIFICATION_ENABLED=1 nhưng chưa cắm nhà cung cấp SMS (setSmser) — mọi yêu cầu " +
          "gửi mã OTP sẽ LỖI. Cắm nhà cung cấp, hoặc đặt PHONE_VERIFICATION_ENABLED=0.",
      );
    }

    if (!storage.isStorageConfigured()) {
      logger.warn(
        "Chưa cấu hình kho lưu trữ tệp (setStorage) — POST /api/v1/files trả 503 trên production.",
      );
    }
  }

  const mode = schedules.schedulingMode(env);

  if (mode === "off") {
    if (isProduction) {
      logger.error(
        "QUEUE_ENABLED=1 nhưng thiếu REDIS_URL — KHÔNG job theo lịch nào chạy (nhả giao dịch quá " +
          "hạn, xuất hoá đơn). Đặt REDIS_URL và chạy worker, hoặc QUEUE_ENABLED=0 để web tự chạy lịch.",
      );
    } else {
      // Máy dev: cố ý không chạy lịch để database (Neon) còn được ngủ — xem
      // `schedulingMode`. Chỉ nhắc một dòng, không phải lỗi.
      logger.info(
        "Dev không có Redis: job theo lịch KHÔNG chạy (để database được ngủ). Cần thử lịch thì " +
          "chạy `pnpm worker:dev` với REDIS_URL, hoặc đặt QUEUE_ENABLED=0.",
      );
    }
    return;
  }

  if (mode === "in-process") {
    // Đọc CRON_* TRƯỚC khi nạp handler: biểu thức sai phải làm máy chủ dừng ngay
    // kèm tên biến, không phải thành một lịch câm.
    const config = schedules.parseScheduleEnv(process.env);
    const { jobHandlers } = await import("@/jobs/handlers");

    schedules.startInProcessScheduler({
      schedules: schedules.buildSchedules(config),
      runJob: (name) => jobHandlers[name]({}),
      log: logger,
    });
  }
}

/**
 * Móc lỗi phía máy chủ — hiện chỉ dùng cho MỘT việc ở môi trường dev.
 *
 * ---
 * NHẮC KHỞI ĐỘNG LẠI `pnpm dev` KHI PRISMA CLIENT TRONG BỘ NHỚ ĐÃ CŨ
 *
 * Đổi `schema.prisma` rồi `prisma generate` xong, server dev ĐANG CHẠY vẫn giữ
 * Prisma Client cũ trong bộ nhớ: `@prisma/client` là package ngoài, hot reload
 * không nạp lại nó. Code mới gửi cột mới, client cũ không biết cột đó, và lỗi
 * hiện ra là `Unknown argument \`checkoutCode\`` — trông y như code viết sai.
 *
 * Đã mất hai vòng hỏi đáp vì đúng lỗi này (docs/GOTCHAS.md #18): migration đã
 * áp, typecheck xanh, e2e xanh, mà bấm đặt sân trên `pnpm dev` vẫn hỏng. Dòng
 * nhắc này nằm ngay dưới lỗi trong terminal, chỗ người ta đang nhìn.
 *
 * Không làm gì ở production: `pnpm build && pnpm start` luôn nạp client mới nhất.
 */
export const onRequestError: Instrumentation.onRequestError = (error) => {
  if (process.env.NODE_ENV === "production") return;
  if (!(error instanceof Error) || !/Unknown (argument|field) `/.test(error.message)) return;

  console.warn(
    [
      "",
      "⚠️  Prisma báo không biết trường/cột này.",
      "   Nếu vừa sửa schema.prisma hoặc chạy prisma generate: server dev đang giữ Prisma Client CŨ",
      "   trong bộ nhớ — dừng `pnpm dev` (Ctrl+C) rồi chạy lại. Code không sai. Xem docs/GOTCHAS.md #18.",
      "   Nếu không đổi schema: kiểm lại tên trường trong câu truy vấn.",
      "",
    ].join("\n"),
  );
};
