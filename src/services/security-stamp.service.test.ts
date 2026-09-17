import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { SecurityStampService } from "./security-stamp.service";
import { __clearCache } from "@/lib/cache";

/**
 * Lớp này quyết định một cookie/token đã ký còn dùng được không. Đỏ ở đây là
 * một trong hai lỗi đắt: người bị khoá vẫn thao tác được (lọt), hoặc người vừa
 * đổi mật khẩu bị đá ra ngay trên chính thiết bị đang cầm (cắt oan).
 */

type Row = { passwordChangedAt: Date | null; status: string; deletedAt: Date | null };

const ACTIVE: Row = { passwordChangedAt: null, status: "ACTIVE", deletedAt: null };

function createDb(row: Row | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(row) },
  } as unknown as PrismaClient & { user: { findUnique: ReturnType<typeof vi.fn> } };
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

describe("SecurityStampService", () => {
  beforeEach(async () => {
    await __clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("mốc đổi mật khẩu", () => {
    it("token cấp SAU khi đổi mật khẩu vẫn hợp lệ", async () => {
      const changedAt = new Date("2026-01-01T00:00:00Z");
      const service = new SecurityStampService(
        createDb({ ...ACTIVE, passwordChangedAt: changedAt }),
      );

      await expect(service.isTokenStillValid("u1", seconds(changedAt) + 10)).resolves.toBe(true);
    });

    it("token cấp TRƯỚC khi đổi mật khẩu bị từ chối", async () => {
      /*
       * Đây là lý do lớp này tồn tại: JWT không thu hồi được, nên nếu không so
       * `iat` thì kẻ đã chiếm tài khoản còn thao tác thêm tới hết hạn cookie
       * (7 ngày) SAU KHI chủ thật đổi mật khẩu.
       */
      const changedAt = new Date("2026-01-01T00:00:00Z");
      const service = new SecurityStampService(
        createDb({ ...ACTIVE, passwordChangedAt: changedAt }),
      );

      await expect(service.isTokenStillValid("u1", seconds(changedAt) - 1)).resolves.toBe(false);
    });

    it("token cấp trong CÙNG một giây vẫn được chấp nhận — không cắt oan phiên vừa cấp lại", async () => {
      // `iat` chỉ có độ phân giải giây. So bằng `>` thì cookie cấp lại ngay trong
      // luồng đổi mật khẩu (để giữ người đang thao tác) bị đá ra ở request sau.
      const changedAt = new Date("2026-01-01T00:00:00.900Z");
      const service = new SecurityStampService(
        createDb({ ...ACTIVE, passwordChangedAt: changedAt }),
      );

      await expect(service.isTokenStillValid("u1", seconds(changedAt))).resolves.toBe(true);
    });

    it("token thiếu `iat` bị từ chối khi tài khoản đã từng đổi mật khẩu", async () => {
      const service = new SecurityStampService(
        createDb({ ...ACTIVE, passwordChangedAt: new Date("2026-01-01T00:00:00Z") }),
      );

      await expect(service.isTokenStillValid("u1", undefined)).resolves.toBe(false);
    });

    it("chưa từng đổi mật khẩu thì mọi token của tài khoản đang hoạt động đều hợp lệ", async () => {
      const service = new SecurityStampService(createDb(ACTIVE));

      await expect(service.isTokenStillValid("u1", 0)).resolves.toBe(true);
    });

    it("SESSION_STRICT_REVOCATION=0 chỉ tắt phép so mốc mật khẩu", async () => {
      vi.spyOn(SecurityStampService.prototype, "isEnabled").mockReturnValue(false);
      const service = new SecurityStampService(
        createDb({ ...ACTIVE, passwordChangedAt: new Date("2026-01-01T00:00:00Z") }),
      );

      await expect(service.isTokenStillValid("u1", 0)).resolves.toBe(true);
    });
  });

  describe("trạng thái tài khoản — luôn bật, không cờ nào tắt được", () => {
    it.each(["BANNED", "INACTIVE"])("tài khoản %s bị cắt phiên ngay", async (status) => {
      // Lỗi thật trước đây: khoá tài khoản chỉ thu hồi refresh token, cookie web
      // vẫn vào được mọi trang và mọi Server Action thêm một tuần.
      const service = new SecurityStampService(createDb({ ...ACTIVE, status }));

      await expect(service.isTokenStillValid("u1", seconds(new Date()))).resolves.toBe(false);
    });

    it("tắt SESSION_STRICT_REVOCATION cũng KHÔNG cứu được tài khoản bị khoá", async () => {
      vi.spyOn(SecurityStampService.prototype, "isEnabled").mockReturnValue(false);
      const service = new SecurityStampService(createDb({ ...ACTIVE, status: "BANNED" }));

      await expect(service.isTokenStillValid("u1", seconds(new Date()))).resolves.toBe(false);
    });

    it("tài khoản đã xoá mềm bị cắt phiên", async () => {
      const service = new SecurityStampService(createDb({ ...ACTIVE, deletedAt: new Date() }));

      await expect(service.isTokenStillValid("u1", seconds(new Date()))).resolves.toBe(false);
    });

    it("id không còn trong database thì token vô dụng", async () => {
      const service = new SecurityStampService(createDb(null));

      await expect(service.isTokenStillValid("khong-co", seconds(new Date()))).resolves.toBe(false);
    });
  });

  describe("cache", () => {
    it("lần thứ hai không chạm database", async () => {
      // Phép kiểm này chạy ở MỌI request đã xác thực — một truy vấn mỗi lần là
      // tự thêm một lượt đi database vào đường đi nóng.
      const db = createDb(ACTIVE);
      const service = new SecurityStampService(db);

      await service.snapshotFor("u1");
      await service.snapshotFor("u1");

      expect(db.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it("cache cả id không tồn tại — token rác không dội database mỗi request", async () => {
      const db = createDb(null);
      const service = new SecurityStampService(db);

      await service.isTokenStillValid("khong-co", 0);
      await service.isTokenStillValid("khong-co", 0);

      expect(db.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it("invalidate buộc đọc lại — khoá tài khoản có hiệu lực TỨC THÌ, không đợi TTL", async () => {
      const db = createDb(ACTIVE);
      const service = new SecurityStampService(db);

      await expect(service.isTokenStillValid("u1", 0)).resolves.toBe(true);

      db.user.findUnique.mockResolvedValue({ ...ACTIVE, status: "BANNED" });
      await service.invalidate("u1");

      await expect(service.isTokenStillValid("u1", 0)).resolves.toBe(false);
      expect(db.user.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
