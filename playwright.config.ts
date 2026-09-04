import { defineConfig, devices } from "@playwright/test";

/**
 * Cấu hình E2E.
 *
 * ---
 * VÌ SAO DỰ ÁN NÀY CẦN E2E
 *
 * Đã có ~170 unit test phủ kín tầng service, và chúng vẫn để lọt một lỗi làm
 * ĐĂNG NHẬP WEB HỎNG HOÀN TOÀN: form gửi trường `email` trong khi schema đã
 * đổi sang `identifier`. Không lớp nào bắt được —
 *
 *   - TypeScript không bắt, vì `safeParse()` nhận `unknown`;
 *   - unit test không bắt, vì chúng gọi thẳng service, không đi qua form;
 *   - build không bắt, vì cả hai phía đều hợp lệ khi đứng riêng.
 *
 * Chỉ có một thứ bắt được: mở trình duyệt thật và bấm nút. Đó chính là công
 * việc của thư mục `e2e/`.
 *
 * Vì vậy bộ test ở đây cố tình HẸP — chỉ những luồng mà "hỏng là dịch vụ chết":
 * đăng nhập, đăng ký, chặn quyền. Không dùng E2E để kiểm nghiệp vụ chi tiết;
 * phần đó thuộc về unit test, vốn nhanh hơn hàng trăm lần.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  // Mỗi test tự đăng nhập bằng tài khoản riêng, không dùng chung trạng thái,
  // nên chạy song song được. Riêng trên CI thì tắt: một runner chia sẻ CPU với
  // Postgres và server Next, chạy song song chỉ làm test chập chờn.
  fullyParallel: !process.env.CI,
  /*
   * MỘT worker, kể cả ở máy cá nhân.
   *
   * `loginAction` có rate limit theo ĐỊA CHỈ IP, mà mọi bài e2e đều đến từ
   * 127.0.0.1. Chạy song song bốn worker là bốn bài cùng đăng nhập trong vài
   * giây và tự đâm vào ngưỡng của chính mình — đỏ ngẫu nhiên, mỗi lần một bài
   * khác nhau, và không liên quan gì tới thứ đang kiểm.
   *
   * Đánh đổi: bộ e2e chạy ~4 phút thay vì ~1 phút. Đáng, vì một bộ test đỏ
   * ngẫu nhiên là một bộ test không ai tin nữa.
   */
  /*
   * 60 giây mỗi bài, thay vì 30 mặc định.
   *
   * Một bài như "đặt sân đầu-cuối" gồm ba lượt điều hướng và hai Server Action
   * chạm database; ở lần đầu của mỗi tiến trình, riêng bắt tay TLS với Neon đã
   * vài giây. 30 giây đủ cho máy nhanh và mạng tốt, và đỏ ngẫu nhiên ở mọi
   * hoàn cảnh khác.
   */
  timeout: 60_000,

  workers: 1,

  // Cấm `test.only` lọt lên nhánh chính — nó làm CI xanh trong khi hầu hết
  // test không hề chạy.
  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

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
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: "production",
    },
  },
});
