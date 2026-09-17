import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOTP, Secret } from "otpauth";
import type { PrismaClient } from "@prisma/client";
import { TwoFactorService } from "./two-factor.service";
import { __clearCache } from "@/lib/cache";
import { encryptSecret } from "@/lib/encryption";
import { __clearRateLimits } from "@/lib/rate-limit";
import { createTotpSecret } from "@/lib/totp";
import { hashScopedToken, normalizeRecoveryCode } from "@/lib/opaque-token";
import {
  InvalidCredentialsError,
  InvalidTwoFactorCodeError,
  ProviderNotConfiguredError,
  TooManyTwoFactorAttemptsError,
  TwoFactorAlreadyEnabledError,
  TwoFactorNotEnabledError,
} from "@/lib/errors";

function codeFor(secret: string): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

function createDb(user: unknown, overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
    },
    recoveryCode: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PrismaClient;
}

describe("TwoFactorService", () => {
  beforeEach(async () => {
    // Bộ đếm lần thử và dấu "bước TOTP đã dùng" nằm trong store dùng chung
    // theo userId. Không dọn thì mã hợp lệ ở bài sau bị coi là mã nộp lại của
    // bài trước.
    await __clearRateLimits();
    await __clearCache();
  });

  describe("bật 2FA", () => {
    it("beginSetup lưu bí mật ĐÃ MÃ HOÁ, chưa bật", async () => {
      // Bí mật TOTP sinh ra được mã hợp lệ — lưu thô là một lần rò database
      // làm 2FA mất tác dụng hoàn toàn.
      const db = createDb({ email: "a@b.com", username: null, twoFactorEnabledAt: null });

      const setup = await new TwoFactorService(db).beginSetup("u1");

      const data = vi.mocked(db.user.update).mock.calls[0]![0].data as {
        twoFactorSecret: string;
        twoFactorEnabledAt?: unknown;
      };

      expect(data.twoFactorSecret).not.toBe(setup.secret);
      expect(data.twoFactorSecret).toMatch(/^v1\./);
      // CHƯA bật: người quét QR hỏng không được phép bị khoá khỏi tài khoản.
      expect(data.twoFactorEnabledAt).toBeUndefined();
    });

    it("máy chủ chưa đặt ENCRYPTION_KEY → lỗi CẤU HÌNH, không phải lỗi 500 chung chung", async () => {
      // `Error` thường thì API trả 500 "thử lại" — thử bao nhiêu lần cũng vậy.
      const db = createDb({ email: "a@b.com", username: null, twoFactorEnabledAt: null });
      const service = new TwoFactorService(db);
      vi.spyOn(service, "isAvailable").mockReturnValue(false);

      await expect(service.beginSetup("u1")).rejects.toBeInstanceOf(ProviderNotConfiguredError);
      expect(db.user.update).not.toHaveBeenCalled();
    });

    it("không cho cài lại khi 2FA đã bật", async () => {
      const db = createDb({ email: "a@b.com", username: null, twoFactorEnabledAt: new Date() });

      await expect(new TwoFactorService(db).beginSetup("u1")).rejects.toBeInstanceOf(
        TwoFactorAlreadyEnabledError,
      );
    });

    it("confirmSetup mã ĐÚNG thì bật và trả về 10 mã khôi phục", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb({
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: null,
      });

      const codes = await new TwoFactorService(db).confirmSetup("u1", codeFor(secret));

      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      expect(db.$transaction).toHaveBeenCalledOnce();
    });

    it("confirmSetup mã SAI thì không bật gì cả", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb({ twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: null });

      await expect(new TwoFactorService(db).confirmSetup("u1", "000000")).rejects.toBeInstanceOf(
        InvalidTwoFactorCodeError,
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it("mã khôi phục lưu dưới dạng BĂM, không phải chuỗi gốc", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb({ twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: null });

      const codes = await new TwoFactorService(db).confirmSetup("u1", codeFor(secret));

      const rows = vi.mocked(db.recoveryCode.createMany).mock.calls[0]![0]!.data as Array<{
        codeHash: string;
      }>;

      expect(rows[0]!.codeHash).toBe(hashScopedToken("u1", normalizeRecoveryCode(codes[0]!)));
      expect(JSON.stringify(rows)).not.toContain(codes[0]!);
    });
  });

  describe("xác minh mã", () => {
    it("chấp nhận mã TOTP đúng", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb({
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: new Date(),
      });

      await expect(new TwoFactorService(db).verifyCode("u1", codeFor(secret))).resolves.toBe(true);
    });

    it("chấp nhận mã khôi phục và đánh dấu ĐÃ DÙNG", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb(
        { twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() },
        {
          recoveryCode: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            deleteMany: vi.fn(),
            createMany: vi.fn(),
          },
        },
      );

      await expect(new TwoFactorService(db).verifyCode("u1", "A1B2C-3D4E5")).resolves.toBe(true);

      // Điều kiện `usedAt: null` nằm TRONG câu ghi: hai request song song với
      // cùng một mã thì chỉ một cái được đi tiếp.
      expect(db.recoveryCode.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ usedAt: null }) }),
      );
    });

    it("từ chối mã khôi phục ĐÃ dùng (updateMany trả 0 dòng)", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb({
        twoFactorSecret: encryptSecret(secret),
        twoFactorEnabledAt: new Date(),
      });

      await expect(new TwoFactorService(db).verifyCode("u1", "A1B2C-3D4E5")).resolves.toBe(false);
    });

    it("KHÔNG nhận lại mã TOTP vừa dùng — kể cả khi mã còn trong cửa sổ ±30 giây", async () => {
      /*
       * Mã hợp lệ tới 90 giây. Không nhớ bước đã dùng thì ai nhìn trộm được mã
       * (qua vai, màn hình chia sẻ, trang giả chuyển tiếp) đăng nhập lại bằng
       * chính mã đó ngay sau chủ tài khoản.
       */
      const { secret } = createTotpSecret("App", "a@b.com");
      const service = new TwoFactorService(
        createDb({ twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() }),
      );
      const code = codeFor(secret);

      await expect(service.verifyCode("u1", code)).resolves.toBe(true);
      await expect(service.verifyCode("u1", code)).resolves.toBe(false);
    });

    it("hai request CÙNG LÚC nộp cùng một mã: chỉ một bên qua", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const service = new TwoFactorService(
        createDb({ twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() }),
      );
      const code = codeFor(secret);

      const results = await Promise.all([
        service.verifyCode("u1", code),
        service.verifyCode("u1", code),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("khoá theo TÀI KHOẢN sau 5 lần thử — chặn cả mã ĐÚNG tới hết cửa sổ", async () => {
      /*
       * Rate limit theo IP không cản được kẻ dò xoay IP. Bộ đếm này đếm trên
       * tài khoản, chung cho web lẫn API. Mã đúng mà vẫn qua thì bộ đếm chỉ
       * làm chậm chứ không chặn: kẻ dò cứ bắn, lần trúng luôn được nhận.
       */
      const { secret } = createTotpSecret("App", "a@b.com");
      const service = new TwoFactorService(
        createDb({ twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() }),
      );

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(service.verifyCode("u1", "000000")).resolves.toBe(false);
      }

      await expect(service.verifyCode("u1", codeFor(secret))).rejects.toBeInstanceOf(
        TooManyTwoFactorAttemptsError,
      );
      // Tài khoản khác không bị vạ lây.
      const other = new TwoFactorService(
        createDb({ twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() }),
      );
      await expect(other.verifyCode("u2", codeFor(secret))).resolves.toBe(true);
    });

    it("nhập ĐÚNG thì bộ đếm về 0 — lần gõ nhầm cũ không tích luỹ mãi", async () => {
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb(
        { twoFactorSecret: encryptSecret(secret), twoFactorEnabledAt: new Date() },
        {
          recoveryCode: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            deleteMany: vi.fn(),
            createMany: vi.fn(),
          },
        },
      );
      const service = new TwoFactorService(db);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await service.verifyCode("u1", "000000");
      }
      // Lần thứ 5 dùng mã khôi phục đúng → đếm lại từ đầu.
      await expect(service.verifyCode("u1", "A1B2C-3D4E5")).resolves.toBe(true);

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await expect(service.verifyCode("u1", "000000")).resolves.toBe(false);
      }
    });

    it("trả false khi tài khoản CHƯA bật 2FA", async () => {
      const db = createDb({ twoFactorSecret: null, twoFactorEnabledAt: null });

      await expect(new TwoFactorService(db).verifyCode("u1", "123456")).resolves.toBe(false);
    });

    it("bí mật không giải mã được → 'mã sai', không phải lỗi 500", async () => {
      // Xảy ra khi ENCRYPTION_KEY bị đổi sau khi đã có dữ liệu. Đó là sự cố vận
      // hành, không phải lỗi của người đang đăng nhập.
      const db = createDb({
        twoFactorSecret: "v1.rac.rac.rac",
        twoFactorEnabledAt: new Date(),
      });

      await expect(new TwoFactorService(db).verifyCode("u1", "123456")).rejects.toBeInstanceOf(
        InvalidTwoFactorCodeError,
      );
    });
  });

  describe("tắt 2FA", () => {
    it("cần ĐÚNG mật khẩu — không chỉ cần mã", async () => {
      // Ai ngồi vào máy đang mở sẵn phiên không được phép gỡ lớp bảo vệ chỉ
      // bằng một cú bấm.
      const { secret } = createTotpSecret("App", "a@b.com");
      const db = createDb({
        password: "$argon2id$v=19$m=19456,t=2,p=1$abc$def",
        twoFactorEnabledAt: new Date(),
        twoFactorSecret: encryptSecret(secret),
      });

      await expect(
        new TwoFactorService(db).disable("u1", "sai-mat-khau", codeFor(secret)),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it("từ chối khi 2FA chưa bật", async () => {
      const db = createDb({ password: null, twoFactorEnabledAt: null });

      await expect(new TwoFactorService(db).disable("u1", null, "123456")).rejects.toBeInstanceOf(
        TwoFactorNotEnabledError,
      );
    });
  });
});
