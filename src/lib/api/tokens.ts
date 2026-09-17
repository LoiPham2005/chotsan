import "server-only";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, signSession } from "@/lib/session";
import { tokenService } from "@/services/token.service";
import type { PublicUser } from "@/schemas/user.schema";

export type TokenPair = {
  accessToken: string;
  /** Số giây còn lại của access token — client dùng để chủ động refresh trước hạn. */
  expiresIn: number;
  tokenType: "Bearer";
  refreshToken: string;
  refreshExpiresAt: string;
  /**
   * Id của phiên vừa cấp.
   *
   * Không phải bí mật — token thật đã băm SHA-256 trước khi lưu, biết id cũng
   * không đăng nhập được. Client lưu lại để đánh dấu "thiết bị này" trên màn
   * `GET /auth/sessions`: access token không mang thông tin gì về refresh
   * token đã sinh ra nó, nên thiếu id thì màn hình đó không tự nhận ra mình.
   *
   * ⚠️ Đây là `familyId`, nên nó KHÔNG đổi qua các lần refresh — client lưu
   * một lần rồi dùng mãi cho tới khi đăng xuất. `id` của bản ghi token thì có
   * đổi, nhưng giá trị đó không bao giờ ra khỏi server.
   */
  sessionId: string;
};

/**
 * Cấp cặp access + refresh token cho một phiên mobile.
 *
 * Gom vào một chỗ để `login`, `register`, bước 2FA, passkey và đổi mật khẩu
 * không thể lệch nhau về hình dạng response — client Flutter chỉ phải viết một
 * model duy nhất.
 *
 * @param context.familyId Chỉ truyền khi CẤP LẠI cho một phiên có sẵn (đổi mật
 * khẩu): token mới vào đúng họ cũ, nên `sessionId` client đang giữ vẫn khớp
 * dòng của nó trong `GET /auth/sessions`. Bỏ trống = phiên mới, họ mới.
 */
export async function issueTokenPair(
  user: Pick<PublicUser, "id" | "email" | "roles">,
  context: {
    userAgent?: string | null;
    ip?: string | null;
    twoFactorAt?: Date | null;
    familyId?: string;
  } = {},
): Promise<TokenPair> {
  const { familyId, ...refreshContext } = context;
  const refresh = await tokenService.issue(user.id, refreshContext, familyId);

  const accessToken = await signSession(
    {
      typ: "access",
      sub: user.id,
      email: user.email,
      roles: user.roles,
      // `familyId`, KHÔNG phải id bản ghi token: giá trị này không đổi qua các
      // lần refresh, nên client giữ được một định danh phiên ổn định.
      sid: refresh.familyId,
      ...(context.twoFactorAt ? { mfa: context.twoFactorAt.toISOString() } : {}),
    },
    ACCESS_TOKEN_MAX_AGE_SECONDS,
  );

  return {
    accessToken,
    expiresIn: ACCESS_TOKEN_MAX_AGE_SECONDS,
    tokenType: "Bearer",
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt.toISOString(),
    sessionId: refresh.familyId,
  };
}
