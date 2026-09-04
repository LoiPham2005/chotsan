import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { VENUE_OWNER_ONLY, VENUE_STAFF_GRANTABLE } from "@/lib/permissions";
import {
  MemberAlreadyInVenueError,
  MemberNotRegisteredError,
  MemberOwnerFixedError,
  MemberOwnerOnlyPermissionError,
  MemberPermissionError,
  MemberService,
} from "./member.service";

vi.mock("@/services/permission.service", () => ({
  permissionService: { invalidateUser: vi.fn().mockResolvedValue(undefined) },
}));

const { permissionService } = await import("@/services/permission.service");

/**
 * Ba quyền không bao giờ tick được cho nhân viên: rút tiền, xoá sân, chuyển
 * nhượng sân. Chúng phải bị chặn Ở SERVICE — giao diện là gợi ý, service mới
 * là luật, và một request tự chế gửi thẳng vào action đi qua đúng chỗ này.
 */

function createDb(options: { user?: { id: string } | null; member?: unknown } = {}) {
  const db = {
    user: { findFirst: vi.fn().mockResolvedValue("user" in options ? options.user : { id: "u2" }) },
    venueMember: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi
        .fn()
        .mockResolvedValue(
          "member" in options ? options.member : { id: "m1", userId: "u2", role: "STAFF" },
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

beforeEach(() => vi.clearAllMocks());

describe("invite — mời nhân viên", () => {
  it("tạo thành viên STAFF không kèm quyền nào", async () => {
    // Nhân viên mới bắt đầu từ bộ quyền mặc định của vai trò; quyền tick thêm
    // là quyết định riêng của chủ sân cho từng người.
    const { db, mock } = createDb();
    await new MemberService(db).invite({ venueId: "v1", email: " A@B.CO ", invitedBy: "u1" });

    const [{ where }] = mock.user.findFirst.mock.calls[0] as [{ where: { email: string } }];
    expect(where.email).toBe("a@b.co");
    expect(mock.venueMember.create.mock.calls[0]![0].data).toMatchObject({
      venueId: "v1",
      userId: "u2",
      role: "STAFF",
      permissions: [],
      invitedBy: "u1",
    });
  });

  it("xoá bộ nhớ đệm quyền ngay — nếu không họ chờ 60 giây mới vào được", async () => {
    const { db } = createDb();
    await new MemberService(db).invite({ venueId: "v1", email: "a@b.co", invitedBy: "u1" });

    expect(permissionService.invalidateUser).toHaveBeenCalledWith("u2");
  });

  it("chưa có tài khoản thì nói thẳng, không tạo lời mời treo", async () => {
    const { db } = createDb({ user: null });

    await expect(
      new MemberService(db).invite({ venueId: "v1", email: "x@y.z", invitedBy: "u1" }),
    ).rejects.toBeInstanceOf(MemberNotRegisteredError);
  });

  it("mời lại người đã ở trong sân thì báo lỗi", async () => {
    const { db, mock } = createDb();
    mock.venueMember.findUnique.mockResolvedValue({ id: "m0" });

    await expect(
      new MemberService(db).invite({ venueId: "v1", email: "a@b.co", invitedBy: "u1" }),
    ).rejects.toBeInstanceOf(MemberAlreadyInVenueError);
    expect(mock.venueMember.create).not.toHaveBeenCalled();
  });
});

describe("setPermissions — tick quyền cho nhân viên", () => {
  it("nhận mọi quyền trong danh sách tick được", async () => {
    const { db, mock } = createDb();
    await new MemberService(db).setPermissions({
      memberId: "m1",
      venueId: "v1",
      permissions: [...VENUE_STAFF_GRANTABLE],
    });

    expect(mock.venueMember.update.mock.calls[0]![0].data.permissions).toEqual([
      ...VENUE_STAFF_GRANTABLE,
    ]);
  });

  it("bỏ quyền trùng lặp", async () => {
    const { db, mock } = createDb();
    const key = VENUE_STAFF_GRANTABLE[0]!;
    await new MemberService(db).setPermissions({
      memberId: "m1",
      venueId: "v1",
      permissions: [key, key, key],
    });

    expect(mock.venueMember.update.mock.calls[0]![0].data.permissions).toEqual([key]);
  });

  /** Đây là phép kiểm quan trọng nhất của cả tệp. */
  it("CHẶN cả ba quyền chỉ-chủ-sân, dù giao diện có gửi lên", async () => {
    for (const key of VENUE_OWNER_ONLY) {
      const { db, mock } = createDb();
      await expect(
        new MemberService(db).setPermissions({ memberId: "m1", venueId: "v1", permissions: [key] }),
      ).rejects.toBeInstanceOf(MemberOwnerOnlyPermissionError);
      expect(mock.venueMember.update).not.toHaveBeenCalled();
    }
  });

  it("chặn quyền bịa hoặc quyền toàn nền tảng", async () => {
    for (const key of ["khong-ton-tai", "venue:approve", "setting:update"]) {
      const { db } = createDb();
      await expect(
        new MemberService(db).setPermissions({ memberId: "m1", venueId: "v1", permissions: [key] }),
      ).rejects.toBeInstanceOf(MemberPermissionError);
    }
  });

  it("không đổi quyền của CHỦ SÂN — chủ sân luôn có tất cả", async () => {
    const { db } = createDb({ member: { id: "m1", userId: "u1", role: "OWNER" } });

    await expect(
      new MemberService(db).setPermissions({ memberId: "m1", venueId: "v1", permissions: [] }),
    ).rejects.toBeInstanceOf(MemberOwnerFixedError);
  });

  it("không đụng được nhân sự của sân khác", async () => {
    const { db, mock } = createDb({ member: null });

    await expect(
      new MemberService(db).setPermissions({ memberId: "m1", venueId: "v1", permissions: [] }),
    ).rejects.toThrow("Không tìm thấy");
    // Điều kiện ràng buộc nằm TRONG câu truy vấn, không phải kiểm rời sau đó.
    const [{ where }] = mock.venueMember.findFirst.mock.calls[0] as [
      { where: { id: string; venueId: string } },
    ];
    expect(where).toMatchObject({ id: "m1", venueId: "v1" });
  });
});

describe("remove — gỡ nhân sự", () => {
  it("gỡ được nhân viên và xoá bộ nhớ đệm quyền", async () => {
    const { db, mock } = createDb();
    await new MemberService(db).remove({ memberId: "m1", venueId: "v1" });

    expect(mock.venueMember.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(permissionService.invalidateUser).toHaveBeenCalledWith("u2");
  });

  it("KHÔNG gỡ được chủ sân — cơ sở phải luôn có đúng một chủ", async () => {
    const { db, mock } = createDb({ member: { id: "m1", userId: "u1", role: "OWNER" } });

    await expect(
      new MemberService(db).remove({ memberId: "m1", venueId: "v1" }),
    ).rejects.toBeInstanceOf(MemberOwnerFixedError);
    expect(mock.venueMember.delete).not.toHaveBeenCalled();
  });
});
