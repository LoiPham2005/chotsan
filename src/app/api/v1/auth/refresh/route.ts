import { clientIp, enforceRateLimit } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { RefreshTokenReuseError } from "@/lib/errors";
import { RATE_LIMIT_BUCKETS, RATE_LIMITS } from "@/lib/rate-limit";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, signSession } from "@/lib/session";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { refreshSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { userService } from "@/services/user.service";
import { tokenService } from "@/services/token.service";

export const dynamic = "force-dynamic";

/**
 * Đổi refresh token lấy cặp token mới.
 *
 * Endpoint này KHÔNG dùng access token: client gọi tới đây chính vì access
 * token đã hết hạn.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, RATE_LIMIT_BUCKETS.refresh, RATE_LIMITS.refresh);

    const { refreshToken } = await parseJsonBody(request, refreshSchema);
    const userAgent = request.headers.get("user-agent");
    const ip = clientIp(request);

    let rotated;
    try {
      rotated = await tokenService.rotate(refreshToken, { userAgent, ip });
    } catch (error) {
      /*
       * Token ĐÃ thu hồi mà vẫn được nộp lại: service vừa huỷ cả HỌ phiên đó
       * (không phải mọi phiên của tài khoản). Đây là dấu hiệu token bị đánh
       * cắp — phải để lại dấu vết tra được theo tài khoản, không chỉ một dòng
       * log cảnh báo trôi đi.
       */
      if (error instanceof RefreshTokenReuseError) {
        await auditService.record({
          action: AUDIT_ACTIONS.REFRESH_TOKEN_REUSED,
          entity: "user",
          entityId: error.userId,
          actorId: error.userId,
          ip,
          userAgent,
        });
      }
      throw error;
    }

    // null = token không tồn tại, hết hạn, hoặc tài khoản không còn ACTIVE.
    if (!rotated) {
      throw apiErrors.unauthenticated("Refresh token không hợp lệ hoặc đã hết hạn");
    }

    /*
     * Tra lại user thay vì tin dữ liệu gắn kèm token cũ.
     *
     * Refresh là đúng thời điểm để nhặt thay đổi: vai trò có thể vừa bị gỡ,
     * tài khoản có thể vừa bị khoá. Ký lại một token mang vai trò cũ là kéo dài
     * thêm một vòng đời cho trạng thái đã lỗi thời.
     */
    const user = await userService.findById(rotated.userId);
    if (!user) throw apiErrors.unauthenticated("Refresh token không hợp lệ hoặc đã hết hạn");

    const accessToken = await signSession(
      {
        typ: "access",
        sub: user.id,
        email: user.email,
        roles: user.roles,
        sid: rotated.refresh.familyId,
        // Phiên đã qua 2FA/passkey thì access token mới cũng mang dấu đó — bản
        // cũ đánh rơi `mfa` từ lần refresh đầu tiên.
        ...(rotated.twoFactorAt ? { mfa: rotated.twoFactorAt.toISOString() } : {}),
      },
      ACCESS_TOKEN_MAX_AGE_SECONDS,
    );

    return apiOk({
      accessToken,
      expiresIn: ACCESS_TOKEN_MAX_AGE_SECONDS,
      tokenType: "Bearer" as const,
      refreshToken: rotated.refresh.token,
      refreshExpiresAt: rotated.refresh.expiresAt.toISOString(),
      /*
       * `familyId`, KHÔNG phải `id` của bản ghi token.
       *
       * `id` đổi sau MỖI lần refresh vì token xoay vòng, còn `familyId` thì
       * không — và `GET /auth/sessions` liệt kê theo `familyId`. Trả `id` ở
       * đây thì sau lần refresh đầu tiên, giá trị client đang giữ không còn
       * khớp dòng nào trong danh sách: màn "thiết bị đang đăng nhập" không bao
       * giờ đánh dấu được thiết bị hiện tại, và `DELETE /auth/sessions/{id}`
       * với giá trị đó trả 404.
       *
       * Phải khớp với `issueTokenPair` — login và refresh mà trả hai loại giá
       * trị khác nhau cho cùng một trường là bẫy cho mọi client.
       */
      sessionId: rotated.refresh.familyId,
    });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/refresh", request });
  }
}
