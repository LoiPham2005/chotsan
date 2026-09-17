import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { seedRbac } from "../../prisma/seeds/seed-rbac";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_METADATA,
  SYSTEM_ROLES,
  isKnownPermission,
  resolveSeedPermissions,
} from "./permissions";

/**
 * Danh mục quyền là nguồn sự thật cho seed và cho việc lọc dữ liệu đọc lên từ
 * database. Sai ở đây thì sai lan ra cả hệ thống, nên nó phải tự nhất quán.
 */

describe("danh mục PERMISSIONS", () => {
  it("không có tên quyền trùng nhau", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("mọi quyền đều theo quy ước <tài-nguyên>:<hành-động>", () => {
    for (const permission of PERMISSIONS) {
      expect(permission, `sai quy ước: ${permission}`).toMatch(/^[a-z]+:[a-z]+(:own)?$/);
    }
  });

  it("mọi quyền đều có mô tả hiển thị", () => {
    // Thiếu mô tả thì giao diện phân quyền hiện ra một ô trống, và người quản
    // trị phải đoán xem mình đang tick vào cái gì.
    for (const permission of PERMISSIONS) {
      expect(
        PERMISSION_METADATA[permission].description,
        `thiếu mô tả: ${permission}`,
      ).toBeTruthy();
    }
  });
});

describe("isKnownPermission", () => {
  it("nhận quyền có trong danh mục", () => {
    expect(isKnownPermission("user:read")).toBe(true);
  });

  it("từ chối chuỗi lạ", () => {
    // Đây là lớp chặn bản ghi còn sót trong database sau khi một quyền bị xoá
    // khỏi code. Không có nó, dòng cũ vẫn cấp quyền mà không mã nào kiểm tra.
    expect(isKnownPermission("user:destroy")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
  });
});

function seedFor(key: string) {
  const seed = DEFAULT_ROLE_PERMISSIONS.find((role) => role.key === key);
  if (!seed) throw new Error(`Thiếu vai trò seed: ${key}`);
  return seed;
}

describe("DEFAULT_ROLE_PERMISSIONS", () => {
  it("có đủ mọi vai trò hệ thống khai trong SYSTEM_ROLES", () => {
    // Khai trong `SYSTEM_ROLES` mà quên seed thì code tham chiếu tới vai trò
    // đó vẫn biên dịch được, nhưng lúc chạy tra database sẽ không thấy gì.
    const keys = DEFAULT_ROLE_PERMISSIONS.map((role) => role.key);

    for (const key of Object.values(SYSTEM_ROLES)) {
      expect(keys, `thiếu seed cho vai trò ${key}`).toContain(key);
    }
  });

  it("mọi quyền được gán đều nằm trong danh mục", () => {
    for (const role of DEFAULT_ROLE_PERMISSIONS) {
      for (const permission of resolveSeedPermissions(role)) {
        expect(PERMISSIONS, `${role.key} gán quyền lạ: ${permission}`).toContain(permission);
      }
    }
  });

  it("không vai trò nào bị gán trùng một quyền hai lần", () => {
    for (const role of DEFAULT_ROLE_PERMISSIONS) {
      const permissions = resolveSeedPermissions(role);
      expect(new Set(permissions).size, `${role.key} có quyền lặp`).toBe(permissions.length);
    }
  });

  it('SUPER_ADMIN dùng "*" và giải ra ĐÚNG toàn bộ danh mục', () => {
    const superAdmin = seedFor(SYSTEM_ROLES.SUPER_ADMIN);

    // Liệt kê tay thì mỗi lần thêm quyền mới lại phải nhớ bổ sung — quên một
    // lần là SUPER_ADMIN mất quyền đó mà không ai để ý cho tới lúc cần dùng.
    expect(superAdmin.permissions).toBe("*");
    expect(resolveSeedPermissions(superAdmin)).toEqual(PERMISSIONS);
  });

  it("USER chỉ chạm được dữ liệu của chính mình", () => {
    /*
     * `notification:read` KHÔNG có hậu tố `:own` nhưng vẫn hợp lệ: service
     * thông báo luôn lọc theo `userId` của người đang đăng nhập, không có
     * đường nào đọc hộp thư của người khác.
     *
     * Thứ phải chặn là các quyền chạm tới dữ liệu NGƯỜI KHÁC — quản lý người
     * dùng, phân quyền, nhật ký, gửi thông báo cho người khác.
     */
    const forbidden = ["user:", "role:", "audit:"];

    for (const permission of resolveSeedPermissions(seedFor(SYSTEM_ROLES.USER))) {
      for (const prefix of forbidden) {
        expect(permission.startsWith(prefix), `USER không được có ${permission}`).toBe(false);
      }
      expect(permission, "USER không được gửi thông báo cho người khác").not.toBe(
        "notification:send",
      );
    }
  });

  it("bậc quyền lực (level) không trùng nhau và tăng dần theo độ mạnh", () => {
    // `Role.level` là thứ chặn leo thang đặc quyền: `assertCanActOn` từ chối
    // khi mục tiêu có level ≥ level của người thao tác. Hai vai trò cùng level
    // nghĩa là chúng thao tác được lên nhau — gần như luôn là nhầm.
    const levels = DEFAULT_ROLE_PERMISSIONS.map((role) => role.level);

    expect(new Set(levels).size, "có hai vai trò trùng level").toBe(levels.length);
    expect(seedFor(SYSTEM_ROLES.SUPER_ADMIN).level).toBeGreaterThan(
      seedFor(SYSTEM_ROLES.ADMIN).level,
    );
    expect(seedFor(SYSTEM_ROLES.USER).level).toBe(0);
  });

  it("vai trò level cao hơn có đủ mọi quyền của vai trò ngay dưới nó", () => {
    /*
     * Ràng buộc thật sự quan trọng.
     *
     * `Role.level` nói "vai trò này mạnh hơn", còn bảng quyền mới là thứ quyết
     * định làm được gì. Nếu hai thứ lệch nhau — ADMIN level 50 nhưng thiếu
     * một quyền mà USER level 0 có — thì admin sẽ thăng cấp cho ai đó và vô
     * tình lấy mất quyền của họ.
     */
    const ordered = [...DEFAULT_ROLE_PERMISSIONS].sort((a, b) => a.level - b.level);

    for (let index = 1; index < ordered.length; index += 1) {
      const lower = resolveSeedPermissions(ordered[index - 1]!);
      const higher = new Set(resolveSeedPermissions(ordered[index]!));

      for (const permission of lower) {
        expect(
          higher.has(permission),
          `${ordered[index]!.key} (level ${ordered[index]!.level}) thiếu ${permission} mà ${ordered[index - 1]!.key} có`,
        ).toBe(true);
      }
    }
  });
});

/**
 * `seedRbac` chạy sau MỖI lần deploy. Test ở đây vì bộ test chỉ quét `src/**`;
 * nó là nơi `DEFAULT_ROLE_PERMISSIONS` biến thành dữ liệu thật.
 *
 * Database giả giữ ba bảng trong bộ nhớ và LỌC THẬT theo `where` — trả bừa thì
 * bài "không thêm lại quyền đã gỡ" xanh cả khi seed gắn nhầm mọi thứ.
 */
function createRbacDb() {
  const permissions = new Map<string, string>(); // key → id
  const roles = new Map<string, { id: string; level: number; name: string }>();
  const links = new Set<string>(); // `${roleId}|${permissionId}`

  const db = {
    permission: {
      findMany: ({ where }: { where?: { key: { in: string[] } } }) =>
        Promise.resolve(
          [...permissions]
            .filter(([key]) => !where || where.key.in.includes(key))
            .map(([key, id]) => ({ key, id })),
        ),
      upsert: ({ where }: { where: { key: string } }) => {
        if (!permissions.has(where.key)) permissions.set(where.key, `p-${where.key}`);
        return Promise.resolve({ id: permissions.get(where.key) });
      },
    },
    role: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(roles.has(where.key) ? { id: roles.get(where.key)!.id } : null),
      upsert: ({
        where,
        update,
        create,
      }: {
        where: { key: string };
        update: { level: number };
        create: { level: number; name: string };
      }) => {
        const existing = roles.get(where.key);
        if (existing) existing.level = update.level;
        else roles.set(where.key, { id: `r-${where.key}`, level: create.level, name: create.name });
        return Promise.resolve({ id: roles.get(where.key)!.id });
      },
    },
    rolePermission: {
      createMany: ({ data }: { data: { roleId: string; permissionId: string }[] }) => {
        for (const row of data) links.add(`${row.roleId}|${row.permissionId}`);
        return Promise.resolve({ count: data.length });
      },
    },
  };

  const keysOf = (roleKey: string) =>
    [...links]
      .filter((link) => link.startsWith(`r-${roleKey}|`))
      .map((link) => link.slice(link.indexOf("|p-") + 3))
      .sort();

  return {
    prisma: db as unknown as PrismaClient,
    keysOf,
    removeLink: (roleKey: string, permission: string) =>
      links.delete(`r-${roleKey}|p-${permission}`),
    /** Giả lập database của bản CŨ, lúc code chưa có quyền này. */
    forgetPermission: (permission: string) => {
      permissions.delete(permission);
      for (const link of links) if (link.endsWith(`|p-${permission}`)) links.delete(link);
    },
    roles,
  };
}

describe("seedRbac — chỉ thêm quyền chưa ai từng quyết định", () => {
  const ADMIN = SYSTEM_ROLES.ADMIN;
  const SUPER_ADMIN = SYSTEM_ROLES.SUPER_ADMIN;

  it("database trống: mọi vai trò nhận đủ quyền mặc định, SUPER_ADMIN nhận tất cả", async () => {
    const db = createRbacDb();

    await seedRbac(db.prisma);

    expect(db.keysOf(ADMIN)).toEqual([...resolveSeedPermissions(seedFor(ADMIN))].sort());
    expect(db.keysOf(SUPER_ADMIN)).toEqual([...PERMISSIONS].sort());
  });

  it("quyền mặc định admin ĐÃ GỠ khỏi vai trò thì lần deploy sau KHÔNG quay lại", async () => {
    // Lỗi thật trước đây: seed thêm lại mọi quyền mặc định còn thiếu, xoá sạch
    // cấu hình của khách mỗi lần deploy.
    const db = createRbacDb();
    await seedRbac(db.prisma);
    db.removeLink(ADMIN, "payment:refund");

    await seedRbac(db.prisma);

    expect(db.keysOf(ADMIN)).not.toContain("payment:refund");
    expect(db.keysOf(ADMIN)).toContain("payment:confirm");
  });

  it("quyền MỚI thêm vào code (chưa từng có trong database) được gắn cho vai trò mặc định có nó", async () => {
    const db = createRbacDb();
    await seedRbac(db.prisma);
    db.forgetPermission("invoice:manage");

    await seedRbac(db.prisma);

    expect(db.keysOf(ADMIN)).toContain("invoice:manage");
  });

  it('SUPER_ADMIN ("*") luôn được bù đủ — kể cả quyền ai đó đã gỡ', async () => {
    const db = createRbacDb();
    await seedRbac(db.prisma);
    db.removeLink(SUPER_ADMIN, "user:delete");

    await seedRbac(db.prisma);

    expect(db.keysOf(SUPER_ADMIN)).toContain("user:delete");
  });

  it("vai trò hệ thống bị xoá rồi tạo lại trong lần chạy: nhận đủ bộ mặc định", async () => {
    const db = createRbacDb();
    await seedRbac(db.prisma);
    db.removeLink(ADMIN, "payment:refund");
    db.roles.delete(ADMIN);

    await seedRbac(db.prisma);

    expect(db.keysOf(ADMIN)).toContain("payment:refund");
  });

  it("level luôn đồng bộ từ code — bậc bị hạ trong database được sửa lại", async () => {
    const db = createRbacDb();
    await seedRbac(db.prisma);
    db.roles.get(SUPER_ADMIN)!.level = 5;

    await seedRbac(db.prisma);

    expect(db.roles.get(SUPER_ADMIN)!.level).toBe(seedFor(SUPER_ADMIN).level);
  });
});
