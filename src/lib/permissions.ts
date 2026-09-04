/**
 * DANH MỤC quyền hạn và bộ gán MẶC ĐỊNH.
 *
 * ---
 * PHÂN CÔNG GIỮA CODE VÀ DATABASE
 *
 * Code giữ danh mục quyền TỒN TẠI. Database giữ việc GÁN quyền cho vai trò.
 *
 * Vì sao chia như vậy: một quyền chỉ có ý nghĩa khi có dòng mã nào đó kiểm tra
 * nó. Cho phép tạo quyền mới từ giao diện quản trị sẽ sinh ra những bản ghi
 * không ràng buộc điều gì — người quản trị tick vào rồi tưởng đã cấm được, mà
 * thực tế không có gì thay đổi.
 *
 * Ngược lại, "vai trò KẾ TOÁN được xem báo cáo nhưng không xoá đơn" là quyết
 * định nghiệp vụ, đổi theo từng khách hàng, và không nên cần một lần deploy.
 *
 * Kết quả: tên quyền vẫn được TypeScript bắt lỗi lúc biên dịch, còn ai được
 * làm gì thì sửa được lúc chạy.
 *
 * ---
 * FILE NÀY KHÔNG DÙNG ĐỂ KIỂM TRA QUYỀN LÚC CHẠY
 *
 * Dùng `PermissionService.can()` trong `@repo/core` — nó đọc từ database (có
 * cache). Bảng `DEFAULT_ROLE_PERMISSIONS` dưới đây chỉ là dữ liệu nền cho
 * `pnpm db:seed`.
 *
 * ---
 * THÊM QUYỀN MỚI CHO DỰ ÁN CỦA BẠN
 *
 *   1. Thêm khoá vào `PERMISSIONS`.
 *   2. Thêm mô tả vào `PERMISSION_METADATA` (TypeScript sẽ bắt lỗi nếu quên).
 *   3. Thêm vào vai trò tương ứng trong `DEFAULT_ROLE_PERMISSIONS`.
 *   4. `pnpm db:seed` — không cần viết migration.
 */

export const PERMISSIONS = [
  // Quản lý người dùng
  "user:read",
  "user:create",
  "user:update",
  "user:delete",

  // Hồ sơ cá nhân
  "profile:read:own",
  "profile:update:own",

  // Vai trò & phân quyền
  "role:read",
  "role:create",
  "role:update",
  "role:delete",

  // Nhật ký & hệ thống
  "audit:read",
  "system:manage",

  // Thông báo
  "notification:read",
  "notification:send",

  // Tệp tin
  "file:upload",

  // ---------------------------------------------------------------------
  // QUYỀN THEO SÂN — luôn hỏi kèm `venueId` qua `canOnVenue()`.
  // Xem docs/THIET_KE_LAI.md §2 và `VENUE_STAFF_DEFAULT` bên dưới.
  // ---------------------------------------------------------------------
  "venue:read",
  "venue:update",
  "venue:delete",
  "venue:transfer",
  "court:read",
  "court:update",
  "pricing:read",
  "pricing:update",
  "booking:read",
  "booking:create",
  "booking:checkin",
  "booking:cancel",
  "booking:reschedule",
  "payment:refund",
  "payment:confirm",
  "report:read",
  "member:manage",
  "payout:manage",

  // Quyền toàn nền tảng, KHÔNG gắn sân
  "venue:approve",
  "payout:approve",
  "invoice:manage",
  "dispute:resolve",
  "setting:update",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// ---------------------------------------------------------------------------
// Phân quyền theo SÂN
// ---------------------------------------------------------------------------

/** Vai trò gắn với một sân cụ thể, qua bảng `VenueMember`. */
export const VENUE_ROLES = { OWNER: "OWNER", STAFF: "STAFF" } as const;
export type VenueRoleKey = (typeof VENUE_ROLES)[keyof typeof VENUE_ROLES];

/**
 * Quyền STAFF có SẴN, không cần chủ sân tick.
 *
 * ⚠️ Danh sách này phải đủ để trực sân từ ngày đầu. Để trống rồi bắt chủ sân
 * tick 12 ô cho mỗi nhân viên mới là làm hỏng đúng thứ mà vai trò sinh ra để
 * giải quyết — và quên một ô là nhân viên không làm việc được rồi gọi điện hỏi.
 */
export const VENUE_STAFF_DEFAULT: readonly Permission[] = [
  "venue:read",
  "court:read",
  "pricing:read",
  "booking:read",
  "booking:checkin",
  "booking:create",
];

/**
 * Quyền chủ sân TICK THÊM được cho từng nhân viên.
 *
 * Đây là thứ thay cho vai trò `MANAGER` cứng: mỗi sân định nghĩa "quản lý" một
 * kiểu, nhét tất cả vào một enum là ép 100 sân theo hình dạng của một sân.
 */
export const VENUE_STAFF_GRANTABLE: readonly Permission[] = [
  "booking:cancel",
  "payment:confirm",
  "booking:reschedule",
  "payment:refund",
  "pricing:update",
  "court:update",
  "venue:update",
  "report:read",
  "member:manage",
];

/**
 * ⚠️ KHÔNG BAO GIỜ tick được cho STAFF — chỉ `OWNER` của sân đó.
 *
 * Đây là tiền rời khỏi hệ thống và mất sân. Giao diện phải KHÔNG CÓ Ô để tick,
 * không phải hiện ra rồi cảnh báo khi bấm: một cú bấm nhầm là mất trắng và chủ
 * sân sẽ không hiểu mình vừa làm gì.
 */
export const VENUE_OWNER_ONLY: readonly Permission[] = [
  "payout:manage",
  "venue:delete",
  "venue:transfer",
];

/** Quyền có ý nghĩa trong phạm vi một sân — dùng cho `canOnVenue()`. */
export const VENUE_SCOPED_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  ...VENUE_STAFF_DEFAULT,
  ...VENUE_STAFF_GRANTABLE,
  ...VENUE_OWNER_ONLY,
]);

export function isVenueScopedPermission(value: string): value is Permission {
  return VENUE_SCOPED_PERMISSIONS.has(value);
}

/** Chủ sân có tick được quyền này cho nhân viên không. */
export function isGrantableToStaff(value: string): value is Permission {
  return (VENUE_STAFF_GRANTABLE as readonly string[]).includes(value);
}

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

/** Một chuỗi bất kỳ có phải quyền đang tồn tại trong code không. */
export function isKnownPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Vai trò hệ thống — được `db:seed` tạo sẵn và không cho xoá.
 *
 * Dự án cụ thể tạo thêm vai trò riêng từ giao diện quản trị; danh sách này chỉ
 * là bộ khung tối thiểu để hệ thống chạy được ngay sau khi cài.
 */
export const SYSTEM_ROLES = {
  /** Toàn quyền. Luôn có MỌI quyền, kể cả quyền mới thêm sau này. */
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  /**
   * Vai trò mặc định của tài khoản tự đăng ký.
   *
   * ChốtSân chỉ có BA vai trò nền tảng. `OWNER` và `STAFF` là vai trò THEO SÂN
   * (enum trên `VenueMember`), không phải dòng trong bảng `roles` — xem
   * docs/THIET_KE_LAI.md §2. Đừng thêm chúng lại vào đây: `STAFF` tồn tại ở hai
   * nơi với hai nghĩa chính là cái bẫy đã làm hỏng bản cũ.
   */
  USER: "USER",
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/** Khoá vai trò. Chuỗi tự do vì quản trị viên tạo thêm vai trò được lúc chạy. */
export type RoleKey = string;

export type RoleSeed = {
  key: SystemRoleKey;
  name: string;
  description: string;
  /**
   * Bậc quyền lực. Cao hơn = mạnh hơn.
   *
   * Chừa khoảng trống giữa các bậc (0 → 10 → 20 → 50 → 100) để sau này chèn
   * vai trò mới vào giữa mà không phải đánh số lại toàn bộ — đánh số lại là
   * thao tác mà một lần sai sẽ trao quyền cho nhầm người.
   */
  level: number;
  /** `"*"` = mọi quyền, kể cả quyền được thêm vào code sau này. */
  permissions: readonly Permission[] | "*";
};

export const DEFAULT_ROLE_PERMISSIONS: readonly RoleSeed[] = [
  {
    key: SYSTEM_ROLES.SUPER_ADMIN,
    level: 100,
    name: "Quản trị tối cao",
    description: "Toàn quyền mọi chức năng. Luôn được cấp cả quyền thêm mới sau này.",
    // Liệt kê tay thì mỗi lần thêm quyền mới lại phải nhớ bổ sung vào đây — và
    // quên một lần là SUPER_ADMIN mất quyền đó mà không ai để ý.
    permissions: "*",
  },
  {
    key: SYSTEM_ROLES.ADMIN,
    level: 50,
    name: "Quản trị viên",
    description: "Quản lý người dùng, phân quyền, thông báo và xem nhật ký",
    permissions: [
      "user:read",
      "user:create",
      "user:update",
      "profile:read:own",
      "profile:update:own",
      "role:read",
      "role:create",
      "role:update",
      "audit:read",
      "notification:read",
      "notification:send",
      "file:upload",
      // Quản trị nền tảng: xem được MỌI sân, nhưng không rút tiền hộ ai
      "venue:read",
      "venue:approve",
      "court:read",
      "pricing:read",
      "booking:read",
      "booking:cancel",
      "payment:refund",
      "payment:confirm",
      "report:read",
      "dispute:resolve",
      /*
       * Đối soát hoá đơn hoa hồng — KHÔNG PHẢI `payout:approve`.
       *
       * Hai việc khác hẳn nhau: `payout:approve` là duyệt tiền CHI RA cho chủ
       * sân, `invoice:manage` là ghi nhận tiền THU VÀO từ chủ sân. Dùng chung
       * một quyền cho cả hai là mở đường chi tiền cho người chỉ được giao việc
       * đi thu.
       */
      "invoice:manage",
    ],
  },
  {
    key: SYSTEM_ROLES.USER,
    level: 0,
    name: "Người dùng",
    description: "Chỉ thao tác trên dữ liệu của chính mình",
    permissions: ["profile:read:own", "profile:update:own", "notification:read"],
  },
];

export type PermissionMeta = {
  name: string;
  /** Nhóm hiển thị trên màn phân quyền. */
  category: string;
  description: string;
};

export const PERMISSION_METADATA: Record<Permission, PermissionMeta> = {
  "user:read": {
    name: "Xem người dùng",
    category: "Quản lý Người dùng",
    description: "Xem danh sách và chi tiết người dùng",
  },
  "user:create": {
    name: "Tạo người dùng",
    category: "Quản lý Người dùng",
    description: "Tạo tài khoản mới thay cho người dùng",
  },
  "user:update": {
    name: "Sửa người dùng",
    category: "Quản lý Người dùng",
    description: "Sửa thông tin, trạng thái và vai trò của người dùng",
  },
  "user:delete": {
    name: "Xoá người dùng",
    category: "Quản lý Người dùng",
    description: "Xoá mềm tài khoản người dùng",
  },
  "profile:read:own": {
    name: "Xem hồ sơ cá nhân",
    category: "Hồ sơ Cá nhân",
    description: "Xem hồ sơ của chính mình",
  },
  "profile:update:own": {
    name: "Sửa hồ sơ cá nhân",
    category: "Hồ sơ Cá nhân",
    description: "Sửa hồ sơ của chính mình",
  },
  "role:read": {
    name: "Xem vai trò & quyền",
    category: "Phân quyền (RBAC)",
    description: "Xem danh sách vai trò và bảng phân quyền",
  },
  "role:create": {
    name: "Tạo vai trò",
    category: "Phân quyền (RBAC)",
    description: "Tạo vai trò mới",
  },
  "role:update": {
    name: "Sửa vai trò",
    category: "Phân quyền (RBAC)",
    description: "Đổi tên vai trò và gán/gỡ quyền",
  },
  "role:delete": {
    name: "Xoá vai trò",
    category: "Phân quyền (RBAC)",
    description: "Xoá vai trò không phải vai trò hệ thống",
  },
  "audit:read": {
    name: "Xem nhật ký kiểm toán",
    category: "Hệ thống & Bảo mật",
    description: "Xem nhật ký các hành động nhạy cảm",
  },
  "system:manage": {
    name: "Quản trị hệ thống",
    category: "Hệ thống & Bảo mật",
    description: "Xem trạng thái hạ tầng, hàng đợi và cấu hình vận hành",
  },
  "notification:read": {
    name: "Xem thông báo",
    category: "Thông báo",
    description: "Xem hộp thông báo của mình",
  },
  "notification:send": {
    name: "Gửi thông báo",
    category: "Thông báo",
    description: "Tạo và gửi thông báo tới người dùng",
  },
  "file:upload": {
    name: "Tải tệp lên",
    category: "Tệp tin",
    description: "Xin link tải tệp lên kho lưu trữ",
  },
  // --- Theo sân ---
  "venue:read": {
    name: "Xem sân",
    category: "Sân bãi",
    description: "Xem thông tin cơ sở được gán",
  },
  "venue:update": {
    name: "Sửa thông tin sân",
    category: "Sân bãi",
    description: "Sửa tên, mô tả, ảnh, giờ mở cửa, tiện ích",
  },
  "venue:delete": {
    name: "Xoá sân",
    category: "Sân bãi",
    description: "⚠️ Chỉ chủ sân. Không tick được cho nhân viên",
  },
  "venue:transfer": {
    name: "Chuyển quyền sở hữu",
    category: "Sân bãi",
    description: "⚠️ Chỉ chủ sân. Không tick được cho nhân viên",
  },
  "court:read": {
    name: "Xem sân con",
    category: "Sân bãi",
    description: "Xem danh sách sân con và lịch đóng bảo trì",
  },
  "court:update": {
    name: "Sửa sân con",
    category: "Sân bãi",
    description: "Thêm, sửa, xoá sân con; đóng sân bảo trì",
  },
  "pricing:read": {
    name: "Xem bảng giá",
    category: "Giá",
    description: "Xem giá theo khung giờ và giá đè ngày lễ",
  },
  "pricing:update": {
    name: "Sửa bảng giá",
    category: "Giá",
    description: "Đổi giá theo khung giờ, đặt giá ngày lễ",
  },
  "booking:read": {
    name: "Xem lượt đặt",
    category: "Đặt sân",
    description: "Xem lịch sân và danh sách lượt đặt",
  },
  "booking:create": {
    name: "Đặt tại quầy",
    category: "Đặt sân",
    description: "Tạo lượt đặt cho khách vãng lai",
  },
  "booking:checkin": {
    name: "Check-in khách",
    category: "Đặt sân",
    description: "Đánh dấu khách đã tới sân",
  },
  "booking:cancel": {
    name: "Huỷ lượt đặt",
    category: "Đặt sân",
    description: "Huỷ lượt đặt của khách",
  },
  "booking:reschedule": {
    name: "Đổi giờ",
    category: "Đặt sân",
    description: "Đổi khung giờ hoặc sân con của lượt đặt",
  },
  "payment:refund": { name: "Hoàn tiền", category: "Tiền", description: "Hoàn tiền cho khách" },
  "payment:confirm": {
    name: "Duyệt chuyển khoản",
    category: "Tiền",
    description: "⚠️ Xác nhận khách đã chuyển khoản tay. Duyệt nhầm là mất một lượt sân",
  },
  "report:read": {
    name: "Xem doanh thu",
    category: "Tiền",
    description: "Xem báo cáo doanh thu và tỉ lệ lấp đầy",
  },
  "member:manage": {
    name: "Quản lý nhân viên",
    category: "Sân bãi",
    description: "Mời, gỡ nhân viên và tick quyền cho họ",
  },
  "payout:manage": {
    name: "Rút tiền",
    category: "Tiền",
    description: "⚠️ Chỉ chủ sân. Xin chi trả về tài khoản ngân hàng",
  },

  // --- Toàn nền tảng ---
  "venue:approve": {
    name: "Duyệt sân",
    category: "Vận hành nền tảng",
    description: "Duyệt hoặc từ chối sân mới đăng ký",
  },
  "payout:approve": {
    name: "Duyệt chi trả",
    category: "Vận hành nền tảng",
    description: "⚠️ Tiền rời khỏi hệ thống. Chỉ quản trị tối cao",
  },
  "invoice:manage": {
    name: "Đối soát hoá đơn hoa hồng",
    category: "Vận hành nền tảng",
    description: "Ghi nhận đã thu, miễn hoá đơn. KHÁC `payout:approve` — đây là tiền THU VÀO",
  },
  "dispute:resolve": {
    name: "Xử lý khiếu nại",
    category: "Vận hành nền tảng",
    description: "Giải quyết khiếu nại và hoàn tiền thủ công",
  },
  "setting:update": {
    name: "Sửa cấu hình nền tảng",
    category: "Vận hành nền tảng",
    description: "⚠️ Hoa hồng, chính sách huỷ, cổng thanh toán",
  },
};

/** Danh sách quyền, gom theo `category` — dùng dựng màn phân quyền. */
export function permissionsByCategory(): Array<{
  category: string;
  permissions: Array<{ key: Permission } & PermissionMeta>;
}> {
  const groups = new Map<string, Array<{ key: Permission } & PermissionMeta>>();

  for (const key of PERMISSIONS) {
    const meta = PERMISSION_METADATA[key];
    const list = groups.get(meta.category) ?? [];
    list.push({ key, ...meta });
    groups.set(meta.category, list);
  }

  return [...groups.entries()].map(([category, permissions]) => ({ category, permissions }));
}

/** Quyền của một vai trò seed, đã giải `"*"` thành danh sách đầy đủ. */
export function resolveSeedPermissions(seed: RoleSeed): readonly Permission[] {
  return seed.permissions === "*" ? PERMISSIONS : seed.permissions;
}
