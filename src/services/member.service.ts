import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@/lib/errors";
import {
  PERMISSION_METADATA,
  VENUE_OWNER_ONLY,
  VENUE_STAFF_GRANTABLE,
  type Permission,
} from "@/lib/permissions";
import { type PermissionService, permissionService } from "@/services/permission.service";

/** Quyền giao việc quản lý nhân sự — thứ duy nhất cho phép chạm vào quyền của người khác. */
const MEMBER_MANAGE: Permission = "member:manage";

/** Người đang thao tác được làm gì với nhân sự của MỘT sân. */
export type StaffManagementScope = {
  /**
   * Là chủ sân (hoặc quản trị nền tảng có `member:manage` toàn cục): cấp/thu
   * `member:manage`, sửa/gỡ người đang giữ nó, cấp mọi quyền tick được.
   */
  canManageManagers: boolean;
  /** Quyền người này ĐƯỢC CẤP cho nhân viên khác ở sân đó. */
  grantable: Permission[];
};

/**
 * Người thao tác có sửa quyền / gỡ được thành viên này không.
 *
 * Đúng các luật `setPermissions` và `remove` dùng để TỪ CHỐI (không tự sửa mình,
 * chủ sân cố định, người quản lý nhân sự chỉ chủ sân đụng được) — trang nhân sự
 * dùng nó để không hiện nút bấm vào là bị từ chối. Service vẫn tự kiểm lại và
 * báo lỗi cụ thể; bài test "giao diện và service nói cùng một điều" giữ hai bên
 * khớp nhau.
 */
export function canManageMember(
  scope: StaffManagementScope,
  actorId: string,
  member: { userId: string; role: string; permissions: readonly string[] },
): boolean {
  if (member.userId === actorId || member.role === "OWNER") return false;
  return scope.canManageManagers || !member.permissions.includes(MEMBER_MANAGE);
}

/**
 * Nhân sự của một cơ sở — chủ sân và nhân viên.
 *
 * ---
 * BA QUYỀN KHÔNG BAO GIỜ TICK ĐƯỢC CHO NHÂN VIÊN
 *
 * `payout:manage` (rút tiền), `venue:delete`, `venue:transfer`. Chúng bị chặn
 * Ở ĐÂY chứ không chỉ bị ẩn khỏi giao diện: giao diện là gợi ý, service mới là
 * luật. Một request tự chế gửi thẳng vào action sẽ đi qua đúng chỗ này.
 *
 * ---
 * NHÂN VIÊN CÓ `member:manage` KHÔNG ĐƯỢC TỰ LEO QUYỀN
 *
 * `member:manage` tick được cho nhân viên, và action chỉ hỏi "có quyền đó trên
 * sân này không". Bản cũ dừng ở đó, nên một nhân viên quản lý nhân sự tự tick
 * cho MÌNH mọi quyền còn lại (hoàn tiền, sửa giá, sửa tài khoản ngân hàng),
 * hoặc gỡ luôn những quản lý khác. Bốn luật chặn việc đó:
 *
 *   1. Không ai tự sửa quyền hay tự gỡ mình.
 *   2. Chỉ chủ sân (hoặc quản trị nền tảng có `member:manage` toàn cục) mới
 *      cấp/thu `member:manage`…
 *   3. …và mới sửa/gỡ được người đang giữ `member:manage`.
 *   4. Nhân viên chỉ CẤP được quyền mà chính họ đang có trên sân đó.
 */
export class MemberService {
  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly permissions: PermissionService = permissionService,
  ) {}

  /**
   * Người thao tác được làm gì với nhân sự của sân này.
   *
   * Dùng ở HAI nơi và phải là MỘT hàm: service để chặn, trang nhân sự để ẩn
   * điều khiển không dùng được. Hai bản tính riêng thì sớm muộn giao diện hiện
   * ô tick mà bấm lưu lại bị từ chối.
   */
  async managementScope(venueId: string, actorId: string): Promise<StaffManagementScope> {
    const [onVenue, global] = await Promise.all([
      this.permissions.venuePermissions(actorId, venueId),
      this.permissions.permissionsFor(actorId),
    ]);

    // Nhóm chỉ-chủ-sân không tới tay nhân viên hay quyền toàn cục (xem
    // `canOnVenue`), nên có đủ nhóm đó trên sân này nghĩa là chủ sân này.
    const isOwner = VENUE_OWNER_ONLY.every((key) => onVenue.has(key));
    const canManageManagers = isOwner || global.has(MEMBER_MANAGE);

    return {
      canManageManagers,
      grantable: canManageManagers
        ? [...VENUE_STAFF_GRANTABLE]
        : VENUE_STAFF_GRANTABLE.filter((key) => key !== MEMBER_MANAGE && onVenue.has(key)),
    };
  }

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
    await this.permissions.invalidateUser(user.id);
    return member;
  }

  /**
   * Đổi danh sách quyền tick thêm cho một nhân viên.
   *
   * @param input.actorId Người đang thao tác — `ctx.actorId` của action. Bắt
   * buộc: bốn luật chống leo quyền ở đầu lớp đều cần biết AI đang sửa.
   */
  async setPermissions(input: {
    memberId: string;
    venueId: string;
    permissions: string[];
    actorId: string;
  }) {
    const member = await this.db.venueMember.findFirst({
      where: { id: input.memberId, venueId: input.venueId },
      select: { id: true, userId: true, role: true, permissions: true },
    });

    if (!member) throw new MemberNotFoundError();
    if (member.userId === input.actorId) throw new MemberSelfManageError();
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

    const scope = await this.managementScope(input.venueId, input.actorId);

    if (!scope.canManageManagers) {
      if (member.permissions.includes(MEMBER_MANAGE)) {
        throw new MemberManagerProtectedError();
      }
      if (cleaned.includes(MEMBER_MANAGE)) throw new MemberManagerGrantError();

      // Chỉ xét quyền được THÊM: quyền chủ sân đã cấp sẵn cho người này mà người
      // thao tác không có thì vẫn giữ nguyên được khi lưu các ô khác.
      const notHeld = cleaned.filter(
        (key) => !member.permissions.includes(key) && !scope.grantable.includes(key),
      );
      if (notHeld.length > 0) throw new MemberGrantNotHeldError(notHeld);
    }

    const updated = await this.db.venueMember.update({
      where: { id: member.id },
      data: { permissions: [...new Set(cleaned)] },
    });

    await this.permissions.invalidateUser(member.userId);
    return updated;
  }

  /**
   * Gỡ một người khỏi cơ sở.
   *
   * Không gỡ được CHỦ SÂN: cơ sở phải luôn có đúng một chủ — ràng buộc đó nằm
   * ở database (`venue_members_mot_chu_cho_moi_co_so`), đây là lớp báo lỗi tử
   * tế trước khi chạm tới nó.
   */
  async remove(input: { memberId: string; venueId: string; actorId: string }) {
    const member = await this.db.venueMember.findFirst({
      where: { id: input.memberId, venueId: input.venueId },
      select: { id: true, userId: true, role: true, permissions: true },
    });

    if (!member) throw new MemberNotFoundError();
    if (member.userId === input.actorId) throw new MemberSelfManageError();
    if (member.role === "OWNER") throw new MemberOwnerFixedError();

    if (member.permissions.includes(MEMBER_MANAGE)) {
      const scope = await this.managementScope(input.venueId, input.actorId);
      if (!scope.canManageManagers) throw new MemberManagerProtectedError();
    }

    await this.db.venueMember.delete({ where: { id: member.id } });
    await this.permissions.invalidateUser(member.userId);
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

/** Luật 1 — không tự sửa quyền, không tự gỡ mình. */
export class MemberSelfManageError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor() {
    super("Bạn không tự sửa quyền hay tự gỡ mình khỏi sân được. Nhờ chủ sân làm việc này.");
  }
}

/** Luật 2 — cấp/thu `member:manage` là việc của chủ sân. */
export class MemberManagerGrantError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor() {
    super("Chỉ chủ sân mới cấp hoặc thu quyền “Quản lý nhân sự”.");
  }
}

/** Luật 3 — người đang quản lý nhân sự chỉ chủ sân mới đụng được. */
export class MemberManagerProtectedError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor() {
    super("Người này đang quản lý nhân sự — chỉ chủ sân mới sửa quyền hoặc gỡ được họ.");
  }
}

/** Luật 4 — không cấp quyền mình không có trên sân này. */
export class MemberGrantNotHeldError extends DomainError {
  readonly code = "FORBIDDEN" as const;
  constructor(keys: readonly Permission[]) {
    super(
      `Bạn chỉ cấp được quyền mà chính bạn đang có ở sân này. Chưa có: ${keys
        .map((key) => PERMISSION_METADATA[key].name)
        .join(", ")}.`,
    );
  }
}

export class MemberPermissionError extends DomainError {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(key: string) {
    super(`Quyền không hợp lệ: ${key}`);
  }
}

export const memberService = new MemberService();
