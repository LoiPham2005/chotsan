import { redirectRelative } from "@/lib/api/redirect";
import { clientIp } from "@/lib/api/auth";
import { createSession } from "@/lib/auth";
import {
  AccountBannedError,
  AccountInactiveError,
  InvalidCredentialsError,
  OAuthEmailRequiredError,
  OAuthEmailUnverifiedError,
  OAuthStateMismatchError,
  ProviderExchangeError,
  ProviderNotConfiguredError,
  TwoFactorRequiredError,
} from "@/lib/errors";
import { landingPathFor } from "@/lib/landing";
import { logger } from "@/lib/logger";
import { exchangeCodeForToken } from "@/lib/oauth/client";
import { consumeOAuthFlowCookie } from "@/lib/oauth/flow-cookie";
import { fetchOAuthProfile, type AppleFormPostUser } from "@/lib/oauth/profile";
import { setPendingTwoFactor } from "@/lib/oauth/two-factor-cookie";
import { isOAuthProviderId } from "@/lib/oauth/types";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { issueTwoFactorTicket } from "@/lib/tickets";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { oauthService } from "@/services/oauth.service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

type CallbackPayload = {
  code?: string;
  state?: string;
  /** `error=access_denied` khi người dùng bấm Huỷ ở màn hình consent của provider. */
  error?: string;
  /** Chỉ Apple gửi, và CHỈ trong lần cấp quyền đầu tiên — xem `profile.ts`. */
  appleUser?: AppleFormPostUser;
};

/**
 * Mã lỗi ngắn gắn vào `?oauthError=` để trang /login hiển thị thông báo phù
 * hợp — không đi qua `handleApiError`/JSON vì đây là luồng redirect trình
 * duyệt, không phải API cho mobile.
 *
 * Mọi lớp lỗi đều từ `@/lib/errors` — nguồn DUY NHẤT. Lỗi thật trước đây: route
 * so `instanceof` với một bộ lớp TRÙNG TÊN khai riêng trong `oauth/types.ts`,
 * nên "tài khoản không có email" rơi vào `unknown` và bị ghi log như sự cố.
 */
function oauthErrorCode(error: unknown): string {
  if (error instanceof OAuthStateMismatchError) return "state_mismatch";
  if (error instanceof OAuthEmailRequiredError) return "email_required";
  if (error instanceof OAuthEmailUnverifiedError) return "email_unverified";
  if (error instanceof ProviderNotConfiguredError) return "not_configured";
  if (error instanceof ProviderExchangeError) return "exchange_failed";
  if (error instanceof AccountBannedError) return "banned";
  // Tạm ngưng, hoặc liên kết cũ trỏ vào tài khoản đã xoá mềm.
  if (error instanceof AccountInactiveError || error instanceof InvalidCredentialsError) {
    return "account_unavailable";
  }
  return "unknown";
}

async function handleCallback(
  request: Request,
  provider: string,
  payload: CallbackPayload,
): Promise<Response> {
  if (!isOAuthProviderId(provider)) {
    return redirectRelative("/login?oauthError=invalid_provider", 302);
  }

  // Người dùng tự huỷ ở màn hình consent — không phải lỗi, không log.
  if (payload.error) {
    return redirectRelative(`/login?oauthError=${encodeURIComponent(payload.error)}`, 302);
  }

  const flow = await consumeOAuthFlowCookie();

  try {
    if (!flow || flow.provider !== provider || !payload.state || flow.state !== payload.state) {
      throw new OAuthStateMismatchError();
    }
    if (!payload.code) throw new OAuthStateMismatchError();

    const tokens = await exchangeCodeForToken(provider, payload.code, flow.codeVerifier);
    const profile = await fetchOAuthProfile(provider, tokens, payload.appleUser);
    const user = await oauthService.loginWithProfile(profile);

    await createSession({ typ: "access", sub: user.id, email: user.email, roles: user.roles });

    await auditService.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { method: "oauth", provider },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    // `next` rỗng = đăng nhập từ màn login trơn → về đúng chỗ làm việc của vai.
    // `next` đã qua `safeRedirectPath` ở bước `start`; qua thêm lần nữa vì cookie
    // `oauth_flow` không ký — ai đặt được cookie trên tên miền là sửa được nó.
    return redirectRelative(
      safeRedirectPath(flow.next || (await landingPathFor(user.id)), "/"),
      302,
    );
  } catch (error) {
    /*
     * Tài khoản đã bật 2FA: Google chỉ là MỘT yếu tố. Không tạo phiên — cấp vé
     * 2FA như luồng mật khẩu, giữ vé trong cookie httpOnly chỉ gửi kèm `/login`
     * (xem `two-factor-cookie.ts`), rồi đưa sang form nhập mã. Vé KHÔNG BAO GIỜ
     * nằm trên URL: nó sẽ vào lịch sử trình duyệt, log proxy và header Referer.
     */
    if (error instanceof TwoFactorRequiredError && flow) {
      const { challengeToken } = await issueTwoFactorTicket(error.userId);
      await setPendingTwoFactor({ ticket: challengeToken, next: flow.next });
      logger.info("OAuth cần bước 2FA", { userId: error.userId, provider });
      return redirectRelative("/login?twoFactor=1", 302);
    }

    const code = oauthErrorCode(error);
    if (code === "unknown") {
      logger.error("OAuth callback thất bại", error, { provider });
    } else {
      logger.warn("OAuth callback bị từ chối", { provider, code });
    }
    return redirectRelative(`/login?oauthError=${code}`, 302);
  }
}

/** Google, Github, Facebook — provider redirect ngược lại bằng GET kèm query string. */
export async function GET(request: Request, { params }: RouteContext) {
  const { provider } = await params;
  const url = new URL(request.url);

  return handleCallback(request, provider, {
    code: url.searchParams.get("code") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  });
}

/**
 * Apple bắt buộc `response_mode=form_post` khi xin scope name/email — xem
 * `config.ts`. Đây là POST CROSS-SITE, nên cookie `oauth_flow` của Apple phải
 * là `SameSite=None; Secure` (xem `flow-cookie.ts`), không thì mọi lượt đăng
 * nhập Apple đều dừng ở `state_mismatch`.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { provider } = await params;
  const form = await request.formData();

  const rawUser = form.get("user");
  let appleUser: AppleFormPostUser | undefined;
  if (typeof rawUser === "string") {
    try {
      appleUser = JSON.parse(rawUser) as AppleFormPostUser;
    } catch {
      appleUser = undefined;
    }
  }

  const code = form.get("code");
  const state = form.get("state");
  const error = form.get("error");

  return handleCallback(request, provider, {
    code: typeof code === "string" ? code : undefined,
    state: typeof state === "string" ? state : undefined,
    error: typeof error === "string" ? error : undefined,
    appleUser,
  });
}
