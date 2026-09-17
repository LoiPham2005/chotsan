"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { actionClientIp, defineAuthedAction, rateLimitAction } from "@/lib/define-action";
import { DomainError, DuplicateFieldError, InvalidCredentialsError } from "@/lib/errors";
import { formErrorMap } from "@/lib/form-errors";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_BUCKETS, RATE_LIMITS } from "@/lib/rate-limit";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { changePasswordSchema, requestEmailChangeSchema } from "@/schemas/auth.schema";
import { auditService } from "@/services/audit.service";
import { authService } from "@/services/auth.service";
import { twoFactorService } from "@/services/two-factor.service";
import { webauthnService } from "@/services/webauthn.service";

/**
 * Thao tác tự phục vụ trên chính tài khoản đang đăng nhập.
 *
 * Dùng `defineAuthedAction` chứ không `defineAction`: không cần quyền quản trị
 * nào. Nhưng vẫn phải bọc — Server Action là endpoint công khai, ai cũng POST
 * thẳng tới action id được mà không đi qua trang này.
 *
 * ---
 * RATE LIMIT CHUNG XÔ VỚI REST API
 *
 * Mỗi luồng ở đây có bản REST tương ứng (`/auth/change-password`,
 * `/auth/2fa/*`…) và đếm vào CÙNG xô theo IP (`rateLimitAction`). Action không
 * giới hạn thì giới hạn của API vô nghĩa: kẻ dò mật khẩu hiện tại chỉ cần đổi
 * sang gọi action.
 */

/** Form trên `/security`: lỗi chung, lỗi từng ô, hoặc câu báo thành công. */
export type SecurityFormState = {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /**
   * Chữ vừa gửi, trả lại KÈM LỖI — React 19 xoá trắng form sau action, kể cả khi
   * báo lỗi. ⚠️ Không bao giờ chứa mật khẩu.
   */
  values?: { newEmail?: string };
};

/** Tên ô người dùng nhìn thấy — để câu lỗi nói đúng ô nào sai. */
const SECURITY_FIELD_LABELS = {
  currentPassword: "Mật khẩu hiện tại",
  newPassword: "Mật khẩu mới",
  newEmail: "Email mới",
  password: "Mật khẩu hiện tại",
} as const;

function tooManyAttempts(retryAfterSeconds: number): { error: string } {
  return { error: `Bạn đã thử quá nhiều lần. Vui lòng đợi ${retryAfterSeconds} giây.` };
}

/**
 * Đổi mật khẩu khi đang đăng nhập.
 *
 * Service vô hiệu MỌI phiên cấp trước lúc đổi — kể cả cookie trình duyệt này
 * đang dùng. Action cấp lại cookie cho CHÍNH trình duyệt này ngay sau đó, nên
 * người vừa đổi không bị đá ra; các thiết bị khác thì bị đăng xuất — đúng điều
 * người đổi mật khẩu vì nghi bị lộ cần.
 */
export const changePasswordAction = defineAuthedAction(
  async (ctx, _prev: SecurityFormState, formData: FormData): Promise<SecurityFormState> => {
    const limit = await rateLimitAction(
      RATE_LIMIT_BUCKETS.passwordChange,
      RATE_LIMITS.passwordChange,
    );
    if (!limit.success) return tooManyAttempts(limit.retryAfterSeconds);

    const parsed = changePasswordSchema.safeParse(
      {
        currentPassword: formData.get("currentPassword"),
        newPassword: formData.get("newPassword"),
      },
      { error: formErrorMap(SECURITY_FIELD_LABELS) },
    );
    if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

    try {
      await authService.changePassword(
        ctx.actorId,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
    } catch (error) {
      // Câu của lỗi này nói về ĐĂNG NHẬP; ở đây người dùng cần biết đúng ô sai.
      if (error instanceof InvalidCredentialsError) {
        return { fieldErrors: { currentPassword: ["Mật khẩu hiện tại không đúng"] } };
      }
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không đổi được mật khẩu", error, { userId: ctx.actorId });
      return { error: "Không thể đổi mật khẩu lúc này. Vui lòng thử lại." };
    }

    /*
     * Cấp cookie SAU khi đổi: `iat` mới (giây) ≥ mốc `passwordChangedAt` (so ở
     * độ phân giải giây), nên cookie này qua phép kiểm thu hồi còn cookie cũ —
     * và mọi bản sao của nó — thì không. Giữ `mfa`: phiên đã qua 2FA, đổi mật
     * khẩu không phải lý do bắt nhập lại mã.
     */
    await createSession({
      typ: "access",
      sub: ctx.session.sub,
      email: ctx.session.email,
      roles: ctx.session.roles,
      ...(ctx.session.sid ? { sid: ctx.session.sid } : {}),
      ...(ctx.session.mfa ? { mfa: ctx.session.mfa } : {}),
    });

    await auditService.record({
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      entity: "user",
      entityId: ctx.actorId,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { surface: "web" },
      ip: await actionClientIp(),
    });

    return { success: "Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất." };
  },
);

/**
 * Gửi lại email xác thực cho CHÍNH tài khoản này.
 *
 * Địa chỉ nhận lấy từ tài khoản, không lấy từ form — cho chọn địa chỉ nhận là
 * biến nút này thành công cụ dội thư tới bất kỳ ai.
 */
export const resendVerificationEmailAction = defineAuthedAction(
  async (ctx, _prev: SecurityFormState): Promise<SecurityFormState> => {
    const limit = await rateLimitAction(
      RATE_LIMIT_BUCKETS.emailVerificationRequest,
      RATE_LIMITS.emailVerificationRequest,
    );
    if (!limit.success) {
      return {
        error: `Đã gửi nhiều lần. Vui lòng đợi ${limit.retryAfterSeconds} giây rồi thử lại.`,
      };
    }

    try {
      await authService.sendEmailVerification(ctx.actorId);
    } catch (error) {
      logger.error("Không gửi lại được email xác thực", error, { userId: ctx.actorId });
      return { error: "Không gửi được email lúc này. Vui lòng thử lại." };
    }

    return {
      success: "Đã gửi. Mở hộp thư (cả mục Thư rác) và bấm liên kết trong thư để xác thực.",
    };
  },
);

/**
 * Xin đổi email. Email CHỈ đổi khi liên kết gửi tới địa chỉ mới được bấm; tới
 * lúc đó trang hiện địa chỉ đang chờ (`pendingEmail`).
 */
export const requestEmailChangeAction = defineAuthedAction(
  async (ctx, _prev: SecurityFormState, formData: FormData): Promise<SecurityFormState> => {
    const limit = await rateLimitAction(
      RATE_LIMIT_BUCKETS.emailChangeRequest,
      RATE_LIMITS.emailVerificationRequest,
    );
    const rawEmail = formData.get("newEmail");
    const values = { newEmail: typeof rawEmail === "string" ? rawEmail : "" };

    if (!limit.success) return { ...tooManyAttempts(limit.retryAfterSeconds), values };

    const parsed = requestEmailChangeSchema.safeParse(
      { newEmail: formData.get("newEmail"), password: formData.get("password") },
      { error: formErrorMap(SECURITY_FIELD_LABELS) },
    );
    if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, values };

    try {
      await authService.requestEmailChange(ctx.actorId, parsed.data.newEmail, parsed.data.password);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return { fieldErrors: { password: ["Mật khẩu hiện tại không đúng"] }, values };
      }
      if (error instanceof DuplicateFieldError) {
        return { fieldErrors: { newEmail: ["Email này đã thuộc về một tài khoản khác"] }, values };
      }
      if (error instanceof DomainError) return { error: error.message, values };
      logger.error("Không xin đổi được email", error, { userId: ctx.actorId });
      return { error: "Không thể đổi email lúc này. Vui lòng thử lại.", values };
    }

    await auditService.record({
      action: AUDIT_ACTIONS.EMAIL_CHANGE_REQUESTED,
      entity: "user",
      entityId: ctx.actorId,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { newEmail: parsed.data.newEmail, surface: "web" },
      ip: await actionClientIp(),
    });

    revalidatePath("/security");
    return {
      success: `Đã gửi liên kết xác nhận tới ${parsed.data.newEmail}. Email chỉ đổi sau khi bạn bấm liên kết đó.`,
    };
  },
);

/** Bước 1 — sinh bí mật và URI cho QR. CHƯA bật gì cả. */
export const beginTwoFactorSetupAction = defineAuthedAction(
  async (ctx): Promise<{ error?: string; secret?: string; uri?: string }> => {
    try {
      return await twoFactorService.beginSetup(ctx.actorId);
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không bắt đầu được thiết lập 2FA", error, { userId: ctx.actorId });
      return { error: "Không thể thiết lập 2FA lúc này." };
    }
  },
);

/**
 * Bước 3 — xác nhận mã và bật thật.
 *
 * Bước này không phải thủ tục thừa: nó chứng minh app xác thực ĐÃ lưu đúng bí
 * mật. Bật ngay từ bước 1 thì người quét QR hỏng sẽ bị khoá vĩnh viễn khỏi tài
 * khoản của chính mình.
 */
export const enableTwoFactorAction = defineAuthedAction(
  async (ctx, code: string): Promise<{ error?: string; recoveryCodes?: string[] }> => {
    const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.twoFactor, RATE_LIMITS.twoFactor);
    if (!limit.success) return tooManyAttempts(limit.retryAfterSeconds);

    try {
      const recoveryCodes = await twoFactorService.confirmSetup(ctx.actorId, code);

      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_ENABLED,
        entity: "user",
        entityId: ctx.actorId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");

      // ⚠️ Lần DUY NHẤT mã khôi phục tồn tại ở dạng đọc được.
      return { recoveryCodes };
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không bật được 2FA", error, { userId: ctx.actorId });
      return { error: "Không thể bật 2FA lúc này." };
    }
  },
);

export const disableTwoFactorAction = defineAuthedAction(
  async (ctx, password: string, code: string): Promise<{ error?: string }> => {
    // Service kiểm MẬT KHẨU trước mã — không có trần này, form tắt 2FA là chỗ
    // dò mật khẩu không giới hạn cho ai đang cầm một phiên mở sẵn.
    const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.twoFactor, RATE_LIMITS.twoFactor);
    if (!limit.success) return tooManyAttempts(limit.retryAfterSeconds);

    try {
      await twoFactorService.disable(ctx.actorId, password || null, code);

      // Tắt 2FA là hành động HẠ mức bảo vệ — phải nằm trong nhật ký để sau này
      // còn trả lời được "ai tắt, lúc nào".
      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_DISABLED,
        entity: "user",
        entityId: ctx.actorId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");
      return {};
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không tắt được 2FA", error, { userId: ctx.actorId });
      return { error: "Không thể tắt 2FA lúc này." };
    }
  },
);

export const regenerateRecoveryCodesAction = defineAuthedAction(
  async (ctx, code: string): Promise<{ error?: string; recoveryCodes?: string[] }> => {
    const limit = await rateLimitAction(RATE_LIMIT_BUCKETS.twoFactor, RATE_LIMITS.twoFactor);
    if (!limit.success) return tooManyAttempts(limit.retryAfterSeconds);

    try {
      const recoveryCodes = await twoFactorService.regenerateRecoveryCodes(ctx.actorId, code);

      await auditService.record({
        action: AUDIT_ACTIONS.TWO_FACTOR_RECOVERY_REGENERATED,
        entity: "user",
        entityId: ctx.actorId,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");
      return { recoveryCodes };
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không cấp lại được mã khôi phục", error, { userId: ctx.actorId });
      return { error: "Không thể cấp lại mã khôi phục lúc này." };
    }
  },
);

export const removePasskeyAction = defineAuthedAction(
  async (ctx, id: string): Promise<{ error?: string }> => {
    try {
      // Service từ chối nếu đây là cách đăng nhập CUỐI CÙNG — xoá được thì
      // người dùng tự khoá mình ra ngoài vĩnh viễn.
      await webauthnService.remove(id, ctx.actorId);

      await auditService.record({
        action: AUDIT_ACTIONS.PASSKEY_REMOVED,
        entity: "webauthn_credential",
        entityId: id,
        actorId: ctx.actorId,
        actorEmail: ctx.session.email,
      });

      revalidatePath("/security");
      return {};
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      logger.error("Không xoá được passkey", error, { userId: ctx.actorId });
      return { error: "Không thể xoá passkey lúc này." };
    }
  },
);
