import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getSession` là cửa DUY NHẤT mà trang, layout và bốn wrapper Server Action
 * dùng để biết ai đang đăng nhập. Hai lỗi đắt nhất:
 *
 *   1. Cookie đúng chữ ký của tài khoản đã bị khoá/xoá/đổi mật khẩu vẫn qua —
 *      lỗi thật trước đây, cookie cũ sống thêm tới 7 ngày.
 *   2. `requireUser` đưa người chưa đăng nhập về sai trang (hoặc ra ngoài site).
 */

const cookieStore = { get: vi.fn() };
const headerStore = new Headers();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(cookieStore),
  headers: () => Promise.resolve(headerStore),
}));

/** `redirect`/`notFound` thật ném lỗi để dừng render — giả lập đúng như vậy. */
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/services/security-stamp.service", () => ({
  securityStampService: { isTokenStillValid: vi.fn() },
}));

vi.mock("@/services/user.service", () => ({
  userService: { findById: vi.fn() },
}));

vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn(), canOnVenue: vi.fn() },
}));

import { signSession, CURRENT_PATH_HEADER } from "./session";
import { securityStampService } from "@/services/security-stamp.service";
import { userService } from "@/services/user.service";
import { getSession, requireUser, requireVenueAccess } from "./auth";

const USER = { id: "u1", email: "an@example.com", roles: ["USER"] };

beforeEach(async () => {
  vi.clearAllMocks();
  headerStore.delete(CURRENT_PATH_HEADER);
  const token = await signSession({ typ: "access", sub: "u1", email: USER.email, roles: [] });
  cookieStore.get.mockReturnValue({ value: token });
  vi.mocked(securityStampService.isTokenStillValid).mockResolvedValue(true);
  vi.mocked(userService.findById).mockResolvedValue(USER as never);
});

describe("getSession", () => {
  it("cookie hợp lệ và phiên chưa bị thu hồi → có phiên", async () => {
    await expect(getSession()).resolves.toMatchObject({ sub: "u1" });
    // Kiểm theo ĐÚNG người và ĐÚNG thời điểm cấp token.
    expect(securityStampService.isTokenStillValid).toHaveBeenCalledWith("u1", expect.any(Number));
  });

  it("cookie ĐÚNG chữ ký nhưng phiên đã bị thu hồi (khoá, xoá, đổi mật khẩu) → không có phiên", async () => {
    vi.mocked(securityStampService.isTokenStillValid).mockResolvedValue(false);

    await expect(getSession()).resolves.toBeNull();
  });

  it("cookie rác → không có phiên, không cần hỏi tới ảnh tài khoản", async () => {
    cookieStore.get.mockReturnValue({ value: "rac" });

    await expect(getSession()).resolves.toBeNull();
    expect(securityStampService.isTokenStillValid).not.toHaveBeenCalled();
  });
});

describe("requireUser — đưa người chưa đăng nhập về đúng chỗ", () => {
  it("không truyền returnTo → quay lại ĐÚNG trang đang mở (từ header proxy gắn)", async () => {
    // Lỗi thật trước đây: layout quản trị viết cứng `/users`, người mở
    // `/invoices?page=2` đăng nhập xong bị đưa sang trang khác.
    vi.mocked(securityStampService.isTokenStillValid).mockResolvedValue(false);
    headerStore.set(CURRENT_PATH_HEADER, "/invoices?page=2");

    await expect(requireUser()).rejects.toThrow(
      `REDIRECT:/login?next=${encodeURIComponent("/invoices?page=2")}`,
    );
  });

  it("returnTo tường minh thắng header", async () => {
    cookieStore.get.mockReturnValue(undefined);
    headerStore.set(CURRENT_PATH_HEADER, "/invoices");

    await expect(requireUser("/manage")).rejects.toThrow(
      `REDIRECT:/login?next=${encodeURIComponent("/manage")}`,
    );
  });

  it("header bị giả thành đích ngoài site → về /login trơn, không mang `next`", async () => {
    cookieStore.get.mockReturnValue(undefined);
    headerStore.set(CURRENT_PATH_HEADER, "//evil.com");

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    await expect(requireUser()).rejects.not.toThrow("next=");
  });

  it("đã đăng nhập thì trả user, không chuyển hướng", async () => {
    await expect(requireUser()).resolves.toMatchObject({ id: "u1" });
  });

  it("requireVenueAccess cũng quay lại đúng trang con của sân", async () => {
    cookieStore.get.mockReturnValue(undefined);
    headerStore.set(CURRENT_PATH_HEADER, "/manage/v1/payments");

    await expect(requireVenueAccess("v1", "payment:confirm")).rejects.toThrow(
      `REDIRECT:/login?next=${encodeURIComponent("/manage/v1/payments")}`,
    );
  });
});
