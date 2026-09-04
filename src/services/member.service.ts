import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";
import { VENUE_OWNER_ONLY, VENUE_STAFF_GRANTABLE, type Permission } from "@/lib/permissions";
import { permissionService } from "@/services/permission.service";

/**
 * Nhân sự của một cơ sở — chủ sân và nhân viên.
 *
 * ---
 * BA QUYỀN KHÔNG BAO GIỜ TICK ĐƯỢC CHO NHÂN VIÊN
 *
 * `payout:manage` (rút tiền), `venue:delete`, `venue:transfer`. Chúng bị chặn
 * Ở ĐÂY chứ không chỉ bị ẩn khỏi giao diện: giao diện là gợi ý, service mới là
 * luật. Một request tự chế gửi thẳng vào action sẽ đi qua đúng chỗ này.
 */
export class MemberService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listForVenue(venueId: string) {
    return this.db.venueMember.findMany({
      where: { venueId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        status: true,
        permissions: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, phone: true, profile: { select: { fullName: true } } },
        },
      },
    });
  }

  /**
   * Mời một người đã có tài khoản vào làm nhân viên.
   *
   * Chỉ mời được người ĐÃ đăng ký: mời qua email cho người chưa có tài khoản
   * cần thêm luồng token mời + trang chấp nhận, và cho tới khi có luồng đó thì
   * nói thẳng "chưa có tài khoản" tốt hơn là tạo một lời mời treo mãi.
   */
  async invite(input: { venueId: string; email: string; invitedBy: string }) {
    const user = await this.db.user.findFirst({
      where: { email: input.email.trim().toLowerCase(), deletedAt: null },
      select: { id: true },
    });

    if (!user) throw new MemberNotRegisteredError();

    const existing = await this.db.venueMember.findUnique({
      where: { venueId_userId: { venueId: input.venueId, userId: user.id } },
      select: { id: true },
    });

    if (existing) throw new MemberAlreadyInVenueError();

    const member = await this.db.venueMember.create({
      data: {
        venueId: input.venueId,
        userId: user.id,
        role: "STAFF",
        status: "ACTIVE",
        permissions: [],
        invitedBy: input.invitedBy,
      },
    });

    // Quyền của người này vừa đổi — bộ nhớ đệm phải bỏ ngay, nếu không họ chờ
    // tới 60 giây mới vào được, và sẽ báo là "app hỏng".
    await permissionService.invalidateUser(user.id);
    return member;
  }

  /** Đổi danh sách quyền tick thêm cho một nhân viên. */
  async setPermissions(input: { memberId: string; venueId: string; permissions: string[] }) {
    const member = await this.db.venueMember.findFirst({
      where: { id: input.memberId, venueId: input.venueId },
      select: { id: true, userId: true, role: true },
    });

    if (!member) throw new MemberNotFoundError();
    if (member.role === "OWNER") throw new MemberOwnerFixedError();

    const cleaned: Permission[] = [];

    for (const key of input.permissions) {
      // Thứ tự kiểm có chủ đích: báo "chỉ chủ sân mới có" cụ thể hơn hẳn
      // "quyền không hợp lệ", và đó là nhầm lẫn hay gặp nhất.
      if ((VENUE_OWNER_ONLY as readonly string[]).includes(key)) {
        throw new MemberOwnerOnlyPermissionError(key);
      }
      if (!(VENUE_STAFF_GRANTABLE as readonly string[]).includes(key)) {
        throw new MemberPermissionError(key);
      }
      cleaned.push(key as Permission);
    }

    const updated = await this.db.venueMember.update({
      where: { id: member.id },
      data: { permissions: [...new Set(cleaned)] },
    });

    await permissionService.invalidateUser(member.userId);
    return updated;
  }

  /**
   * Gỡ một người khỏi cơ sở.
   *
   * Không gỡ được CHỦ SÂN: cơ sở phải luôn có đúng một chủ — ràng buộc đó nằm
   * ở database (`venue_members_mot_chu_cho_moi_co_so`), đây là lớp báo lỗi tử
   * tế trước khi chạm tới nó.
   */
  async remove(input: { memberId: string; venueId: string }) {
    const member = await this.db.venueMember.findFirst({
      where: { id: input.memberId, venueId: input.venueId },
      select: { id: true, userId: true, role: true },
    });

    if (!member) throw new MemberNotFoundError();
    if (member.role === "OWNER") throw new MemberOwnerFixedError();

    await this.db.venueMember.delete({ where: { id: member.id } });
    await permissionService.invalidateUser(member.userId);
  }
}

export class MemberNotRegisteredError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Email này chưa có tài khoản ChốtSân. Bảo họ đăng ký trước rồi mời lại.");
  }
}

export class MemberAlreadyInVenueError extends DomainError {
  readonly code = "CONFLICT" as const;
  constructor() {
    super("Người này đã ở trong sân của bạn rồi");
  }
}

export class MemberNotFoundError extends DomainError {
  readonly code = "NOT_FOUND" as const;
  constructor() {
    super("Không tìm thấy nhân sự này");
  }
}

export class MemberOwnerFixedError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor() {
    super("Chủ sân luôn có mọi quyền và không gỡ được. Muốn đổi chủ thì dùng chuyển nhượng.");
  }
}

export class MemberOwnerOnlyPermissionError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor(key: string) {
    super(`Quyền "${key}" chỉ chủ sân mới có, không tick cho nhân viên được`);
  }
}

export class MemberPermissionError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(key: string) {
    super(`Quyền không hợp lệ: ${key}`);
  }
}

export const memberService = new MemberService();
