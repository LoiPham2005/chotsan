import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RoleService } from "./role.service";
import type { PermissionService } from "./permission.service";
import {
  InsufficientRoleLevelError,
  PermissionNotHeldError,
  RoleInUseError,
  SystemRoleImmutableError,
} from "@/lib/errors";

/**
 * Bảng phân quyền là thứ nguy hiểm nhất hệ thống: ai sửa được nó thì tự cấp
 * cho mình mọi quyền còn lại. Hai chốt giữ nó:
 *
 *   1. `Role.level` — không tạo/sửa/xoá vai trò ngang hoặc trên bậc mình.
 *   2. Không đưa vào vai trò quyền mà chính mình không có.
 *
 * Lỗi thật trước đây: mọi nơi gọi `create/update/remove` đều quên truyền
 * `actorId`, nên chốt 1 chưa từng chạy — ADMIN tick được `role:delete`,
 * `setting:update`, `payout:approve` cho chính vai trò ADMIN.
 *
 * Bậc dùng trong tệp: SUPER_ADMIN 100 · ADMIN 50 · USER 0.
 */

type RoleRow = {
  id: string;
  key: string;
  level: number;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
};

/** Bản MỚI mỗi lần gọi — bài nào sửa dữ liệu cũng không rò sang bài sau. */
function defaultRoles(): RoleRow[] {
  return [
    { id: "r-sa", key: "SUPER_ADMIN", level: 100, isSystem: true, permissions: [], userCount: 1 },
    {
      id: "r-ad",
      key: "ADMIN",
      level: 50,
      isSystem: true,
      permissions: ["user:read"],
      userCount: 2,
    },
    { id: "r-us", key: "USER", level: 0, isSystem: true, permissions: [], userCount: 9 },
    { id: "r-kt", key: "KE_TOAN", level: 10, isSystem: false, permissions: [], userCount: 0 },
    { id: "r-old", key: "CU", level: 60, isSystem: false, permissions: [], userCount: 0 },
  ];
}

/** Bậc cao nhất theo từng người thao tác. */
const ACTOR_LEVELS: Record<string, number> = { admin: 50, sa: 100 };

/** Quyền hiệu lực của từng người thao tác. */
const HELD: Record<string, string[]> = {
  admin: ["user:read", "user:update", "role:update", "report:read"],
  sa: ["user:read", "user:delete", "payout:approve", "setting:update", "report:read"],
};

function createDb(roles: RoleRow[]) {
  const byKey = (key: string) => roles.find((role) => role.key === key) ?? null;

  const db = {
    role: {
      // Lọc THẬT theo `where.key` — mock trả bừa một vai trò thì bài "không sửa
      // được vai trò bậc trên" xanh cả khi service đọc nhầm vai trò.
      findUnique: vi.fn(({ where }: { where: { key: string } }) => {
        const role = byKey(where.key);
        return Promise.resolve(
          role && {
            ...role,
            permissions: role.permissions.map((key) => ({ permission: { key } })),
            _count: { userRoles: role.userCount },
          },
        );
      }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    userRole: {
      findMany: vi.fn(({ where }: { where: { userId: string } }) => {
        const level = ACTOR_LEVELS[where.userId];
        return Promise.resolve(level === undefined ? [] : [{ role: { level } }]);
      }),
    },
    permission: {
      findMany: vi.fn(({ where }: { where: { key: { in: string[] } } }) =>
        Promise.resolve(where.key.in.map((key) => ({ id: `p-${key}`, key }))),
      ),
    },
    rolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
  };

  return db;
}

function createPermissions() {
  return {
    invalidateAll: vi.fn().mockResolvedValue(undefined),
    permissionsFor: vi.fn((userId: string) => Promise.resolve(new Set(HELD[userId] ?? []))),
  } as unknown as PermissionService & { invalidateAll: ReturnType<typeof vi.fn> };
}

function setup(roles: RoleRow[] = defaultRoles()) {
  const db = createDb(roles);
  const permissions = createPermissions();
  const service = new RoleService(db as unknown as PrismaClient, permissions);
  // `findByKey` đọc lại danh sách sau khi ghi — không phải thứ đang kiểm ở đây.
  vi.spyOn(service, "findByKey").mockResolvedValue({} as never);
  return { db, permissions, service };
}

describe("RoleService — chốt bậc vai trò", () => {
  it("ADMIN KHÔNG tạo được vai trò ngang hoặc trên bậc mình", async () => {
    const { db, service } = setup();

    for (const level of [50, 100]) {
      await expect(
        service.create(
          { key: "NGANG_ADMIN", name: "x", level, permissions: [] },
          { actorId: "admin" },
        ),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    }
    expect(db.role.create).not.toHaveBeenCalled();
  });

  it("ADMIN KHÔNG sửa được vai trò ADMIN hay SUPER_ADMIN — kể cả chỉ tick quyền", async () => {
    const { db, service } = setup();

    for (const key of ["ADMIN", "SUPER_ADMIN"]) {
      await expect(
        service.update(key, { permissions: ["user:read"] }, { actorId: "admin" }),
      ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    }
    expect(db.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it("ADMIN KHÔNG nâng được vai trò bậc thấp lên ngang mình", async () => {
    const { db, service } = setup();

    await expect(
      service.update("KE_TOAN", { level: 50 }, { actorId: "admin" }),
    ).rejects.toBeInstanceOf(InsufficientRoleLevelError);
    expect(db.role.update).not.toHaveBeenCalled();
  });

  it("ADMIN KHÔNG xoá được vai trò trên bậc mình", async () => {
    const { db, service } = setup();

    await expect(service.remove("CU", { actorId: "admin" })).rejects.toBeInstanceOf(
      InsufficientRoleLevelError,
    );
    expect(db.role.delete).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN sửa được vai trò ADMIN", async () => {
    const { permissions, service } = setup();

    await expect(
      service.update("ADMIN", { permissions: ["user:read", "report:read"] }, { actorId: "sa" }),
    ).resolves.toBeDefined();
    expect(permissions.invalidateAll).toHaveBeenCalled();
  });

  it("thao tác của HỆ THỐNG (actorId null tường minh) không bị chặn", async () => {
    const { service } = setup();

    await expect(
      service.update("SUPER_ADMIN", { permissions: ["payout:approve"] }, { actorId: null }),
    ).resolves.toBeDefined();
  });

  it("vẫn giữ luật cũ: không xoá vai trò hệ thống, không xoá vai trò còn người mang", async () => {
    const { service } = setup([
      ...defaultRoles(),
      { id: "r-busy", key: "BAN", level: 5, isSystem: false, permissions: [], userCount: 3 },
    ]);

    await expect(service.remove("USER", { actorId: "sa" })).rejects.toBeInstanceOf(
      SystemRoleImmutableError,
    );
    await expect(service.remove("BAN", { actorId: "sa" })).rejects.toBeInstanceOf(RoleInUseError);
  });
});

describe("RoleService — không cấp quyền mình không có", () => {
  it("ADMIN KHÔNG tick được `payout:approve` cho vai trò USER", async () => {
    /*
     * Chốt bậc cho ADMIN sửa USER (bậc 0) — và mọi tài khoản đều mang USER.
     * Không có chốt này, ADMIN có ngay quyền chi tiền chỉ SUPER_ADMIN được có,
     * qua bất kỳ tài khoản phụ nào của mình.
     */
    const { db, service } = setup();

    await expect(
      service.update("USER", { permissions: ["payout:approve"] }, { actorId: "admin" }),
    ).rejects.toBeInstanceOf(PermissionNotHeldError);
    expect(db.rolePermission.createMany).not.toHaveBeenCalled();
  });

  it("ADMIN KHÔNG tạo được vai trò bậc 49 mang quyền mình không có", async () => {
    const { db, service } = setup();

    await expect(
      service.create(
        { key: "PHU", name: "Phụ", level: 49, permissions: ["setting:update"] },
        { actorId: "admin" },
      ),
    ).rejects.toBeInstanceOf(PermissionNotHeldError);
    expect(db.role.create).not.toHaveBeenCalled();
  });

  it("chỉ xét quyền được THÊM — quyền có sẵn do bậc trên cấp không chặn việc lưu", async () => {
    // KE_TOAN đã có `payout:approve` (SUPER_ADMIN cấp). ADMIN không có quyền đó
    // nhưng vẫn phải lưu được thay đổi khác của vai trò mà không phải gỡ nó.
    const roles = defaultRoles().map((role) =>
      role.key === "KE_TOAN" ? { ...role, permissions: ["payout:approve"] } : role,
    );
    const { db, service } = setup(roles);

    await expect(
      service.update(
        "KE_TOAN",
        { permissions: ["payout:approve", "report:read"] },
        { actorId: "admin" },
      ),
    ).resolves.toBeDefined();
    expect(db.rolePermission.createMany).toHaveBeenCalled();
  });
});
