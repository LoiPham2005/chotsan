/**
 * Chuyển hướng bằng ĐƯỜNG DẪN TƯƠNG ĐỐI — dùng trong route handler.
 *
 * ---
 * VÌ SAO KHÔNG DÙNG `NextResponse.redirect(new URL(path, request.url))`
 *
 * Ở `next dev`, `request.url` trong route handler bị ghi thành
 * `http://localhost:3000/...` bất kể trình duyệt đang mở bằng địa chỉ nào. Mở
 * app qua IP mạng LAN (`http://192.168.1.119:3000`) thì lệnh chuyển hướng
 * trỏ sang `localhost` — một origin KHÁC.
 *
 * Nếu request đó là một form POST, CSP `form-action 'self'` chặn luôn bước
 * chuyển hướng: cookie phiên ĐÃ được đặt, nhưng người dùng đứng yên ở trang
 * đăng nhập và không thấy lỗi gì. Đã xảy ra thật với nút đăng nhập nhanh.
 *
 * `Location` tương đối hợp lệ theo RFC 9110 §10.2.2: trình duyệt tự ghép với
 * đúng origin đang mở, nên không bao giờ lệch host.
 *
 * ⚠️ Chỉ nhận đường dẫn nội bộ đã qua `safeRedirectPath` — hàm này không tự
 * kiểm, và `Location: //evil.com` là open redirect.
 */
export function redirectRelative(path: string, status: 302 | 303 | 307 = 303): Response {
  return new Response(null, { status, headers: { Location: path } });
}
