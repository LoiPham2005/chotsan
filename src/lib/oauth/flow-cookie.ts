import "server-only";
import { cookies } from "next/headers";
import { isProduction } from "@/lib/env";
import { PROVIDER_CONFIG } from "./config";
import type { OAuthProviderId } from "./types";

/**
 * Trạng thái tạm giữa bước `start` (redirect sang provider) và `callback`
 * (provider redirect ngược lại): provider nào, `state` để đối chiếu chống
 * CSRF, `codeVerifier` cho PKCE (không phải provider nào cũng cần), và
 * `next` — trang muốn quay lại sau khi đăng nhập xong.
 *
 * Gộp một cookie JSON thay vì ba cookie rời: callback luôn cần đọc cả ba cùng
 * lúc, và gộp lại thì không có chuyện đọc được `state` nhưng thiếu
 * `codeVerifier` do cookie kia bị trình duyệt/proxy nào đó chặn riêng.
 */
type OAuthFlowState = {
  provider: OAuthProviderId;
  state: string;
  codeVerifier?: string;
  next: string;
};

const COOKIE_NAME = "oauth_flow";

/** 10 phút — đủ để người dùng đăng nhập ở phía provider, ngắn để giảm cửa sổ replay. */
const MAX_AGE_SECONDS = 10 * 60;

/**
 * Tuỳ chọn cookie theo CÁCH provider gọi lại callback.
 *
 * Google/GitHub/Facebook chuyển hướng trình duyệt bằng GET — điều hướng cấp
 * cao nhất nên cookie `SameSite=Lax` vẫn được gửi kèm.
 *
 * Apple thì `response_mode=form_post`: trang của appleid.apple.com tự POST một
 * form về callback, tức là request CROSS-SITE bằng POST. Trình duyệt KHÔNG gửi
 * cookie `Lax` theo request đó, callback không đọc được `state` và mọi lượt đăng
 * nhập Apple đều hỏng với `state_mismatch`. Nên riêng luồng form_post phải là
 * `SameSite=None` — và trình duyệt chỉ nhận `None` khi kèm `Secure`, bất kể môi
 * trường (Apple vốn cũng chỉ chấp nhận `redirect_uri` https).
 */
export function oauthFlowCookieOptions(provider: OAuthProviderId) {
  const crossSitePost = PROVIDER_CONFIG[provider].responseMode === "form_post";

  return {
    httpOnly: true,
    sameSite: crossSitePost ? ("none" as const) : ("lax" as const),
    secure: crossSitePost ? true : isProduction,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

export async function setOAuthFlowCookie(flow: OAuthFlowState): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(flow), oauthFlowCookieOptions(flow.provider));
}

/** Đọc VÀ xoá cookie — state một lần dùng, dùng lại là dấu hiệu replay. */
export async function consumeOAuthFlowCookie(): Promise<OAuthFlowState | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  store.delete(COOKIE_NAME);

  if (!raw) return null;

  try {
    return JSON.parse(raw) as OAuthFlowState;
  } catch {
    return null;
  }
}
