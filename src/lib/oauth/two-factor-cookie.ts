import "server-only";
import { cookies } from "next/headers";
import { env, isProduction } from "@/lib/env";

/**
 * Lượt đăng nhập OAuth đang chờ bước 2FA.
 *
 * ---
 * VÌ SAO LÀ COOKIE, KHÔNG PHẢI THAM SỐ TRÊN URL
 *
 * Callback OAuth là một chuỗi chuyển hướng trình duyệt, không có form nào để
 * trả vé về như luồng mật khẩu. Đặt vé lên URL (`/login?ticket=…`) là để nó
 * nằm trong lịch sử trình duyệt, log truy cập của proxy, và header `Referer`
 * gửi sang bất kỳ tài nguyên ngoài nào trang đó tải. Vé chứng minh "đã qua
 * bước một" — lộ nó là lộ nửa cái khoá.
 *
 * Cookie `httpOnly`, chỉ gửi kèm đường dẫn `/login` (trang hiện form và Server
 * Action của form đó cùng POST về đây), sống đúng bằng hạn của vé.
 */

const COOKIE_NAME = "oauth_2fa";

export type PendingTwoFactor = {
  /** Vé `typ: "2fa"` — xem `src/lib/tickets.ts`. */
  ticket: string;
  /** Đích sau khi xong, ĐÃ qua `safeRedirectPath` ở bước `start`. Rỗng = theo vai. */
  next: string;
};

export function pendingTwoFactorCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/login",
    maxAge: env.TWO_FACTOR_CHALLENGE_TTL_MINUTES * 60,
  };
}

export async function setPendingTwoFactor(value: PendingTwoFactor): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(value), pendingTwoFactorCookieOptions());
}

/** `null` khi không có, hoặc cookie hỏng. Vé bên trong vẫn phải qua `verifyTicket`. */
export async function readPendingTwoFactor(): Promise<PendingTwoFactor | null> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PendingTwoFactor>;
    return typeof parsed.ticket === "string"
      ? { ticket: parsed.ticket, next: typeof parsed.next === "string" ? parsed.next : "" }
      : null;
  } catch {
    return null;
  }
}

/** Xoá sau khi đăng nhập xong — cùng `path`, không thì trình duyệt giữ bản cũ. */
export async function clearPendingTwoFactor(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { ...pendingTwoFactorCookieOptions(), maxAge: 0 });
}
