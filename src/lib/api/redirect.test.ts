import { describe, expect, it } from "vitest";
import { redirectRelative } from "./redirect";

/**
 * GOTCHAS #16: route handler chuyển hướng bằng URL TUYỆT ĐỐI dựng từ `request.url`
 * (= `localhost` ở `next dev`) → mở app qua IP LAN thì CSP `form-action 'self'`
 * chặn bước chuyển hướng, cookie đã đặt mà người dùng đứng yên ở trang đăng nhập.
 */
describe("redirectRelative", () => {
  it("Location là đường dẫn TƯƠNG ĐỐI — trình duyệt tự ghép đúng host đang mở", () => {
    const response = redirectRelative("/manage?tab=lich");

    expect(response.headers.get("location")).toBe("/manage?tab=lich");
    expect(response.headers.get("location")).not.toMatch(/^https?:/);
  });

  it("mặc định 303 — form POST xong trình duyệt đổi sang GET, không gửi lại form", () => {
    expect(redirectRelative("/").status).toBe(303);
    expect(redirectRelative("/", 307).status).toBe(307);
  });
});
