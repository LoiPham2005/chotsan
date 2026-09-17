import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Tầng xác thực — lỗi đắt nhất ở đây là lỗi IM LẶNG: đăng nhập vẫn chạy, chỉ
 * có một chốt chặn nào đó không còn chặn gì. Mỗi bài dưới đây khoá một chốt.
 *
 * Email đi qua hàng đợi; mock ở đây để bài không phụ thuộc hàng đợi và để
 * kiểm được email nào đã được gửi.
 */
vi.mock("@/lib/emails", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailChangeVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailChangeNoticeEmail: vi.fn().mockResolvedValue(undefined),
}));

import { AuthService } from "./auth.service";
import type { UserService } from "./user.service";
import type { VerificationService } from "./verification.service";
import type { TokenService } from "./token.service";
import type { SecurityStampService } from "./security-stamp.service";
import { CryptoUtils } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendEmailChangeVerificationEmail } from "@/lib/emails";
import {
  AccountBannedError,
  AccountInactiveError,
  AccountLockedError,
  DuplicateFieldError,
  InvalidCredentialsError,
  InvalidVerificationTokenError,
  TwoFactorRequiredError,
} from "@/lib/errors";

const PASSWORD = "mat-khau-dung-123";
const PASSWORD_HASH = await CryptoUtils.hashPassword(PASSWORD);

type UserRow = {
  id: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  password: string | null;
  status: "ACTIVE" | "INACTIVE" | "BANNED";
  emailVerifiedAt: Date | null;
  pendingEmail: string | null;
  passwordChangedAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  twoFactorEnabledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  profile: { fullName: string | null; avatarUrl: string | null } | null;
  userRoles: { role: { key: string } }[];
};

function userRow(extra: Partial<UserRow> = {}): UserRow {
  return {
    id: "u1",
    email: "an@example.com",
    username: "an",
    phone: null,
    password: PASSWORD_HASH,
    status: "ACTIVE",
    emailVerifiedAt: new Date("2026-09-01T00:00:00Z"),
    pendingEmail: null,
    passwordChangedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabledAt: null,
    deletedAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    profile: { fullName: "An", avatarUrl: null },
    userRoles: [{ role: { key: "USER" } }],
    ...extra,
  };
}

/**
 * Database giả LỌC THẬT theo `where` của `user.findFirst` (id, email,
 * username, deletedAt, NOT) — mock trả bừa một bản ghi thì "tra theo tên đăng
 * nhập" hay "bỏ qua tài khoản đã xoá" xanh cả khi truy vấn sai.
 */
function createDb(rows: UserRow[]) {
  const matches = (row: UserRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === "NOT") return row.id !== (value as { id: string }).id;
      return (row as unknown as Record<string, unknown>)[key] === value;
    });

  const db = {
    user: {
      findFirst: vi.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
      ),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((row) => row.id === where.id) ?? null),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((item) => item.id === where.id)!;
        const increment = (data.failedLoginAttempts as { increment?: number } | undefined)
          ?.increment;
        const next =
          increment !== undefined
            ? { ...data, failedLoginAttempts: row.failedLoginAttempts + increment }
            : data;
        Object.assign(row, next);
        return Promise.resolve(row);
      }),
    },
    webAuthnCredential: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    recoveryCode: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    // Mảng lời gọi: chạy tuần tự, trả kết quả theo thứ tự — đủ cho logic ở đây.
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  };

  return db;
}

function createDeps() {
  return {
    users: {
      create: vi.fn().mockResolvedValue({ id: "moi", email: "moi@example.com", roles: ["USER"] }),
      findById: vi.fn().mockResolvedValue({ id: "u1", email: "an@example.com", status: "ACTIVE" }),
      findByEmail: vi.fn(),
    },
    verification: {
      issue: vi.fn().mockResolvedValue({ token: "tok", expiresAt: new Date() }),
      consume: vi.fn(),
    },
    tokens: { revokeAllForUser: vi.fn().mockResolvedValue(3) },
    stamps: { invalidate: vi.fn().mockResolvedValue(undefined) },
  };
}

function setup(rows: UserRow[]) {
  const db = createDb(rows);
  const deps = createDeps();
  const service = new AuthService(
    db as unknown as PrismaClient,
    deps.users as unknown as UserService,
    deps.verification as unknown as VerificationService,
    deps.tokens as unknown as TokenService,
    deps.stamps as unknown as SecurityStampService,
  );
  return { db, deps, service };
}

beforeEach(() => vi.clearAllMocks());

describe("validateCredentials — đăng nhập bằng mật khẩu", () => {
  it("đúng mật khẩu → hồ sơ công khai, KHÔNG có cột password", async () => {
    const { service } = setup([userRow()]);

    const user = await service.validateCredentials({
      identifier: "AN@example.com ",
      password: PASSWORD,
    });

    expect(user.id).toBe("u1");
    expect(user).not.toHaveProperty("password");
  });

  it("tra theo tên đăng nhập khi chuỗi không có @", async () => {
    const { service } = setup([userRow()]);

    await expect(
      service.validateCredentials({ identifier: "an", password: PASSWORD }),
    ).resolves.toMatchObject({ id: "u1" });
  });

  it("tài khoản không tồn tại và sai mật khẩu: CÙNG một lỗi", async () => {
    const { service } = setup([userRow()]);

    const missing = await service
      .validateCredentials({ identifier: "khong@example.com", password: PASSWORD })
      .catch((e: unknown) => e);
    const wrong = await service
      .validateCredentials({ identifier: "an@example.com", password: "sai" })
      .catch((e: unknown) => e);

    expect(missing).toBeInstanceOf(InvalidCredentialsError);
    expect(wrong).toBeInstanceOf(InvalidCredentialsError);
    expect((missing as Error).message).toBe((wrong as Error).message);
    // `userId` chỉ có khi tài khoản CÓ THẬT — để nhật ký ghi LOGIN_FAILED đúng
    // người, không để lộ ra response.
    expect((missing as InvalidCredentialsError).userId).toBeUndefined();
    expect((wrong as InvalidCredentialsError).userId).toBe("u1");
  });

  it("sai đủ ngưỡng thì khoá tạm", async () => {
    const row = userRow({ failedLoginAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS - 1 });
    const { service } = setup([row]);

    await expect(
      service.validateCredentials({ identifier: "an", password: "sai" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(row.lockedUntil).toBeInstanceOf(Date);
    expect(row.failedLoginAttempts).toBe(0);
  });

  it("đang khoá tạm: mật khẩu ĐÚNG hay SAI đều cùng một lỗi, không đếm thêm lần sai", async () => {
    /*
     * Lỗi thật trước đây: trong lúc khoá, sai → "Thông tin không chính xác",
     * ĐÚNG → "Tài khoản tạm khoá". Kẻ dò vẫn đoán tiếp được và được báo đúng
     * lúc mình vừa đoán trúng — khoá tạm mất hẳn tác dụng.
     */
    const lockedUntil = new Date(Date.now() + 10 * 60_000);
    const row = userRow({ lockedUntil, failedLoginAttempts: 0 });
    const { db, service } = setup([row]);

    const right = await service
      .validateCredentials({ identifier: "an", password: PASSWORD })
      .catch((e: unknown) => e);
    const wrong = await service
      .validateCredentials({ identifier: "an", password: "sai" })
      .catch((e: unknown) => e);

    expect(right).toBeInstanceOf(AccountLockedError);
    expect(wrong).toBeInstanceOf(AccountLockedError);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(row.lockedUntil).toBe(lockedUntil);
  });

  it.each([
    ["BANNED", AccountBannedError],
    ["INACTIVE", AccountInactiveError],
  ] as const)("tài khoản %s chỉ bị lộ SAU KHI mật khẩu đúng", async (status, error) => {
    const { service } = setup([userRow({ status })]);

    await expect(
      service.validateCredentials({ identifier: "an", password: PASSWORD }),
    ).rejects.toBeInstanceOf(error);
    // Sai mật khẩu thì vẫn chỉ là "không chính xác" — không cho người dò biết
    // tài khoản đang bị khoá.
    await expect(
      service.validateCredentials({ identifier: "an", password: "sai" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("CỔNG 2FA: mật khẩu đúng nhưng đã bật 2FA → ném lỗi kèm userId, không trả user", async () => {
    const { service } = setup([userRow({ twoFactorEnabledAt: new Date() })]);

    const error = await service
      .validateCredentials({ identifier: "an", password: PASSWORD })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TwoFactorRequiredError);
    expect((error as TwoFactorRequiredError).userId).toBe("u1");
  });

  it("tài khoản đã xoá mềm không đăng nhập được", async () => {
    const { service } = setup([userRow({ deletedAt: new Date() })]);

    await expect(
      service.validateCredentials({ identifier: "an", password: PASSWORD }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});

describe("register — đăng ký công khai", () => {
  it("vai trò LUÔN là USER, không đọc từ input — kể cả khi input có roleKeys", async () => {
    const { deps, service } = setup([]);

    await service.register({
      email: "moi@example.com",
      password: "matkhau123",
      roleKeys: ["SUPER_ADMIN"],
    } as never);

    const [input, options] = deps.users.create.mock.calls[0] as [
      { roleKeys: string[] },
      { actorId: string | null },
    ];
    expect(input.roleKeys).toEqual(["USER"]);
    expect(options).toEqual({ actorId: null });
  });
});

describe("resetPassword — đặt lại mật khẩu bằng link", () => {
  it("link hỏng → lỗi, không ghi gì", async () => {
    const { db, deps, service } = setup([userRow()]);
    deps.verification.consume.mockResolvedValue(null);

    await expect(service.resetPassword("rac", "matkhaumoi1")).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("băm mật khẩu mới, ghi mốc đổi, thu hồi MỌI phiên — cả cookie đang cầm", async () => {
    const row = userRow({ lockedUntil: new Date(Date.now() + 60_000), failedLoginAttempts: 3 });
    const { deps, service } = setup([row]);
    deps.verification.consume.mockResolvedValue({ userId: "u1", destination: "an@example.com" });

    await service.resetPassword("tok", "matkhaumoi1");

    expect(row.password).toMatch(/^\$argon2id\$/);
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
    expect(row.lockedUntil).toBeNull();
    expect(deps.tokens.revokeAllForUser).toHaveBeenCalledWith("u1");
    // Không có dòng này thì cookie web của kẻ đã chiếm tài khoản sống thêm 7 ngày.
    expect(deps.stamps.invalidate).toHaveBeenCalledWith("u1");
  });

  it("email CHƯA xác thực: link chứng minh sở hữu → đánh dấu đã xác thực, gỡ passkey và 2FA gắn trước đó", async () => {
    /*
     * Đường lấy lại tài khoản bị tiền-chiếm: kẻ xấu đăng ký trước bằng email nạn
     * nhân, bật 2FA và thêm passkey của họ. Chủ thật "quên mật khẩu" → bấm link.
     * Không gỡ thì kẻ xấu vẫn vào bằng passkey, hoặc chặn chủ thật ở bước 2FA.
     */
    const row = userRow({ emailVerifiedAt: null, twoFactorEnabledAt: new Date() });
    const { db, deps, service } = setup([row]);
    deps.verification.consume.mockResolvedValue({ userId: "u1", destination: "an@example.com" });

    await service.resetPassword("tok", "matkhaumoi1");

    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(row.twoFactorEnabledAt).toBeNull();
    expect(db.webAuthnCredential.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(db.recoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });

  it("email ĐÃ xác thực: không đụng tới passkey và 2FA", async () => {
    const row = userRow({ twoFactorEnabledAt: new Date("2026-09-02T00:00:00Z") });
    const { db, deps, service } = setup([row]);
    deps.verification.consume.mockResolvedValue({ userId: "u1", destination: "an@example.com" });

    await service.resetPassword("tok", "matkhaumoi1");

    expect(row.twoFactorEnabledAt).toEqual(new Date("2026-09-02T00:00:00Z"));
    expect(db.webAuthnCredential.deleteMany).not.toHaveBeenCalled();
  });

  it("link gửi tới địa chỉ KHÁC địa chỉ hiện tại → không chứng minh gì về email", async () => {
    const row = userRow({ emailVerifiedAt: null, email: "moi@example.com" });
    const { db, deps, service } = setup([row]);
    deps.verification.consume.mockResolvedValue({ userId: "u1", destination: "cu@example.com" });

    await service.resetPassword("tok", "matkhaumoi1");

    expect(row.emailVerifiedAt).toBeNull();
    expect(db.webAuthnCredential.deleteMany).not.toHaveBeenCalled();
  });
});

describe("changePassword — đổi mật khẩu khi đang đăng nhập", () => {
  it("sai mật khẩu hiện tại → từ chối, không ghi gì", async () => {
    const { db, deps, service } = setup([userRow()]);

    await expect(service.changePassword("u1", "sai", "matkhaumoi1")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(db.user.update).not.toHaveBeenCalled();
    expect(deps.tokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it("tài khoản chưa có mật khẩu (chỉ OAuth) không đổi được — phải đặt qua quên mật khẩu", async () => {
    const { service } = setup([userRow({ password: null })]);

    await expect(
      service.changePassword("u1", "gi-cung-duoc", "matkhaumoi1"),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("đúng → ghi mốc đổi, thu hồi TẤT CẢ refresh token (kể cả thiết bị này), xoá ảnh phiên", async () => {
    // Cấp lại phiên cho người đang thao tác là việc của nơi gọi (action/route).
    // Service không được giữ lại token cũ nào — kể cả token của chính thiết bị
    // này, vì bản sao của nó có thể đã nằm trong tay kẻ gian.
    const row = userRow();
    const { deps, service } = setup([row]);

    await service.changePassword("u1", PASSWORD, "matkhaumoi1");

    expect(row.passwordChangedAt).toBeInstanceOf(Date);
    expect(deps.tokens.revokeAllForUser).toHaveBeenCalledWith("u1");
    expect(deps.stamps.invalidate).toHaveBeenCalledWith("u1");
  });
});

describe("đổi email", () => {
  it("requestEmailChange: sai mật khẩu → từ chối, không gửi thư", async () => {
    const { deps, service } = setup([userRow()]);

    await expect(service.requestEmailChange("u1", "moi@example.com", "sai")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(deps.verification.issue).not.toHaveBeenCalled();
  });

  it("requestEmailChange: địa chỉ đã có người dùng → trùng", async () => {
    const { service } = setup([userRow(), userRow({ id: "u2", email: "moi@example.com" })]);

    await expect(
      service.requestEmailChange("u1", "Moi@Example.com", PASSWORD),
    ).rejects.toBeInstanceOf(DuplicateFieldError);
  });

  it("requestEmailChange: gửi link tới địa chỉ MỚI và ghi địa chỉ đang chờ để hiển thị", async () => {
    const row = userRow();
    const { deps, service } = setup([row]);

    await service.requestEmailChange("u1", " Moi@Example.com ", PASSWORD);

    expect(deps.verification.issue).toHaveBeenCalledWith("u1", "EMAIL_CHANGE", "moi@example.com");
    expect(sendEmailChangeVerificationEmail).toHaveBeenCalledWith("moi@example.com", "tok");
    expect(row.pendingEmail).toBe("moi@example.com");
    // Email THẬT chưa đổi cho tới khi link được bấm.
    expect(row.email).toBe("an@example.com");
  });

  it("confirmEmailChange: ghi email mới, đánh dấu đã xác thực, xoá địa chỉ chờ, thu hồi phiên", async () => {
    const row = userRow({ pendingEmail: "moi@example.com" });
    const { deps, service } = setup([row]);
    deps.verification.consume.mockResolvedValue({ userId: "u1", destination: "moi@example.com" });

    await service.confirmEmailChange("tok");

    expect(row).toMatchObject({ email: "moi@example.com", pendingEmail: null });
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(deps.tokens.revokeAllForUser).toHaveBeenCalledWith("u1");
  });

  it("confirmEmailChange: thua cuộc đua trùng email (lỗi Prisma 7 THẬT) → DuplicateFieldError", async () => {
    const { db, deps, service } = setup([userRow()]);
    deps.verification.consume.mockResolvedValue({ userId: "u1", destination: "moi@example.com" });
    db.user.update.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
        code: "P2002",
        meta: {
          modelName: "User",
          driverAdapterError: {
            cause: {
              originalCode: "23505",
              originalMessage:
                'duplicate key value violates unique constraint "users_email_active_key"',
              constraint: { fields: ["email"] },
            },
          },
        },
      }),
    );

    await expect(service.confirmEmailChange("tok")).rejects.toBeInstanceOf(DuplicateFieldError);
  });
});
