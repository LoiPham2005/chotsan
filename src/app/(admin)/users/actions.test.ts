import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type * as UserServiceModule from "@/services/user.service";
import { SelfActionForbiddenError, DuplicateFieldError } from "@/lib/errors";

/**
 * Đây là bài test quan trọng nhất trong repo.
 *
 * Server Action là HTTP endpoint công khai: proxy chặn được người chưa đăng
 * nhập ở đường vào trang, nhưng KHÔNG chặn được một người đã đăng nhập với
 * quyền USER gửi thẳng request tới action dành cho ADMIN. Những test dưới đây
 * khoá chặt hành vi đó.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

/**
 * `defineAction` hỏi `permissionService.can()` chứ không so `role === "ADMIN"`
 * nữa. Mock ở đây để test không cần một Postgres đang chạy — thứ đang kiểm là
 * "action phản ứng thế nào với quyền", không phải "quyền được đọc lên ra sao"
 * (đã có `permission.service.test.ts` lo).
 */
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn() },
}));

vi.mock("@/services/user.service", async (importOriginal) => {
  // Giữ nguyên các lớp lỗi thật để `instanceof` trong action vẫn đúng.
  const actual = await importOriginal<typeof UserServiceModule>();
  return {
    ...actual,
    userService: { create: vi.fn(), softDelete: vi.fn(), setStatus: vi.fn() },
  };
});

import { getSession } from "@/lib/auth";
import { auditService } from "@/services/audit.service";
import { permissionService } from "@/services/permission.service";
import { userService } from "@/services/user.service";
import { createUserAction, deleteUserAction, setUserStatusAction } from "./actions";

const adminSession: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};
const userSession: SessionPayload = {
  typ: "access",
  sub: "user-1",
  email: "user@example.com",
  roles: ["USER"],
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Mặc định: tài khoản admin có mọi quyền, tài khoản thường thì không.
  // `can` nhận userId chứ không nhận vai trò — một người mang được nhiều vai
  // trò cùng lúc, và hợp quyền của chúng nằm dưới database.
  vi.mocked(permissionService.can).mockImplementation((userId) =>
    Promise.resolve(userId === adminSession.sub),
  );
});

describe("createUserAction", () => {
  it("từ chối khi chưa đăng nhập và không chạm tới service", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await createUserAction({}, form({ email: "new@example.com" }));

    expect(result.error).toContain("đăng nhập");
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("từ chối user thường dù đã đăng nhập", async () => {
    vi.mocked(getSession).mockResolvedValue(userSession);

    const result = await createUserAction({}, form({ email: "new@example.com" }));

    expect(result.error).toContain("không có quyền");
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("bỏ qua field role gửi kèm — không cho tự phong ADMIN", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.create).mockResolvedValue({
      id: "u-2",
      email: "new@example.com",
      username: "u",
      fullName: null,
      emailVerifiedAt: null,
      status: "ACTIVE",
      lockedUntil: null,
      roles: ["USER"],
      phone: null,
      avatarUrl: null,
      twoFactorEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await createUserAction({}, form({ email: "new@example.com", roleKeys: "ADMIN" }));

    expect(vi.mocked(userService.create).mock.calls[0]?.[0].roleKeys).toBeUndefined();
  });

  it("trả lỗi theo field khi email sai định dạng", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);

    const result = await createUserAction({}, form({ email: "khong-phai-email" }));

    expect(result.fieldErrors?.email).toBeDefined();
    expect(userService.create).not.toHaveBeenCalled();
  });

  /**
   * Bài test này canh một lỗi đã xảy ra thật và KHÔNG lỗi nào bắt được nó:
   * form gửi `name` trong khi schema đã đổi sang `fullName`. Zod strip im lặng
   * khoá lạ nên parse vẫn thành công, typecheck vẫn xanh (`safeParse` nhận
   * `unknown`), chỉ có dữ liệu người dùng vừa nhập là biến mất.
   *
   * Vì vậy phải khẳng định trên ĐỐI SỐ THẬT truyền xuống service, chứ không
   * chỉ khẳng định action chạy xong không lỗi.
   */
  it("chuyển tiếp fullName và username xuống service", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.create).mockResolvedValue({
      id: "u-3",
      email: "new@example.com",
      username: "nguyenvana",
      fullName: "Nguyễn Văn A",
      emailVerifiedAt: null,
      status: "ACTIVE",
      lockedUntil: null,
      roles: ["USER"],
      phone: null,
      avatarUrl: null,
      twoFactorEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await createUserAction(
      {},
      form({
        email: "new@example.com",
        fullName: "Nguyễn Văn A",
        username: "nguyenvana",
      }),
    );

    expect(vi.mocked(userService.create).mock.calls[0]?.[0]).toMatchObject({
      email: "new@example.com",
      fullName: "Nguyễn Văn A",
      username: "nguyenvana",
    });
    // Người thao tác đi xuống service — chốt `Role.level` cần biết AI đang tạo.
    expect(vi.mocked(userService.create).mock.calls[0]?.[1]).toEqual({ actorId: "admin-1" });
  });

  it("đưa lỗi trùng tên đăng nhập về đúng ô username", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.create).mockRejectedValue(new DuplicateFieldError("username", "trung"));

    const result = await createUserAction(
      {},
      form({ email: "new@example.com", username: "trung" }),
    );

    // Lỗi phải rơi vào ĐÚNG ô `username`, không phải một câu chung chung ở đầu
    // form: `DuplicateFieldError` mang sẵn tên trường trong `fields`.
    expect(result.fieldErrors?.username?.[0]).toContain("Tên đăng nhập");
    expect(result.fieldErrors?.email).toBeUndefined();
    // Chữ vừa gõ đi kèm lỗi — form dựng lại đúng như lúc bấm.
    expect(result.values).toEqual({ email: "new@example.com", fullName: "", username: "trung" });
  });

  it("tên đăng nhập quá ngắn: câu lỗi tiếng Việt của schema, chữ vừa gõ được trả lại", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);

    const result = await createUserAction(
      {},
      form({ email: "new@example.com", fullName: "An", username: "ab" }),
    );

    expect(result.fieldErrors?.username).toEqual(["Tên đăng nhập tối thiểu 3 ký tự"]);
    expect(result.values).toEqual({ email: "new@example.com", fullName: "An", username: "ab" });
    expect(userService.create).not.toHaveBeenCalled();
  });

  it("họ tên quá dài: câu lỗi nói đúng ô, không phải câu tiếng Anh mặc định của Zod", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);

    const result = await createUserAction(
      {},
      form({ email: "new@example.com", fullName: "A".repeat(101) }),
    );

    expect(result.fieldErrors?.fullName).toEqual(["Họ và tên dài quá — tối đa 100 ký tự"]);
  });
});

describe("deleteUserAction", () => {
  it("từ chối khi chưa đăng nhập", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const result = await deleteUserAction("victim-id");

    expect(result.error).toContain("đăng nhập");
    expect(userService.softDelete).not.toHaveBeenCalled();
  });

  it("từ chối user thường — đây là lỗ hổng của bản cũ", async () => {
    vi.mocked(getSession).mockResolvedValue(userSession);

    const result = await deleteUserAction("victim-id");

    expect(result.error).toContain("không có quyền");
    expect(userService.softDelete).not.toHaveBeenCalled();
  });

  it("truyền actorId xuống service để service tự áp luật tự-xoá", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.softDelete).mockRejectedValue(new SelfActionForbiddenError("xoá"));

    const result = await deleteUserAction(adminSession.sub);

    // Action không tự kiểm luật nữa — nó chỉ chuyển tiếp danh tính người thao
    // tác và hiển thị lỗi service trả về.
    expect(userService.softDelete).toHaveBeenCalledWith(adminSession.sub, {
      actorId: adminSession.sub,
    });
    expect(result.error).toContain("tự xoá");
  });

  it("cho phép admin xoá người khác", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.softDelete).mockResolvedValue();

    const result = await deleteUserAction("victim-id");

    expect(result.error).toBeUndefined();
    expect(userService.softDelete).toHaveBeenCalledWith("victim-id", {
      actorId: adminSession.sub,
    });
  });
});

describe("setUserStatusAction — nút Khoá / Mở khoá", () => {
  const PUBLIC_USER = {
    id: "victim-id",
    email: "v@example.com",
    username: null,
    fullName: null,
    emailVerifiedAt: null,
    status: "BANNED" as const,
    lockedUntil: null,
    roles: ["USER"],
    phone: null,
    avatarUrl: null,
    twoFactorEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("nhận ĐÚNG hình dạng nút gửi lên — `{ status }` — và chuyển chuỗi trạng thái xuống service", async () => {
    /*
     * Lỗi thật trước đây: action parse bằng `userStatusSchema` (enum, chỉ nhận
     * chuỗi) trong khi nút gửi `{ status: "BANNED" }`. Parse luôn trượt, mọi
     * lần bấm đều báo "Trạng thái không hợp lệ" — không ai khoá được ai từ web.
     */
    vi.mocked(getSession).mockResolvedValue(adminSession);
    vi.mocked(userService.setStatus).mockResolvedValue({
      user: PUBLIC_USER,
      previousStatus: "ACTIVE",
    });

    const result = await setUserStatusAction("victim-id", { status: "BANNED" });

    expect(result.error).toBeUndefined();
    expect(userService.setStatus).toHaveBeenCalledWith("victim-id", "BANNED", {
      actorId: "admin-1",
    });
    // Nhật ký ghi `{ from, to }` bằng hằng, không phải "user.banned"/"user.unbanned".
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.status_changed",
        metadata: expect.objectContaining({ from: "ACTIVE", to: "BANNED" }),
      }),
    );
  });

  it("trạng thái lạ → báo lỗi, KHÔNG chạm service", async () => {
    vi.mocked(getSession).mockResolvedValue(adminSession);

    const result = await setUserStatusAction("victim-id", { status: "SUPER" } as never);

    // Câu lỗi nói giá trị nào được nhận và phải làm gì — không phải "không hợp lệ".
    expect(result.error).toBe(
      "Không đổi được trạng thái: chỉ nhận Hoạt động, Tạm ngưng, Khoá. Tải lại trang rồi bấm lại giúp bạn nhé.",
    );
    expect(userService.setStatus).not.toHaveBeenCalled();
  });

  it("user thường gọi thẳng action → bị chặn trước khi parse", async () => {
    vi.mocked(getSession).mockResolvedValue(userSession);

    const result = await setUserStatusAction("victim-id", { status: "BANNED" });

    expect(result.error).toContain("không có quyền");
    expect(userService.setStatus).not.toHaveBeenCalled();
  });
});
