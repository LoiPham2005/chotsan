import type { Prisma, PrismaClient, VenueStatus } from "@prisma/client";
import {
  ForbiddenError,
  VenueAdminLockedError,
  VenueConfigError,
  VenueDraftLimitError,
  VenueNotFoundError,
  VenueNotReadyError,
  VenueStatusTransitionError,
} from "@/lib/errors";
import { slugify } from "@/lib/format";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { prisma } from "@/lib/prisma";
import { isSlotAligned, MINUTES_PER_DAY, SLOT_MINUTES } from "@/lib/slots";

/**
 * Cơ sở thể thao — hồ sơ, giờ mở cửa, ảnh, người làm việc.
 *
 * ---
 * GIỜ MỞ CỬA PHẢI THẲNG KHUNG 30 PHÚT
 *
 * Toàn hệ thống chạy khung 30 phút. Sân khai mở cửa 06:15 thì `slotRange()` sẽ
 * sinh ra 06:15, 06:45… — lệch với mọi bảng giá, mọi lưới đặt sân, và không có
 * gì báo lỗi. Chặn ngay ở đây là chỗ rẻ nhất.
 */

/** Sắp xếp danh sách sân cho khách — sân đông khách trước. */
const PUBLIC_ORDER: Prisma.VenueOrderByWithRelationInput[] = [
  { ratingAvg: "desc" },
  { ratingCount: "desc" },
  { name: "asc" },
];

export type VenueHourInput = {
  /** 0 = Chủ nhật, khớp `Date.getDay()`. */
  weekday: number;
  openMinute: number;
  closeMinute: number;
  isClosed?: boolean;
};

/** Hồ sơ chưa duyệt (DRAFT/PENDING) tối đa một người giữ cùng lúc — xem `VenueDraftLimitError`. */
export const MAX_UNAPPROVED_VENUES = 3;

/**
 * Ai đang đổi trạng thái. Nơi gọi NÓI RÕ, service không suy ra từ vai trò: cùng
 * một người có thể vừa là quản trị nền tảng vừa là chủ một sân.
 *
 * - `owner`: PHÍA CƠ SỞ — chủ sân, hoặc nhân viên được tick `venue:update`
 *   (quyền đã kiểm ở `defineVenueAction`).
 * - `admin`: quản trị nền tảng (`venue:approve`, kiểm ở `defineAction`).
 */
export type VenueActor = "owner" | "admin";

/**
 * Đồ thị chuyển trạng thái cơ sở: `TỪ → { SANG: ai được làm }`. Cạnh không có
 * ở đây là không đi được, với bất kỳ ai.
 *
 *   DRAFT ──chủ gửi duyệt──→ PENDING ──admin duyệt──→ ACTIVE
 *     ↑                         │
 *     └──────admin trả về───────┘
 *
 *   ACTIVE, UNDER_MAINTENANCE, SUSPENDED: chủ sân tự chuyển qua lại giữa ba trạng thái này.
 *   Mọi trạng thái ──admin khoá──→ ADMIN_LOCKED ──admin gỡ──→ ACTIVE.
 *
 * - Trả hồ sơ về DRAFT (kèm lý do), KHÔNG dùng ADMIN_LOCKED: "chưa đạt" khác hẳn
 *   "bị khoá vì vi phạm" — gộp lại thì chủ sân bị từ chối lần đầu trông y như bị
 *   phạt, và không tự sửa rồi gửi lại được.
 * - ADMIN_LOCKED chỉ admin gỡ: gộp chung với SUSPENDED thì chủ sân bị khoá chỉ
 *   cần bấm "Mở bán lại" là hết hình phạt (bài học từ bản cũ).
 */
const STATUS_TRANSITIONS: Record<VenueStatus, Partial<Record<VenueStatus, VenueActor>>> = {
  DRAFT: { PENDING: "owner", ADMIN_LOCKED: "admin" },
  PENDING: { ACTIVE: "admin", DRAFT: "admin", ADMIN_LOCKED: "admin" },
  ACTIVE: { UNDER_MAINTENANCE: "owner", SUSPENDED: "owner", ADMIN_LOCKED: "admin" },
  UNDER_MAINTENANCE: { ACTIVE: "owner", SUSPENDED: "owner", ADMIN_LOCKED: "admin" },
  SUSPENDED: { ACTIVE: "owner", UNDER_MAINTENANCE: "owner", ADMIN_LOCKED: "admin" },
  ADMIN_LOCKED: { ACTIVE: "admin" },
};

/** Tên trạng thái trong câu báo lỗi — người đọc là chủ sân, không phải lập trình viên. */
const STATUS_NAME: Record<VenueStatus, string> = {
  DRAFT: "Bản nháp",
  PENDING: "Chờ duyệt",
  ACTIVE: "Đang nhận đặt",
  SUSPENDED: "Tạm nghỉ",
  UNDER_MAINTENANCE: "Đang sửa",
  ADMIN_LOCKED: "Bị khoá",
};

/** Những gì phải đọc để biết cơ sở đã đủ điều kiện gửi duyệt/mở bán chưa. */
const READINESS_SELECT = {
  bankName: true,
  bankAccountNumber: true,
  bankAccountName: true,
  _count: {
    select: {
      hours: { where: { isClosed: false } },
      courts: { where: { isActive: true, deletedAt: null } },
      priceRules: true,
    },
  },
} satisfies Prisma.VenueSelect;

export type VenueReadinessItem = {
  key: "hours" | "courts" | "pricing" | "bank";
  /** Cụm danh từ — ghép thẳng vào câu "sân còn thiếu …". */
  label: string;
  done: boolean;
};

/**
 * Danh sách việc phải xong trước khi gửi duyệt hoặc mở bán. MỘT nguồn cho cả
 * phép chặn trong `setStatus` lẫn danh sách việc cần làm trên màn cài đặt — hai
 * nơi tự đếm riêng là sớm muộn màn hình báo "đủ rồi" mà nút bấm vẫn bị từ chối.
 *
 * Thiếu thứ nào thì khách thấy gì: không giờ mở cửa → lưới trống; không sân con
 * đang bật → lưới trống; không bảng giá → giá 0đ; không tài khoản nhận tiền →
 * trang thanh toán không dựng được mã QR.
 */
function readinessOf(venue: {
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
  _count: { hours: number; courts: number; priceRules: number };
}): VenueReadinessItem[] {
  return [
    { key: "hours", label: "giờ mở cửa", done: venue._count.hours > 0 },
    { key: "courts", label: "ít nhất một sân con", done: venue._count.courts > 0 },
    { key: "pricing", label: "bảng giá", done: venue._count.priceRules > 0 },
    {
      key: "bank",
      label: "tài khoản nhận tiền",
      done: Boolean(venue.bankName && venue.bankAccountNumber && venue.bankAccountName),
    },
  ];
}

export class VenueService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Tạo cơ sở. Người tạo thành `OWNER` ngay trong cùng transaction.
   *
   * Tách hai bước thì có khe: tạo sân xong, tạo thành viên hỏng, và sân đó
   * không thuộc về ai — kể cả người vừa tạo cũng không sửa được nó.
   *
   * Một người giữ tối đa `MAX_UNAPPROVED_VENUES` hồ sơ chưa duyệt. Phép đếm chạy
   * SAU khi khoá dòng người tạo, trong cùng transaction: không khoá thì mở năm
   * tab bấm "Đăng ký" cùng lúc, cả năm lần đều đếm thấy "mới có 2".
   */
  async create(input: {
    name: string;
    sportId: string;
    /** Số nhà + tên đường. */
    address: string;
    /** Phường/xã — cấp hành chính thứ hai sau cải cách 01/07/2025. */
    ward: string;
    /** Tỉnh/thành phố. */
    province: string;
    ownerId: string;
    phone?: string | null;
    description?: string | null;
    holdMinutes?: number | null;
  }) {
    const name = input.name.trim();

    // Môn sai thì database cũng từ chối (khoá ngoại) — nhưng thành lỗi 500 khó
    // hiểu. Chặn ở đây để câu báo nói đúng chỗ phải sửa.
    const sport = await this.db.sport.findFirst({
      where: { id: input.sportId, isActive: true },
      select: { id: true },
    });
    if (!sport) throw new VenueConfigError("Chọn môn thể thao trong danh sách giúp bạn");

    const slug = await this.uniqueSlug(name);

    try {
      return await this.db.$transaction(
        async (tx) => {
          // `FOR NO KEY UPDATE`: hai lần tạo của cùng một người xếp hàng, nhưng
          // không chặn phép kiểm khoá ngoại của những ghi khác trỏ tới người này.
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.ownerId} FOR NO KEY UPDATE`;

          const unapproved = await tx.venue.count({
            where: {
              deletedAt: null,
              status: { in: ["DRAFT", "PENDING"] },
              members: { some: { userId: input.ownerId, role: "OWNER" } },
            },
          });
          if (unapproved >= MAX_UNAPPROVED_VENUES) {
            throw new VenueDraftLimitError(MAX_UNAPPROVED_VENUES);
          }

          const venue = await tx.venue.create({
            data: {
              slug,
              name,
              sportId: sport.id,
              address: input.address.trim(),
              ward: input.ward.trim(),
              province: input.province.trim(),
              phone: input.phone?.trim() || null,
              description: input.description?.trim() || null,
              holdMinutes: input.holdMinutes ?? null,
              // Sân mới luôn là bản nháp: chưa có giờ mở cửa, chưa có sân con, chưa
              // có giá. Cho ACTIVE ngay là bán ra một thứ chưa tồn tại.
              status: "DRAFT",
            },
          });

          await tx.venueMember.create({
            data: { venueId: venue.id, userId: input.ownerId, role: "OWNER", status: "ACTIVE" },
          });

          return venue;
        },
        // Mặc định 5 giây không đủ cho bốn câu lệnh qua Neon (xem `holdCheckout`).
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      // Slug được chọn TRƯỚC transaction, nên hai người đặt cùng một tên đúng
      // cùng lúc vẫn có thể đụng nhau ở ràng buộc duy nhất. Hiếm — nhưng đừng để
      // nó thành trang lỗi: bấm lại là `uniqueSlug` chọn được số tiếp theo.
      if (isUniqueViolation(error, "venues_slug_key")) {
        throw new VenueConfigError("Tên này vừa có người đăng ký cùng lúc. Bấm lại giúp bạn nhé.");
      }
      throw error;
    }
  }

  async update(
    venueId: string,
    input: Partial<{
      name: string;
      description: string | null;
      address: string;
      ward: string;
      province: string;
      phone: string | null;
      email: string | null;
      amenities: string[];
      lat: number | null;
      lng: number | null;
      holdMinutes: number | null;
      freeCancelHours: number | null;
      cancelFeePercent: number | null;
      bankName: string | null;
      bankAccountNumber: string | null;
      bankAccountName: string | null;
    }>,
  ) {
    // Cố ý KHÔNG nhận `status`/`inactiveNote`: hai thứ đó chỉ đổi qua `setStatus`,
    // nơi có đồ thị chuyển trạng thái. Cho sửa lẻ ở đây là chủ sân tự xoá được
    // lý do nền tảng ghi khi khoá hay trả hồ sơ.
    await this.requireVenue(venueId);

    return this.db.venue.update({ where: { id: venueId }, data: input });
  }

  /**
   * Cơ sở đã đủ điều kiện gửi duyệt/mở bán chưa — nguồn cho danh sách việc cần
   * làm trên màn cài đặt. Kèm `inactiveNote`: với cơ sở DRAFT đó là lý do nền
   * tảng trả hồ sơ về.
   */
  async readiness(venueId: string) {
    const venue = await this.db.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: { status: true, inactiveNote: true, ...READINESS_SELECT },
    });

    if (!venue) throw new VenueNotFoundError();

    const items = readinessOf(venue);
    return {
      status: venue.status,
      inactiveNote: venue.inactiveNote,
      items,
      ready: items.every((item) => item.done),
    };
  }

  /**
   * Đổi trạng thái theo đồ thị `STATUS_TRANSITIONS`.
   *
   * Thứ tự kiểm:
   *
   * 1. Vào/ra `ADMIN_LOCKED` mà không phải admin → `VenueAdminLockedError`.
   * 2. Cạnh không có trong đồ thị → `VenueStatusTransitionError`, kể rõ đang ở
   *    trạng thái nào.
   * 3. Có cạnh nhưng sai người làm → `ForbiddenError`.
   * 4. Trả hồ sơ (DRAFT) và khoá (ADMIN_LOCKED) BẮT BUỘC có lý do — chủ sân đọc
   *    câu đó để biết phải sửa gì.
   * 5. Gửi duyệt (PENDING) và mở bán (ACTIVE) cần đủ `readinessOf`.
   *
   * Ghi bằng so-rồi-đổi (`updateMany` kèm trạng thái đã đọc): hai quản trị viên
   * cùng bấm "Duyệt" và "Trả về" trên một hồ sơ thì đúng một người thắng, người
   * kia được báo tải lại — không có chuyện hồ sơ vừa duyệt xong bị trả về ngầm.
   *
   * Đổi sang đúng trạng thái đang có thì không làm gì: bấm hai lần không phải lỗi.
   */
  async setStatus(
    venueId: string,
    status: VenueStatus,
    options: { actor: VenueActor; inactiveNote?: string | null },
  ) {
    const venue = await this.db.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: { id: true, status: true, inactiveNote: true, ...READINESS_SELECT },
    });

    if (!venue) throw new VenueNotFoundError();

    if (venue.status === status) {
      return { id: venue.id, status: venue.status, inactiveNote: venue.inactiveNote };
    }

    const locked = venue.status === "ADMIN_LOCKED" || status === "ADMIN_LOCKED";
    if (locked && options.actor !== "admin") throw new VenueAdminLockedError();

    const allowed = STATUS_TRANSITIONS[venue.status][status];
    if (!allowed) {
      throw new VenueStatusTransitionError(
        `Cơ sở đang ở trạng thái “${STATUS_NAME[venue.status]}”, không chuyển thẳng sang “${STATUS_NAME[status]}” được`,
      );
    }
    if (allowed !== options.actor) {
      throw new ForbiddenError(
        allowed === "admin"
          ? "Chỉ quản trị ChốtSân mới duyệt, trả hoặc khoá hồ sơ cơ sở"
          : "Việc này do chủ sân tự làm trên trang quản lý sân",
      );
    }

    const note = options.inactiveNote?.trim() || null;
    if (status === "DRAFT" && !note) {
      throw new VenueConfigError("Ghi lý do trả hồ sơ để chủ sân biết phải sửa gì");
    }
    if (status === "ADMIN_LOCKED" && !note) {
      throw new VenueConfigError("Ghi lý do khoá cơ sở để chủ sân biết vì sao");
    }

    if (status === "PENDING" || status === "ACTIVE") {
      const missing = readinessOf(venue)
        .filter((item) => !item.done)
        .map((item) => item.label);

      if (missing.length > 0) {
        throw new VenueNotReadyError(missing, status === "PENDING" ? "gửi duyệt" : "mở bán");
      }
    }

    // Khách đang xem sân cần biết VÌ SAO sân đóng, chủ sân cần biết vì sao bị
    // trả hồ sơ. Gửi duyệt lại hoặc mở bán thì lý do cũ hết giá trị — xoá.
    const inactiveNote = status === "ACTIVE" || status === "PENDING" ? null : note;

    const { count } = await this.db.venue.updateMany({
      where: { id: venueId, status: venue.status, deletedAt: null },
      data: { status, inactiveNote },
    });

    if (count === 0) {
      throw new VenueStatusTransitionError(
        "Trạng thái cơ sở vừa được người khác thay đổi. Tải lại trang rồi thử lại giúp bạn nhé.",
      );
    }

    return { id: venueId, status, inactiveNote };
  }

  /**
   * Đặt lại toàn bộ giờ mở cửa của cả tuần.
   *
   * Thay CẢ TUẦN một lần chứ không sửa từng thứ: giao diện là một bảng bảy
   * dòng, và cập nhật từng dòng thì nửa chừng lỗi mạng để lại một tuần lẫn lộn
   * giờ cũ với giờ mới.
   */
  async setHours(venueId: string, hours: VenueHourInput[]) {
    await this.requireVenue(venueId);

    const seen = new Set<number>();
    for (const hour of hours) {
      if (!Number.isInteger(hour.weekday) || hour.weekday < 0 || hour.weekday > 6) {
        throw new VenueConfigError(`Thứ không hợp lệ: ${hour.weekday}`);
      }
      // Hai dòng cùng một thứ thì ràng buộc (venue_id, weekday) nổ giữa
      // transaction thành lỗi 500 — báo thẳng ở đây.
      if (seen.has(hour.weekday)) {
        throw new VenueConfigError("Mỗi ngày trong tuần chỉ khai giờ một lần");
      }
      seen.add(hour.weekday);
      if (hour.isClosed) continue;

      if (!isSlotAligned(hour.openMinute) || !isSlotAligned(hour.closeMinute)) {
        throw new VenueConfigError(`Giờ mở cửa phải tròn ${SLOT_MINUTES} phút`);
      }
      if (hour.openMinute >= hour.closeMinute) {
        throw new VenueConfigError("Giờ đóng cửa phải sau giờ mở cửa");
      }
      if (hour.closeMinute > MINUTES_PER_DAY) {
        throw new VenueConfigError("Giờ đóng cửa không vượt quá 24:00");
      }
    }

    return this.db.$transaction(async (tx) => {
      await tx.venueHour.deleteMany({ where: { venueId } });
      await tx.venueHour.createMany({
        data: hours.map((hour) => ({
          venueId,
          weekday: hour.weekday,
          openMinute: hour.openMinute,
          closeMinute: hour.closeMinute,
          isClosed: hour.isClosed ?? false,
        })),
      });

      return tx.venueHour.findMany({ where: { venueId }, orderBy: { weekday: "asc" } });
    });
  }

  /**
   * Cơ sở đang chờ nền tảng duyệt.
   *
   * Trả kèm số sân con, số luật giá, số ngày mở cửa và có tài khoản nhận tiền
   * chưa: đó là những thứ quyết định "duyệt được chưa". Duyệt một sân chưa có
   * sân con nào là mở bán một trang trống. Chỉ trả CÓ/KHÔNG cho tài khoản ngân
   * hàng — màn duyệt không cần, và không nên cầm, số tài khoản của chủ sân.
   */
  async listPendingApproval(limit = 50) {
    const venues = await this.db.venue.findMany({
      where: { status: "PENDING", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        address: true,
        ward: true,
        province: true,
        phone: true,
        createdAt: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountName: true,
        sport: { select: { key: true, name: true } },
        _count: {
          select: {
            courts: { where: { isActive: true, deletedAt: null } },
            priceRules: true,
            hours: { where: { isClosed: false } },
          },
        },
        members: {
          where: { role: "OWNER" },
          take: 1,
          select: {
            user: { select: { email: true, phone: true, profile: { select: { fullName: true } } } },
          },
        },
      },
    });

    return venues.map(({ bankName, bankAccountNumber, bankAccountName, ...venue }) => ({
      ...venue,
      hasBankAccount: Boolean(bankName && bankAccountNumber && bankAccountName),
    }));
  }

  /**
   * Hồ sơ cơ sở cho khu QUẢN LÝ — tra theo id, không lọc theo trạng thái.
   *
   * `publicDetail` không dùng được ở đây vì nó chỉ trả sân `ACTIVE`: chủ sân
   * phải vào được sân đang là bản nháp, đang tạm nghỉ, hay đang bị khoá — đó
   * đúng là lúc họ cần vào để sửa.
   *
   * Không kiểm quyền trong này. Quyền là việc của `requireVenueAccess` ở trang
   * và `defineVenueAction` ở action; service chỉ trả dữ liệu.
   */
  async forManage(venueId: string) {
    return this.db.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        inactiveNote: true,
        address: true,
        ward: true,
        province: true,
        description: true,
        amenities: true,
        phone: true,
        holdMinutes: true,
        freeCancelHours: true,
        cancelFeePercent: true,
        bankName: true,
        bankAccountNumber: true,
        bankAccountName: true,
        sport: { select: { key: true, name: true } },
        hours: {
          orderBy: { weekday: "asc" },
          select: { weekday: true, openMinute: true, closeMinute: true, isClosed: true },
        },
      },
    });
  }

  /**
   * Hồ sơ cơ sở cho trang chi tiết của KHÁCH.
   *
   * ---
   * SÂN TẠM ĐÓNG VẪN CÓ TRANG, CHỈ LÀ KHÔNG ĐẶT ĐƯỢC
   *
   * Trước đây chỉ trả sân `ACTIVE` mà lại chọn `inactiveNote` — tức là khách
   * không bao giờ đọc được lý do đóng: sân bảo trì một tuần thì link khách đã
   * lưu thành 404, như thể sân biến mất. Nay sân bảo trì hay tạm nghỉ vẫn hiện
   * đủ hồ sơ kèm `bookable: false` và ghi chú; trang ẩn lưới đặt.
   *
   * Nháp, chờ duyệt, bị nền tảng khoá, đã xoá thì vẫn KHÔNG có trang (null →
   * 404): hồ sơ chưa duyệt hay đang bị xử lý vi phạm không phải thứ để bày cho
   * khách.
   */
  async publicDetail(slug: string) {
    const venue = await this.db.venue.findFirst({
      where: {
        slug,
        status: { in: ["ACTIVE", "UNDER_MAINTENANCE", "SUSPENDED"] },
        deletedAt: null,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        description: true,
        address: true,
        ward: true,
        province: true,
        inactiveNote: true,
        holdMinutes: true,
        freeCancelHours: true,
        cancelFeePercent: true,
        lat: true,
        lng: true,
        phone: true,
        amenities: true,
        ratingAvg: true,
        ratingCount: true,
        sport: { select: { key: true, name: true } },
        images: { orderBy: { sortOrder: "asc" }, select: { url: true, isPrimary: true } },
        hours: {
          orderBy: { weekday: "asc" },
          select: { weekday: true, openMinute: true, closeMinute: true, isClosed: true },
        },
        courts: {
          where: { isActive: true, deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, surface: true, isIndoor: true, note: true },
        },
      },
    });

    if (!venue) return null;

    // Một chỗ quyết "đặt được không" — trang, action và lịch trống cùng một luật.
    return { ...venue, bookable: venue.status === "ACTIVE" };
  }

  /**
   * Tỉnh/thành có ít nhất một cơ sở đang mở bán — nguồn cho ô lọc ở trang tìm sân.
   *
   * Lấy từ dữ liệu thật chứ không phải danh mục 34 tỉnh: chọn một tỉnh chưa có
   * sân nào là nhận trang "không có sân" — một ngõ cụt tự bày ra.
   */
  async listActiveProvinces(): Promise<string[]> {
    const rows = await this.db.venue.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      distinct: ["province"],
      select: { province: true },
    });

    // Sắp ở đây theo tiếng Việt: collation của database có thể đẩy "Đà Nẵng" xuống sau "Yên Bái".
    return rows.map((row) => row.province).sort((a, b) => a.localeCompare(b, "vi"));
  }

  /**
   * Tìm sân cho khách. Phân trang theo SỐ TRANG vì màn tìm kiếm cần biết tổng.
   * CHỈ cơ sở đang mở bán — sân tạm đóng có trang riêng nhưng không lên kết quả.
   *
   * `maxPricePerSlot` lọc theo luật giá RẺ NHẤT của sân — người dùng lọc "dưới
   * 100k" là muốn thấy sân có khung nào đó dưới 100k, không phải sân mà mọi
   * khung đều dưới 100k.
   *
   * Luật giá 0đ không tính là giá: khung 0đ không đặt được (xem
   * `AvailabilityService.forDay`), nên "từ 0đ" trên thẻ sân là quảng cáo sai.
   */
  async search(params: {
    q?: string;
    sportKey?: string;
    province?: string;
    ward?: string;
    maxPricePerSlot?: number;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 20));

    const where: Prisma.VenueWhereInput = {
      status: "ACTIVE",
      deletedAt: null,
      ...(params.sportKey ? { sport: { key: params.sportKey } } : {}),
      ...(params.province ? { province: params.province } : {}),
      ...(params.ward ? { ward: params.ward } : {}),
      ...(params.q
        ? {
            OR: [
              { name: { contains: params.q, mode: "insensitive" } },
              { address: { contains: params.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(params.maxPricePerSlot
        ? { priceRules: { some: { pricePerSlot: { gt: 0, lte: params.maxPricePerSlot } } } }
        : {}),
    };

    /*
     * Hai truy vấn SONG SONG, cố ý KHÔNG bọc transaction.
     *
     * Bản trước dùng `$transaction([...])` để "đếm và lấy trang thấy cùng một
     * trạng thái bảng". Đúng về lý thuyết, nhưng đây là trang được mở nhiều
     * nhất của sản phẩm, và một transaction giữ riêng một kết nối suốt cả hai
     * câu — trên Neon (pooler) nó đổ ngay khi có vài người tìm cùng lúc:
     *
     *     Transaction API error: Unable to start a transaction in the given time.
     *
     * Cái mất khi bỏ transaction: một khe rất hẹp mà tổng số lệch trang đang
     * xem, ví dụ hiện "47 sân" trong khi vừa có sân thứ 48 được duyệt. Không
     * ai nhận ra. Đổi lại trang tìm sân không sập khi đông người.
     */
    const [items, total] = await Promise.all([
      this.db.venue.findMany({
        where,
        orderBy: PUBLIC_ORDER,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          slug: true,
          name: true,
          address: true,
          ward: true,
          province: true,
          ratingAvg: true,
          ratingCount: true,
          sport: { select: { key: true, name: true } },
          images: {
            where: { isPrimary: true },
            take: 1,
            select: { url: true },
          },
          priceRules: {
            where: { pricePerSlot: { gt: 0 } },
            orderBy: { pricePerSlot: "asc" },
            take: 1,
            select: { pricePerSlot: true },
          },
        },
      }),
      this.db.venue.count({ where }),
    ]);

    return {
      items: items.map((venue) => ({
        ...venue,
        imageUrl: venue.images[0]?.url ?? null,
        fromPricePerSlot: venue.priceRules[0]?.pricePerSlot ?? null,
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Những sân một người có chân — dùng cho màn chọn sân của chủ/nhân viên. */
  async listForUser(userId: string) {
    const members = await this.db.venueMember.findMany({
      where: { userId, status: "ACTIVE", venue: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        permissions: true,
        venue: {
          select: {
            id: true,
            slug: true,
            name: true,
            status: true,
            province: true,
            ward: true,
            sport: { select: { key: true, name: true } },
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
      },
    });

    return members.map((member) => ({
      ...member.venue,
      role: member.role,
      permissions: member.permissions,
    }));
  }

  /**
   * Xoá mềm.
   *
   * KHÔNG xoá thật: lượt đặt, hoá đơn và nhật ký trỏ tới sân này phải đọc được
   * sau khi sân đóng cửa — nếu không thì báo cáo doanh thu năm ngoái vỡ.
   */
  async softDelete(venueId: string, now = new Date()) {
    await this.requireVenue(venueId);

    return this.db.venue.update({
      where: { id: venueId },
      data: { deletedAt: now, status: "SUSPENDED" },
    });
  }

  /**
   * Sinh slug không đụng hàng.
   *
   * Thử `ten-san`, `ten-san-2`, `ten-san-3`… Vẫn có thể đụng nếu hai người tạo
   * cùng lúc — `create()` đổi lỗi trùng thành câu "bấm lại", không thử lại vô hạn.
   *
   * Tên toàn ký tự lạ (slugify ra chuỗi rỗng) thì dùng "san" — chữ "sân" bỏ dấu.
   */
  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "san";

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      const existing = await this.db.venue.findUnique({ where: { slug }, select: { id: true } });
      if (!existing) return slug;
    }

    throw new VenueConfigError("Không sinh được đường dẫn cho tên sân này, đổi tên khác giúp bạn");
  }

  private async requireVenue(venueId: string) {
    const venue = await this.db.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: { id: true },
    });

    if (!venue) throw new VenueNotFoundError();
    return venue;
  }
}

export const venueService = new VenueService();
