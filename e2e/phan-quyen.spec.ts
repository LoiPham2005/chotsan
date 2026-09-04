import { expect, test } from "@playwright/test";
import { dangNhap, moSanDauTien, TAI_KHOAN } from "./tro-giup";

/**
 * Ranh giới phân quyền, kiểm trên trình duyệt thật.
 *
 * ---
 * TRẢ 404, KHÔNG PHẢI 403
 *
 * `venueId` đến từ URL nên ai cũng gõ được. 403 là xác nhận "sân này có thật,
 * chỉ là bạn không có quyền" — đủ để dò xem nền tảng có những sân nào. 404
 * không nói gì cả.
 *
 * Unit test đã khoá phần "Server Action tự kiểm quyền". Phần này kiểm thứ unit
 * test không thấy: người thật, đi từ trang thật, có bị chặn không.
 */
test.describe("Chưa đăng nhập", () => {
  test("mọi trang công khai đều mở được", async ({ page }) => {
    for (const path of ["/", "/venues", "/venues/cau-long-thanh-cong"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
  });

  test("vào khu quản lý thì bị đá về /login kèm ?next=", async ({ page }) => {
    await page.goto("/manage");

    await expect(page).toHaveURL(/\/login/);
    // Không có `?next=` thì đăng nhập xong người dùng rơi về trang chủ và phải
    // tự tìm lại đường.
    expect(new URL(page.url()).searchParams.get("next")).toBe("/manage");
  });

  test("vào lượt đặt của tôi cũng bị đá về /login", async ({ page }) => {
    await page.goto("/account/bookings");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Khách thường", () => {
  test.beforeEach(async ({ page }) => {
    await dangNhap(page, TAI_KHOAN.khach);
  });

  test("mở được màn lượt đặt của mình", async ({ page }) => {
    await page.goto("/account/bookings");
    await expect(page.getByRole("heading", { name: "Lượt đặt của tôi" })).toBeVisible();
  });

  test("KHÔNG thấy mục quản lý sân trên thanh điều hướng", async ({ page }) => {
    await page.goto("/");
    // Bày mục dẫn tới trang trống là hứa một thứ không có.
    await expect(page.getByRole("link", { name: "Quản lý sân" })).toHaveCount(0);
  });

  test("mở khu quản trị nhận 404", async ({ page }) => {
    for (const path of ["/users", "/roles", "/venue-approvals", "/invoices"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });
});

test.describe("Nhân viên sân", () => {
  test("vào được lịch sân nhưng KHÔNG vào được nhân sự", async ({ browser }) => {
    // Mỗi vai một ngữ cảnh RIÊNG, không dùng `clearCookies` rồi đăng nhập lại
    // trên cùng một trang: xoá cookie xong trang vẫn đang ở URL cũ, và lần
    // `goto("/login")` tiếp theo có thể bị proxy chuyển hướng trước khi form
    // kịp dựng.
    const chuSan = await browser.newContext();
    const trangChuSan = await chuSan.newPage();
    await dangNhap(trangChuSan, TAI_KHOAN.chuSan);
    const venueId = await moSanDauTien(trangChuSan);
    await chuSan.close();

    const nhanVien = await browser.newContext();
    const page = await nhanVien.newPage();
    await dangNhap(page, TAI_KHOAN.nhanVien);

    const lich = await page.goto(`/manage/${venueId}`);
    expect(lich?.status(), "nhân viên phải trực được sân").toBe(200);

    // `member:manage` không nằm trong bộ quyền mặc định của nhân viên.
    const nhanSu = await page.goto(`/manage/${venueId}/staff`);
    expect(nhanSu?.status()).toBe(404);

    await nhanVien.close();
  });
});

test.describe("Quản trị nền tảng", () => {
  test.beforeEach(async ({ page }) => {
    await dangNhap(page, TAI_KHOAN.quanTri);
  });

  test("mở được màn duyệt cơ sở và đối soát hoá đơn", async ({ page }) => {
    await page.goto("/venue-approvals");
    await expect(page.getByRole("heading", { name: "Duyệt cơ sở" })).toBeVisible();

    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Hoá đơn hoa hồng" })).toBeVisible();
    // Nói rõ đây là khoản NỢ, không phải khoản đã trừ — mô hình dòng tiền của
    // ChốtSân phụ thuộc vào chỗ này không bị hiểu nhầm.
    await expect(page.getByText(/khoản chủ sân nợ nền tảng/i)).toBeVisible();
  });

  test("KHÔNG vào được khu quản lý của một sân cụ thể", async ({ browser }) => {
    // Quản trị nền tảng không phải thành viên của sân nào — và không được là.
    // Xem mọi sân là quyền `venue:read`; thao tác trên lịch của một sân là
    // quyền theo sân, mà họ không có.
    const chuSan = await browser.newContext();
    const trangChuSan = await chuSan.newPage();
    await dangNhap(trangChuSan, TAI_KHOAN.chuSan);
    const venueId = await moSanDauTien(trangChuSan);
    await chuSan.close();

    const quanTri = await browser.newContext();
    const page = await quanTri.newPage();
    await dangNhap(page, TAI_KHOAN.quanTri);

    const response = await page.goto(`/manage/${venueId}/settings`);
    expect(response?.status()).toBe(404);

    await quanTri.close();
  });
});
