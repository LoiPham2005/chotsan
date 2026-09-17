import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS } from "@/lib/permissions";
import { PermissionService } from "./permission.service";

/**
 * Đây là bộ test quan trọng nhất của tầng phân quyền.
 *
 * Bản cũ của dự án chỉ kiểm phạm vi sân ở **2/29 service** — nghĩa là nhân viên
 * sân A thao tác được lên sân B nếu tìm đúng endpoint. Những test dưới đây khoá
 * chặt ranh giới đó ở đúng một chỗ: `canOnVenue`.
 *
 * `permissionsFor` được mock để test không cần database thật; thứ đang kiểm là
 * LUẬT phân quyền theo sân, không phải cách quyền toàn cục được đọc lên (đã có
 * `permission.service.test.ts` lo).
 */

type Member = {
  role: "OWNER" | "STAFF";
  status: "ACTIVE" | "INVITED" | "DISABLED";
  permissions: string[];
  venue: { deletedAt: Date | null };
};

function createService(member: Member | null, globalPermissions: string[] = []) {
  const db = {
    venueMember: { findUnique: vi.fn().mockResolvedValue(member) },
  } as unknown as PrismaClient;

  const service = new PermissionService(db);
  vi.spyOn(service, "permissionsFor").mockResolvedValue(new Set(globalPermissions) as never);

  return service;
}

/**
 * Bản LỌC THẬT theo khoá `(venueId, userId)` — cho các bài có nhiều sân, nơi
 * mock trả bừa một thành viên sẽ che mất đúng lỗi "quyền sân A dùng ở sân B".
 */
function createServiceWithMembers(
  members: Array<Member & { venueId: string; userId: string }>,
  globalPermissions: string[] = [],
) {
  const findUnique = vi.fn(
    ({ where }: { where: { venueId_userId: { venueId: string; userId: string } } }) =>
      Promise.resolve(
        members.find(
          (member) =>
            member.venueId === where.venueId_userId.venueId &&
            member.userId === where.venueId_userId.userId,
        ) ?? null,
      ),
  );
  const db = { venueMember: { findUnique } } as unknown as PrismaClient;

  const service = new PermissionService(db);
  vi.spyOn(service, "permissionsFor").mockResolvedValue(new Set(globalPermissions) as never);

  return service;
}

const LIVE_VENUE = { deletedAt: null };
const OWNER: Member = { role: "OWNER", status: "ACTIVE", permissions: [], venue: LIVE_VENUE };
const STAFF: Member = { role: "STAFF", status: "ACTIVE", permissions: [], venue: LIVE_VENUE };

beforeEach(() => vi.clearAllMocks());

describe("canOnVenue — chủ sân", () => {
  it("có mọi quyền trên sân mình sở hữu", async () => {
    const service = createService(OWNER);

    expect(await service.canOnVenue("u1", "booking:cancel", "v1")).toBe(true);
    expect(await service.canOnVenue("u1", "pricing:update", "v1")).toBe(true);
    expect(await service.canOnVenue("u1", "payout:manage", "v1")).toBe(true);
    expect(await service.canOnVenue("u1", "venue:delete", "v1")).toBe(true);
  });

  it("KHÔNG có quyền trên sân không phải của mình", async () => {
    // `findUnique` theo cặp (venueId, userId) không thấy dòng nào → không phải
    // thành viên sân đó. Đây chính là lỗ hổng của bản cũ.
    const service = createService(null);

    expect(await service.canOnVenue("u1", "booking:read", "v2")).toBe(false);
    expect(await service.canOnVenue("u1", "booking:cancel", "v2")).toBe(false);
  });
});

describe("canOnVenue — nhân viên", () => {
  it("dùng được ngay bộ quyền mặc định, không cần chủ sân tick gì", async () => {
    // Nếu test này đỏ thì mỗi lần tuyển người, chủ sân phải ngồi tick 12 ô —
    // quên một ô là nhân viên không làm việc được rồi gọi điện hỏi.
    const service = createService(STAFF);

    expect(await service.canOnVenue("u2", "venue:read", "v1")).toBe(true);
    expect(await service.canOnVenue("u2", "booking:read", "v1")).toBe(true);
    expect(await service.canOnVenue("u2", "booking:checkin", "v1")).toBe(true);
    expect(await service.canOnVenue("u2", "booking:create", "v1")).toBe(true);
  });

  it("KHÔNG có quyền nguy hiểm khi chưa được tick", async () => {
    const service = createService(STAFF);

    expect(await service.canOnVenue("u2", "payment:refund", "v1")).toBe(false);
    expect(await service.canOnVenue("u2", "pricing:update", "v1")).toBe(false);
    expect(await service.canOnVenue("u2", "report:read", "v1")).toBe(false);
  });

  it("có quyền sau khi chủ sân tick thêm", async () => {
    const service = createService({
      ...STAFF,
      permissions: ["payment:refund", "report:read"],
    });

    expect(await service.canOnVenue("u2", "payment:refund", "v1")).toBe(true);
    expect(await service.canOnVenue("u2", "report:read", "v1")).toBe(true);
    // Tick hai quyền không mở thêm quyền thứ ba.
    expect(await service.canOnVenue("u2", "pricing:update", "v1")).toBe(false);
  });

  it("mất sạch quyền khi bị vô hiệu hoá", async () => {
    for (const status of ["INVITED", "DISABLED"] as const) {
      const service = createService({ ...STAFF, status });
      expect(await service.canOnVenue("u2", "booking:read", "v1")).toBe(false);
    }
  });
});

describe("canOnVenue — ba quyền không bao giờ tick được", () => {
  /**
   * Bài test quan trọng nhất của file này.
   *
   * `payout:manage`, `venue:delete`, `venue:transfer` là **tiền rời khỏi hệ
   * thống** và **mất sân**. Giao diện không có ô để tick chúng, nhưng phép chặn
   * thật phải nằm ở đây: nếu ai đó ghi thẳng vào cột `permissions` trong
   * database — kịch bản hoàn toàn có thể xảy ra — thì vẫn không lọt.
   */
  it("STAFF không dùng được dù đã bị ghi thẳng vào database", async () => {
    const service = createService({
      ...STAFF,
      permissions: ["payout:manage", "venue:delete", "venue:transfer"],
    });

    expect(await service.canOnVenue("u2", "payout:manage", "v1")).toBe(false);
    expect(await service.canOnVenue("u2", "venue:delete", "v1")).toBe(false);
    expect(await service.canOnVenue("u2", "venue:transfer", "v1")).toBe(false);
  });

  it("quản trị nền tảng cũng không rút tiền hộ chủ sân được", async () => {
    // Quyền toàn cục thắng ở hầu hết mọi chỗ — nhưng không ở đây. Rút tiền là
    // việc của chủ sân; quản trị viên duyệt (`payout:approve`), không tự xin.
    const service = createService(null, ["payout:manage", "venue:delete"]);

    expect(await service.canOnVenue("admin", "payout:manage", "v1")).toBe(false);
    expect(await service.canOnVenue("admin", "venue:delete", "v1")).toBe(false);
  });
});

describe("canOnVenue — quản trị nền tảng", () => {
  it("quyền toàn cục cho qua mọi sân, không cần là thành viên", async () => {
    const service = createService(null, ["booking:read", "venue:read"]);

    expect(await service.canOnVenue("admin", "booking:read", "v1")).toBe(true);
    expect(await service.canOnVenue("admin", "venue:read", "v99")).toBe(true);
  });

  it("không tra database khi đã có quyền toàn cục", async () => {
    const db = {
      venueMember: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const service = new PermissionService(db);
    vi.spyOn(service, "permissionsFor").mockResolvedValue(new Set(["booking:read"]) as never);

    await service.canOnVenue("admin", "booking:read", "v1");

    // Một truy vấn tiết kiệm được ở đây được nhân với mọi ô trong lưới lịch sân.
    expect(db.venueMember.findUnique).not.toHaveBeenCalled();
  });
});

describe("canOnVenue — sân đã xoá mềm hoặc đang bị khoá", () => {
  it("sân đã xoá mềm: chủ và nhân viên cũ mất quyền", async () => {
    const deleted = { deletedAt: new Date("2026-09-01T00:00:00Z") };

    expect(
      await createService({ ...OWNER, venue: deleted }).canOnVenue("u1", "booking:read", "v1"),
    ).toBe(false);
    expect(
      await createService({ ...STAFF, venue: deleted }).canOnVenue("u2", "booking:read", "v1"),
    ).toBe(false);
  });

  it("quản trị nền tảng vẫn xem được sân đã xoá — cần khi xử lý khiếu nại", async () => {
    const service = createService({ ...OWNER, venue: { deletedAt: new Date() } }, ["booking:read"]);

    expect(await service.canOnVenue("admin", "booking:read", "v1")).toBe(true);
  });
});

describe("venuePermissions — mọi quyền trên một sân trong một lượt", () => {
  const members = [
    { ...OWNER, venueId: "v1", userId: "chu" },
    { ...STAFF, venueId: "v1", userId: "nv", permissions: ["payment:confirm"] },
    // Nhân viên sân v2 KHÔNG có gì ở v1 — ca lệch sân.
    { ...STAFF, venueId: "v2", userId: "nv2", permissions: ["pricing:update"] },
  ];

  it("chủ sân có cả nhóm chỉ-chủ-sân; nhân viên có mặc định + phần được tick", async () => {
    const service = createServiceWithMembers(members);

    const owner = await service.venuePermissions("chu", "v1");
    expect(owner.has("payout:manage")).toBe(true);
    expect(owner.has("venue:transfer")).toBe(true);

    const staff = await service.venuePermissions("nv", "v1");
    expect(staff.has("booking:read")).toBe(true);
    expect(staff.has("payment:confirm")).toBe(true);
    expect(staff.has("pricing:update")).toBe(false);
    expect(staff.has("payout:manage")).toBe(false);
  });

  it("quyền tick ở sân B không mang sang sân A", async () => {
    const service = createServiceWithMembers(members);

    expect((await service.venuePermissions("nv2", "v1")).size).toBe(0);
    expect((await service.venuePermissions("nv2", "v2")).has("pricing:update")).toBe(true);
  });

  it("LUÔN khớp canOnVenue với mọi quyền — giao diện và action không được nói hai lời", async () => {
    const cases = [
      { userId: "chu", venueId: "v1", global: [] },
      { userId: "nv", venueId: "v1", global: [] },
      { userId: "nv2", venueId: "v1", global: [] },
      { userId: "admin", venueId: "v1", global: ["booking:read", "payout:manage", "user:read"] },
    ];

    for (const item of cases) {
      const service = createServiceWithMembers(members, item.global);
      const all = await service.venuePermissions(item.userId, item.venueId);

      for (const permission of PERMISSIONS) {
        expect(all.has(permission), `${item.userId} · ${permission} · ${item.venueId}`).toBe(
          await service.canOnVenue(item.userId, permission, item.venueId),
        );
      }
    }
  });
});
