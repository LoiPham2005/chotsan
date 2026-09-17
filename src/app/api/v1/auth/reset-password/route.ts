import { clientIp, enforceRateLimit } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_BUCKETS, RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { resetPasswordSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

/**
 * Đặt mật khẩu mới bằng token trong email.
 *
 * Sau khi đổi, MỌI phiên của tài khoản bị thu hồi — refresh token lẫn access
 * token đang cầm (xem `AuthService.resetPassword`). Client phải coi mọi token
 * đang giữ là đã hỏng và điều hướng người dùng về màn hình đăng nhập.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, RATE_LIMIT_BUCKETS.passwordReset, RATE_LIMITS.passwordChange);

    const body = await parseJsonBody(request, resetPasswordSchema);
    const userId = await authService.resetPassword(body.token, body.password);

    await auditService.record({
      action: AUDIT_ACTIONS.PASSWORD_RESET,
      entity: "user",
      entityId: userId,
      actorId: userId,
      metadata: { surface: "api" },
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    logger.info("API reset password thành công", { userId });

    return apiOk({
      message: "Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.",
    });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/reset-password", request });
  }
}
