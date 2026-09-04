import { expect, test } from "@playwright/test";
import { dangNhap, moSanDauTien, TAI_KHOAN } from "./tro-giup";

/**
 * Khu quản lý của chủ sân.
 *
 * Mỗi bài mở một màn và kiểm nó dựng được từ DỮ LIỆU THẬT — không phải chỉ trả
 * HTTP 200. Một trang 200 mà rỗng trông y hệt một trang chạy đúng khi chỉ nhìn
 * mã trạng thái.
 */
test.describe("Chủ sân", () => {
  test.beforeEach(async ({ page }) => {
    await dangNhap(page, TAI_KHOAN.chuSan);
  });

  test("thấy đủ sân mình quản lý", async ({ page }) => {
    await page.goto("/manage");

    await expect(page.getByRole("heading", { name: "Sân của bạn" })).toBeVisible();

    // Kiểm theo TÊN chứ không đếm link: thanh điều hướng cũng có link vào khu
    // quản lý, nên đếm link là đếm cả thứ không liên quan.
    for (const ten of [
      "Nhà thi đấu Cầu lông Thành Công",
      "Sân bóng đá Mỹ Đình",
      "Pickleball Arena Quận 7",
    ]) {
      // `.first()`: tên sân có thể xuất hiện ở nhiều chỗ trên trang, và bài này
      // hỏi "có thấy sân đó không", không hỏi "thấy đúng một lần".
      await expect(page.getByRole("link", { name: new RegExp(ten) }).first()).toBeVisible();
    }
  });

  test("lịch sân hiện lượt đặt kèm nút thao tác", async ({ page }) => {
    const venueId = await moSanDauTien(page);
    await page.goto(`/manage/${venueId}`);

    await expect(page.getByRole("group", { name: "Chọn ngày" })).toBeVisible();
    // Dải ngày phải có 14 mốc — người đặt sân hay đặt cho cuối tuần sau.
    await expect(page.locator('a[href*="?date="]')).toHaveCount(14);
    // Có tổng tiền trong ngày, không chỉ danh sách trơ.
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  });

  test("hàng chờ duyệt tiền nói rõ phải đối chiếu ngân hàng", async ({ page }) => {
    const venueId = await moSanDauTien(page);
    await page.goto(`/manage/${venueId}/payments`);

    await expect(page.getByRole("heading", { name: "Chờ duyệt tiền" })).toBeVisible();
    // Câu nhắc này là thứ chặn chủ sân bấm duyệt theo lời khai của khách.
    const coKhoan = await page.getByRole("button", { name: /Đã nhận đủ tiền/ }).count();
    if (coKhoan > 0) {
      await expect(page.getByText(/Lời khai của khách không phải bằng chứng/)).toBeVisible();
    }
  });

  test("sân con hiện đúng trạng thái bật/tắt", async ({ page }) => {
    const venueId = await moSanDauTien(page);
    await page.goto(`/manage/${venueId}/courts`);

    await expect(page.getByRole("heading", { name: /Sân .* bảng giá/ })).toBeVisible();
    // Dữ liệu mẫu tắt sẵn sân cuối — phải phân biệt được với sân đang bán.
    await expect(page.getByText("Đã tắt").first()).toBeVisible();
    await expect(page.getByText("Đang mở bán").first()).toBeVisible();
  });

  test("bảng giá hiện luật và cho sửa tại chỗ", async ({ page }) => {
    const venueId = await moSanDauTien(page);
    await page.goto(`/manage/${venueId}/courts`);

    // Neo vào ĐẦU chuỗi: tiêu đề thật là "Bảng giá 3 luật", còn `exact: true`
    // thì trượt, mà bỏ neo thì trúng cả tiêu đề trang "Sân & bảng giá".
    await expect(page.getByRole("heading", { name: /^Bảng giá/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lưu bảng giá" })).toBeVisible();
    // Giá tính theo 30 phút — nói rõ để không ai nhập nhầm giá theo giờ.
    await expect(page.getByText(/mỗi 30 phút/)).toBeVisible();
  });

  /**
   * Ba quyền này là tiền rời khỏi hệ thống và mất sân. Giao diện phải KHÔNG CÓ
   * ô để tick — không phải hiện ra rồi cảnh báo khi bấm.
   */
  test("bảng tick quyền KHÔNG có ba quyền nguy hiểm", async ({ page }) => {
    const venueId = await moSanDauTien(page);
    await page.goto(`/manage/${venueId}/staff`);

    await expect(page.getByRole("heading", { name: "Nhân sự" })).toBeVisible();

    const nutQuyen = page.getByRole("button", { name: /^Quyền \(/ });
    if ((await nutQuyen.count()) === 0) return;

    await nutQuyen.first().click();
    const values = await page
      .locator('input[name="permissions"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));

    expect(values.length).toBeGreaterThan(0);
    expect(values).not.toContain("payout:manage");
    expect(values).not.toContain("venue:delete");
    expect(values).not.toContain("venue:transfer");
  });

  test("cài đặt sân cảnh báo rõ về tài khoản nhận tiền", async ({ page }) => {
    const venueId = await moSanDauTien(page);
    await page.goto(`/manage/${venueId}/settings`);

    await expect(page.getByRole("heading", { name: "Cài đặt sân" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tài khoản nhận tiền" })).toBeVisible();
    // Sai một số ở đây là tiền vào tài khoản người khác.
    await expect(page.getByText(/tiền vào tài khoản người khác/)).toBeVisible();
  });

  test("doanh thu nói rõ đang tính tiền ĐÃ CHỐT, không phải tiền đã về", async ({ page }) => {
    const venueId = await moSanDauTien(page);
    await page.goto(`/manage/${venueId}/revenue`);

    await expect(page.getByRole("heading", { name: "Doanh thu" })).toBeVisible();
    // Chủ sân sẽ đối chiếu con số này với sao kê — phải nói trước vì sao lệch.
    await expect(page.getByText(/chỉ tính lượt đã xác nhận trở lên/)).toBeVisible();
    await expect(page.getByText(/Hoa hồng nợ/)).toBeVisible();
  });
});
