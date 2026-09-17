import { NextResponse, type NextRequest } from "next/server";
import { CURRENT_PATH_HEADER, SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";

/**
 * Proxy — tên mới của Middleware kể từ Next.js 16.
 *
 * Làm ba việc: dựng Content-Security-Policy có nonce, gắn `x-pathname` cho
 * `requireUser()` biết đường quay lại, và chặn request chưa đăng nhập ngay ở
 * cửa ngõ.
 *
 * ---
 * CHỈ LÀ LỚP GIAO DIỆN — KHÔNG PHẢI RANH GIỚI BẢO MẬT
 *
 * Proxy CHỈ kiểm CHỮ KÝ cookie, cố ý không chạm database hay cache: nó chạy
 * trước MỌI request trang và asset động. Nên nó không biết phiên đã bị thu hồi
 * (tài khoản bị khoá, bị xoá, vừa đổi mật khẩu). Phép kiểm đó nằm ở
 * `getSession()` — nơi mọi trang, layout và Server Action đều đi qua. Mọi
 * Server Action và route handler vẫn phải tự kiểm quyền (`src/lib/define-action.ts`,
 * `src/lib/api/auth.ts`).
 */

/** Prefix yêu cầu đã đăng nhập. */
const PROTECTED_PREFIXES = ["/users", "/roles", "/sessions", "/security"];

function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    `default-src 'self'`,
    // 'strict-dynamic' cho phép script đã qua nonce tự nạp script con, đúng
    // với cách Next.js hydrate. Dev cần 'unsafe-eval' cho React Refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Không dùng nonce cho style: toàn bộ UI ở đây dùng thuộc tính style={{}}
    // của React, mà thuộc tính style thì nonce không áp được — chỉ
    // 'unsafe-inline' mới cho qua. Bỏ inline style đi thì siết lại được.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const { pathname } = request.nextUrl;

  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(nonce, isDev);

  const session = await verifySession(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  // Đường dẫn KÈM truy vấn: `/venues/a?chon=…` phải quay lại đúng lựa chọn cũ.
  // (Next đã bỏ tham số nội bộ `_rsc` khỏi `nextUrl` trước khi tới đây.)
  const currentPath = `${pathname}${request.nextUrl.search}`;

  const needsAuth = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (needsAuth && !session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", currentPath);
    return NextResponse.redirect(loginUrl);
  }

  /*
   * ĐÃ ĐĂNG NHẬP MÀ VÀO /login, /register: KHÔNG chuyển hướng ở đây.
   *
   * Proxy chỉ thấy chữ ký. Cookie đúng chữ ký của phiên ĐÃ BỊ THU HỒI mà bị đá
   * khỏi /login thì người đó không bao giờ tới được form để đăng nhập lại — còn
   * trang cần đăng nhập thì đá họ ngược về /login: vòng lặp chuyển hướng. Hai
   * trang đó tự chuyển hướng người đăng nhập THẬT về `safeRedirectPath(next,
   * "/")` bằng `getSession()` đầy đủ.
   */

  // Nonce phải đi vào REQUEST header thì Next.js mới đọc được và gắn vào các
  // thẻ <script> nó tự sinh; đặt mỗi ở response header là không đủ.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  // GHI ĐÈ, không nối: client tự gửi `x-pathname` thì giá trị đó bị thay. Nơi
  // đọc (`requireUser`) vẫn lọc qua `safeRedirectPath`.
  requestHeaders.set(CURRENT_PATH_HEADER, currentPath);

  // Mã định danh request: tôn trọng giá trị reverse proxy đã gắn, chỉ sinh mới
  // khi chưa có. Nhờ vậy log của ứng dụng nối được với log của Caddy/nginx
  // thay vì mỗi tầng mang một mã riêng.
  //
  // Chỉ áp cho luồng TRANG — proxy cố tình không chạy trên /api, nên phía API
  // việc này do `handleApiError` lo (xem src/lib/request-id.ts).
  const requestId = getRequestId(request);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

// Không khai báo `runtime` ở đây: từ Next.js 16, Proxy mặc định chạy trên
// Node.js runtime và việc set `runtime` sẽ khiến build lỗi.
export const config = {
  matcher: [
    /*
     * Bỏ qua:
     *   - asset tĩnh và mọi file có phần mở rộng
     *   - /api/** và /docs — CÓ CHỦ ĐÍCH.
     *
     * Proxy nói chuyện bằng redirect và HTML, còn client API (app Flutter)
     * cần JSON kèm đúng status code. Nếu để /api đi qua đây, một token hết
     * hạn sẽ trả về 307 dẫn tới trang login thay vì 401 — lỗi rất khó nhìn ra
     * từ phía mobile vì nó trông như request thành công.
     *
     * Đổi lại, MỌI route handler trong src/app/api phải tự kiểm quyền bằng
     * `requireApiUser()` / `requireApiPermission()`. Header bảo mật không mất
     * đi: chúng được set ở next.config.mjs cho toàn bộ đường dẫn.
     */
    "/((?!api/|docs|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)",
  ],
};
