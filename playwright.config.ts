import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình E2E.
 *
 * ---
 * VÌ SAO DỰ ÁN NÀY CẦN E2E
 *
 * Hàng trăm unit test phủ tầng service vẫn để lọt những lỗi làm DỊCH VỤ CHẾT:
 * form đăng nhập gửi `email` trong khi schema đòi `identifier`, form đặt sân gửi
 * `days` thay vì `date` (GOTCHAS #1, #13). Không lớp nào khác bắt được —
 *
 *   - TypeScript không bắt, vì `safeParse()` nhận `unknown`;
 *   - unit test không bắt, vì chúng gọi thẳng service, không đi qua form;
 *   - build không bắt, vì cả hai phía đều hợp lệ khi đứng riêng.
 *
 * Chỉ có một thứ bắt được: mở trình duyệt thật và bấm nút. Đó chính là công
 * việc của thư mục `e2e/`.
 *
 * Bộ test vì vậy cố tình HẸP — những luồng mà "hỏng là dịch vụ chết": đăng
 * nhập/đăng ký, chặn quyền theo vai, khách đặt sân tới màn thanh toán, thanh
 * toán gộp nhiều sân, các màn quản lý của chủ sân. Nghiệp vụ chi tiết (giá,
 * giữ chỗ, hoàn tiền) thuộc về unit test và `pnpm db:check-conflict`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  /*
   * MỘT worker, kể cả ở máy cá nhân — nên các bài chạy TUẦN TỰ, và
   * `fullyParallel` phải tắt cho khớp (bật mà chỉ một worker thì chỉ gây hiểu lầm).
   *
   * `loginAction` có rate limit theo ĐỊA CHỈ IP, mà mọi bài e2e đều đến từ
   * 127.0.0.1. Chạy song song bốn worker là bốn bài cùng đăng nhập trong vài
   * giây và tự đâm vào ngưỡng của chính mình — đỏ ngẫu nhiên, mỗi lần một bài
   * khác nhau, và không liên quan gì tới thứ đang kiểm.
   *
   * Đánh đổi: bộ e2e chạy lâu hơn vài phút. Đáng, vì một bộ test đỏ ngẫu nhiên
   * là một bộ test không ai tin nữa.
   */
  fullyParallel: false,
  workers: 1,

  /*
   * 60 giây mỗi bài, thay vì 30 mặc định.
   *
   * Một bài như "đặt sân đầu-cuối" gồm ba lượt điều hướng và hai Server Action
   * chạm database; ở lần đầu của mỗi tiến trình, riêng bắt tay TLS với Neon đã
   * vài giây. 30 giây đủ cho máy nhanh và mạng tốt, và đỏ ngẫu nhiên ở mọi
   * hoàn cảnh khác.
   */
  timeout: 60_000,

  // Cấm `test.only` lọt lên nhánh chính — nó làm CI xanh trong khi hầu hết
  // test không hề chạy.
  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 1 : 0,
  /*
   * CI sinh báo cáo HTML thật ở `playwright-report/` để workflow tải lên khi hỏng.
   * Bản trước chỉ có `github` + `list` — bước upload chạy mà artifact rỗng, nên
   * lần hỏng đầu tiên trên CI không có gì để mở ra xem.
   */
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"]],

  /*
   * 15 giây cho mỗi phép chờ, thay vì 5 giây mặc định.
   *
   * Ứng dụng nói chuyện với database ở xa (Neon), và lần chạm đầu tiên của mỗi
   * tiến trình phải mở kết nối + bắt tay TLS. Một Server Action đăng nhập mất
   * 6–8 giây ở lần đầu là bình thường, không phải hỏng — đã đo và ghi ở
   * GOTCHAS #12. Để 5 giây thì bộ e2e đỏ vì đồng hồ chứ không vì lỗi thật, và
   * đó là cách nhanh nhất khiến người ta thôi tin nó.
   */
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    // Chỉ giữ dấu vết của lần chạy hỏng: trace đầy đủ rất nặng, mà lần chạy
    // xanh thì không ai mở ra xem.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  /*
   * Chạy bản BUILD PRODUCTION, không phải `next dev`.
   *
   * Hai môi trường khác nhau ở đúng những chỗ dễ hỏng: dev có React Refresh và
   * CSP nới lỏng (`unsafe-eval`), production thì không. Test trên dev sẽ bỏ
   * qua đúng loại lỗi mà E2E sinh ra để bắt.
   */
  webServer: {
    command: "pnpm build && pnpm start",
    url: `${baseURL}/api/health`,
    /*
     * KHÔNG dùng lại server đang nghe cổng này, kể cả ở máy cá nhân.
     *
     * Bản trước bật ở máy cá nhân: cổng 3100 còn một `pnpm start` CŨ từ lần chạy
     * trước là cả bộ test chạy trên bản build cũ — xanh cho mã đã sửa hỏng, đỏ
     * cho mã đã sửa đúng. Cổng bị chiếm thì Playwright báo lỗi ngay; dừng tiến
     * trình cũ (`lsof -nP -iTCP:3100 -sTCP:LISTEN`) rồi chạy lại.
     */
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
      /*
       * Job chạy NGAY trong request, không cần Redis lẫn worker.
       *
       * Bản production mà `QUEUE_ENABLED` bật (mặc định) và `.env` thiếu
       * `REDIS_URL` thì `enqueue()` NÉM LỖI — luồng nào gửi email mà không tự
       * bắt lỗi sẽ làm e2e đỏ vì hạ tầng, không vì mã. Biến đặt ở đây thắng
       * `.env` (`--env-file-if-exists` không ghi đè biến đã có).
       */
      QUEUE_ENABLED: "0",
    },
  },
});
