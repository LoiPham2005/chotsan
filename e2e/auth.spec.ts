import { expect, test } from "@playwright/test";

/**
 * Luồng đăng nhập/đăng ký chạy trên trình duyệt thật.
 *
 * Đây là bộ test đáng lẽ đã bắt được lỗi "form gửi `email` trong khi schema
 * đòi `identifier`" — lỗi làm đăng nhập web hỏng hoàn toàn mà cả typecheck,
 * unit test lẫn build đều báo xanh.
 *
 * Điều kiện chạy: database đã `pnpm db:seed`. Tài khoản dùng ở đây là
 * tài khoản mẫu của bộ seed đó.
 */

const DEV_PASSWORD = "matkhau123";

/**
 * Đăng nhập nhanh — kiểm nó KHÔNG tồn tại ở bản production.
 *
 * Bộ e2e chạy trên `pnpm build && pnpm start`, tức đúng bản người dùng thật
 * nhận được. Đó là chỗ duy nhất kiểm được tính chất đáng giá của khối này:
 * bốn tài khoản có mật khẩu nằm công khai trong mã nguồn phải BIẾN MẤT hoàn
 * toàn, không chỉ bị ẩn bằng CSS.
 */
test.describe("Đăng nhập nhanh chỉ có ở dev", () => {
  test("bản production KHÔNG có khối đăng nhập nhanh", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("Chỉ có ở môi trường dev")).toHaveCount(0);
    // Cả email lẫn mật khẩu mẫu đều không được lọt vào HTML.
    await expect(page.getByText("chusan@dev.local")).toHaveCount(0);
    expect(await page.content()).not.toContain("matkhau123");
  });

  test("endpoint đăng nhập nhanh trả 404 trên production", async ({ request }) => {
    const response = await request.post("/api/dev/quick-login", {
      form: { identifier: "chusan@dev.local", password: "matkhau123" },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(404);
  });
});

test.describe("Đăng nhập", () => {
  test("đăng nhập bằng EMAIL rồi vào được trang cần quyền", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email hoặc tên đăng nhập").fill("admin@dev.local");
    await page.getByLabel("Mật khẩu").fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

    // Mỗi vai về đúng chỗ làm việc của mình: quản trị viên vào thẳng hàng chờ
    // duyệt cơ sở, không phải trang chủ bán hàng. Xem `src/lib/landing.ts`.
    await expect(page).toHaveURL(/\/venue-approvals/);
    // Thanh điều hướng đổi sang trạng thái đã đăng nhập — đó là bằng chứng
    // cookie phiên tới được trình duyệt, không chỉ được đặt ở máy chủ.
    await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
  });

  /*
   * Bài "đăng nhập bằng TÊN ĐĂNG NHẬP" của bộ khung đã bỏ: tài khoản mẫu của
   * ChốtSân không đặt `username`, nên bài đó chỉ kiểm được dữ liệu mẫu chứ
   * không kiểm được nhánh code. Nhánh đó đã có unit test ở
   * `auth.service.test.ts`.
   */

  test("sai mật khẩu thì hiện lỗi và Ở LẠI trang đăng nhập", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email hoặc tên đăng nhập").fill("admin@dev.local");
    await page.getByLabel("Mật khẩu").fill("sai-mat-khau-hoan-toan");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

    // Điểm mấu chốt: phải có THÔNG BÁO nhìn thấy được. Lỗi cũ khiến form im
    // lặng không phản ứng gì — về mặt kỹ thuật cũng là "ở lại trang login",
    // nên chỉ kiểm URL thôi là không đủ.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("chưa đăng nhập mà vào trang cần quyền thì bị đá về /login kèm ?next=", async ({ page }) => {
    await page.goto("/manage");

    await expect(page).toHaveURL(/\/login\?next=%2Fmanage/);
  });
});

test.describe("Đăng ký", () => {
  test("tạo tài khoản mới, giữ được họ tên, và về đúng trang đang dở", async ({ page }) => {
    // Email phải khác nhau giữa các lần chạy — database không được reset giữa
    // các test, và đăng ký trùng email là lỗi hợp lệ.
    const email = `e2e-${Date.now()}@example.com`;
    const fullName = "Người Dùng E2E";

    // Khách đang xem sân thì bấm "Đăng ký" — đăng ký xong phải về lại sân đó.
    await page.goto(`/register?next=${encodeURIComponent("/venues/cau-long-thanh-cong")}`);

    await page.getByLabel("Tên hiển thị").fill(fullName);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mật khẩu").fill("matkhau-e2e-123");
    await page.getByRole("button", { name: "Đăng ký" }).click();

    // Đăng ký xong là có phiên luôn, nên header hiện thông tin người dùng.
    // Đây cũng chính là chỗ bắt lỗi "form gửi `name` nhưng schema đòi
    // `fullName`": Zod strip im lặng khoá lạ nên đăng ký vẫn thành công, chỉ
    // có họ tên là biến mất.
    // Header hiện tên người dùng thành link tới màn thiết bị đăng nhập.
    await expect(page.getByRole("link", { name: fullName })).toBeVisible();

    // Kiểm ở trên từng XANH GIẢ: đăng ký xong bị đá vào `/users` (chỉ quản trị
    // xem được) — trang 404 vẫn có header mang tên người dùng. Phải kiểm cả
    // nơi đến lẫn nội dung của nó.
    await expect(page).toHaveURL(/\/venues\/cau-long-thanh-cong$/);
    await expect(page.getByRole("heading", { name: "Chọn khung giờ" })).toBeVisible();
  });
});

test.describe("Quên mật khẩu", () => {
  test("luôn trả cùng một thông điệp, kể cả với email không tồn tại", async ({ page }) => {
    await page.goto("/forgot-password");

    await page.getByLabel("Email").fill("khong-ai-dung-dia-chi-nay@example.com");
    await page.getByRole("button", { name: "Gửi hướng dẫn đặt lại" }).click();

    // Không được tiết lộ email có tài khoản hay không — đó là cách dò danh
    // sách người dùng rẻ nhất.
    await expect(page.getByRole("status")).toContainText("Nếu địa chỉ này có tài khoản");
  });

  test("mở /reset-password không kèm token thì báo link hỏng, không dựng form", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    // Trang có nhiều vùng `role="alert"`; lấy đúng vùng báo link hỏng thay vì
    // để Playwright kêu "strict mode violation".
    await expect(page.getByRole("alert").filter({ hasText: "không hợp lệ" })).toBeVisible();
    await expect(page.getByLabel("Mật khẩu mới")).toHaveCount(0);
  });
});
