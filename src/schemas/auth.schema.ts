import { z } from "zod";
import {
  emailSchema,
  fullNameSchema,
  passwordSchema,
  phoneSchema,
  usernameSchema,
} from "@/schemas/user.schema";
import { emptyToUndefined } from "@/schemas/common.schema";

export const loginSchema = z.object({
  /**
   * Một ô nhập duy nhất cho cả email lẫn tên đăng nhập.
   *
   * Không tách hai trường vì người dùng không nhớ mình đã đăng ký bằng đường
   * nào. `AuthService` phân biệt bằng ký tự `@` — thứ mà `usernameSchema` cấm.
   */
  identifier: z.string().trim().min(1, "Vui lòng nhập email hoặc tên đăng nhập"),
  /**
   * Chỉ yêu cầu "có nhập gì đó". Áp luật độ dài ở đây vừa vô nghĩa với tài
   * khoản đặt mật khẩu từ trước khi luật đổi, vừa tiết lộ luật mật khẩu cho
   * người đang dò.
   */
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: emptyToUndefined(usernameSchema.optional()),
  fullName: emptyToUndefined(fullNameSchema.optional()),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Thiếu refresh token"),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Thiếu mã đặt lại mật khẩu"),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
    newPassword: passwordSchema,
  })
  // Đổi sang đúng mật khẩu cũ là thao tác vô nghĩa, và nó thường có nghĩa là
  // người dùng hiểu nhầm form — nói thẳng còn hơn báo "đổi thành công".
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "Mật khẩu mới phải khác mật khẩu hiện tại",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Thiếu mã xác thực"),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({ email: emailSchema });
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

/*
 * HÌNH DẠNG RESPONSE token/phiên KHÔNG khai ở đây.
 *
 * Nguồn sự thật của response là `TokenPair` (`src/lib/api/tokens.ts`, dùng
 * chung cho login/register/2FA/passkey/refresh — `sessionId` là `familyId`, ổn
 * định qua mọi lần refresh) và đặc tả `TokenPair`/`Session` trong
 * `src/lib/openapi/registry.ts`. Bản sao Zod cũ ở file này đã lệch cả hai (token
 * lồng trong `tokens`, `ip`/`current` mà API không trả) mà không ai dùng — giữ
 * lại chỉ để có ngày ai đó tin vào nó.
 *
 * Danh sách provider OAuth cũng không khai ở đây: nguồn duy nhất là
 * `OAUTH_PROVIDERS` trong `src/lib/oauth/types.ts`.
 */

// ---------------------------------------------------------------------------
// Xác thực hai lớp (2FA)
// ---------------------------------------------------------------------------

/**
 * Mã 2FA: chấp nhận CẢ mã TOTP 6 số lẫn mã khôi phục 10 ký tự.
 *
 * Không tách hai trường vì người dùng ở màn hình đó chỉ có một ô nhập, và họ
 * không nên phải tự phân loại thứ mình đang dán vào. `TwoFactorService` phân
 * biệt bằng độ dài sau khi chuẩn hoá.
 */
export const twoFactorCodeSchema = z
  .string()
  .trim()
  .min(6, "Mã xác thực quá ngắn")
  .max(20, "Mã xác thực quá dài");

export const verifyTwoFactorSchema = z.object({
  /** Vé nhận được từ `POST /auth/login` khi tài khoản có bật 2FA. */
  challengeToken: z.string().min(1, "Thiếu vé xác thực"),
  code: twoFactorCodeSchema,
});
export type VerifyTwoFactorInput = z.infer<typeof verifyTwoFactorSchema>;

export const confirmTwoFactorSchema = z.object({ code: twoFactorCodeSchema });
export type ConfirmTwoFactorInput = z.infer<typeof confirmTwoFactorSchema>;

export const disableTwoFactorSchema = z.object({
  /** Bỏ trống với tài khoản chưa đặt mật khẩu (chỉ đăng nhập qua OAuth). */
  password: z.string().optional(),
  code: twoFactorCodeSchema,
});
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;

/**
 * Phản hồi của `POST /auth/login` khi tài khoản có bật 2FA.
 *
 * Hình dạng KHÁC HẲN `AuthResponse` có chủ đích: client buộc phải rẽ nhánh
 * tường minh thay vì đọc phải một object thiếu `tokens` rồi hỏng ở đâu đó xa
 * hơn.
 */
export const twoFactorChallengeSchema = z.object({
  twoFactorRequired: z.literal(true),
  challengeToken: z.string(),
  /** Số giây còn lại của vé. */
  expiresIn: z.number(),
});
export type TwoFactorChallenge = z.infer<typeof twoFactorChallengeSchema>;

export const twoFactorSetupSchema = z.object({
  /** Bí mật base32 — hiển thị để người dùng nhập tay khi không quét được QR. */
  secret: z.string(),
  /** URI `otpauth://` để dựng mã QR. */
  uri: z.string(),
});
export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupSchema>;

export const twoFactorStatusSchema = z.object({
  enabled: z.boolean(),
  enabledAt: z.coerce.date().nullable(),
  remainingRecoveryCodes: z.number(),
  /** `false` khi hệ thống chưa cấu hình `ENCRYPTION_KEY` — nút bật 2FA nên ẩn. */
  available: z.boolean(),
});
export type TwoFactorStatusResponse = z.infer<typeof twoFactorStatusSchema>;

// ---------------------------------------------------------------------------
// Đổi địa chỉ email
// ---------------------------------------------------------------------------

export const requestEmailChangeSchema = z.object({
  newEmail: emailSchema,
  /**
   * Bắt nhập lại mật khẩu hiện tại. Đổi email là đường chiếm tài khoản kinh
   * điển — chiếm phiên một lúc, đổi email, rồi dùng "quên mật khẩu" để chiếm
   * vĩnh viễn.
   */
  password: z.string().min(1, "Vui lòng nhập mật khẩu hiện tại"),
});
export type RequestEmailChangeInput = z.infer<typeof requestEmailChangeSchema>;

export const confirmEmailChangeSchema = z.object({
  token: z.string().min(1, "Thiếu mã xác nhận"),
});
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;

// ---------------------------------------------------------------------------
// Passkey (WebAuthn)
// ---------------------------------------------------------------------------

/**
 * Phản hồi thô từ `navigator.credentials.create()` / `.get()`.
 *
 * Cố ý KHÔNG mô tả lại cấu trúc bằng Zod: đặc tả WebAuthn định nghĩa nó rất
 * chi tiết và còn đang tiến hoá, nên một bản chép tay ở đây sẽ lỗi thời và bắt
 * đầu từ chối những trình duyệt hợp lệ. Việc kiểm tra thật do
 * `@simplewebauthn/server` làm — nó xác minh chữ ký, origin, RP ID và
 * challenge, tức là kiểm thứ thực sự quan trọng.
 *
 * Ở đây chỉ chặn "không phải object" để phần còn lại không nổ vì `undefined`.
 */
export const webAuthnResponseSchema = z.record(z.string(), z.unknown());

export const registerPasskeySchema = z.object({
  /** Vé chứa challenge, nhận từ bước `/register/options`. */
  challengeToken: z.string().min(1, "Thiếu vé đăng ký"),
  response: webAuthnResponseSchema,
  /** Tên do người dùng đặt: "iPhone của Loi". */
  name: z.string().trim().max(60).optional(),
});
export type RegisterPasskeyInput = z.infer<typeof registerPasskeySchema>;

export const loginPasskeySchema = z.object({
  challengeToken: z.string().min(1, "Thiếu vé đăng nhập"),
  response: webAuthnResponseSchema,
});
export type LoginPasskeyInput = z.infer<typeof loginPasskeySchema>;

export const renamePasskeySchema = z.object({
  name: z.string().trim().min(1, "Tên không được để trống").max(60),
});
export type RenamePasskeyInput = z.infer<typeof renamePasskeySchema>;

export const passkeySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** `singleDevice` = khoá cứng · `multiDevice` = passkey đồng bộ được. */
  deviceType: z.string(),
  /** `false` = chưa sao lưu; mất thiết bị là mất hẳn passkey này. */
  backedUp: z.boolean(),
  transports: z.array(z.string()),
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Passkey = z.infer<typeof passkeySchema>;

// ---------------------------------------------------------------------------
// Xác thực số điện thoại (SMS)
// ---------------------------------------------------------------------------

export const requestPhoneOtpSchema = z.object({ phone: phoneSchema });
export type RequestPhoneOtpInput = z.infer<typeof requestPhoneOtpSchema>;

export const verifyPhoneOtpSchema = z.object({
  /**
   * 6 chữ số. Bỏ MỌI khoảng trắng trước khi kiểm — kể cả ở giữa: tin nhắn và
   * bàn phím số hay chèn khoảng trắng thành `123 456`. Bản cũ chỉ `trim()` hai
   * đầu, nên đúng kiểu dán phổ biến nhất lại bị báo "gồm 6 chữ số".
   */
  code: z.preprocess(
    (value) => (typeof value === "string" ? value.replace(/\s/g, "") : value),
    z.string().regex(/^\d{6}$/, "Mã xác thực gồm 6 chữ số"),
  ),
});
export type VerifyPhoneOtpInput = z.infer<typeof verifyPhoneOtpSchema>;
