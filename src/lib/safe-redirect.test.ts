import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

/**
 * `next` đến thẳng từ URL — ai cũng soạn được. Một đích lọt ra ngoài site là
 * open redirect: trang đăng nhập THẬT của ChốtSân đưa nạn nhân sang trang giả
 * ngay sau khi họ nhập mật khẩu, đúng lúc họ tin nhất.
 *
 * Mọi chuỗi tấn công dưới đây đều được trình duyệt "sửa" thành `//evil.com`.
 * Ký tự điều khiển viết bằng `String.fromCharCode` để tệp không chứa tab thật.
 */
const TAB = String.fromCharCode(9);
const NEWLINE = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);

describe("safeRedirectPath", () => {
  it.each([
    [`/${BACKSLASH}evil.com`, "dấu \\ được trình duyệt đọc như /"],
    [`/${TAB}/evil.com`, "tab bị bỏ đi"],
    [`/${NEWLINE}/evil.com`, "xuống dòng bị bỏ đi"],
    ["/%5Cevil.com", "\\ đã mã hoá — thành /\\evil.com khi một tầng khác giải mã"],
    ["/%5cevil.com", "mã hoá chữ thường cũng vậy"],
    ["/%2F/evil.com", "/ đã mã hoá ghép thành //"],
    ["//evil.com", "URL không có scheme"],
    ["/.//evil.com", "`.` bị chuẩn hoá mất → //evil.com"],
    ["/..//evil.com", "`..` ở gốc cũng bị bỏ"],
    ["https://evil.com", "URL tuyệt đối"],
    ["javascript:alert(1)", "scheme javascript"],
    ["evil.com", "không bắt đầu bằng /"],
    ["/%E0%A4%A", "mã % hỏng"],
  ])("từ chối %j — %s", (value) => {
    expect(safeRedirectPath(value, "/")).toBe("/");
  });

  it("giữ nguyên đường dẫn nội bộ kèm truy vấn và fragment", () => {
    expect(safeRedirectPath("/venues?x=1#a", "/")).toBe("/venues?x=1#a");
  });

  it("trả dạng ĐÃ chuẩn hoá — thứ trình duyệt thật sự sẽ đi tới", () => {
    expect(safeRedirectPath("/manage/../account/bookings", "/")).toBe("/account/bookings");
  });

  it("không đụng tới dữ liệu hợp lệ trong truy vấn", () => {
    // Chỉ `pathname` bị soi dạng giải mã: `?chon=` của luồng đặt sân mang đủ
    // loại ký tự đã mã hoá.
    expect(safeRedirectPath("/venues/a?q=a%5Cb", "/")).toBe("/venues/a?q=a%5Cb");
  });

  it("giá trị không phải chuỗi thì về fallback", () => {
    expect(safeRedirectPath(undefined, "/fallback")).toBe("/fallback");
    expect(safeRedirectPath(null, "")).toBe("");
    expect(safeRedirectPath(["/a"], "/")).toBe("/");
  });
});
