import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, VenueStatus } from "@prisma/client";
import {
  ForbiddenError,
  VenueAdminLockedError,
  VenueConfigError,
  VenueDraftLimitError,
  VenueNotFoundError,
  VenueNotReadyError,
  VenueStatusTransitionError,
} from "@/lib/errors";
import { MAX_UNAPPROVED_VENUES, VenueService } from "./venue.service";

/**
 * Ba chỗ sai ở tầng này tốn tiền thật của chủ sân:
 * mở bán một cơ sở chưa có giá hay chưa có tài khoản nhận tiền (khách đặt được
 * sân 0đ, hoặc tới trang thanh toán không có mã QR), khai giờ mở cửa lệch khung
 * 30 phút (mọi khung giờ lệch theo, không có gì báo lỗi), và để trạng thái cơ sở
 * nhảy lung tung (chủ sân tự duyệt hồ sơ, tự gỡ lệnh khoá).
 */

type VenueRow = {
  id: string;
  status: VenueStatus;
  inactiveNote: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  _count: { hours: number; courts: number; priceRules: number };
};

/** Cơ sở đủ mọi điều kiện gửi duyệt/mở bán. */
const READY_VENUE: VenueRow = {
  id: "v1",
  status: "ACTIVE",
  inactiveNote: null,
  bankName: "VCB",
  bankAccountNumber: "1234567890",
  bankAccountName: "NGUYEN VAN A",
  _count: { hours: 7, courts: 3, priceRules: 2 },
};

const NEW_VENUE = {
  name: "Sân ABC",
  sportId: "s1",
  address: "1 Nguyễn Trãi",
  ward: "Phường Thanh Xuân",
  province: "Hà Nội",
  ownerId: "u1",
};

type Options = {
  venue?: Partial<VenueRow> | null;
  /** Trạng thái THẬT trong database lúc ghi — khác `venue.status` là có người vừa đổi. */
  statusInDb?: VenueStatus;
  slugTaken?: string[];
  sports?: { id: string; isActive: boolean }[];
  unapprovedCount?: number;
  createError?: Error;
};

function createDb(options: Options = {}) {
  const taken = new Set(options.slugTaken ?? []);
  const venue = options.venue === null ? null : { ...READY_VENUE, ...options.venue };
  const statusInDb = options.statusInDb ?? venue?.status;
  const sports = options.sports ?? [{ id: "s1", isActive: true }];

  const db = {
    venue: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        options.createError
          ? Promise.reject(options.createError)
          : Promise.resolve({ id: "v-new", ...data }),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Promise.resolve({ ...venue, ...data, id: where.id }),
      ),
      // Lọc THẬT theo `where`: so-rồi-đổi chỉ ghi khi trạng thái trong database
      // vẫn đúng là trạng thái đã đọc.
      updateMany: vi.fn(
        ({ where }: { where: { id: string; status: string }; data: Record<string, unknown> }) =>
          Promise.resolve({
            count: venue && where.id === venue.id && where.status === statusInDb ? 1 : 0,
          }),
      ),
      findFirst: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(venue && where.id === venue.id ? venue : null),
      ),
      findUnique: vi.fn(({ where }: { where: { slug: string } }) =>
        Promise.resolve(taken.has(where.slug) ? { id: "other" } : null),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(options.unapprovedCount ?? 0),
    },
    sport: {
      findFirst: vi.fn(({ where }: { where: { id: string; isActive: boolean } }) =>
        Promise.resolve(
          sports.some((sport) => sport.id === where.id && sport.isActive === where.isActive)
            ? { id: where.id }
            : null,
        ),
      ),
    },
    venueMember: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "m1", ...data }),
      ),
      findMany: vi.fn().mockResolvedValue([]),
    },
    venueHour: {
      deleteMany: vi.fn().mockResolvedValue({ count: 7 }),
      createMany: vi.fn().mockResolvedValue({ count: 7 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ..._values: unknown[]) =>
      Promise.resolve([{ id: "u1" }]),
    ),
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function"
        ? Promise.resolve((arg as (tx: unknown) => unknown)(db))
        : Promise.resolve([[], 0]),
    ),
  };

  return { db: db as unknown as PrismaClient, mock: db };
}

/** Lỗi trùng khoá đúng hình dạng Prisma 7 + adapter-pg (xem prisma-errors.test.ts). */
function uniqueViolation(constraint: string, fields: string[]): Error {
  return Object.assign(
    new Error(
      `Unique constraint failed on the fields: (${fields.map((f) => `\`${f}\``).join(",")})`,
    ),
    {
      code: "P2002",
      meta: {
        modelName: "Venue",
        driverAdapterError: {
          cause: {
            originalCode: "23505",
            originalMessage: `duplicate key value violates unique constraint "${constraint}"`,
            constraint: { fields },
          },
        },
      },
    },
  );
}

function hoursForWeek(open = 6 * 60, close = 22 * 60) {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    openMinute: open,
    closeMinute: close,
  }));
}

beforeEach(() => vi.clearAllMocks());

describe("create — tạo cơ sở", () => {
  it("tạo sân và gán người tạo làm OWNER trong CÙNG một transaction", async () => {
    // Tách hai bước thì có khe: tạo sân xong, tạo thành viên hỏng, và sân đó
    // không thuộc về ai — kể cả người vừa tạo cũng không sửa được.
    const { db, mock } = createDb();
    await new VenueService(db).create(NEW_VENUE);

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.venueMember.create.mock.calls[0]![0].data).toMatchObject({
      userId: "u1",
      role: "OWNER",
      status: "ACTIVE",
    });
  });

  it("sân mới luôn là bản nháp, không tự mở bán", async () => {
    // Sân mới chưa có giờ, chưa có sân con, chưa có giá — ACTIVE ngay là bán ra
    // một thứ chưa tồn tại.
    const { db, mock } = createDb();
    await new VenueService(db).create(NEW_VENUE);

    expect(mock.venue.create.mock.calls[0]![0].data.status).toBe("DRAFT");
  });

  it("sinh slug bỏ dấu từ tên", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).create({ ...NEW_VENUE, name: "Sân Cầu Lông Đại Việt" });

    expect(mock.venue.create.mock.calls[0]![0].data.slug).toBe("san-cau-long-dai-viet");
  });

  it("slug đã có người dùng thì thêm số, không ghi đè sân của người khác", async () => {
    const { db, mock } = createDb({ slugTaken: ["san-abc", "san-abc-2"] });
    await new VenueService(db).create(NEW_VENUE);

    expect(mock.venue.create.mock.calls[0]![0].data.slug).toBe("san-abc-3");
  });

  it('tên toàn ký tự lạ vẫn ra slug dùng được — "san", không phải chữ "court" lạc vào', async () => {
    // Lỗi thật trước đây: lần đổi tên hàng loạt bằng regex biến "san" thành "court".
    const { db, mock } = createDb();
    await new VenueService(db).create({ ...NEW_VENUE, name: "!!! ???" });

    expect(mock.venue.create.mock.calls[0]![0].data.slug).toBe("san");
  });

  it("bỏ khoảng trắng thừa, ô trống thành null chứ không phải chuỗi rỗng", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).create({
      ...NEW_VENUE,
      name: "  Sân ABC  ",
      phone: "   ",
      description: "  Sân đẹp  ",
    });

    expect(mock.venue.create.mock.calls[0]![0].data).toMatchObject({
      name: "Sân ABC",
      phone: null,
      description: "Sân đẹp",
    });
  });

  it("môn không tồn tại hoặc đã tắt thì báo rõ, KHÔNG tạo gì", async () => {
    // Không chặn thì khoá ngoại ở database nổ thành lỗi 500 khó hiểu.
    for (const sports of [[], [{ id: "s1", isActive: false }]]) {
      const { db, mock } = createDb({ sports });

      await expect(new VenueService(db).create(NEW_VENUE)).rejects.toBeInstanceOf(VenueConfigError);
      expect(mock.venue.create).not.toHaveBeenCalled();
    }
  });

  it(`TỪ CHỐI khi người tạo đã giữ ${MAX_UNAPPROVED_VENUES} hồ sơ chưa duyệt`, async () => {
    const { db, mock } = createDb({ unapprovedCount: MAX_UNAPPROVED_VENUES });

    await expect(new VenueService(db).create(NEW_VENUE)).rejects.toBeInstanceOf(
      VenueDraftLimitError,
    );
    expect(mock.venue.create).not.toHaveBeenCalled();
    expect(mock.venueMember.create).not.toHaveBeenCalled();

    // Đếm đúng thứ cần đếm: cơ sở CHƯA duyệt, còn sống, mà người này là CHỦ.
    const [{ where }] = mock.venue.count.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(where).toEqual({
      deletedAt: null,
      status: { in: ["DRAFT", "PENDING"] },
      members: { some: { userId: "u1", role: "OWNER" } },
    });
  });

  it("khoá dòng người tạo TRƯỚC khi đếm — năm tab bấm cùng lúc không lọt qua trần", async () => {
    const { db, mock } = createDb({ unapprovedCount: MAX_UNAPPROVED_VENUES - 1 });
    await new VenueService(db).create(NEW_VENUE);

    const [strings, ownerId] = mock.$queryRaw.mock.calls[0]!;
    expect(strings.join("?")).toMatch(/FROM users WHERE id = \? FOR NO KEY UPDATE/);
    expect(ownerId).toBe("u1");
    expect(mock.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mock.venue.count.mock.invocationCallOrder[0]!,
    );
    expect(mock.venue.create).toHaveBeenCalledTimes(1);
  });

  it("đụng slug với người tạo cùng lúc thì báo bấm lại, không thành trang lỗi", async () => {
    const { db } = createDb({ createError: uniqueViolation("venues_slug_key", ["slug"]) });

    await expect(new VenueService(db).create(NEW_VENUE)).rejects.toBeInstanceOf(VenueConfigError);
  });

  it("lỗi lạ ném lên nguyên vẹn, không bị đổi thành câu 'bấm lại'", async () => {
    const boom = new Error("Can't reach database server");
    const { db } = createDb({ createError: boom });

    await expect(new VenueService(db).create(NEW_VENUE)).rejects.toBe(boom);
  });
});

describe("setStatus — đồ thị chuyển trạng thái", () => {
  /** Đặc tả, viết tay độc lập với bảng trong service: TỪ → SANG → ai. */
  const ALLOWED: [VenueStatus, VenueStatus, "owner" | "admin"][] = [
    ["DRAFT", "PENDING", "owner"],
    ["PENDING", "ACTIVE", "admin"],
    ["PENDING", "DRAFT", "admin"],
    ["ACTIVE", "UNDER_MAINTENANCE", "owner"],
    ["ACTIVE", "SUSPENDED", "owner"],
    ["UNDER_MAINTENANCE", "ACTIVE", "owner"],
    ["UNDER_MAINTENANCE", "SUSPENDED", "owner"],
    ["SUSPENDED", "ACTIVE", "owner"],
    ["SUSPENDED", "UNDER_MAINTENANCE", "owner"],
    ["DRAFT", "ADMIN_LOCKED", "admin"],
    ["PENDING", "ADMIN_LOCKED", "admin"],
    ["ACTIVE", "ADMIN_LOCKED", "admin"],
    ["UNDER_MAINTENANCE", "ADMIN_LOCKED", "admin"],
    ["SUSPENDED", "ADMIN_LOCKED", "admin"],
    ["ADMIN_LOCKED", "ACTIVE", "admin"],
  ];
  const STATUSES: VenueStatus[] = [
    "DRAFT",
    "PENDING",
    "ACTIVE",
    "UNDER_MAINTENANCE",
    "SUSPENDED",
    "ADMIN_LOCKED",
  ];

  it("MỌI cặp trạng thái × người làm đi đúng như đặc tả — không có cạnh ngầm", async () => {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (from === to) continue;

        for (const actor of ["owner", "admin"] as const) {
          const { db, mock } = createDb({ venue: { status: from } });
          const allowed = ALLOWED.some(([f, t, a]) => f === from && t === to && a === actor);
          const run = new VenueService(db).setStatus("v1", to, {
            actor,
            inactiveNote: "Lý do đủ dài",
          });

          if (allowed) {
            await expect(run, `${from} → ${to} (${actor})`).resolves.toMatchObject({ status: to });
            expect(mock.venue.updateMany).toHaveBeenCalledTimes(1);
          } else {
            await expect(run, `${from} → ${to} (${actor})`).rejects.toSatisfy(
              (error) =>
                error instanceof VenueStatusTransitionError ||
                error instanceof ForbiddenError ||
                error instanceof VenueAdminLockedError,
            );
            expect(mock.venue.updateMany).not.toHaveBeenCalled();
          }
        }
      }
    }
  });

  it("chủ sân GỬI DUYỆT được khi đủ điều kiện — ghi bằng so-rồi-đổi, xoá lý do cũ", async () => {
    const { db, mock } = createDb({
      venue: { status: "DRAFT", inactiveNote: "Thiếu ảnh sân" },
    });
    await new VenueService(db).setStatus("v1", "PENDING", { actor: "owner" });

    expect(mock.venue.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", status: "DRAFT", deletedAt: null },
      data: { status: "PENDING", inactiveNote: null },
    });
  });

  it("CHẶN gửi duyệt khi chưa có tài khoản nhận tiền — khách sẽ không có mã QR để trả", async () => {
    const { db, mock } = createDb({
      venue: { status: "DRAFT", bankName: null, bankAccountNumber: null, bankAccountName: null },
    });

    await expect(
      new VenueService(db).setStatus("v1", "PENDING", { actor: "owner" }),
    ).rejects.toThrow("Chưa gửi duyệt được: sân còn thiếu tài khoản nhận tiền");
    expect(mock.venue.updateMany).not.toHaveBeenCalled();
  });

  it("khai ngân hàng MỘT NỬA vẫn tính là chưa có", async () => {
    const { db } = createDb({ venue: { status: "DRAFT", bankAccountName: null } });

    await expect(
      new VenueService(db).setStatus("v1", "PENDING", { actor: "owner" }),
    ).rejects.toBeInstanceOf(VenueNotReadyError);
  });

  it("CHẶN mở bán khi chưa có giá — khách sẽ đặt được sân 0đ", async () => {
    const { db, mock } = createDb({
      venue: { status: "PENDING", _count: { hours: 7, courts: 3, priceRules: 0 } },
    });

    await expect(
      new VenueService(db).setStatus("v1", "ACTIVE", { actor: "admin" }),
    ).rejects.toBeInstanceOf(VenueNotReadyError);
    expect(mock.venue.updateMany).not.toHaveBeenCalled();
  });

  it("nói RÕ còn thiếu gì để chủ sân không phải đi dò từng màn", async () => {
    const { db } = createDb({
      venue: {
        status: "PENDING",
        bankName: null,
        _count: { hours: 0, courts: 0, priceRules: 0 },
      },
    });

    await expect(
      new VenueService(db).setStatus("v1", "ACTIVE", { actor: "admin" }),
    ).rejects.toThrow(
      "Chưa mở bán được: sân còn thiếu giờ mở cửa, ít nhất một sân con, bảng giá, tài khoản nhận tiền",
    );
  });

  it("chủ sân KHÔNG tự duyệt hồ sơ của mình", async () => {
    const { db, mock } = createDb({ venue: { status: "PENDING" } });

    await expect(
      new VenueService(db).setStatus("v1", "ACTIVE", { actor: "owner" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mock.venue.updateMany).not.toHaveBeenCalled();
  });

  it("bản nháp KHÔNG nhảy thẳng sang mở bán, kể cả admin — phải qua hàng chờ duyệt", async () => {
    for (const actor of ["owner", "admin"] as const) {
      const { db } = createDb({ venue: { status: "DRAFT" } });

      await expect(new VenueService(db).setStatus("v1", "ACTIVE", { actor })).rejects.toThrow(
        /đang ở trạng thái “Bản nháp”/,
      );
    }
  });

  /**
   * Lỗi thật trước đây: từ chối hồ sơ dùng luôn ADMIN_LOCKED — chủ sân bị từ
   * chối lần đầu trông y như bị khoá vì vi phạm, và không tự sửa rồi gửi lại được.
   */
  it("admin TRẢ hồ sơ về BẢN NHÁP kèm lý do, không khoá", async () => {
    const { db, mock } = createDb({ venue: { status: "PENDING" } });
    await new VenueService(db).setStatus("v1", "DRAFT", {
      actor: "admin",
      inactiveNote: "  Thiếu ảnh sân và giờ mở cửa Chủ nhật  ",
    });

    expect(mock.venue.updateMany.mock.calls[0]![0].data).toEqual({
      status: "DRAFT",
      inactiveNote: "Thiếu ảnh sân và giờ mở cửa Chủ nhật",
    });
  });

  it("trả hồ sơ hay khoá mà không có lý do (kể cả toàn khoảng trắng) thì bị chặn", async () => {
    for (const [from, to] of [
      ["PENDING", "DRAFT"],
      ["ACTIVE", "ADMIN_LOCKED"],
    ] as const) {
      for (const inactiveNote of [undefined, null, "   "]) {
        const { db, mock } = createDb({ venue: { status: from } });

        await expect(
          new VenueService(db).setStatus("v1", to, { actor: "admin", inactiveNote }),
        ).rejects.toBeInstanceOf(VenueConfigError);
        expect(mock.venue.updateMany).not.toHaveBeenCalled();
      }
    }
  });

  it("tạm ngừng bán thì KHÔNG kiểm điều kiện — đóng cửa luôn phải làm được", async () => {
    const { db, mock } = createDb({
      venue: { status: "ACTIVE", bankName: null, _count: { hours: 0, courts: 0, priceRules: 0 } },
    });
    await new VenueService(db).setStatus("v1", "SUSPENDED", { actor: "owner" });

    expect(mock.venue.updateMany.mock.calls[0]![0].data.status).toBe("SUSPENDED");
  });

  it("mở bán lại sau tạm nghỉ vẫn phải đủ điều kiện", async () => {
    const { db } = createDb({
      venue: { status: "SUSPENDED", _count: { hours: 7, courts: 0, priceRules: 2 } },
    });

    await expect(
      new VenueService(db).setStatus("v1", "ACTIVE", { actor: "owner" }),
    ).rejects.toBeInstanceOf(VenueNotReadyError);
  });

  /**
   * Trước đây chỉ có một trạng thái `SUSPENDED` cho cả "chủ sân tự tạm nghỉ"
   * lẫn "nền tảng khoá vì vi phạm" — nghĩa là chủ sân bị khoá chỉ cần bấm
   * "Mở bán lại" là gỡ được hình phạt. Bản cũ tách hai trạng thái, và đó là
   * điều đúng.
   */
  it("chủ sân KHÔNG tự gỡ được lệnh khoá của nền tảng, bằng bất kỳ đường nào", async () => {
    for (const to of ["ACTIVE", "SUSPENDED", "DRAFT"] as const) {
      const { db, mock } = createDb({ venue: { status: "ADMIN_LOCKED" } });

      await expect(
        new VenueService(db).setStatus("v1", to, { actor: "owner" }),
      ).rejects.toBeInstanceOf(VenueAdminLockedError);
      expect(mock.venue.updateMany).not.toHaveBeenCalled();
    }
  });

  it("chủ sân cũng không tự KHOÁ được — khoá là việc của nền tảng", async () => {
    const { db } = createDb();

    await expect(
      new VenueService(db).setStatus("v1", "ADMIN_LOCKED", { actor: "owner", inactiveNote: "x" }),
    ).rejects.toBeInstanceOf(VenueAdminLockedError);
  });

  it("admin gỡ khoá được, và lý do khoá được xoá khi mở bán lại", async () => {
    const { db, mock } = createDb({
      venue: { status: "ADMIN_LOCKED", inactiveNote: "Nợ hoa hồng quá hạn" },
    });
    await new VenueService(db).setStatus("v1", "ACTIVE", { actor: "admin" });

    expect(mock.venue.updateMany.mock.calls[0]![0].data).toEqual({
      status: "ACTIVE",
      inactiveNote: null,
    });
  });

  it("đóng cửa thì ghi lý do cho khách đọc", async () => {
    // Khách đang xem sân cần biết VÌ SAO sân đóng, không phải chỉ thấy
    // "hiện không nhận đặt".
    const { db, mock } = createDb();
    await new VenueService(db).setStatus("v1", "UNDER_MAINTENANCE", {
      actor: "owner",
      inactiveNote: "Sửa mặt sân tới 25/9",
    });

    expect(mock.venue.updateMany.mock.calls[0]![0].data.inactiveNote).toBe("Sửa mặt sân tới 25/9");
  });

  it("bấm hai lần sang đúng trạng thái đang có thì không ghi gì, không báo lỗi", async () => {
    const { db, mock } = createDb({ venue: { status: "PENDING" } });

    await expect(
      new VenueService(db).setStatus("v1", "PENDING", { actor: "owner" }),
    ).resolves.toMatchObject({ status: "PENDING" });
    expect(mock.venue.updateMany).not.toHaveBeenCalled();
  });

  it("hai admin cùng quyết một hồ sơ: người đến sau được báo tải lại, không ghi đè ngầm", async () => {
    // Đọc thấy PENDING, nhưng lúc ghi thì người kia đã duyệt xong (ACTIVE).
    const { db } = createDb({ venue: { status: "PENDING" }, statusInDb: "ACTIVE" });

    await expect(
      new VenueService(db).setStatus("v1", "DRAFT", { actor: "admin", inactiveNote: "Thiếu ảnh" }),
    ).rejects.toThrow(/vừa được người khác thay đổi/);
  });

  it("cơ sở không tồn tại hoặc đã xoá thì báo NOT_FOUND", async () => {
    const { db } = createDb({ venue: null });

    await expect(
      new VenueService(db).setStatus("v1", "PENDING", { actor: "owner" }),
    ).rejects.toBeInstanceOf(VenueNotFoundError);
  });
});

describe("readiness — danh sách việc cần làm trước khi gửi duyệt", () => {
  it("trả từng mục kèm đã xong chưa, và lý do nền tảng trả hồ sơ", async () => {
    const { db } = createDb({
      venue: {
        status: "DRAFT",
        inactiveNote: "Thiếu bảng giá cuối tuần",
        bankAccountNumber: null,
        _count: { hours: 7, courts: 0, priceRules: 2 },
      },
    });

    const result = await new VenueService(db).readiness("v1");

    expect(result).toEqual({
      status: "DRAFT",
      inactiveNote: "Thiếu bảng giá cuối tuần",
      ready: false,
      items: [
        { key: "hours", label: "giờ mở cửa", done: true },
        { key: "courts", label: "ít nhất một sân con", done: false },
        { key: "pricing", label: "bảng giá", done: true },
        { key: "bank", label: "tài khoản nhận tiền", done: false },
      ],
    });
  });

  it("đủ cả bốn thì ready — cùng một phép tính với chốt chặn của setStatus", async () => {
    const { db } = createDb({ venue: { status: "DRAFT" } });

    expect((await new VenueService(db).readiness("v1")).ready).toBe(true);
    await expect(
      new VenueService(db).setStatus("v1", "PENDING", { actor: "owner" }),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("cơ sở không tồn tại thì NOT_FOUND", async () => {
    const { db } = createDb({ venue: null });

    await expect(new VenueService(db).readiness("v1")).rejects.toBeInstanceOf(VenueNotFoundError);
  });
});

describe("listPendingApproval — hàng chờ duyệt", () => {
  it("báo CÓ/KHÔNG tài khoản nhận tiền, không đưa số tài khoản ra màn duyệt", async () => {
    const { db, mock } = createDb();
    mock.venue.findMany.mockResolvedValue([
      { id: "v1", name: "A", bankName: "VCB", bankAccountNumber: "123456", bankAccountName: "X" },
      { id: "v2", name: "B", bankName: "VCB", bankAccountNumber: null, bankAccountName: "Y" },
    ]);

    const rows = await new VenueService(db).listPendingApproval();

    expect(rows).toEqual([
      { id: "v1", name: "A", hasBankAccount: true },
      { id: "v2", name: "B", hasBankAccount: false },
    ]);
  });
});

describe("setHours — giờ mở cửa cả tuần", () => {
  it("thay CẢ TUẦN một lần, không sửa từng thứ", async () => {
    // Cập nhật từng dòng thì nửa chừng lỗi mạng để lại một tuần lẫn giờ cũ với
    // giờ mới, và lưới đặt sân hiện ra sai mà không ai biết vì sao.
    const { db, mock } = createDb();
    await new VenueService(db).setHours("v1", hoursForWeek());

    expect(mock.venueHour.deleteMany).toHaveBeenCalledWith({ where: { venueId: "v1" } });
    const [{ data }] = mock.venueHour.createMany.mock.calls[0] as [{ data: unknown[] }];
    expect(data).toHaveLength(7);
    expect(mock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("TỪ CHỐI giờ lệch khung 30 phút", async () => {
    // 06:15 sẽ sinh ra khung 06:15, 06:45… lệch với mọi bảng giá, và không có
    // gì báo lỗi ở tầng dưới.
    const { db, mock } = createDb();

    await expect(
      new VenueService(db).setHours("v1", [{ weekday: 1, openMinute: 375, closeMinute: 22 * 60 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
    expect(mock.venueHour.deleteMany).not.toHaveBeenCalled();
  });

  it("từ chối giờ đóng trước giờ mở, và giờ vượt quá 24:00", async () => {
    const { db } = createDb();
    const service = new VenueService(db);

    await expect(
      service.setHours("v1", [{ weekday: 1, openMinute: 22 * 60, closeMinute: 6 * 60 }]),
    ).rejects.toThrow(/sau giờ mở cửa/);

    await expect(
      service.setHours("v1", [{ weekday: 1, openMinute: 6 * 60, closeMinute: 25 * 60 }]),
    ).rejects.toThrow(/24:00/);
  });

  it("hai dòng cùng một thứ thì báo rõ, không để ràng buộc database nổ thành lỗi 500", async () => {
    const { db, mock } = createDb();

    await expect(
      new VenueService(db).setHours("v1", [
        { weekday: 1, openMinute: 360, closeMinute: 600 },
        { weekday: 1, openMinute: 720, closeMinute: 1320 },
      ]),
    ).rejects.toThrow(/chỉ khai giờ một lần/);
    expect(mock.venueHour.deleteMany).not.toHaveBeenCalled();
  });

  it("ngày nghỉ thì bỏ qua mọi phép kiểm giờ", async () => {
    // Ngày đóng cửa không cần giờ hợp lệ — bắt khai giờ cho ngày nghỉ là vô nghĩa.
    const { db, mock } = createDb();
    await new VenueService(db).setHours("v1", [
      { weekday: 0, openMinute: 0, closeMinute: 0, isClosed: true },
    ]);

    expect(mock.venueHour.createMany).toHaveBeenCalled();
  });

  it("từ chối thứ ngoài 0–6", async () => {
    const { db } = createDb();

    await expect(
      new VenueService(db).setHours("v1", [{ weekday: 7, openMinute: 360, closeMinute: 1320 }]),
    ).rejects.toBeInstanceOf(VenueConfigError);
  });

  it("cơ sở không tồn tại hoặc đã xoá thì báo NOT_FOUND", async () => {
    const { db } = createDb({ venue: null });

    await expect(new VenueService(db).setHours("v1", hoursForWeek())).rejects.toBeInstanceOf(
      VenueNotFoundError,
    );
  });
});

describe("search — tìm sân", () => {
  it("chỉ trả sân ĐANG BÁN và chưa xoá", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).search({ q: "cầu lông" });

    const [{ where }] = mock.venue.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(where).toMatchObject({ status: "ACTIVE", deletedAt: null });
  });

  it("chặn limit để một request không kéo cả bảng về", async () => {
    const { db } = createDb();
    const result = await new VenueService(db).search({ limit: 5_000 });

    expect(result.meta.limit).toBe(50);
  });

  it("trang âm hoặc 0 vẫn ra trang 1", async () => {
    const { db } = createDb();

    expect((await new VenueService(db).search({ page: -3 })).meta.page).toBe(1);
    expect((await new VenueService(db).search({ page: 0 })).meta.page).toBe(1);
  });

  it("đếm và lấy trang SONG SONG, KHÔNG bọc transaction", async () => {
    // Trang này được mở nhiều nhất; một transaction giữ riêng một kết nối cho
    // cả hai câu và đổ ngay khi có vài người tìm cùng lúc trên Neon.
    const { db, mock } = createDb();
    const result = await new VenueService(db).search({});

    expect(mock.$transaction).not.toHaveBeenCalled();
    expect(mock.venue.findMany).toHaveBeenCalledTimes(1);
    expect(mock.venue.count).toHaveBeenCalledTimes(1);
    expect(result.meta.total).toBe(0);
  });

  it("sân tạm đóng (bảo trì, tạm nghỉ) KHÔNG lên kết quả tìm kiếm", async () => {
    // Trang chi tiết của sân tạm đóng vẫn mở được, nhưng đưa nó lên danh sách
    // là mời khách bấm vào một sân không đặt được.
    const { db, mock } = createDb();
    await new VenueService(db).search({});

    const [{ where }] = mock.venue.findMany.mock.calls[0] as [{ where: { status: unknown } }];
    expect(where.status).toBe("ACTIVE");
  });

  /**
   * Khung 0đ không đặt được (chưa mở bán). Lấy luật 0đ làm "giá từ" là thẻ sân
   * quảng cáo "từ 0 /30 phút", và lọc "dưới 100k" trả về sân không bán gì dưới 100k.
   */
  it("giá 'từ' và lọc theo giá bỏ qua luật giá 0đ", async () => {
    const { db, mock } = createDb();
    await new VenueService(db).search({ maxPricePerSlot: 100_000 });

    const [{ where, select }] = mock.venue.findMany.mock.calls[0] as [
      {
        where: { priceRules: { some: { pricePerSlot: unknown } } };
        select: { priceRules: { where: unknown } };
      },
    ];
    expect(where.priceRules.some.pricePerSlot).toEqual({ gt: 0, lte: 100_000 });
    expect(select.priceRules.where).toEqual({ pricePerSlot: { gt: 0 } });
  });
});

describe("publicDetail — trang chi tiết của khách", () => {
  type Row = { slug: string; status: string; deletedAt: Date | null; inactiveNote: string | null };

  /** Mock lọc THẬT theo `where` — ép trả `null` thì không chứng minh được gì. */
  function detailDb(rows: Row[]) {
    const findFirst = vi.fn(
      ({ where }: { where: { slug: string; status: { in: string[] }; deletedAt: null } }) =>
        Promise.resolve(
          rows.find(
            (row) =>
              row.slug === where.slug &&
              where.status.in.includes(row.status) &&
              row.deletedAt === where.deletedAt,
          ) ?? null,
        ),
    );
    return { db: { venue: { findFirst } } as unknown as PrismaClient, findFirst };
  }

  it("sân đang mở bán: có trang, đặt được", async () => {
    const { db } = detailDb([
      { slug: "san-a", status: "ACTIVE", deletedAt: null, inactiveNote: null },
    ]);

    expect(await new VenueService(db).publicDetail("san-a")).toMatchObject({
      status: "ACTIVE",
      bookable: true,
    });
  });

  /**
   * Lỗi thật trước đây: chỉ trả sân ACTIVE nhưng lại đọc `inactiveNote` — khách
   * không bao giờ thấy lý do đóng, link đã lưu của sân đang bảo trì thành 404.
   */
  it("sân BẢO TRÌ hay TẠM NGHỈ vẫn có trang, kèm lý do đóng — nhưng KHÔNG đặt được", async () => {
    const { db } = detailDb([
      {
        slug: "bao-tri",
        status: "UNDER_MAINTENANCE",
        deletedAt: null,
        inactiveNote: "Sửa mặt sân tới 25/9",
      },
      { slug: "tam-nghi", status: "SUSPENDED", deletedAt: null, inactiveNote: null },
    ]);
    const service = new VenueService(db);

    expect(await service.publicDetail("bao-tri")).toMatchObject({
      bookable: false,
      inactiveNote: "Sửa mặt sân tới 25/9",
    });
    expect(await service.publicDetail("tam-nghi")).toMatchObject({ bookable: false });
  });

  it("nháp, chờ duyệt, bị nền tảng khoá hay đã xoá thì KHÔNG có trang", async () => {
    const { db } = detailDb([
      { slug: "nhap", status: "DRAFT", deletedAt: null, inactiveNote: null },
      { slug: "cho-duyet", status: "PENDING", deletedAt: null, inactiveNote: null },
      { slug: "bi-khoa", status: "ADMIN_LOCKED", deletedAt: null, inactiveNote: "Vi phạm" },
      { slug: "da-xoa", status: "SUSPENDED", deletedAt: new Date(), inactiveNote: null },
    ]);
    const service = new VenueService(db);

    for (const slug of ["nhap", "cho-duyet", "bi-khoa", "da-xoa"]) {
      expect(await service.publicDetail(slug)).toBeNull();
    }
  });

  it("đọc kèm hạn giữ chỗ của sân — trang nói đúng số phút thay vì con số viết cứng", async () => {
    const { db, findFirst } = detailDb([]);
    await new VenueService(db).publicDetail("san-a");

    const [{ select }] = findFirst.mock.calls[0] as unknown as [
      { select: Record<string, unknown> },
    ];
    expect(select.holdMinutes).toBe(true);
    expect(select.inactiveNote).toBe(true);
  });
});

describe("listActiveProvinces — ô lọc tỉnh/thành", () => {
  it("chỉ tỉnh có cơ sở đang mở bán, mỗi tỉnh một lần, sắp theo tiếng Việt", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { province: "TP. Hồ Chí Minh" },
        { province: "Đà Nẵng" },
        { province: "Hà Nội" },
      ]);
    const db = { venue: { findMany } } as unknown as PrismaClient;

    const provinces = await new VenueService(db).listActiveProvinces();

    expect(findMany.mock.calls[0]![0]).toMatchObject({
      where: { status: "ACTIVE", deletedAt: null },
      distinct: ["province"],
    });
    // "Đ" đứng sau "D", trước "H" — không bị đẩy xuống cuối như so theo mã ký tự.
    expect(provinces).toEqual(["Đà Nẵng", "Hà Nội", "TP. Hồ Chí Minh"]);
  });
});

describe("softDelete", () => {
  it("xoá mềm và ngừng bán, KHÔNG xoá thật", async () => {
    // Lượt đặt, hoá đơn, nhật ký đều trỏ tới sân này — xoá thật là vỡ báo cáo
    // doanh thu của những năm trước.
    const { db, mock } = createDb();
    const now = new Date("2026-09-04T03:00:00Z");
    await new VenueService(db).softDelete("v1", now);

    expect(mock.venue.update.mock.calls[0]![0].data).toEqual({
      deletedAt: now,
      status: "SUSPENDED",
    });
  });
});
