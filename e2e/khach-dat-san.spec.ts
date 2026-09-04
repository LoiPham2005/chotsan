import { expect, test } from "@playwright/test";

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
    await expect(page.locator("button[aria-pressed]").first()).toBeVisible();
  });

  test("chọn khung giờ rồi đặt — tới được màn thanh toán kèm mã QR", async ({ page }) => {
    await page.goto("/venues/cau-long-thanh-cong");

    const oTrong = page.locator('button[aria-pressed="false"]:not([disabled])').first();
    await expect(oTrong).toBeVisible({ timeout: 20_000 });
    await oTrong.click();

    // Thanh tóm tắt phải hiện ngay, kèm giá tạm tính.
    await expect(page.getByRole("button", { name: "Bỏ chọn" })).toBeVisible();

    await page.locator('input[name="customerName"]').fill("Khách E2E");
    await page.locator('input[name="customerPhone"]').fill("0912345678");
    await page.getByRole("button", { name: "Đặt sân" }).click();

    await page.waitForURL(/\/bookings\/[A-Z0-9]+/, { timeout: 30_000 });

    // Màn thanh toán phải có đủ ba thứ khách cần: số tài khoản, nội dung
    // chuyển khoản, và mã QR vẽ ở trình duyệt.
    await expect(page.getByText("Nội dung chuyển khoản", { exact: false })).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: /Tôi đã chuyển khoản/ })).toBeVisible();
  });

  test("mã đặt sân không tồn tại thì 404, không phải trang trống", async ({ page }) => {
    const response = await page.goto("/bookings/KHONGCO");
    expect(response?.status()).toBe(404);
  });
});
