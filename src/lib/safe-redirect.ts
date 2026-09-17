/**
 * Chỉ chấp nhận đường dẫn NỘI BỘ làm đích chuyển hướng.
 *
 * Dùng cho MỌI `next`: form đăng nhập/đăng ký/2FA (`(auth)/actions.ts`),
 * passkey, đăng nhập nhanh, luồng OAuth (`api/v1/auth/oauth/[provider]/start`)
 * và `returnTo` mà `requireUser` tự dựng.
 *
 * ---
 * VÌ SAO KHÔNG CHỈ CHẶN `//`
 *
 * Bản trước chỉ nhận chuỗi bắt đầu bằng `/` và không bắt đầu bằng `//`. Trình
 * duyệt thì rộng lượng hơn thế nhiều khi đọc `Location`:
 *
 *   /\evil.com      → `\` được hiểu như `/`        → //evil.com
 *   /<TAB>/evil.com → tab, xuống dòng bị bỏ đi      → //evil.com
 *   /.//evil.com    → `.` bị chuẩn hoá mất          → //evil.com
 *   /%5Cevil.com    → vô hại ở đây, nhưng thành `/\evil.com` ngay khi một tầng
 *                     nào đó giải mã lại (`searchParams.get` ở bước OAuth)
 *
 * Nên thay vì đoán trình duyệt sẽ hiểu chuỗi ra sao, để CHÍNH bộ phân tích URL
 * chuẩn quyết định: ghép chuỗi vào một gốc giả, chỉ nhận khi origin không đổi,
 * và trả lại dạng ĐÃ CHUẨN HOÁ — thứ trình duyệt sẽ thấy — rồi kiểm lại dạng
 * đó lần nữa.
 */

/** Gốc giả để phân tích. `.invalid` (RFC 2606) không bao giờ là tên miền thật. */
const INTERNAL_ORIGIN = "http://internal.invalid";

/**
 * Có ký tự điều khiển (tab, xuống dòng…, DEL) hoặc dấu `\` không — trình duyệt
 * tự "sửa" chúng khi đọc `Location`.
 *
 * Duyệt mã ký tự thay vì regex: ESLint (`no-control-regex`) cấm ký tự điều
 * khiển trong regex vì chúng thường là lỗi gõ — ở đây thì cố ý.
 */
function hasSuspiciousChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/** Dạng giải mã của một chuỗi, hoặc `null` nếu nó chứa mã `%` hỏng. */
function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || hasSuspiciousChar(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return fallback;
  }

  if (url.origin !== INTERNAL_ORIGIN) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;

  // Kiểm lại SAU chuẩn hoá: `/.//evil.com` qua được mọi phép kiểm ở trên, rồi
  // bộ phân tích bỏ `.` đi và trả về đúng `//evil.com`.
  if (path.startsWith("//")) return fallback;

  // Phần đường dẫn không bao giờ cần `\`, ký tự điều khiển hay `//` ở đầu dù
  // đã mã hoá — có chúng là dấu hiệu chuỗi được soạn để qua mặt một tầng giải
  // mã phía sau. Chỉ xét `pathname`: truy vấn `?q=a%5Cb` là dữ liệu hợp lệ.
  const decodedPath = decoded(url.pathname);
  if (decodedPath === null || hasSuspiciousChar(decodedPath) || decodedPath.startsWith("//")) {
    return fallback;
  }

  return path;
}
