import { expect, test } from "@playwright/test";
import { dangNhap, MAT_KHAU, TAI_KHOAN } from "./tro-giup";

/**
 * Luồng khách đặt sân — từ trang chủ tới màn thanh toán.
 *
 * ---
 * ĐÂY LÀ LỚP DUY NHẤT BẮT ĐƯỢC LOẠI LỖI "FORM GỬI TÊN TRƯỜNG KHÁC SCHEMA"
 *
 * Typecheck không thấy (`safeParse` nhận `unknown`), unit test không thấy (gọi
 * thẳng service). Chỉ có trình duyệt thật gửi đúng `FormData` mà form dựng ra
 * mới lộ.
 */
test.describe("Khách đặt sân", () => {
  test("trang chủ hiện sân thật và ô tìm kiếm dẫn tới danh sách", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Đặt sân thể thao/ })).toBeVisible();
    // Sân lấy từ database, không phải chữ cứng trong mã nguồn.
    await expect(page.locator('a[href^="/venues/"]').first()).toBeVisible();

    await page.locator('input[name="q"]').fill("cầu lông");
    await page.getByRole("button", { name: "Tìm sân" }).click();

    await page.waitForURL(/\/venues\?/);
    await expect(page.getByRole("heading", { name: "Tìm sân" })).toBeVisible();
  });

  test("lọc theo môn giữ được trên URL — chia sẻ được kết quả", async ({ page }) => {
    await page.goto("/venues?mon=football");

    await expect(page.getByRole("heading", { name: "Tìm sân" })).toBeVisible();
    // Bộ lọc phải giữ nguyên lựa chọn sau khi tải lại, nếu không người dùng
    // bấm quay lại là mất hết.
    await expect(page.locator('select[name="mon"]')).toHaveValue("football");
  });

  test("lưới đặt sân dựng đủ sân con và khung 30 phút", async ({ page }) => {
    await page.goto("/venues/cau-long-thanh-cong");

    await expect(page.getByRole("heading", { name: /Thành Công/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chọn khung giờ" })).toBeVisible();

    // Sân thứ 10 bị TẮT trong dữ liệu mẫu — lưới chỉ được hiện 9 sân đang bán.
    await expect(page.getByText("Sân 9", { exact: true })).toBeVisible();
    await expect(page.getByText("Sân 10", { exact: true })).toHaveCount(0);

    // Ô khung giờ là nút bấm được, không phải ô tĩnh.
    await expect(page.locator("button[data-minute]").first()).toBeVisible();
  });

  test("thẻ sân và trang chi tiết có ảnh thật, tải được qua bộ tối ưu ảnh", async ({ page }) => {
    await page.goto("/venues");

    // Ảnh phải TẢI ĐƯỢC, không chỉ có thẻ <img>: CSP chặn, đường dẫn sai hay bộ
    // tối ưu ảnh hỏng đều để lại một thẻ <img> nằm đó với naturalWidth = 0.
    const anhThe = page.locator('a[href^="/venues/"] img').first();
    await expect(anhThe).toBeVisible();
    await expect
      .poll(() => anhThe.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    await page.goto("/venues/cau-long-thanh-cong");

    const bangAnh = page.getByRole("region", { name: /^Ảnh Nhà thi đấu Cầu lông Thành Công/ });
    await expect(bangAnh.locator("img")).toHaveCount(4);
    const anhBia = bangAnh.locator("img").first();
    await expect
      .poll(() => anhBia.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(anhBia).toHaveAttribute("alt", /Nhà thi đấu Cầu lông Thành Công — ảnh 1/);
  });

  test("chưa đăng nhập thì được dẫn tới đăng nhập, KHÔNG hỏi tên và số", async ({ page }) => {
    await page.goto("/venues/cau-long-thanh-cong");

    const oTrong = page
      .locator('button[data-minute][aria-pressed="false"]:not([disabled])')
      .first();
    await expect(oTrong).toBeVisible({ timeout: 20_000 });
    await oTrong.click();

    // Đặt không cần tài khoản là luồng làm dở: lượt đặt mang `userId: null` nên
    // không bao giờ hiện ở "Lượt đặt của tôi" và khách không tự huỷ được.
    await expect(page.getByRole("link", { name: "Đăng nhập để đặt sân" })).toBeVisible();
    await expect(page.locator('input[name="customerName"]')).toHaveCount(0);

    // Đường quay lại phải giữ nguyên sân và ngày đang xem.
    const href = await page
      .getByRole("link", { name: "Đăng nhập để đặt sân" })
      .getAttribute("href");
    expect(href).toContain("next=");
    expect(decodeURIComponent(href ?? "")).toContain("/venues/cau-long-thanh-cong");
  });

  test("đăng nhập rồi đặt — tới màn thanh toán kèm mã QR", async ({ page }) => {
    await dangNhap(page, TAI_KHOAN.khach);
    await page.goto("/venues/cau-long-thanh-cong");

    const oTrong = page
      .locator('button[data-minute][aria-pressed="false"]:not([disabled])')
      .first();
    await expect(oTrong).toBeVisible({ timeout: 20_000 });
    await oTrong.click();

    // Thanh tóm tắt phải hiện ngay, kèm giá tạm tính.
    await expect(page.getByRole("button", { name: "Bỏ chọn" })).toBeVisible();

    // Không hỏi lại tên: hồ sơ đã có. Số điện thoại chỉ hỏi khi hồ sơ thiếu.
    const oSoDienThoai = page.locator('input[name="customerPhone"]');
    if ((await oSoDienThoai.count()) > 0) await oSoDienThoai.fill("0912345678");

    await page.getByRole("button", { name: "Đặt sân" }).click();

    await page.waitForURL(/\/bookings\/[A-Z0-9]+/, { timeout: 30_000 });

    // Màn thanh toán phải có đủ ba thứ khách cần: số tài khoản, nội dung
    // chuyển khoản, và mã QR vẽ ở trình duyệt.
    await expect(page.getByText("Nội dung chuyển khoản", { exact: false })).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: /Tôi đã chuyển khoản/ })).toBeVisible();
  });

  test("chọn ô rồi mới đăng nhập — quay về còn nguyên các ô và đặt tiếp được", async ({ page }) => {
    await page.goto("/venues/cau-long-thanh-cong");

    // Cả hai lần đều bấm `.first()` của ô CÒN TRỐNG: ô vừa bấm đổi sang
    // `aria-pressed="true"` nên lần sau tự trỏ sang ô kế tiếp.
    const oTrong = page.locator('button[data-minute][aria-pressed="false"]:not([disabled])');
    const oDangChon = page.locator('button[data-minute][aria-pressed="true"]');
    await expect(oTrong.first()).toBeVisible({ timeout: 20_000 });
    await oTrong.first().click();
    await expect(oDangChon).toHaveCount(1);
    await oTrong.first().click();
    await expect(oDangChon).toHaveCount(2);

    await page.getByRole("link", { name: "Đăng nhập để đặt sân" }).click();
    await page.waitForURL(/\/login\?next=/);

    await page.locator('input[name="identifier"]').fill(TAI_KHOAN.khach);
    await page.locator('input[name="password"]').fill(MAT_KHAU);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

    // Về lại ĐÚNG trang sân — không phải trang chủ, không phải màn của vai.
    await page.waitForURL(/\/venues\/cau-long-thanh-cong/, { timeout: 30_000 });

    // Đây là lỗi người dùng gặp: đăng nhập xong lưới trống trơn, phải chọn lại
    // từ đầu. Hai ô phải còn nguyên, kèm lời báo để khách biết việc tiếp theo.
    await expect(oDangChon).toHaveCount(2);
    await expect(
      page.getByRole("status").filter({ hasText: "Đã giữ nguyên 2 khung" }),
    ).toBeVisible();

    // `chon` phải rời thanh địa chỉ, nếu không đặt xong bấm Quay lại sẽ thấy
    // đúng các ô vừa đặt "được chọn" lần nữa.
    await expect(page).not.toHaveURL(/chon=/);

    const oSoDienThoai = page.locator('input[name="customerPhone"]');
    if ((await oSoDienThoai.count()) > 0) await oSoDienThoai.fill("0912345678");

    await page.getByRole("button", { name: "Đặt sân và thanh toán" }).click();

    // Một hay nhiều lượt đều tới MÀN THANH TOÁN — không bao giờ đá sang danh
    // sách lượt đặt. Xem combined-checkout.spec.ts.
    await page.waitForURL(/\/bookings\/[A-Z0-9]{6}$/, { timeout: 30_000 });
  });

  test("bấm ngày khác trên dải ngày thì đổi lịch — không 404, không mang ô của ngày cũ", async ({
    page,
  }) => {
    await page.goto("/venues/cau-long-thanh-cong");

    const oTrong = page.locator('button[data-minute][aria-pressed="false"]:not([disabled])');
    await expect(oTrong.first()).toBeVisible({ timeout: 20_000 });
    await oTrong.first().click();
    await expect(page.locator('button[data-minute][aria-pressed="true"]')).toHaveCount(1);

    // Dải ngày từng trỏ `/venue/…` (thiếu chữ s): bấm ngày nào cũng ra 404.
    const ngayKhac = page.getByRole("group", { name: "Chọn ngày" }).getByRole("link").nth(2);
    await ngayKhac.click();

    await page.waitForURL(/\/venues\/cau-long-thanh-cong\?date=\d{4}-\d{2}-\d{2}/);
    await expect(ngayKhac).toHaveAttribute("aria-current", "date");
    await expect(page.getByRole("heading", { name: "Chọn khung giờ" })).toBeVisible();

    // Ô chọn ở ngày cũ không được lặng lẽ nằm lại và bị đặt cho ngày mới.
    await expect(page.locator('button[data-minute][aria-pressed="true"]')).toHaveCount(0);
  });

  test("mã đặt sân không tồn tại thì 404, không phải trang trống", async ({ page }) => {
    const response = await page.goto("/bookings/KHONGCO");
    expect(response?.status()).toBe(404);
  });
});
