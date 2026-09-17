import type { PrismaClient, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { cacheDel, cacheGet, cacheSet } from "@/lib/cache";

/**
 * Thu hồi phiên THẬT SỰ: token hợp lệ về chữ ký vẫn bị từ chối khi tài khoản
 * đã đổi trạng thái kể từ lúc cấp token.
 *
 * ---
 * BÀI TOÁN
 *
 * JWT đã ký thì không thu hồi được — đó là bản chất của nó. Cookie web sống
 * `SESSION_MAX_AGE_DAYS` (mặc định 7 ngày), access token mobile 15 phút. Trong
 * quãng đó ba chuyện có thể đã xảy ra mà chữ ký không hề biết:
 *
 *   1. Mật khẩu vừa đổi/đặt lại — thường vì nghi bị chiếm tài khoản.
 *   2. Tài khoản bị khoá (BANNED) hoặc tạm ngưng (INACTIVE).
 *   3. Tài khoản bị xoá mềm.
 *
 * Refresh token thì thu hồi được (nằm trong database) — nhưng nó chỉ chặn việc
 * GIA HẠN, không chặn token đang cầm. Trước lớp này, admin khoá một người thì
 * người đó vẫn dùng mọi trang bằng cookie cũ thêm một tuần.
 *
 * ---
 * CÁCH LÀM
 *
 * Mọi nơi đọc phiên (`getSession` web, `getApiSession` REST, handshake
 * realtime) hỏi `isTokenStillValid(sub, iat)`. Hàm đó đọc một ẢNH NHỎ của tài
 * khoản — mốc đổi mật khẩu, trạng thái, đã xoá chưa — và so với token.
 *
 * ---
 * VÌ SAO KHÔNG BIẾN NÓ THÀNH MỘT TRUY VẤN MỖI REQUEST
 *
 * Vì đó là một lượt đi database trên đường đi nóng, chỉ để đọc ba giá trị gần
 * như không bao giờ đổi. Nên: cache, và **xoá cache ngay trong chính thao tác
 * làm đổi chúng** (`invalidate`). Nhờ vậy hiệu lực là tức thì chứ không phải
 * "sau khi TTL hết".
 *
 * TTL 60 giây là lưới an toàn cho đường ghi không đi qua service (script chạy
 * tay, sửa thẳng SQL) và cho cache RAM của tiến trình KHÁC khi chưa có Redis —
 * `invalidate` chỉ xoá được bản của tiến trình đang chạy nó.
 */

const CACHE_PREFIX = "secstamp:v2:";
const CACHE_TTL_SECONDS = 60;

/** Những gì về tài khoản quyết định một token còn dùng được hay không. */
export type SecuritySnapshot = {
  /** Mốc đổi mật khẩu gần nhất, GIÂY epoch — cùng đơn vị với `iat`. `null` = chưa từng đổi. */
  passwordChangedAt: number | null;
  status: UserStatus;
  /** Đã xoá mềm — hoặc không còn bản ghi nào. */
  deleted: boolean;
};

/** Ảnh của một id không có trong database: không dùng được, và vẫn cache được. */
const MISSING: SecuritySnapshot = { passwordChangedAt: null, status: "INACTIVE", deleted: true };

export class SecurityStampService {
  constructor(private readonly db: PrismaClient = prisma) {}

  /**
   * `true` khi phép so mốc ĐỔI MẬT KHẨU đang bật (`SESSION_STRICT_REVOCATION`).
   *
   * Không ảnh hưởng phép kiểm trạng thái: khoá/xoá luôn cắt phiên.
   */
  isEnabled(): boolean {
    return env.SESSION_STRICT_REVOCATION;
  }

  async snapshotFor(userId: string): Promise<SecuritySnapshot> {
    const key = `${CACHE_PREFIX}${userId}`;

    const cached = await cacheGet<SecuritySnapshot>(key);
    if (cached !== null) return cached;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { passwordChangedAt: true, status: true, deletedAt: true },
    });

    const snapshot: SecuritySnapshot = user
      ? {
          passwordChangedAt: user.passwordChangedAt
            ? Math.floor(user.passwordChangedAt.getTime() / 1000)
            : null,
          status: user.status,
          deleted: user.deletedAt !== null,
        }
      : MISSING;

    await cacheSet(key, snapshot, CACHE_TTL_SECONDS);
    return snapshot;
  }

  /**
   * Token của `userId`, cấp lúc `issuedAt`, còn được nhận không.
   *
   * @param issuedAt `iat` của JWT (giây epoch).
   *
   * Phép so mốc dùng `>=` chứ không phải `>`, và đó là chủ đích: `iat` chỉ có
   * độ phân giải GIÂY. Mật khẩu đổi ở mili-giây 900 rồi cookie mới được cấp ở
   * mili-giây 950 của CÙNG giây đó thì `iat === mốc` — dùng `>` là phiên vừa
   * cấp để giữ người đang thao tác cũng bị cắt oan ngay request kế tiếp.
   */
  async isTokenStillValid(userId: string, issuedAt: number | undefined): Promise<boolean> {
    const snapshot = await this.snapshotFor(userId);

    if (snapshot.deleted || snapshot.status !== "ACTIVE") return false;
    if (!this.isEnabled() || snapshot.passwordChangedAt === null) return true;

    // Token không mang `iat` thì không chứng minh được nó cấp SAU lần đổi mật
    // khẩu. `signSession` luôn ghi `iat`, nên thiếu nó là token lạ.
    return issuedAt !== undefined && issuedAt >= snapshot.passwordChangedAt;
  }

  /**
   * Gọi NGAY sau mọi lần ghi làm đổi ảnh: đổi/đặt lại mật khẩu, đổi trạng thái
   * (`setStatus`, `update` có `status`), xoá mềm. Quên là hiệu lực trễ tới 60
   * giây.
   */
  async invalidate(userId: string): Promise<void> {
    await cacheDel(`${CACHE_PREFIX}${userId}`);
  }
}

/**
 * Instance dùng chung cho toàn ứng dụng.
 *
 * Constructor nhận `prisma` làm THAM SỐ MẶC ĐỊNH chứ không import cứng: chỗ
 * gọi không phải đổi gì, mà test vẫn tiêm được database giả thay vì phải mock
 * cả module `@/lib/prisma`.
 */
export const securityStampService = new SecurityStampService();
