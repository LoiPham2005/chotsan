import { expect, test } from "@playwright/test";
import { dangNhap, TAI_KHOAN } from "./tro-giup";

/**
 * Đặt nhiều sân một lần → MỘT màn thanh toán → chủ sân duyệt MỘT lần.
 *
 * ---
 * LỖI NGƯỜI DÙNG GẶP THẬT
 *
 * Chọn Sân 1 lúc 13:00 và Sân 8 lúc 14:00 rồi bấm "Đặt sân và thanh toán" thì
 * bị đá sang "Lượt đặt của tôi" — không có mã QR, không có chỗ nào để trả tiền.
 * Hai sân là hai lượt đặt ở database, và code cũ coi nhiều lượt là "tự lo".
 *
 * Bài này đi trọn đường tiền: khách đặt hai sân → một màn, một QR, một nút →
 * chủ sân thấy MỘT khoản với tổng tiền → bấm một lần → cả hai lượt xác nhận.
 */
test("hai sân khác nhau: một màn thanh toán, chủ sân duyệt một lần", async ({ page, browser }) => {
  test.setTimeout(120_000);

  // Ngày mai: chạy bộ test lúc tối muộn thì hôm nay có thể đã hết giờ mở cửa.
  const ngayMai = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  );

  await dangNhap(page, TAI_KHOAN.khach);
  await page.goto(`/venues/cau-long-thanh-cong?date=${ngayMai}`);

  // Ô trống ĐẦU TIÊN của hai hàng khác nhau = hai sân khác nhau.
  const hang = page.locator("table tbody tr");
  const oTrong = (index: number) =>
    hang.nth(index).locator('button[data-minute][aria-pressed="false"]:not([disabled])').first();

  await expect(oTrong(0)).toBeVisible({ timeout: 20_000 });
  await oTrong(0).click();
  await oTrong(1).click();

  await expect(page.locator('button[data-minute][aria-pressed="true"]')).toHaveCount(2);
  await expect(page.getByText(/2 khung · 2 lượt đặt/)).toBeVisible();

  const oSoDienThoai = page.locator('input[name="customerPhone"]');
  if ((await oSoDienThoai.count()) > 0) await oSoDienThoai.fill("0912345678");

  await page.getByRole("button", { name: "Đặt sân và thanh toán" }).click();

  // Trước đây: `/account/bookings`. Giờ: màn thanh toán của cả lần đặt.
  await page.waitForURL(/\/bookings\/[A-Z0-9]{6}$/, { timeout: 30_000 });
  const code = new URL(page.url()).pathname.split("/").pop()!;

  await expect(page.getByText("Cần thanh toán (2 lượt)")).toBeVisible();
  await expect(page.getByText("Mã lượt")).toHaveCount(2);
  // MỘT mã QR cho tổng tiền, MỘT nội dung chuyển khoản chung.
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.getByText(`CS ${code}`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Tôi đã chuyển khoản" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã gửi cho sân" })).toBeVisible();

  // ---- Chủ sân: một khoản cho cả lần chuyển ----
  const chuSan = await browser.newContext();
  const trangChuSan = await chuSan.newPage();

  try {
    await dangNhap(trangChuSan, TAI_KHOAN.chuSan);
    await trangChuSan.goto("/manage");

    const linkSan = trangChuSan
      .locator('a[href^="/manage/"]')
      .filter({ hasText: "Thành Công" })
      .first();
    const venueId = (await linkSan.getAttribute("href"))?.split("/")[2];
    expect(venueId, "không thấy sân Thành Công trong khu quản lý").toBeTruthy();

    await trangChuSan.goto(`/manage/${venueId}/payments`);

    const theKhoan = trangChuSan.locator("li").filter({ hasText: `CS ${code}` });
    await expect(theKhoan).toHaveCount(1);
    // Hai sân + giờ nằm TRONG cùng một thẻ, không phải hai thẻ hai số tiền.
    await expect(theKhoan.locator("ul li")).toHaveCount(2);

    await theKhoan.getByRole("button", { name: "Đã nhận đủ tiền" }).click();
    await expect(trangChuSan.locator("li").filter({ hasText: `CS ${code}` })).toHaveCount(0, {
      timeout: 30_000,
    });
  } finally {
    await chuSan.close();
  }

  // ---- Khách: cả hai lượt đã xác nhận ----
  await page.reload();
  await expect(page.getByRole("heading", { name: "Đặt sân thành công" })).toBeVisible();
  // `exact`: câu mô tả "Sân đã xác nhận…" cũng chứa cụm này — đếm nhãn trạng
  // thái của từng lượt thôi.
  await expect(page.getByText("Đã xác nhận", { exact: true })).toHaveCount(2);
});
