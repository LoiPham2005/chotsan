import { NextResponse } from "next/server";
import { redirectRelative } from "@/lib/api/redirect";
import { apiErrors, handleApiError } from "@/lib/api/response";
import { buildAuthorizationUrl } from "@/lib/oauth/client";
import { PROVIDER_CONFIG, isProviderConfigured } from "@/lib/oauth/config";
import { setOAuthFlowCookie } from "@/lib/oauth/flow-cookie";
import { createCodeChallenge, generateCodeVerifier, generateOAuthState } from "@/lib/oauth/pkce";
import { isOAuthProviderId } from "@/lib/oauth/types";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

/** Bấm "Đăng nhập bằng Google/Github/Facebook/Apple" luôn trỏ vào đây (GET, để dùng được như href). */
export async function GET(request: Request, { params }: RouteContext) {
  const { provider } = await params;

  if (!isOAuthProviderId(provider)) {
    // Cùng envelope `{ error: { code, message } }` với mọi route `/api/v1` —
    // client rẽ nhánh theo `code`, không phải đoán hình dạng.
    return handleApiError(apiErrors.notFound("Nhà cung cấp đăng nhập không được hỗ trợ"), {
      route: "GET /api/v1/auth/oauth/[provider]/start",
      request,
    });
  }

  if (!isProviderConfigured(provider)) {
    return redirectRelative("/login?oauthError=not_configured", 302);
  }

  // Rỗng = "chưa biết về đâu": callback sẽ hỏi `landingPathFor()` sau khi biết
  // người đăng nhập là ai. Bộ khung để mặc định `/users` — màn quản trị cần
  // quyền `user:read`, nên đăng nhập bằng Google xong là rơi vào 404.
  const next = safeRedirectPath(new URL(request.url).searchParams.get("next"), "");

  const state = generateOAuthState();
  const codeVerifier = PROVIDER_CONFIG[provider].usePkce ? generateCodeVerifier() : undefined;

  await setOAuthFlowCookie({ provider, state, codeVerifier, next });

  const authorizationUrl = buildAuthorizationUrl(provider, {
    state,
    codeChallenge: codeVerifier ? createCodeChallenge(codeVerifier) : undefined,
  });

  return NextResponse.redirect(authorizationUrl);
}
