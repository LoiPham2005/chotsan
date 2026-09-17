import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { CryptoUtils } from "@/lib/crypto";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/encryption";
import { createTotpSecret, totpTimeStep, verifyTotp } from "@/lib/totp";
import { generateRecoveryCode, hashScopedToken, normalizeRecoveryCode } from "@/lib/opaque-token";
import { cacheGet, cacheSet } from "@/lib/cache";
import { claimOnce, RATE_LIMITS, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import {
  InvalidCredentialsError,
  InvalidTwoFactorCodeError,
  ProviderNotConfiguredError,
  TooManyTwoFactorAttemptsError,
  TwoFactorAlreadyEnabledError,
  TwoFactorNotEnabledError,
  UserNotFoundError,
} from "@/lib/errors";

/**
 * Xác thực hai lớp bằng TOTP (Google Authenticator, Authy, 1Password…).
 *
 * ---
 * LUỒNG BẬT 2FA — BA BƯỚC, KHÔNG PHẢI MỘT
 *
 *   1. `beginSetup()`  → sinh bí mật, trả URI để dựng QR. **CHƯA bật.**
 *   2. Người dùng quét QR bằng app xác thực.
 *   3. `confirmSetup(code)` → mã đúng thì mới thật sự bật, và trả về mã khôi phục.
 *
 * Bước 3 không phải thủ tục thừa: nó chứng minh app xác thực ĐÃ lưu đúng bí
 * mật. Bật ngay từ bước 1 thì người quét QR hỏng sẽ bị khoá vĩnh viễn khỏi tài
 * khoản của chính mình — và đó là kịch bản thường gặp, không phải hiếm.
 *
 * ---
 * MÃ KHÔI PHỤC
 *
 * Cấp một lần duy nhất, hiển thị đúng một lần, lưu dưới dạng băm. Không có
 * chúng thì "mất điện thoại = mất tài khoản", và người dùng sẽ không bật 2FA.
 *
 * Băm KÈM `userId` (`hashScopedToken`) vì mã khôi phục ngắn hơn token trong
 * email — 50 bit là đủ để không dò được, nhưng chưa đủ để coi va chạm là không
 * thể.
 *
 * ---
 * BA CHỐT CHỐNG DÒ VÀ PHÁT LẠI MÃ
 *
 *   1. Bộ đếm theo TÀI KHOẢN (`RATE_LIMITS.twoFactorAccount`), chung cho web,
 *      API, và cả tắt 2FA/cấp lại mã. Rate limit theo IP không cản được kẻ dò
 *      xoay IP; bộ đếm này thì có. Vượt ngưỡng là chặn cả mã ĐÚNG tới hết cửa
 *      sổ; nhập đúng thì đếm lại từ đầu.
 *   2. Nhớ BƯỚC THỜI GIAN của mã TOTP đã dùng (cache ~90 giây, đúng bằng thời
 *      gian một mã còn hợp lệ). Không nhớ thì ai nhìn trộm được mã đăng nhập
 *      lại được bằng chính mã đó trong cửa sổ ±30 giây.
 *   3. Mã khôi phục dùng một lần — đánh dấu nguyên tử trong database.
 *
 * ---
 * KHÔNG CÓ "THIẾT BỊ TIN CẬY"
 *
 * Cố ý bỏ tính năng "đừng hỏi mã trên máy này trong 30 ngày". Nó là một cơ chế
 * BỎ QUA 2FA: thêm một credential dài hạn nữa để đánh cắp, và làm rỗng phần
 * lớn giá trị của lớp bảo vệ vừa dựng. Dự án nào cần thì thêm sau, có cân nhắc
 * — bộ khung không bật sẵn một đường vòng.
 */
export type TwoFactorSetup = {
  /** Bí mật base32 — hiển thị cho người dùng nhập tay khi không quét được QR. */
  secret: string;
  /** URI `otpauth://` để dựng mã QR. ⚠️ Chứa bí mật, đừng ghi vào log. */
  uri: string;
};

export type TwoFactorStatus = {
  enabled: boolean;
  enabledAt: Date | null;
  /** Số mã khôi phục CHƯA dùng. Dưới 3 thì giao diện nên nhắc cấp lại. */
  remainingRecoveryCodes: number;
};

/** Số mã khôi phục cấp mỗi lần. 10 là mức chuẩn của hầu hết dịch vụ lớn. */
const RECOVERY_CODE_COUNT = 10;

/**
 * Giữ dấu bước TOTP đã dùng bao lâu: bước hiện tại + một bước mỗi bên của cửa
 * sổ xác minh = 90 giây. Sau đó mã đã tự hết hạn, không cần nhớ nữa.
 */
const USED_STEP_TTL_SECONDS = 90;

export class TwoFactorService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /** `true` khi hệ thống đủ điều kiện chạy 2FA (đã có khoá mã hoá). */
  isAvailable(): boolean {
    return isEncryptionConfigured();
  }

  async status(userId: string): Promise<TwoFactorStatus> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        twoFactorEnabledAt: true,
        _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
      },
    });

    if (!user) throw new UserNotFoundError(userId);

    return {
      enabled: user.twoFactorEnabledAt !== null,
      enabledAt: user.twoFactorEnabledAt,
      remainingRecoveryCodes: user._count.recoveryCodes,
    };
  }

  /**
   * Bước 1: sinh bí mật và trả về URI để quét.
   *
   * Ghi bí mật vào database ngay (đã mã hoá) nhưng KHÔNG đặt
   * `twoFactorEnabledAt` — trạng thái "đang cài dở". Phải lưu vì bước xác nhận
   * là một request khác, và giữ nó trong RAM giữa hai request thì hỏng ngay
   * khi chạy từ hai instance.
   *
   * Gọi lại nhiều lần thì bí mật cũ bị GHI ĐÈ: người dùng quét nhầm rồi làm
   * lại là chuyện bình thường, và để lại bí mật mồ côi chỉ tạo nhầm lẫn.
   */
  async beginSetup(userId: string): Promise<TwoFactorSetup> {
    // Kiểm TRƯỚC khi đọc gì: thiếu `ENCRYPTION_KEY` thì `encryptSecret` ném
    // `Error` thường, và API trả 500 "thử lại" cho một lỗi mà thử lại bao
    // nhiêu lần cũng vậy — thứ cần làm là thêm một dòng vào `.env`.
    if (!this.isAvailable()) {
      throw new ProviderNotConfiguredError("xác thực hai lớp (máy chủ chưa đặt ENCRYPTION_KEY)");
    }

    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true, username: true, twoFactorEnabledAt: true },
    });

    if (!user) throw new UserNotFoundError(userId);
    if (user.twoFactorEnabledAt) throw new TwoFactorAlreadyEnabledError();

    const label = user.email ?? user.username ?? userId;
    const setup = createTotpSecret(env.APP_NAME, label);

    await this.db.user.update({
      where: { id: userId },
      data: { twoFactorSecret: encryptSecret(setup.secret) },
    });

    return setup;
  }

  /**
   * Bước 3: xác nhận và bật thật.
   *
   * Trả về danh sách mã khôi phục — đây là LẦN DUY NHẤT chúng tồn tại ở dạng
   * đọc được. Nơi gọi phải hiển thị ngay và nhắc người dùng lưu lại.
   */
  async confirmSetup(userId: string, code: string): Promise<string[]> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { twoFactorSecret: true, twoFactorEnabledAt: true },
    });

    if (!user) throw new UserNotFoundError(userId);
    if (user.twoFactorEnabledAt) throw new TwoFactorAlreadyEnabledError();
    if (!user.twoFactorSecret) throw new TwoFactorNotEnabledError();

    if (!(await this.acceptTotp(userId, this.decrypt(user.twoFactorSecret), code))) {
      throw new InvalidTwoFactorCodeError();
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { twoFactorEnabledAt: new Date() },
      }),
      // Xoá mã cũ trước: gọi lại luồng cài đặt không được để lại mã của lần
      // trước còn dùng được.
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.recoveryCode.createMany({
        data: codes.map((code) => ({
          userId,
          codeHash: hashScopedToken(userId, normalizeRecoveryCode(code)),
        })),
      }),
    ]);

    logger.info("Đã bật xác thực hai lớp", { userId });
    return codes;
  }

  /**
   * Kiểm tra mã lúc đăng nhập. Chấp nhận CẢ mã TOTP lẫn mã khôi phục.
   *
   * Thử TOTP trước vì đó là đường đi thường ngày; mã khôi phục là ngoại lệ.
   *
   * Mã khôi phục được đánh dấu đã dùng bằng `updateMany` có điều kiện
   * `usedAt: null` — cùng lý do với `VerificationService.consume`: hai request
   * song song với cùng một mã thì chỉ một cái được đi tiếp.
   *
   * @throws {TooManyTwoFactorAttemptsError} khi tài khoản đã nhập quá số lần
   * trong cửa sổ — kể cả khi lần này mã ĐÚNG.
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    /*
     * Đếm LẦN THỬ trước khi kiểm, không đếm lần sai sau khi kiểm: INCR nguyên
     * tử thì 20 request song song bị tính đủ 20. "Kiểm rồi mới tăng số lần
     * sai" thì cả 20 cùng đọc thấy 0 lần sai và cùng được thử.
     */
    const attemptKey = `2fa-account:${userId}`;
    const attempt = await rateLimit(attemptKey, RATE_LIMITS.twoFactorAccount);
    if (!attempt.success) throw new TooManyTwoFactorAttemptsError(attempt.retryAfterSeconds);

    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { twoFactorSecret: true, twoFactorEnabledAt: true },
    });

    if (!user?.twoFactorEnabledAt || !user.twoFactorSecret) return false;

    const valid =
      (await this.acceptTotp(userId, this.decrypt(user.twoFactorSecret), code)) ||
      (await this.consumeRecoveryCode(userId, code));

    // Nhập đúng thì đếm lại từ đầu — không bắt người dùng trả giá cho những
    // lần gõ nhầm đã qua.
    if (valid) await resetRateLimit(attemptKey);

    return valid;
  }

  /**
   * Mã TOTP đúng VÀ chưa từng được dùng.
   *
   * Hai lớp nhớ, mỗi lớp chặn một kiểu:
   *   • `claimOnce` theo bước thời gian — nguyên tử, nên hai request cùng nộp
   *     MỘT mã thì chỉ một bên qua.
   *   • Bước lớn nhất đã dùng — mã của bước CŨ hơn (vẫn nằm trong cửa sổ ±1)
   *     không dùng được sau khi mã mới hơn đã được nhận (RFC 6238 §5.2).
   */
  private async acceptTotp(userId: string, secret: string, code: string): Promise<boolean> {
    const now = Date.now();
    const delta = verifyTotp(secret, code, now);
    if (delta === null) return false;

    const step = totpTimeStep(delta, now);
    const lastKey = `totp:last-step:${userId}`;
    const lastStep = await cacheGet<number>(lastKey);

    if (lastStep !== null && step <= lastStep) {
      logger.warn("Mã TOTP bị nộp lại hoặc cũ hơn mã đã dùng", { userId });
      return false;
    }

    if (!(await claimOnce(`totp:${userId}:${step}`, USED_STEP_TTL_SECONDS))) {
      logger.warn("Mã TOTP bị nộp lại hoặc cũ hơn mã đã dùng", { userId });
      return false;
    }

    await cacheSet(lastKey, step, USED_STEP_TTL_SECONDS);
    return true;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);

    // Định dạng mã khôi phục là 10 ký tự; mã TOTP là 6 chữ số. Chặn sớm để một
    // mã TOTP sai không phải đi qua một truy vấn database vô ích.
    if (normalized.length !== 10) return false;

    const claimed = await this.db.recoveryCode.updateMany({
      where: { userId, codeHash: hashScopedToken(userId, normalized), usedAt: null },
      data: { usedAt: new Date() },
    });

    if (claimed.count > 0) {
      // Phải nhìn thấy được: dùng mã khôi phục nghĩa là người dùng mất quyền
      // truy cập app xác thực — hoặc ai đó đang dùng mã lấy trộm được.
      logger.warn("Đăng nhập bằng MÃ KHÔI PHỤC 2FA", { userId });
      return true;
    }

    return false;
  }

  /**
   * Tắt 2FA. Bắt nhập lại MẬT KHẨU và một mã hợp lệ.
   *
   * Hai lớp có chủ đích: ai ngồi vào máy đang mở sẵn phiên không được phép gỡ
   * lớp bảo vệ chỉ bằng một cú bấm. Tài khoản chưa có mật khẩu (đăng nhập qua
   * OAuth) thì bỏ qua vế mật khẩu — không có gì để kiểm.
   */
  async disable(userId: string, password: string | null, code: string): Promise<void> {
    const user = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { password: true, twoFactorEnabledAt: true },
    });

    if (!user) throw new UserNotFoundError(userId);
    if (!user.twoFactorEnabledAt) throw new TwoFactorNotEnabledError();

    if (user.password) {
      if (!password) throw new InvalidCredentialsError();

      const check = await CryptoUtils.verifyPassword(password, user.password);
      if (!check.valid) throw new InvalidCredentialsError();
    }

    if (!(await this.verifyCode(userId, code))) throw new InvalidTwoFactorCodeError();

    await this.db.$transaction([
      this.db.user.update({
        where: { id: userId },
        data: { twoFactorSecret: null, twoFactorEnabledAt: null },
      }),
      this.db.recoveryCode.deleteMany({ where: { userId } }),
    ]);

    logger.warn("Đã TẮT xác thực hai lớp", { userId });
  }

  /**
   * Cấp lại bộ mã khôi phục. Mã cũ mất hiệu lực ngay.
   *
   * Dùng khi người dùng đã tiêu gần hết mã, hoặc nghi tờ giấy chép mã bị lộ.
   */
  async regenerateRecoveryCodes(userId: string, code: string): Promise<string[]> {
    const status = await this.status(userId);
    if (!status.enabled) throw new TwoFactorNotEnabledError();

    if (!(await this.verifyCode(userId, code))) throw new InvalidTwoFactorCodeError();

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());

    await this.db.$transaction([
      this.db.recoveryCode.deleteMany({ where: { userId } }),
      this.db.recoveryCode.createMany({
        data: codes.map((item) => ({
          userId,
          codeHash: hashScopedToken(userId, normalizeRecoveryCode(item)),
        })),
      }),
    ]);

    logger.info("Đã cấp lại mã khôi phục 2FA", { userId });
    return codes;
  }

  /**
   * Giải mã bí mật. Lỗi giải mã KHÔNG được lộ ra ngoài dưới dạng 500.
   *
   * Nó xảy ra khi `ENCRYPTION_KEY` bị đổi sau khi đã có dữ liệu — một sự cố
   * vận hành, không phải lỗi của người đang đăng nhập. Họ nhận "mã không đúng"
   * và liên hệ hỗ trợ; log giữ nguyên nguyên nhân thật.
   */
  private decrypt(encrypted: string): string {
    try {
      return decryptSecret(encrypted);
    } catch (error) {
      logger.error(
        "Không giải mã được khoá 2FA — ENCRYPTION_KEY có thể đã bị đổi sau khi có dữ liệu",
        error,
      );
      throw new InvalidTwoFactorCodeError();
    }
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const twoFactorService = new TwoFactorService();
