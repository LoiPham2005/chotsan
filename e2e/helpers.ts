import { expect, type Page } from "@playwright/test";

/**
 * Tiện ích dùng chung cho bộ e2e.
 *
 * ---
 * DÙNG TÀI KHOẢN MẪU CỦA `pnpm db:seed`
 *
 * Bộ e2e cũ thừa hưởng từ bộ khung trỏ vào `user1@example.com` — tài khoản
 * không tồn tại trong ChốtSân, nên mọi bài đều đỏ vì lý do không liên quan tới
 * thứ đang kiểm.
 */
export const PASSWORD = "matkhau123";

export const ACCOUNTS = {
  /** Quản trị nền tảng (ADMIN) — đích sau đăng nhập: `/venue-approvals`. */
  admin: "admin@dev.local",
  /** Chủ 3 cơ sở mẫu. */
  owner: "chusan@dev.local",
  /** Nhân viên sân, có `payment:confirm`. */
  staff: "nhanvien@dev.local",
  /** Khách. */
  customer: "user@dev.local",
} as const;

/**
 * Đăng nhập rồi chờ tới khi RỜI trang đăng nhập.
 *
 * Chờ theo ĐIỀU KIỆN, không theo đồng hồ. Server Action ở đây mất vài giây
 * (biên dịch trang đích, mở kết nối database lần đầu), và `waitForTimeout` là
 * cách chắc chắn để kết luận sai — xem GOTCHAS #12.
 */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="identifier"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** Mở một sân bất kỳ mà tài khoản đang đăng nhập quản lý, trả về id của nó. */
export async function openFirstVenue(page: Page): Promise<string> {
  await page.goto("/manage");

  const link = page.locator('a[href^="/manage/"]').first();
  await expect(link).toBeVisible({ timeout: 20_000 });

  const href = await link.getAttribute("href");
  const venueId = href?.split("/")[2];
  expect(venueId, "không tìm thấy sân nào để quản lý").toBeTruthy();

  return venueId!;
}
