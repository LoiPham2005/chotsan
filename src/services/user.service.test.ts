import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserService } from "./user.service";
import type { PermissionService } from "./permission.service";
import type { SecurityStampService } from "./security-stamp.service";
import {
  AccountBannedError,
  AccountInactiveError,
  assertLoginAllowed,
  DuplicateFieldError,
  InsufficientRoleLevelError,
  PermissionNotHeldError,
  SelfActionForbiddenError,
  UnknownRoleKeyError,
} from "@/lib/errors";

const USER_ROW = {
  id: "u1",
  email: "a@b.com",
  phone: null,
  username: null,
  status: "ACTIVE",
  emailVerifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  profile: { fullName: "Nguyễn A", avatarUrl: null },
  userRoles: [{ role: { key: "USER" } }],
};

/**
 * @param levels Bậc vai trò theo từng userId, cho các test leo thang đặc quyền.
 * `userRole.findMany` trả về đúng bộ vai trò của người được hỏi.
 */
function createDb(
  overrides: { user?: Record<string, unknown>; role?: Record<string, unknown> } = {},
  levels: Record<string, number> = {},
  tx: ReturnType<typeof createTx> = createTx(),
) {
  return {
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(USER_ROW),
      findMany: vi.fn().mockResolvedValue([USER_ROW]),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockResolvedValue(USER_ROW),
      update: vi.fn().mockResolvedValue(USER_ROW),
      ...overrides.user,
    },
    role: {
      findMany: vi.fn().mockResolvedValue([{ id: "r-user", key: "USER", level: 0 }]),
      ...overrides.role,
    },
    userRole: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(({ where }: { where: { userId: string } }) => {
        const level = levels[where.userId];
        return Promise.resolve(level === undefined ? [] : [{ role: { level } }]);
      }),
    },
    userProfile: { upsert: vi.fn() },
    userPermission: { upsert: vi.fn(), deleteMany: vi.fn() },
    permission: { findUnique: vi.fn().mockResolvedValue({ id: "p1" }) },
    // `softDelete` gọi `$transaction([...])` với một MẢNG, nên các lệnh trong
    // đó chạy trên client gốc chứ không trên `tx`.
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    // Chạy callback ngay tại chỗ thay vì mở transaction thật: test này kiểm
    // logic nghiệp vụ, không kiểm Postgres.
    $transaction: vi.fn((arg: unknown) =>
      Promise.resolve(typeof arg === "function" ? (arg as (tx: unknown) => unknown)(tx) : []),
    ),
  } as unknown as PrismaClient;
}

function createTx() {
  return {
    user: { update: vi.fn().mockResolvedValue(USER_ROW) },
    userRole: { deleteMany: vi.fn(), createMany: vi.fn() },
    // `setStatus` thu hồi phiên ngay trong cùng transaction khi khoá tài khoản
    // — khoá mà để phiên cũ sống tiếp thì việc khoá gần như vô nghĩa.
    refreshToken: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

/**
 * `PermissionService` giả — đếm xem cache có bị xoá không, và trả lời "người
 * thao tác có quyền X không" theo đúng bảng truyền vào.
 */
function createPermissions(held: Record<string, string[]> = {}) {
  return {
    invalidateUser: vi.fn().mockResolvedValue(undefined),
    invalidateAll: vi.fn().mockResolvedValue(undefined),
    can: vi.fn((userId: string, key: string) =>
      Promise.resolve((held[userId] ?? []).includes(key)),
    ),
  } as unknown as PermissionService & {
    invalidateUser: ReturnType<typeof vi.fn>;
  };
}

/** `SecurityStampService` giả — chỉ cần biết ảnh phiên có bị xoá khỏi cache không. */
function createStamps() {
  return { invalidate: vi.fn().mockResolvedValue(undefined) } as unknown as SecurityStampService & {
    invalidate: ReturnType<typeof vi.fn>;
  };
}

const SYSTEM = { actorId: null };

/** Lỗi trùng email CHÉP NGUYÊN hình dạng Prisma 7 + adapter-pg — xem prisma-errors.test.ts. */
function duplicateEmailError() {
  return Object.assign(
    new Error(
      "\nInvalid `tx.user.create()` invocation:\n\nUnique constraint failed on the fields: (`email`)",
    ),
    {
      code: "P2002",
      meta: {
        modelName: "User",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            originalMessage:
              'duplicate key value violates unique constraint "users_email_active_key"',
            kind: "UniqueConstraintViolation",
            constraint: { fields: ["email"] },
          },
        },
      },
    },
  );
}

const baseInput = { email: "a@b.com", status: "ACTIVE" as const };

describe("UserService", () => {
  describe("create", () => {
    it("băm mật khẩu, KHÔNG bao giờ lưu chuỗi gốc", async () => {
      const db = createDb();

      await new UserService(db).create({ ...baseInput, password: "matkhau123" }, SYSTEM);

      const data = vi.mocked(db.user.create).mock.calls[0]![0].data as { password: string };
      expect(data.password).not.toBe("matkhau123");
      expect(data.password).toMatch(/^\$argon2id\$/);
    });

    it("lưu password NULL — không phải chuỗi rỗng — khi không truyền mật khẩu", async () => {
      // Chuỗi rỗng là một mật khẩu "hợp lệ" nhìn từ tầng dữ liệu; null mới nói
      // đúng rằng tài khoản này chưa đặt mật khẩu.
      const db = createDb();

      await new UserService(db).create(baseInput, SYSTEM);

      const data = vi.mocked(db.user.create).mock.calls[0]![0].data as { password: null };
      expect(data.password).toBeNull();
    });

    it("mặc định gán vai trò USER khi không chỉ định", async () => {
      const db = createDb();

      await new UserService(db).create(baseInput, SYSTEM);

      expect(db.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: { in: ["USER"] } } }),
      );
    });

    it("từ chối vai trò không tồn tại thay vì lặng lẽ bỏ qua", async () => {
      // Bỏ qua nghĩa là admin bấm "gán vai trò KE_TOAN", hệ thống báo thành
      // công, mà người dùng không nhận được vai trò nào.
      const db = createDb({ role: { findMany: vi.fn().mockResolvedValue([]) } });

      await expect(
        new UserService(db).create({ ...baseInput, roleKeys: ["KE_TOAN"] }, SYSTEM),
      ).rejects.toBeInstanceOf(UnknownRoleKeyError);
    });

    it("báo đúng TRƯỜNG bị trùng, không phải lỗi chung chung", async () => {
      const db = createDb({
        user: {
          findFirst: vi.fn().mockResolvedValue({ email: "a@b.com", username: null, phone: null }),
        },
      });

      await expect(new UserService(db).create(baseInput, SYSTEM)).rejects.toBeInstanceOf(
        DuplicateFieldError,
      );
    });

    it("không select cột password, nên nó không thể rò ra khỏi service", async () => {
      const db = createDb();

      const user = await new UserService(db).create(baseInput, SYSTEM);

      const select = vi.mocked(db.user.create).mock.calls[0]![0].select as Record<string, unknown>;
      expect(select.password).toBeUndefined();
      expect(user).not.toHaveProperty("password");
    });

    it("không nuốt lỗi lạ của database", async () => {
      const db = createDb({
        user: { create: vi.fn().mockRejectedValue(new Error("connection lost")) },
      });

      await expect(new UserService(db).create(baseInput, SYSTEM)).rejects.toThrow(
        "connection lost",
      );
    });

    it("thua cuộc đua trùng email → DuplicateFieldError, không phải 500", async () => {
      /*
       * Hai request cùng qua `assertUnique`, database chặn request thứ hai.
       *
       * Lỗi thật trước đây: `catchDuplicate` đọc `meta.target` — Prisma 7 không
       * còn trường đó, nhánh không bao giờ khớp và người dùng nhận 500. Lỗi
       * giả ở đây mang ĐÚNG hình dạng lỗi thật, không phải hình dạng tưởng tượng.
       */
      const db = createDb({ user: { create: vi.fn().mockRejectedValue(duplicateEmailError()) } });

      const error = await new UserService(db).create(baseInput, SYSTEM).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DuplicateFieldError);
      expect((error as DuplicateFieldError).fields).toHaveProperty("email");
    });
  });

  describe("list", () => {
    it("bỏ qua tài khoản đã xoá mềm theo mặc định", async () => {
      const db = createDb();

      await new UserService(db).list({ page: 1, limit: 20, includeDeleted: false });

      const args = vi.mocked(db.user.findMany).mock.calls[0]![0]!;
      expect(args.where).toMatchObject({ deletedAt: null });
      expect(args.take).toBe(20);
      expect(args.skip).toBe(0);
    });

    it("trả metadata phân trang khớp với tổng số bản ghi", async () => {
      const db = createDb({ user: { count: vi.fn().mockResolvedValue(45) } });

      const page = await new UserService(db).list({ page: 2, limit: 20, includeDeleted: false });

      expect(page.meta).toMatchObject({
        page: 2,
        limit: 20,
        total: 45,
        totalPages: 3,
        hasNext: true,
      });
    });
  });

  describe("chốt chặn leo thang đặc quyền", () => {
    it("ADMIN không tạo được tài khoản SUPER_ADMIN", async () => {
      /*
       * Đây là đường leo thang rõ nhất, và chốt "không tự đổi vai trò của
       * chính mình" KHÔNG cứu được: kẻ tấn công tạo một tài khoản KHÁC mang
       * vai trò tối cao rồi đăng nhập vào đó.
       */
      const db = createDb(
        {
          role: {
            findMany: vi.fn().mockResolvedValue([{ id: "r-sa", key: "SUPER_ADMIN", level: 100 }]),
          },
        },
        { admin: 50 },
      );

      await expect(
        new UserService(db).create(
          { ...baseInput, roleKeys: ["SUPER_ADMIN"] },
          { actorId: "admin" },
        ),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    });

    it("ADMIN không gán được vai trò NGANG bậc mình", async () => {
      // "Bằng" cũng bị chặn: cho phép ADMIN nhân bản ADMIN nghĩa là bậc đó
      // tăng vô hạn và không ai gỡ được — vì ADMIN cũng không đụng được vào
      // ADMIN khác.
      const db = createDb(
        {
          role: { findMany: vi.fn().mockResolvedValue([{ id: "r-ad", key: "ADMIN", level: 50 }]) },
        },
        { admin: 50 },
      );

      await expect(
        new UserService(db).create({ ...baseInput, roleKeys: ["ADMIN"] }, { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    });

    it("ADMIN không sửa/khoá/xoá được tài khoản SUPER_ADMIN", async () => {
      const db = createDb(
        { user: { findFirst: vi.fn().mockResolvedValue({ id: "sa" }) } },
        { admin: 50, sa: 100 },
      );
      const service = new UserService(db);

      await expect(
        service.update("sa", { status: "BANNED" }, { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);

      await expect(service.setStatus("sa", "BANNED", { actorId: "admin" })).rejects.toBeInstanceOf(
        InsufficientRoleLevelError,
      );

      await expect(service.softDelete("sa", { actorId: "admin" })).rejects.toBeInstanceOf(
        InsufficientRoleLevelError,
      );
    });

    it("ADMIN không cấp/tước/gỡ được quyền lẻ của SUPER_ADMIN", async () => {
      // Cấp quyền lẻ là một dạng đổi thẩm quyền — nếu không chịu cùng chốt
      // chặn thì nó trở thành đường vòng quanh luật vai trò. Gỡ một lệnh TƯỚC
      // quyền cũng là trả lại quyền đó, nên chịu cùng chốt.
      const db = createDb({}, { admin: 50, sa: 100 });
      const service = new UserService(db, createPermissions({ admin: ["user:delete"] }));

      await expect(
        service.setUserPermission("sa", "user:delete", false, { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
      await expect(
        service.clearUserPermission("sa", "user:delete", { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
      expect(db.userPermission.deleteMany).not.toHaveBeenCalled();
    });

    it("không CẤP được quyền mà chính mình không có — dù người nhận ở bậc thấp hơn", async () => {
      /*
       * ADMIN (bậc 50) không có `payout:approve`. Không có chốt này thì ADMIN
       * tick quyền đó cho một tài khoản phụ bậc 0 rồi dùng nó để duyệt chi tiền
       * — chốt bậc vai trò không thấy gì bất thường.
       */
      const db = createDb({}, { admin: 50, u1: 0 });
      const service = new UserService(db, createPermissions({ admin: ["user:read"] }));

      await expect(
        service.setUserPermission("u1", "payout:approve", true, { actorId: "admin" }),
      ).rejects.toBeInstanceOf(PermissionNotHeldError);
      expect(db.userPermission.upsert).not.toHaveBeenCalled();

      // Quyền mình ĐANG có thì cấp được; TƯỚC thì không cần tự có.
      await expect(
        service.setUserPermission("u1", "user:read", true, { actorId: "admin" }),
      ).resolves.toBeUndefined();
      await expect(
        service.setUserPermission("u1", "payout:approve", false, { actorId: "admin" }),
      ).resolves.toBeUndefined();
    });

    it("ADMIN không mở khoá tạm được cho SUPER_ADMIN", async () => {
      const db = createDb(
        { user: { findFirst: vi.fn().mockResolvedValue({ id: "sa" }) } },
        { admin: 50, sa: 100 },
      );

      await expect(new UserService(db).unlock("sa", { actorId: "admin" })).rejects.toBeInstanceOf(
        InsufficientRoleLevelError,
      );
    });

    it("SUPER_ADMIN thao tác được lên ADMIN", async () => {
      const db = createDb(
        { user: { findFirst: vi.fn().mockResolvedValue({ id: "admin" }) } },
        { sa: 100, admin: 50 },
      );

      await expect(
        new UserService(db).setStatus("admin", "BANNED", { actorId: "sa" }),
      ).resolves.toBeDefined();
    });

    it("thao tác của HỆ THỐNG (không có actor) không bị chặn", async () => {
      // Seed, script, job nền — không có ai để so bậc, và bỏ qua là đúng.
      const db = createDb({}, {});

      await expect(
        new UserService(db).create({ ...baseInput, roleKeys: ["USER"] }, SYSTEM),
      ).resolves.toBeDefined();
    });
  });

  describe("chốt chặn tự bắn vào chân mình", () => {
    it("không cho tự đổi vai trò của chính mình", async () => {
      // Không có chốt này thì quản trị viên cuối cùng tự khoá mình ra ngoài chỉ
      // bằng một cú bấm nhầm, và không còn ai vào sửa được.
      const db = createDb({ user: { findFirst: vi.fn().mockResolvedValue({ id: "u1" }) } });

      await expect(
        new UserService(db).update("u1", { roleKeys: ["USER"] }, { actorId: "u1" }),
      ).rejects.toBeInstanceOf(SelfActionForbiddenError);
    });

    it("không cho tự khoá và tự xoá chính mình", async () => {
      const db = createDb();
      const service = new UserService(db);

      await expect(service.setStatus("u1", "BANNED", { actorId: "u1" })).rejects.toBeInstanceOf(
        SelfActionForbiddenError,
      );
      await expect(service.softDelete("u1", { actorId: "u1" })).rejects.toBeInstanceOf(
        SelfActionForbiddenError,
      );
    });
  });
});

describe("assertLoginAllowed", () => {
  it("chặn cả BANNED lẫn INACTIVE, cho ACTIVE đi qua", () => {
    // Gom vào một hàm dùng chung cho cả ba đường đăng nhập (mật khẩu, OAuth,
    // passkey). Bốn chỗ kiểm tra riêng lẻ là bốn cơ hội để một đường mới quên
    // mất luật.
    expect(() => assertLoginAllowed("ACTIVE")).not.toThrow();
    expect(() => assertLoginAllowed("BANNED")).toThrow(AccountBannedError);
    expect(() => assertLoginAllowed("INACTIVE")).toThrow(AccountInactiveError);
  });
});

/**
 * Quyền được cache 60 giây, nên MỌI đường ghi đụng tới thẩm quyền phải xoá
 * cache của người bị ảnh hưởng.
 *
 * Chiều "cấp thêm" mà quên chỉ gây khó hiểu: admin tick một quyền, thử ngay,
 * thấy vẫn 403. Chiều "tước bỏ" thì là lỗ hổng thật — người vừa bị gỡ vai trò
 * vẫn thao tác được như cũ thêm một phút nữa.
 *
 * Đây là lỗi ĐÃ XẢY RA: `setUserPermission` ghi đúng vào database nhưng không
 * xoá cache, nên cấp quyền xong gọi lại API vẫn nhận 403.
 */
describe("xoá cache quyền sau mỗi lần ghi thẩm quyền", () => {
  it("create: người mới có vai trò ngay từ request đầu tiên", async () => {
    const permissions = createPermissions();

    await new UserService(createDb(), permissions).create(baseInput, SYSTEM);

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("update: đổi vai trò có hiệu lực NGAY, không đợi cache hết hạn", async () => {
    const permissions = createPermissions();
    const db = createDb({
      user: { findFirst: vi.fn().mockResolvedValue(USER_ROW) },
      role: { findMany: vi.fn().mockResolvedValue([{ id: "r-admin", key: "ADMIN", level: 50 }]) },
    });

    await new UserService(db, permissions).update("u1", { roleKeys: ["ADMIN"] }, SYSTEM);

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("setUserPermission: cấp quyền lẻ có hiệu lực ngay", async () => {
    const permissions = createPermissions();

    await new UserService(createDb(), permissions).setUserPermission(
      "u1",
      "user:read",
      true,
      SYSTEM,
    );

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("clearUserPermission: gỡ ngoại lệ có hiệu lực ngay", async () => {
    const permissions = createPermissions();

    await new UserService(createDb(), permissions).clearUserPermission("u1", "user:read", SYSTEM);

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });

  it("softDelete: tài khoản đã xoá không còn quyền nào trong cache", async () => {
    const permissions = createPermissions();
    const db = createDb({
      user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" }) },
    });

    await new UserService(db, permissions).softDelete("u1", SYSTEM);

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u1");
  });
});

/**
 * Khoá, tạm ngưng, xoá mềm phải cắt phiên NGAY — kể cả cookie web và access
 * token đang cầm, thứ refresh token không chạm tới được. `securityStamps` là
 * ảnh cache mà mọi lần đọc phiên đối chiếu; không xoá nó thì hiệu lực trễ 60
 * giây.
 */
describe("hệ quả của việc đổi trạng thái tài khoản", () => {
  it("setStatus BANNED: thu hồi refresh token, xoá ảnh phiên, trả trạng thái cũ cho nhật ký", async () => {
    const tx = createTx();
    const stamps = createStamps();
    const db = createDb(
      { user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", status: "ACTIVE" }) } },
      {},
      tx,
    );

    const result = await new UserService(db, createPermissions(), stamps).setStatus(
      "u1",
      "BANNED",
      SYSTEM,
    );

    expect(result.previousStatus).toBe("ACTIVE");
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", revokedAt: null } }),
    );
    expect(stamps.invalidate).toHaveBeenCalledWith("u1");
  });

  it("update có `status` cũng phải thu hồi phiên như setStatus", async () => {
    // Lỗi thật trước đây: PATCH users/[id] với `status: BANNED` đổi cột trạng
    // thái nhưng để refresh token sống tiếp tới 30 ngày.
    const tx = createTx();
    const stamps = createStamps();
    const db = createDb(
      { user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" }) } },
      {},
      tx,
    );

    await new UserService(db, createPermissions(), stamps).update(
      "u1",
      { status: "INACTIVE" },
      SYSTEM,
    );

    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
    expect(stamps.invalidate).toHaveBeenCalledWith("u1");
  });

  it("update không đụng trạng thái thì KHÔNG thu hồi phiên", async () => {
    const tx = createTx();
    const stamps = createStamps();
    const db = createDb(
      { user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" }) } },
      {},
      tx,
    );

    await new UserService(db, createPermissions(), stamps).update(
      "u1",
      { fullName: "Tên mới" },
      SYSTEM,
    );

    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(stamps.invalidate).not.toHaveBeenCalled();
  });

  it("softDelete xoá ảnh phiên — tài khoản vừa xoá không dùng tiếp cookie cũ", async () => {
    const stamps = createStamps();
    const db = createDb({
      user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.com" }) },
    });

    await new UserService(db, createPermissions(), stamps).softDelete("u1", SYSTEM);

    expect(stamps.invalidate).toHaveBeenCalledWith("u1");
  });
});

describe("update — admin đổi email", () => {
  it("địa chỉ MỚI mất dấu đã xác thực của địa chỉ cũ", async () => {
    /*
     * Email do quản trị viên gõ chưa ai chứng minh là của người dùng. Giữ dấu
     * "đã xác thực" là để OAuth tự liên kết theo một địa chỉ chưa kiểm chứng.
     */
    const tx = createTx();
    const db = createDb(
      { user: { findFirst: vi.fn().mockResolvedValue({ id: "u1", email: "cu@b.com" }) } },
      {},
      tx,
    );

    await new UserService(db, createPermissions(), createStamps()).update(
      "u1",
      { email: "moi@b.com" },
      SYSTEM,
    );

    const [{ data }] = vi.mocked(tx.user.update).mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).toMatchObject({ email: "moi@b.com", emailVerifiedAt: null });
  });

  it("gửi lại đúng email cũ thì giữ nguyên trạng thái xác thực", async () => {
    const tx = createTx();
    // Lọc theo `where`: phép kiểm trùng (`NOT: { id }`) không được thấy chính
    // bản ghi đang sửa — nếu không, gửi lại email của mình cũng thành "trùng".
    const findFirst = vi.fn(({ where }: { where: { NOT?: unknown } }) =>
      Promise.resolve(where.NOT ? null : { id: "u1", email: "cu@b.com" }),
    );
    const db = createDb({ user: { findFirst } }, {}, tx);

    await new UserService(db, createPermissions(), createStamps()).update(
      "u1",
      { email: "cu@b.com" },
      SYSTEM,
    );

    const [{ data }] = vi.mocked(tx.user.update).mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(data).not.toHaveProperty("emailVerifiedAt");
  });
});
