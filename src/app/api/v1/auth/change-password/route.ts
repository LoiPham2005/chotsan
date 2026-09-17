import { clientIp, enforceRateLimit, requireApiUser } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { issueTokenPair } from "@/lib/api/tokens";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_BUCKETS, RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { changePasswordSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";
import { userService } from "@/services/user.service";

export const dynamic = "force-dynamic";

/**
 * Đổi mật khẩu khi đang đăng nhập.
 *
 * Vẫn bắt nhập mật khẩu hiện tại dù đã có session hợp lệ: nếu không, bất kỳ ai
 * ngồi vào máy đang mở sẵn phiên — hoặc chiếm được token — đều đổi được mật
 * khẩu và chiếm tài khoản vĩnh viễn.
 *
 * ---
 * THIẾT BỊ ĐANG THAO TÁC KHÔNG BỊ ĐÁ RA
 *
 * Service thu hồi MỌI refresh token và vô hiệu mọi access token cấp trước lúc
 * đổi — kể cả của chính thiết bị này, vì bản sao của chúng có thể đã nằm trong
 * tay kẻ gian. Route trả luôn một cặp token MỚI cho thiết bị đang gọi, cùng
 * `familyId` cũ (`sid` trong access token): `sessionId` client đang giữ vẫn
 * khớp dòng của nó trong `GET /auth/sessions`, và người dùng không phải đăng
 * nhập lại ngay trên máy vừa đổi mật khẩu.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiUser(request);

    await enforceRateLimit(request, RATE_LIMIT_BUCKETS.passwordChange, RATE_LIMITS.passwordChange);

    const body = await parseJsonBody(request, changePasswordSchema);
    await authService.changePassword(session.sub, body.currentPassword, body.newPassword);

    const user = await userService.findById(session.sub);
    if (!user) throw apiErrors.unauthenticated("Tài khoản không còn tồn tại");

    const userAgent = request.headers.get("user-agent");
    const ip = clientIp(request);

    const tokens = await issueTokenPair(user, {
      userAgent,
      ip,
      // Phiên đã qua 2FA thì phiên cấp lại cũng vậy — đổi mật khẩu không phải
      // lý do bắt nhập lại mã.
      twoFactorAt: session.mfa ? new Date(session.mfa) : null,
      ...(session.sid ? { familyId: session.sid } : {}),
    });

    await auditService.record({
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entity: "user",
      entityId: session.sub,
      actorId: session.sub,
      actorEmail: session.email,
      metadata: { surface: "api" },
      ip,
      userAgent,
    });

    logger.info("API đổi mật khẩu", { userId: session.sub });

    return apiOk({
      message: "Đổi mật khẩu thành công. Các thiết bị khác đã bị đăng xuất.",
      user,
      ...tokens,
    });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/change-password", request });
  }
}
