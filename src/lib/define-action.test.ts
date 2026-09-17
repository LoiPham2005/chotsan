import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `defineAction` là chốt chặn của MỌI Server Action trong dự án. Hỏng nó là
 * hỏng cùng lúc toàn bộ lớp kiểm quyền ở tầng action — nên nó cần test riêng,
 * không dựa vào test của từng action.
 */

const headerStore = new Headers();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(headerStore) }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn(), canOnVenue: vi.fn() },
}));

import { getSession } from "@/lib/auth";
import { __clearRateLimits } from "@/lib/rate-limit";
import { permissionService } from "@/services/permission.service";
import {
  defineAction,
  defineAuthedAction,
  definePublicAction,
  defineVenueAction,
} from "./define-action";

const session = { sub: "u-1", email: "a@b.com", typ: "access" as const, roles: ["KE_TOAN"] };

beforeEach(async () => {
  vi.clearAllMocks();
  headerStore.delete("x-forwarded-for");
  await __clearRateLimits();
});

describe("defineAction", () => {
  it("chạy phần thân khi có quyền, và truyền actorId vào ngữ cảnh", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(true);

    const body = vi.fn().mockResolvedValue({ ok: true });
    const action = defineAction("user:create", body);

    const result = await action("tham-so");

    expect(result).toEqual({ ok: true });
    expect(body).toHaveBeenCalledWith({ session, actorId: "u-1" }, "tham-so");
  });

  it("chặn khi chưa đăng nhập và KHÔNG chạm vào phần thân", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const body = vi.fn();
    const result = await defineAction("user:create", body)();

    expect(result.error).toContain("đăng nhập");
    // Điểm mấu chốt: phần thân không được chạy. Nếu nó chạy rồi mới bị chặn ở
    // đầu ra thì tác dụng phụ (ghi database, gửi mail) đã xảy ra mất rồi.
    expect(body).not.toHaveBeenCalled();
  });

  it("chặn khi thiếu quyền và KHÔNG chạm vào phần thân", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(false);

    const body = vi.fn();
    const result = await defineAction("user:delete", body)();

    expect(result.error).toContain("không có quyền");
    expect(body).not.toHaveBeenCalled();
  });

  it("hỏi ĐÚNG quyền đã khai báo, theo vai trò trong session", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(true);

    await defineAction("role:update", vi.fn().mockResolvedValue({}))();

    // Kiểm theo QUYỀN, không phải theo tên vai trò — nhờ vậy vai trò tự tạo
    // (KE_TOAN trong session ở đây) vẫn dùng được action nếu được tick quyền
    // tương ứng. `can` nhận userId chứ không nhận vai trò: một người có thể
    // mang nhiều vai trò cùng lúc, hợp quyền của chúng nằm dưới database.
    expect(permissionService.can).toHaveBeenCalledWith(session.sub, "role:update");
  });

  it("không nuốt lỗi từ phần thân", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.can).mockResolvedValue(true);

    const action = defineAction("user:create", () => Promise.reject(new Error("lỗi nghiệp vụ")));

    // Lỗi phải bung ra để error boundary/logger xử lý, không được biến thành
    // một object trông như thành công.
    await expect(action()).rejects.toThrow("lỗi nghiệp vụ");
  });
});

describe("defineAuthedAction", () => {
  it("cho qua khi đã đăng nhập, không hỏi quyền nào", async () => {
    vi.mocked(getSession).mockResolvedValue(session);

    const result = await defineAuthedAction(() => Promise.resolve({ error: undefined }))();

    expect(result.error).toBeUndefined();
    expect(permissionService.can).not.toHaveBeenCalled();
  });

  it("vẫn chặn khi chưa đăng nhập", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const body = vi.fn();
    const result = await defineAuthedAction(body)();

    expect(result.error).toContain("đăng nhập");
    expect(body).not.toHaveBeenCalled();
  });
});

describe("defineVenueAction", () => {
  it("chạy phần thân khi có quyền TRÊN ĐÚNG SÂN, và đưa venueId vào ngữ cảnh", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.canOnVenue).mockResolvedValue(true);

    const body = vi.fn().mockResolvedValue({});
    await defineVenueAction("booking:cancel", body)("v1", "tham-so");

    expect(permissionService.canOnVenue).toHaveBeenCalledWith("u-1", "booking:cancel", "v1");
    expect(body).toHaveBeenCalledWith({ session, actorId: "u-1", venueId: "v1" }, "tham-so");
  });

  it("thiếu quyền trên sân này → chặn, KHÔNG chạy phần thân", async () => {
    // Có quyền ở sân khác không mở được sân này — đúng lỗ hổng của bản cũ:
    // nhân viên sân A thao tác được sân B nếu tìm đúng endpoint.
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(permissionService.canOnVenue).mockImplementation((_user, _permission, venueId) =>
      Promise.resolve(venueId === "v1"),
    );

    const body = vi.fn();
    const result = await defineVenueAction("booking:cancel", body)("v2");

    expect(result.error).toContain("trên sân này");
    expect(body).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập (hoặc phiên đã bị thu hồi) → chặn trước khi hỏi quyền", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const body = vi.fn();
    const result = await defineVenueAction("booking:cancel", body)("v1");

    expect(result.error).toContain("đăng nhập");
    expect(permissionService.canOnVenue).not.toHaveBeenCalled();
    expect(body).not.toHaveBeenCalled();
  });
});

describe("definePublicAction", () => {
  const options = { key: "khai-chuyen-khoan", limit: 2, windowSeconds: 60 };

  it("khách vãng lai: đếm theo IP do proxy tin cậy thêm vào, không theo phần tử client tự gửi", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    // `6.6.6.6` do client tự gửi; `203.0.113.7` do proxy nối vào cuối.
    headerStore.set("x-forwarded-for", "6.6.6.6, 203.0.113.7");

    const body = vi.fn().mockResolvedValue({ ok: true });
    await definePublicAction("khách không có tài khoản", options, body)();

    expect(body).toHaveBeenCalledWith({ session: null, actorId: null, ip: "203.0.113.7" });
  });

  it("vượt trần → chặn, KHÔNG chạy phần thân", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    headerStore.set("x-forwarded-for", "203.0.113.8");

    const body = vi.fn().mockResolvedValue({});
    const action = definePublicAction("khách không có tài khoản", options, body);

    await action();
    await action();
    const blocked = await action();

    expect(blocked.error).toContain("hơi nhanh");
    expect(body).toHaveBeenCalledTimes(2);
  });

  it("đổi phần tử ĐẦU của X-Forwarded-For không lách được trần", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const body = vi.fn().mockResolvedValue({});
    const action = definePublicAction("khách không có tài khoản", options, body);

    for (const fake of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      headerStore.set("x-forwarded-for", `${fake}, 203.0.113.9`);
      await action();
    }

    expect(body).toHaveBeenCalledTimes(2);
  });

  it("đã đăng nhập: đếm theo NGƯỜI DÙNG — đổi mạng không lách được", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    const body = vi.fn().mockResolvedValue({});
    const action = definePublicAction("khách không có tài khoản", options, body);

    for (const ip of ["198.51.100.1", "198.51.100.2", "198.51.100.3"]) {
      headerStore.set("x-forwarded-for", ip);
      await action();
    }

    expect(body).toHaveBeenCalledTimes(2);
    expect(body.mock.calls[0]![0]).toMatchObject({ session, actorId: "u-1" });
  });
});
