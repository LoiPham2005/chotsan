import { clientIp, enforceRateLimit } from "@/lib/api/auth";
import { apiErrors, apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { issueTokenPair } from "@/lib/api/tokens";
import { RATE_LIMIT_BUCKETS, RATE_LIMITS } from "@/lib/rate-limit";
import { consumeTicket, verifyTicket } from "@/lib/tickets";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { loginPasskeySchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { webauthnService } from "@/services/webauthn.service";

export const dynamic = "force-dynamic";

/**
 * Bước 2 — xác minh chữ ký và cấp token.
 *
 * KHÔNG hỏi thêm mã 2FA sau bước này, kể cả khi tài khoản có bật TOTP. Một
 * passkey với `userVerification: "required"` đã là hai yếu tố: thiết bị +
 * sinh trắc/PIN. Hỏi thêm chỉ khiến người dùng quay về dùng mật khẩu — tức là
 * làm hệ thống YẾU đi.
 */
export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, RATE_LIMIT_BUCKETS.passkey, RATE_LIMITS.passkey);

    const body = await parseJsonBody(request, loginPasskeySchema);
    const ticket = await verifyTicket(body.challengeToken, "webauthn_auth");

    // Tiêu vé TRƯỚC khi xác minh: passkey đồng bộ giữ bộ đếm chữ ký bằng 0, nên
    // thư viện không nhận ra một phản hồi bị nộp lại. Vé dùng một lần mới chặn
    // được việc đăng nhập lại bằng đúng cặp vé + phản hồi cũ.
    if (!ticket || !(await consumeTicket(ticket))) {
      throw apiErrors.unauthenticated("Phiên đăng nhập passkey đã hết hạn. Vui lòng thử lại.");
    }

    const user = await webauthnService.verifyAuthentication(body.response, ticket.challenge);

    const userAgent = request.headers.get("user-agent");
    const ip = clientIp(request);

    const tokens = await issueTokenPair(user, {
      userAgent,
      ip,
      // Đánh dấu phiên đã qua xác thực nhiều yếu tố — xem ghi chú ở trên.
      twoFactorAt: new Date(),
    });

    await auditService.record({
      action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { method: "passkey", surface: "api" },
      ip,
      userAgent,
    });

    return apiOk({ user, ...tokens });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/passkeys/login/verify", request });
  }
}
