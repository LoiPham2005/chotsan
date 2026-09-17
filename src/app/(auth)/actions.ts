"use server";
import {
  DomainError,
  InvalidTwoFactorCodeError,
  InvalidVerificationTokenError,
  DuplicateFieldError,
  TwoFactorRequiredError,
} from "@/lib/errors";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/auth";
import { actionClientIp, rateLimitAction } from "@/lib/define-action";
import { formErrorMap } from "@/lib/form-errors";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_BUCKETS, RATE_LIMITS, resetRateLimit } from "@/lib/rate-limit";
import { landingPathFor } from "@/lib/landing";
import { clearPendingTwoFactor, readPendingTwoFactor } from "@/lib/oauth/two-factor-cookie";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  confirmEmailChangeSchema,
} from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";
import { twoFactorService } from "@/services/two-factor.service";
import { consumeTicket, issueTwoFactorTicket, verifyTicket } from "@/lib/tickets";

/**
 * Tên các ô trong form xác thực.
 *
 * Union này là hợp đồng giữa ba nơi: `name=` của thẻ input, khoá lỗi Zod trả
 * về, và khoá mà `AuthFields` dùng để tìm lỗi đem hiển thị. Giữ nó khớp với
 * schema chính là thứ chặn lại lỗi cũ — form gửi `email` trong khi schema đòi
 * `identifier`, khiến đăng nhập hỏng hoàn toàn mà không lớp nào bắt được.
 */
export type AuthFieldName = "identifier" | "email" | "username" | "fullName" | "password";

export type AuthFormState = {
  error?: string;
  /**
   * Vé 2FA — mật khẩu đã đúng, còn thiếu mã từ app xác thực.
   *
   * Có mặt là form phải đổi sang ô nhập mã. Vé mang `typ: "2fa"` nên tự nó
   * KHÔNG đăng nhập được vào đâu (xem `src/lib/tickets.ts`); nó chỉ chứng minh
   * "vừa nhập đúng mật khẩu", hết hạn sau vài phút, và chết sau lần dùng đầu.
   *
   * Chỉ luồng MẬT KHẨU trả vé ở đây. Luồng OAuth giữ vé trong cookie httpOnly
   * (`two-factor-cookie.ts`) — không có form nào để trả nó về.
   */
  twoFactorToken?: string;
  /**
   * Thông điệp thành công hiển thị TẠI CHỖ, không kèm điều hướng.
   *
   * Cần cho luồng quên mật khẩu: nó cố ý không nói được gì về kết quả thật
   * (email có tồn tại hay không), nên cũng không có trang nào để đá người dùng
   * sang. Câu trả lời chính là toàn bộ phản hồi.
   */
  success?: string;
  fieldErrors?: Partial<Record<AuthFieldName, string[]>>;
  /**
   * Chữ vừa gửi, trả lại KÈM LỖI để form dựng lại đúng như lúc bấm — React 19
   * tự xoá trắng form sau mỗi lần action chạy xong, kể cả khi báo lỗi.
   *
   * ⚠️ KHÔNG BAO GIỜ có `password`: mật khẩu không được đi ngược từ máy chủ về
   * HTML (nằm trong payload của trang, trong bộ nhớ đệm của trình duyệt…).
   */
  values?: Partial<Record<Exclude<AuthFieldName, "password">, string>>;
};

/** Tên ô người dùng NHÌN THẤY — để câu lỗi nói đúng ô nào sai (`formErrorMap`). */
const AUTH_FIELD_LABELS = {
  identifier: "Email hoặc tên đăng nhập",
  email: "Email",
  username: "Tên đăng nhập",
  fullName: "Tên hiển thị",
  password: "Mật khẩu",
  token: "Liên kết",
} as const;

/** Giá trị chữ của một ô form ("" khi thiếu) — để trả lại trong `values`. */
function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/*
 * RATE LIMIT: mọi action dưới đây đếm theo IP vào CÙNG xô với route API của
 * cùng luồng (`RATE_LIMIT_BUCKETS`). Bản cũ đếm web `login:<ip>` và API
 * `api:login:<ip>` riêng — luân phiên hai cửa là gấp đôi số lần thử.
 */

async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.login, RATE_LIMITS.login);
  const values = { identifier: text(formData, "identifier") };

  if (!limit.success) {
    logger.warn("Login rate limit exceeded", { key: limit.key });
    return {
      error: `Bạn đã thử quá nhiều lần. Vui lòng đợi ${limit.retryAfterSeconds} giây.`,
      values,
    };
  }

  const parsed = loginSchema.safeParse(
    { identifier: formData.get("identifier"), password: formData.get("password") },
    { error: formErrorMap(AUTH_FIELD_LABELS) },
  );

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  let user;
  try {
    user = await authService.validateCredentials(parsed.data);
  } catch (error) {
    /*
     * KHÔNG phải lỗi — đây là một bước trong luồng đăng nhập.
     *
     * `validateCredentials` ném thay vì trả cờ để nơi gọi không thể vô tình bỏ
     * qua bước thứ hai. Chưa đặt cookie phiên nào tại đây, và cũng chưa reset
     * rate limit: đăng nhập chưa xong.
     */
    if (error instanceof TwoFactorRequiredError) {
      const ticket = await issueTwoFactorTicket(error.userId);
      return { twoFactorToken: ticket.challengeToken };
    }

    /*
     * MỌI lỗi nghiệp vụ đều có câu hiển thị được: sai thông tin, bị khoá, TẠM
     * NGƯNG, khoá tạm. Bản cũ liệt kê tay ba lớp và quên `AccountInactiveError`
     * — tài khoản tạm ngưng nhận "Không thể đăng nhập lúc này" và bị ghi log
     * như sự cố.
     */
    if (error instanceof DomainError) {
      await auditService.recordLoginFailure(error, {
        method: "password",
        ip: await actionClientIp(),
        userAgent: await userAgent(),
      });
      return { error: error.message, values };
    }
    logger.error("Login failed unexpectedly", error, { identifier: parsed.data.identifier });
    return { error: "Không thể đăng nhập lúc này. Vui lòng thử lại.", values };
  }

  await resetRateLimit(limit.key);
  await createSession({
    typ: "access" as const,
    sub: user.id,
    email: user.email,
    roles: user.roles,
  });

  await auditService.record({
    action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
    entity: "user",
    entityId: user.id,
    actorId: user.id,
    actorEmail: user.email,
    metadata: { method: "password", surface: "web" },
    ip: await actionClientIp(),
    userAgent: await userAgent(),
  });

  /*
   * `?next=` LUÔN THẮNG.
   *
   * Người dùng bấm vào một link cụ thể rồi bị chặn ở cửa — đưa họ về đúng chỗ
   * đó, không phải về màn mặc định của vai. Chỉ khi không có `next` mới hỏi
   * "vai này làm việc ở đâu" — không bao giờ mặc định `/users` (màn quản trị,
   * 404 với gần như mọi người).
   */
  const next = formData.get("next");
  const destination = typeof next === "string" && next ? next : await landingPathFor(user.id);

  // redirect() hoạt động bằng cách ném exception — phải nằm ngoài mọi try/catch.
  redirect(safeRedirectPath(destination, "/"));
}

/**
 * Bước 2 của đăng nhập web: đổi vé 2FA + mã lấy cookie phiên.
 *
 * Tách khỏi `loginAction` chứ không nhét thêm một nhánh `if`: hai bước nhận
 * dữ liệu khác nhau, kiểm tra khác nhau, và rate limit khác nhau.
 *
 * Vé đến từ MỘT trong hai nguồn:
 *   • field ẩn `twoFactorToken` — luồng mật khẩu (`loginAction` vừa trả về);
 *   • cookie httpOnly `oauth_2fa` — luồng OAuth, vé không bao giờ ra tới HTML
 *     hay URL. Xoá cookie khi xong.
 *
 * Chống dò: rate limit IP (chung xô với API), bộ đếm theo TÀI KHOẢN trong
 * `verifyCode`, và vé dùng MỘT lần (gõ sai mã thì vé còn nguyên).
 */
export async function verifyTwoFactorAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.twoFactor, RATE_LIMITS.twoFactor);

  if (!limit.success) {
    return { error: `Bạn đã thử quá nhiều lần. Vui lòng đợi ${limit.retryAfterSeconds} giây.` };
  }

  const formToken = formData.get("twoFactorToken");
  const pending = typeof formToken === "string" && formToken ? null : await readPendingTwoFactor();
  const challengeToken = typeof formToken === "string" && formToken ? formToken : pending?.ticket;
  const code = formData.get("code");

  const ticket = await verifyTicket(challengeToken, "2fa");

  if (!ticket || typeof code !== "string") {
    return { error: "Phiên xác thực đã hết hạn. Vui lòng đăng nhập lại." };
  }

  // Vé của luồng mật khẩu thì trả lại để người dùng nhập tiếp; vé trong cookie
  // thì vẫn nằm yên trong cookie.
  const retry = pending ? {} : { twoFactorToken: challengeToken };

  let user;
  try {
    if (!(await twoFactorService.verifyCode(ticket.sub, code))) {
      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_FAILED,
        entity: "user",
        entityId: ticket.sub,
        actorId: ticket.sub,
        metadata: { surface: "web" },
        ip: await actionClientIp(),
        userAgent: await userAgent(),
      });
      throw new InvalidTwoFactorCodeError();
    }

    // Mã đúng → tiêu vé trước khi cấp phiên: hai request cùng nộp một vé thì
    // chỉ một bên được đăng nhập.
    if (!(await consumeTicket(ticket))) {
      return { error: "Phiên xác thực đã được dùng. Vui lòng đăng nhập lại." };
    }

    // Kiểm lại trạng thái tài khoản: nó có thể vừa bị khoá trong vài giây giữa
    // bước nhập mật khẩu và bước nhập mã.
    user = await authService.completeTwoFactorLogin(ticket.sub);
  } catch (error) {
    // Mọi lỗi nghiệp vụ (mã sai, quá số lần thử, tài khoản vừa bị khoá hoặc
    // tạm ngưng) đều có câu hiển thị được.
    if (error instanceof DomainError) {
      return { error: error.message, ...retry };
    }
    logger.error("Xác minh 2FA thất bại", error, { userId: ticket.sub });
    return { error: "Không thể xác minh lúc này. Vui lòng thử lại." };
  }

  await resetRateLimit(limit.key);
  await clearPendingTwoFactor();
  await createSession({
    typ: "access" as const,
    sub: user.id,
    email: user.email,
    roles: user.roles,
    mfa: new Date().toISOString(),
  });

  await auditService.record({
    action: AUDIT_ACTIONS.LOGIN_SUCCEEDED,
    entity: "user",
    entityId: user.id,
    actorId: user.id,
    actorEmail: user.email,
    metadata: { method: "2fa", firstFactor: pending ? "oauth" : "password", surface: "web" },
    ip: await actionClientIp(),
    userAgent: await userAgent(),
  });

  // `?next=` LUÔN THẮNG — xem `loginAction`. Luồng OAuth mang `next` trong
  // cookie cùng với vé (đã qua `safeRedirectPath` ở bước `start`).
  const next = formData.get("next");
  const requested = typeof next === "string" && next ? next : (pending?.next ?? "");
  const destination = requested || (await landingPathFor(user.id));

  // redirect() hoạt động bằng cách ném exception — phải nằm ngoài mọi try/catch.
  redirect(safeRedirectPath(destination, "/"));
}

export async function registerAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.register, RATE_LIMITS.register);
  const values = { email: text(formData, "email"), fullName: text(formData, "fullName") };

  if (!limit.success) {
    return {
      error: `Bạn đã tạo quá nhiều tài khoản. Vui lòng đợi ${limit.retryAfterSeconds} giây.`,
      values,
    };
  }

  const parsed = registerSchema.safeParse(
    {
      email: formData.get("email"),
      password: formData.get("password"),
      fullName: formData.get("fullName") || undefined,
    },
    { error: formErrorMap(AUTH_FIELD_LABELS) },
  );

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  let user;
  try {
    user = await authService.register(parsed.data);
  } catch (error) {
    if (error instanceof DuplicateFieldError) {
      return { error: error.message, values };
    }
    logger.error("Registration failed", error, { email: parsed.data.email });
    return { error: "Không thể tạo tài khoản lúc này. Vui lòng thử lại.", values };
  }

  await createSession({
    typ: "access" as const,
    sub: user.id,
    email: user.email,
    roles: user.roles,
  });
  logger.info("User registered", { userId: user.id });

  /*
   * Trước đây là `redirect("/users")` — trang CHỈ quản trị mới xem được, nên
   * MỌI người vừa đăng ký đều nhận ngay một trang 404. Giờ theo đúng luật của
   * đăng nhập: `?next=` thắng (khách đang đặt sân dở thì về lại đó), không có
   * thì về màn của vai — với tài khoản mới là trang chủ.
   */
  const next = formData.get("next");
  const destination = typeof next === "string" && next ? next : await landingPathFor(user.id);

  redirect(safeRedirectPath(destination, "/"));
}

// ---------------------------------------------------------------------------
// Quên mật khẩu / đặt lại mật khẩu / xác thực email
//
// Ba action dưới đây là cửa vào phía WEB cho những luồng mà trước đó chỉ có
// REST API. Link trong email trỏ tới `/verify-email` và `/reset-password`;
// thiếu chúng thì người dùng bấm link trong thư và nhận 404.
//
// Đăng xuất của web KHÔNG nằm ở đây mà ở `src/app/logout-action.ts`.
// ---------------------------------------------------------------------------

/**
 * Gửi link đặt lại mật khẩu.
 *
 * Trả về ĐÚNG MỘT thông điệp cho mọi kết cục — email tồn tại, không tồn tại,
 * hay việc gửi thư thất bại. Đây là endpoint công khai, nên bất kỳ khác biệt
 * nào cũng biến nó thành công cụ dò danh sách người dùng.
 *
 * Kể cả lỗi thật cũng bị nuốt, vì để nó bung ra thành thông báo lỗi thì chính
 * thông báo đó là tín hiệu: lỗi gửi thư chỉ xảy ra khi email có thật.
 */
export async function forgotPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = await rateLimitAction(
    RATE_LIMIT_BUCKETS.passwordResetRequest,
    RATE_LIMITS.passwordResetRequest,
  );
  const values = { email: text(formData, "email") };

  if (!limit.success) {
    return {
      error: `Bạn đã yêu cầu quá nhiều lần. Vui lòng đợi ${limit.retryAfterSeconds} giây.`,
      values,
    };
  }

  const parsed = forgotPasswordSchema.safeParse(
    { email: formData.get("email") },
    { error: formErrorMap(AUTH_FIELD_LABELS) },
  );

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };
  }

  try {
    await authService.requestPasswordReset(parsed.data.email);
  } catch (error) {
    logger.error("Không gửi được email đặt lại mật khẩu", error);
  }

  return {
    success: "Nếu địa chỉ này có tài khoản, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu.",
  };
}

/**
 * Đặt mật khẩu mới bằng token trong email.
 *
 * Service vô hiệu MỌI phiên cấp trước lúc đổi — refresh token lẫn cookie web
 * ở mọi trình duyệt (`securityStampService`). Xoá thêm cookie của trình duyệt
 * ĐANG thao tác để người dùng thấy rõ phải đăng nhập lại bằng mật khẩu mới,
 * thay vì một cookie đã chết vẫn nằm đó.
 */
export async function resetPasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.passwordReset, RATE_LIMITS.passwordChange);

  if (!limit.success) {
    return {
      error: `Bạn đã thử quá nhiều lần. Vui lòng đợi ${limit.retryAfterSeconds} giây.`,
    };
  }

  const parsed = resetPasswordSchema.safeParse(
    { token: formData.get("token"), password: formData.get("password") },
    { error: formErrorMap(AUTH_FIELD_LABELS) },
  );

  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;

    // Token nằm trong URL chứ không phải ô người dùng nhập được, nên báo lỗi
    // theo field cho nó là vô nghĩa — không có ô nào để sửa.
    if (fieldErrors.token) {
      return { error: "Liên kết không hợp lệ. Hãy yêu cầu gửi lại email." };
    }
    return { fieldErrors };
  }

  let userId;
  try {
    userId = await authService.resetPassword(parsed.data.token, parsed.data.password);
  } catch (error) {
    if (error instanceof InvalidVerificationTokenError) {
      return { error: error.message };
    }
    logger.error("Reset password failed", error);
    return { error: "Không thể đặt lại mật khẩu lúc này. Vui lòng thử lại." };
  }

  await auditService.record({
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    entity: "user",
    entityId: userId,
    actorId: userId,
    metadata: { surface: "web" },
    ip: await actionClientIp(),
    userAgent: await userAgent(),
  });

  await destroySession();
  logger.info("Web reset password thành công", { userId });

  redirect("/login?reset=1");
}

/**
 * Xác thực địa chỉ email.
 *
 * ⚠️ Cố ý là một ACTION (POST) chứ không phải việc xảy ra khi mở trang.
 *
 * Token dùng một lần. Nếu tiêu thụ nó ngay lúc GET, thì bộ quét link của
 * Gmail/Outlook — vốn tự mở mọi URL trong thư để kiểm tra an toàn — sẽ đốt
 * mất token trước khi người dùng kịp bấm. Người dùng bấm vào và nhận "liên
 * kết đã hết hạn", còn log thì cho thấy nó vừa được dùng thành công.
 *
 * Nên: mở trang chỉ hiện một nút, tiêu thụ token khi người dùng bấm.
 */
export async function verifyEmailAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.emailVerify, RATE_LIMITS.passwordChange);

  if (!limit.success) {
    return {
      error: `Bạn đã thử quá nhiều lần. Vui lòng đợi ${limit.retryAfterSeconds} giây.`,
    };
  }

  const parsed = verifyEmailSchema.safeParse({ token: formData.get("token") });

  if (!parsed.success) {
    return { error: "Liên kết không hợp lệ hoặc đã hết hạn." };
  }

  try {
    const user = await authService.verifyEmail(parsed.data.token);
    logger.info("Web verify email", { userId: user.id });
  } catch (error) {
    if (error instanceof InvalidVerificationTokenError) {
      return { error: error.message };
    }
    logger.error("Verify email failed", error);
    return { error: "Không thể xác thực email lúc này. Vui lòng thử lại." };
  }

  return { success: "Địa chỉ email của bạn đã được xác thực." };
}

/**
 * Xác nhận đổi email bằng token trong link.
 *
 * Không đòi đăng nhập: người dùng bấm link từ hộp thư MỚI, có thể trên một
 * trình duyệt khác. Token dùng-một-lần đã mang danh tính rồi.
 *
 * Như `/verify-email`, trang chỉ xác nhận khi BẤM NÚT chứ không khi mở — bộ
 * quét link của Gmail sẽ đốt mất token trước khi người dùng kịp bấm.
 */
export async function confirmEmailChangeAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const limit = await rateLimitAction(
    RATE_LIMIT_BUCKETS.emailChangeConfirm,
    RATE_LIMITS.emailVerificationRequest,
  );

  if (!limit.success) {
    return { error: `Bạn đã thử quá nhiều lần. Vui lòng đợi ${limit.retryAfterSeconds} giây.` };
  }

  const parsed = confirmEmailChangeSchema.safeParse({ token: formData.get("token") });

  if (!parsed.success) {
    return { error: "Liên kết không hợp lệ hoặc đã hết hạn." };
  }

  try {
    const user = await authService.confirmEmailChange(parsed.data.token);

    await auditService.record({
      action: AUDIT_ACTIONS.EMAIL_CHANGED,
      entity: "user",
      entityId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { surface: "web" },
      ip: await actionClientIp(),
      userAgent: await userAgent(),
    });

    return {
      success: `Email đã đổi thành ${user.email ?? ""}. Lần đăng nhập sau hãy dùng địa chỉ mới.`,
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    logger.error("Xác nhận đổi email thất bại", error);
    return { error: "Không thể xác nhận lúc này. Vui lòng thử lại." };
  }
}
