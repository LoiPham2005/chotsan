import type { Prisma, PrismaClient, VenueStatus } from "@prisma/client";
import {
  VenueAdminLockedError,
  VenueConfigError,
  VenueNotFoundError,
  VenueNotReadyError,
} from "@/lib/errors";
import { slugify } from "@/lib/format";
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

export class VenueService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * Tạo cơ sở. Người tạo thành `OWNER` ngay trong cùng transaction.
   *
   * Tách hai bước thì có khe: tạo sân xong, tạo thành viên hỏng, và sân đó
   * không thuộc về ai — kể cả người vừa tạo cũng không sửa được nó.
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
    const slug = await this.uniqueSlug(input.name);

    return this.db.$transaction(async (tx) => {
      const venue = await tx.venue.create({
        data: {
          slug,
          name: input.name.trim(),
          sportId: input.sportId,
          address: input.address.trim(),
          ward: input.ward.trim(),
          province: input.province.trim(),
          phone: input.phone ?? null,
          description: input.description ?? null,
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
    });
  }

  async update(
    venueId: string,
    input: Partial<{
      name: string;
      description: string | null;
      address: string;
      ward: string;
      province: string;
      inactiveNote: string | null;
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
    await this.requireVenue(venueId);

    return this.db.venue.update({ where: { id: venueId }, data: input });
  }

  /**
   * Đổi trạng thái hiển thị.
   *
   * Hai phép kiểm độc lập:
   *
   * 1. **`ADMIN_LOCKED` chỉ admin gỡ được.** Bản cũ tách riêng trạng thái này
   *    và đó là điều đúng: gộp chung một `SUSPENDED` thì chủ sân bị khoá vì vi
   *    phạm chỉ cần bấm "Mở bán lại" là xong — hình phạt không tồn tại.
   *    Người gọi phải nói rõ `byAdmin: true`, không suy ra từ vai trò ở đây.
   *
   * 2. **`ACTIVE` cần đủ giờ mở cửa, một sân con đang bật, và một luật giá.**
   *    Thiếu thứ nào thì lưới đặt sân hiện ra trống trơn hoặc giá 0đ, và khách
   *    nghĩ app hỏng.
   */
  async setStatus(
    venueId: string,
    status: VenueStatus,
    options: { byAdmin?: boolean; inactiveNote?: string | null } = {},
  ) {
    const venue = await this.db.venue.findFirst({
      where: { id: venueId, deletedAt: null },
      select: {
        id: true,
        status: true,
        _count: {
          select: {
            hours: { where: { isClosed: false } },
            courts: { where: { isActive: true, deletedAt: null } },
            priceRules: true,
          },
        },
      },
    });

    if (!venue) throw new VenueNotFoundError();

    const dangBiKhoa = venue.status === "ADMIN_LOCKED";
    if ((dangBiKhoa || status === "ADMIN_LOCKED") && !options.byAdmin) {
      throw new VenueAdminLockedError();
    }

    if (status === "ACTIVE") {
      const thieu: string[] = [];
      if (venue._count.hours === 0) thieu.push("giờ mở cửa");
      if (venue._count.courts === 0) thieu.push("ít nhất một sân con");
      if (venue._count.priceRules === 0) thieu.push("bảng giá");

      if (thieu.length > 0) throw new VenueNotReadyError(thieu);
    }

    return this.db.venue.update({
      where: { id: venueId },
      data: {
        status,
        // Khách đang xem sân cần biết VÌ SAO sân đóng, chứ không phải chỉ thấy
        // "hiện không nhận đặt". Mở bán lại thì xoá ghi chú.
        inactiveNote:
          status === "ACTIVE" ? null : "inactiveNote" in options ? options.inactiveNote : undefined,
      },
    });
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

    for (const hour of hours) {
      if (!Number.isInteger(hour.weekday) || hour.weekday < 0 || hour.weekday > 6) {
        throw new VenueConfigError(`Thứ không hợp lệ: ${hour.weekday}`);
      }
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

  /** Hồ sơ đầy đủ cho trang chi tiết của khách. */
  async publicDetail(slug: string) {
    return this.db.venue.findFirst({
      where: { slug, status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        address: true,
        ward: true,
        province: true,
        inactiveNote: true,
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
  }

  /**
   * Tìm sân cho khách. Phân trang theo SỐ TRANG vì màn tìm kiếm cần biết tổng.
   *
   * `minPrice` lọc theo luật giá RẺ NHẤT của sân — người dùng lọc "dưới 100k"
   * là muốn thấy sân có khung nào đó dưới 100k, không phải sân mà mọi khung
   * đều dưới 100k.
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
        ? { priceRules: { some: { pricePerSlot: { lte: params.maxPricePerSlot } } } }
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
   * cùng lúc — `create()` để lỗi trùng bung ra chứ không thử lại vô hạn.
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
