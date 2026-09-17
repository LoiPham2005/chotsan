import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  VENUE_OWNER_ONLY,
  VENUE_STAFF_DEFAULT,
  VENUE_STAFF_GRANTABLE,
  type Permission,
} from "@/lib/permissions";
import type { PermissionService } from "./permission.service";
import {
  canManageMember,
  MemberAlreadyInVenueError,
  MemberGrantNotHeldError,
  MemberManagerGrantError,
  MemberManagerProtectedError,
  MemberNotRegisteredError,
  MemberOwnerFixedError,
  MemberOwnerOnlyPermissionError,
  MemberPermissionError,
  MemberSelfManageError,
  MemberService,
} from "./member.service";

/**
 * Hai loại lỗi đắt nhất của tầng nhân sự:
 *
 *   1. Ba quyền không bao giờ tick được cho nhân viên — rút tiền, xoá sân,
 *      chuyển nhượng sân. Chặn Ở SERVICE: giao diện là gợi ý, service mới là
 *      luật, và request tự chế gửi thẳng vào action đi qua đúng chỗ này.
 *   2. Nhân viên có `member:manage` tự leo quyền: tự tick quyền cho mình, cấp
 *      quyền mình không có, gỡ quản lý khác.
 *
 * Nhân vật: `chu` là chủ sân v1; `ql` là nhân viên v1 có `member:manage` +
 * `payment:confirm`; `nv` là nhân viên v1 thường; `admin` là quản trị nền tảng
 * có `member:manage` toàn cục.
 */

type MemberRow = {
  id: string;
  venueId: string;
  userId: string;
  role: "OWNER" | "STAFF";
  permissions: string[];
};

const MEMBERS: MemberRow[] = [
  { id: "m-chu", venueId: "v1", userId: "chu", role: "OWNER", permissions: [] },
  {
    id: "m-ql",
    venueId: "v1",
    userId: "ql",
    role: "STAFF",
    permissions: ["member:manage", "payment:confirm"],
  },
  { id: "m-nv", venueId: "v1", userId: "nv", role: "STAFF", permissions: ["payment:refund"] },
  { id: "m-v2", venueId: "v2", userId: "nv2", role: "STAFF", permissions: [] },
];

function createDb(options: { user?: { id: string } | null } = {}) {
  const db = {
    user: { findFirst: vi.fn().mockResolvedValue("user" in options ? options.user : { id: "u2" }) },
    venueMember: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      // Lọc THẬT theo `{ id, venueId }`: mock trả bừa một thành viên thì bài
      // "id của sân khác" xanh cả khi service quên đưa `venueId` vào truy vấn.
      findFirst: vi.fn(({ where }: { where: { id: string; venueId: string } }) =>
        Promise.resolve(
          MEMBERS.find((member) => member.id === where.id && member.venueId === where.venueId) ??
            null,
        ),
      ),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "m1", ...data }),
      ),
      update: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "m1", ...data }),
      ),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  return { db: db as unknown as PrismaClient, mock: db };
}

/**
 * `PermissionService` giả, tính quyền trên sân đúng luật `canOnVenue` rút gọn:
 * chủ có mọi quyền theo sân của sân mình, nhân viên có bộ mặc định + phần được
 * tick, quyền toàn cục (trừ nhóm chỉ-chủ-sân) áp cho mọi sân.
 */
function createPermissions(global: Record<string, Permission[]> = { admin: ["member:manage"] }) {
  const venuePermissions = vi.fn((userId: string, venueId: string) => {
    const member = MEMBERS.find((row) => row.userId === userId && row.venueId === venueId);
    const result = new Set<string>(
      (global[userId] ?? []).filter((key) => !VENUE_OWNER_ONLY.includes(key)),
    );
    if (member?.role === "OWNER") {
      [...VENUE_STAFF_DEFAULT, ...VENUE_STAFF_GRANTABLE, ...VENUE_OWNER_ONLY].forEach((key) =>
        result.add(key),
      );
    } else if (member) {
      [...VENUE_STAFF_DEFAULT, ...member.permissions].forEach((key) => result.add(key));
    }
    return Promise.resolve(result);
  });

  return {
    invalidateUser: vi.fn().mockResolvedValue(undefined),
    permissionsFor: vi.fn((userId: string) => Promise.resolve(new Set(global[userId] ?? []))),
    venuePermissions,
  } as unknown as PermissionService & { invalidateUser: ReturnType<typeof vi.fn> };
}

function setup(options: { user?: { id: string } | null } = {}) {
  const { db, mock } = createDb(options);
  const permissions = createPermissions();
  return { service: new MemberService(db, permissions), mock, permissions };
}

beforeEach(() => vi.clearAllMocks());

describe("invite — mời nhân viên", () => {
  it("tạo thành viên STAFF không kèm quyền nào", async () => {
    // Nhân viên mới bắt đầu từ bộ quyền mặc định của vai trò; quyền tick thêm
    // là quyết định riêng của chủ sân cho từng người.
    const { service, mock } = setup();
    await service.invite({ venueId: "v1", email: " A@B.CO ", invitedBy: "chu" });

    const [{ where }] = mock.user.findFirst.mock.calls[0] as [{ where: { email: string } }];
    expect(where.email).toBe("a@b.co");
    expect(mock.venueMember.create.mock.calls[0]![0].data).toMatchObject({
      venueId: "v1",
      userId: "u2",
      role: "STAFF",
      permissions: [],
      invitedBy: "chu",
    });
  });

  it("xoá bộ nhớ đệm quyền ngay — nếu không họ chờ 60 giây mới vào được", async () => {
    const { service, permissions } = setup();
    await service.invite({ venueId: "v1", email: "a@b.co", invitedBy: "chu" });

    expect(permissions.invalidateUser).toHaveBeenCalledWith("u2");
  });

  it("chưa có tài khoản thì nói thẳng, không tạo lời mời treo", async () => {
    const { service } = setup({ user: null });

    await expect(
      service.invite({ venueId: "v1", email: "x@y.z", invitedBy: "chu" }),
    ).rejects.toBeInstanceOf(MemberNotRegisteredError);
  });

  it("mời lại người đã ở trong sân thì báo lỗi", async () => {
    const { service, mock } = setup();
    mock.venueMember.findUnique.mockResolvedValue({ id: "m0" });

    await expect(
      service.invite({ venueId: "v1", email: "a@b.co", invitedBy: "chu" }),
    ).rejects.toBeInstanceOf(MemberAlreadyInVenueError);
    expect(mock.venueMember.create).not.toHaveBeenCalled();
  });
});

describe("setPermissions — tick quyền cho nhân viên", () => {
  it("chủ sân tick được mọi quyền trong danh sách tick được", async () => {
    const { service, mock } = setup();
    await service.setPermissions({
      memberId: "m-nv",
      venueId: "v1",
      permissions: [...VENUE_STAFF_GRANTABLE],
      actorId: "chu",
    });

    expect(mock.venueMember.update.mock.calls[0]![0].data.permissions).toEqual([
      ...VENUE_STAFF_GRANTABLE,
    ]);
  });

  it("bỏ quyền trùng lặp", async () => {
    const { service, mock } = setup();
    const key = VENUE_STAFF_GRANTABLE[0]!;
    await service.setPermissions({
      memberId: "m-nv",
      venueId: "v1",
      permissions: [key, key, key],
      actorId: "chu",
    });

    expect(mock.venueMember.update.mock.calls[0]![0].data.permissions).toEqual([key]);
  });

  /** Đây là phép kiểm quan trọng nhất của cả tệp. */
  it("CHẶN cả ba quyền chỉ-chủ-sân, dù giao diện có gửi lên", async () => {
    for (const key of VENUE_OWNER_ONLY) {
      const { service, mock } = setup();
      await expect(
        service.setPermissions({
          memberId: "m-nv",
          venueId: "v1",
          permissions: [key],
          actorId: "chu",
        }),
      ).rejects.toBeInstanceOf(MemberOwnerOnlyPermissionError);
      expect(mock.venueMember.update).not.toHaveBeenCalled();
    }
  });

  it("chặn quyền bịa hoặc quyền toàn nền tảng", async () => {
    for (const key of ["khong-ton-tai", "venue:approve", "setting:update"]) {
      const { service } = setup();
      await expect(
        service.setPermissions({
          memberId: "m-nv",
          venueId: "v1",
          permissions: [key],
          actorId: "chu",
        }),
      ).rejects.toBeInstanceOf(MemberPermissionError);
    }
  });

  it("không đổi quyền của CHỦ SÂN — chủ sân luôn có tất cả", async () => {
    const { service } = setup();

    await expect(
      service.setPermissions({
        memberId: "m-chu",
        venueId: "v1",
        permissions: [],
        actorId: "admin",
      }),
    ).rejects.toBeInstanceOf(MemberOwnerFixedError);
  });

  it("không đụng được nhân sự của sân khác", async () => {
    // `m-v2` có thật — nhưng ở sân v2, còn action đang chạy trên v1.
    const { service, mock } = setup();

    await expect(
      service.setPermissions({ memberId: "m-v2", venueId: "v1", permissions: [], actorId: "chu" }),
    ).rejects.toThrow("Không tìm thấy");
    expect(mock.venueMember.update).not.toHaveBeenCalled();
  });
});

describe("chống nhân viên quản lý nhân sự tự leo quyền", () => {
  it("không ai tự sửa quyền của chính mình — kể cả quản lý", async () => {
    // Lỗi thật trước đây: nhân viên có `member:manage` tự tick cho MÌNH quyền
    // hoàn tiền, sửa giá, sửa tài khoản ngân hàng.
    const { service, mock } = setup();

    await expect(
      service.setPermissions({
        memberId: "m-ql",
        venueId: "v1",
        permissions: ["member:manage", "payment:refund"],
        actorId: "ql",
      }),
    ).rejects.toBeInstanceOf(MemberSelfManageError);
    expect(mock.venueMember.update).not.toHaveBeenCalled();
  });

  it("không ai tự gỡ mình khỏi sân", async () => {
    const { service, mock } = setup();

    await expect(
      service.remove({ memberId: "m-nv", venueId: "v1", actorId: "nv" }),
    ).rejects.toBeInstanceOf(MemberSelfManageError);
    expect(mock.venueMember.delete).not.toHaveBeenCalled();
  });

  it("nhân viên quản lý KHÔNG cấp được `member:manage` cho người khác", async () => {
    const { service, mock } = setup();

    await expect(
      service.setPermissions({
        memberId: "m-nv",
        venueId: "v1",
        permissions: ["payment:refund", "member:manage"],
        actorId: "ql",
      }),
    ).rejects.toBeInstanceOf(MemberManagerGrantError);
    expect(mock.venueMember.update).not.toHaveBeenCalled();
  });

  it("nhân viên quản lý chỉ CẤP được quyền mà chính họ đang có ở sân đó", async () => {
    const { service, mock } = setup();

    // `ql` không có `pricing:update` → không cấp được.
    await expect(
      service.setPermissions({
        memberId: "m-nv",
        venueId: "v1",
        permissions: ["payment:refund", "pricing:update"],
        actorId: "ql",
      }),
    ).rejects.toBeInstanceOf(MemberGrantNotHeldError);
    expect(mock.venueMember.update).not.toHaveBeenCalled();

    // `ql` có `payment:confirm` → cấp được. `payment:refund` là quyền CÓ SẴN của
    // `nv` (chủ sân cấp) — `ql` không có nó nhưng giữ nguyên thì không bị chặn.
    await expect(
      service.setPermissions({
        memberId: "m-nv",
        venueId: "v1",
        permissions: ["payment:refund", "payment:confirm"],
        actorId: "ql",
      }),
    ).resolves.toBeDefined();
  });

  it("chỉ chủ sân mới sửa hoặc gỡ được người đang giữ `member:manage`", async () => {
    const { service, mock } = setup();
    // Một quản lý thứ hai của v1 thao tác lên `ql`.
    MEMBERS.push({
      id: "m-ql2",
      venueId: "v1",
      userId: "ql2",
      role: "STAFF",
      permissions: ["member:manage"],
    });

    try {
      await expect(
        service.setPermissions({
          memberId: "m-ql",
          venueId: "v1",
          permissions: [],
          actorId: "ql2",
        }),
      ).rejects.toBeInstanceOf(MemberManagerProtectedError);
      await expect(
        service.remove({ memberId: "m-ql", venueId: "v1", actorId: "ql2" }),
      ).rejects.toBeInstanceOf(MemberManagerProtectedError);
      expect(mock.venueMember.delete).not.toHaveBeenCalled();

      // Chủ sân thì được.
      await expect(
        service.remove({ memberId: "m-ql", venueId: "v1", actorId: "chu" }),
      ).resolves.toBeUndefined();
    } finally {
      MEMBERS.pop();
    }
  });

  it("quản trị nền tảng có `member:manage` toàn cục làm được việc của chủ sân", async () => {
    const { service } = setup();

    await expect(
      service.setPermissions({
        memberId: "m-ql",
        venueId: "v1",
        permissions: ["payment:confirm"],
        actorId: "admin",
      }),
    ).resolves.toBeDefined();
  });

  it("LỆCH SÂN: chủ sân v1 không mang quyền chủ sang sân v2", async () => {
    /*
     * `chu` là chủ v1, không là gì ở v2. Giả sử action v2 để lọt (ví dụ `chu`
     * được tick `member:manage` ở v2 như một nhân viên): service phải tính
     * phạm vi theo ĐÚNG sân đang thao tác, không theo "là chủ ở đâu đó".
     */
    const { service } = setup();
    MEMBERS.push(
      {
        id: "m-chu-v2",
        venueId: "v2",
        userId: "chu",
        role: "STAFF",
        permissions: ["member:manage"],
      },
      {
        id: "m-ql-v2",
        venueId: "v2",
        userId: "ql-v2",
        role: "STAFF",
        permissions: ["member:manage"],
      },
    );

    try {
      const scope = await service.managementScope("v2", "chu");
      expect(scope.canManageManagers).toBe(false);
      expect(scope.grantable).not.toContain("member:manage");

      await expect(
        service.remove({ memberId: "m-ql-v2", venueId: "v2", actorId: "chu" }),
      ).rejects.toBeInstanceOf(MemberManagerProtectedError);
    } finally {
      MEMBERS.splice(-2, 2);
    }
  });
});

describe("managementScope — thứ trang nhân sự dùng để ẩn điều khiển", () => {
  it("chủ sân: quản được quản lý, cấp được mọi quyền tick được", async () => {
    const { service } = setup();

    await expect(service.managementScope("v1", "chu")).resolves.toEqual({
      canManageManagers: true,
      grantable: [...VENUE_STAFF_GRANTABLE],
    });
  });

  it("nhân viên quản lý: chỉ những quyền chính mình có, không có `member:manage`", async () => {
    const { service } = setup();

    await expect(service.managementScope("v1", "ql")).resolves.toEqual({
      canManageManagers: false,
      grantable: ["payment:confirm"],
    });
  });

  it("`canManageMember` (ẩn nút) nói ĐÚNG điều `remove` (từ chối) nói — mọi cặp người thao tác × thành viên", async () => {
    // Lệch nhau là giao diện hiện nút "Gỡ" bấm vào bị từ chối, hoặc giấu nút
    // của việc người đó được làm.
    for (const actorId of ["chu", "ql", "nv", "admin"]) {
      for (const member of MEMBERS.filter((row) => row.venueId === "v1")) {
        const { service } = setup();
        const scope = await service.managementScope("v1", actorId);

        const allowed = await service
          .remove({ memberId: member.id, venueId: "v1", actorId })
          .then(() => true)
          .catch(() => false);

        expect(canManageMember(scope, actorId, member), `${actorId} → ${member.id}`).toBe(allowed);
      }
    }
  });
});

describe("remove — gỡ nhân sự", () => {
  it("chủ sân gỡ được nhân viên và xoá bộ nhớ đệm quyền", async () => {
    const { service, mock, permissions } = setup();
    await service.remove({ memberId: "m-nv", venueId: "v1", actorId: "chu" });

    expect(mock.venueMember.delete).toHaveBeenCalledWith({ where: { id: "m-nv" } });
    expect(permissions.invalidateUser).toHaveBeenCalledWith("nv");
  });

  it("KHÔNG gỡ được chủ sân — cơ sở phải luôn có đúng một chủ", async () => {
    const { service, mock } = setup();

    await expect(
      service.remove({ memberId: "m-chu", venueId: "v1", actorId: "admin" }),
    ).rejects.toBeInstanceOf(MemberOwnerFixedError);
    expect(mock.venueMember.delete).not.toHaveBeenCalled();
  });
});
