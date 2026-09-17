import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import type * as MemberServiceModule from "@/services/member.service";

/**
 * Action nhân sự chỉ hỏi "có `member:manage` trên sân này không" — vé vào cửa.
 * Luật chống leo quyền (không tự sửa mình, không cấp quyền mình không có…) nằm
 * ở `memberService` và CẦN BIẾT AI đang thao tác. Lỗi thật trước đây: action
 * không truyền người thao tác, nên service không thể chặn gì.
 *
 * Service được giả lập — luật của nó đã có `member.service.test.ts`. Ở đây
 * kiểm action chuyển đúng người thao tác, trả lỗi nghiệp vụ thành thông báo, và
 * chỉ ghi nhật ký khi thao tác thành công.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock("@/services/audit.service", () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("@/services/permission.service", () => ({
  permissionService: { canOnVenue: vi.fn() },
}));
vi.mock("@/services/member.service", async (importOriginal) => {
  // Giữ lớp lỗi thật để `instanceof DomainError` trong action vẫn đúng.
  const actual = await importOriginal<typeof MemberServiceModule>();
  return {
    ...actual,
    memberService: { invite: vi.fn(), setPermissions: vi.fn(), remove: vi.fn() },
  };
});

import { getSession } from "@/lib/auth";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import {
  MemberNotRegisteredError,
  MemberSelfManageError,
  memberService,
} from "@/services/member.service";
import { permissionService } from "@/services/permission.service";
import { inviteStaffAction, removeStaffAction, setStaffPermissionsAction } from "./actions";

const managerSession: SessionPayload = {
  typ: "access",
  sub: "ql",
  email: "ql@example.com",
  roles: ["USER"],
};

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of [value].flat()) data.append(key, item);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(managerSession);
  vi.mocked(permissionService.canOnVenue).mockResolvedValue(true);
});

describe("setStaffPermissionsAction", () => {
  it("truyền người thao tác cho service — luật chống leo quyền cần biết AI đang sửa", async () => {
    vi.mocked(memberService.setPermissions).mockResolvedValue({
      permissions: ["payment:confirm"],
    } as never);

    const result = await setStaffPermissionsAction(
      "v1",
      {},
      form({ memberId: "m-nv", permissions: ["payment:confirm"] }),
    );

    expect(result).toEqual({ ok: "Đã lưu quyền" });
    expect(memberService.setPermissions).toHaveBeenCalledWith({
      memberId: "m-nv",
      venueId: "v1",
      permissions: ["payment:confirm"],
      actorId: "ql",
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.VENUE_MEMBER_PERMISSIONS_UPDATED,
        entityId: "m-nv",
        actorId: "ql",
        metadata: { venueId: "v1", permissions: ["payment:confirm"] },
      }),
    );
  });

  it("service từ chối → trả thông báo của service, KHÔNG ghi nhật ký", async () => {
    vi.mocked(memberService.setPermissions).mockRejectedValue(new MemberSelfManageError());

    const result = await setStaffPermissionsAction("v1", {}, form({ memberId: "m-ql" }));

    expect(result.error).toBe(new MemberSelfManageError().message);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it("không có `member:manage` trên sân → không chạm service", async () => {
    vi.mocked(permissionService.canOnVenue).mockResolvedValue(false);

    const result = await setStaffPermissionsAction("v1", {}, form({ memberId: "m-nv" }));

    expect(result.error).toBeDefined();
    expect(memberService.setPermissions).not.toHaveBeenCalled();
  });
});

describe("removeStaffAction", () => {
  it("truyền người thao tác và ghi nhật ký kèm sân", async () => {
    vi.mocked(memberService.remove).mockResolvedValue(undefined);

    const result = await removeStaffAction("v1", {}, form({ memberId: "m-nv" }));

    expect(result).toEqual({ ok: "Đã gỡ khỏi sân" });
    expect(memberService.remove).toHaveBeenCalledWith({
      memberId: "m-nv",
      venueId: "v1",
      actorId: "ql",
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.VENUE_MEMBER_REMOVED,
        entityId: "m-nv",
        metadata: { venueId: "v1" },
      }),
    );
  });

  it("service từ chối (tự gỡ mình) → báo lỗi, không ghi nhật ký", async () => {
    vi.mocked(memberService.remove).mockRejectedValue(new MemberSelfManageError());

    const result = await removeStaffAction("v1", {}, form({ memberId: "m-ql" }));

    expect(result.error).toBe(new MemberSelfManageError().message);
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

describe("inviteStaffAction", () => {
  it("ghi nhật ký lời mời với id thành viên mới", async () => {
    vi.mocked(memberService.invite).mockResolvedValue({ id: "m-moi" } as never);

    const result = await inviteStaffAction("v1", {}, form({ email: "Moi@Example.com" }));

    expect(result.ok).toContain("moi@example.com");
    expect(memberService.invite).toHaveBeenCalledWith({
      venueId: "v1",
      email: "moi@example.com",
      invitedBy: "ql",
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.VENUE_MEMBER_INVITED,
        entityId: "m-moi",
        metadata: { venueId: "v1", email: "moi@example.com" },
      }),
    );
    // Mời xong không trả chữ vừa gõ — ô trống để mời người tiếp theo.
    expect(result.values).toBeUndefined();
  });

  it("email chưa có tài khoản: trả lại chữ vừa gõ để sửa, không ghi nhật ký", async () => {
    vi.mocked(memberService.invite).mockRejectedValue(new MemberNotRegisteredError());

    const result = await inviteStaffAction("v1", {}, form({ email: "nhan.vien@example.com" }));

    expect(result.error).toBe(new MemberNotRegisteredError().message);
    expect(result.values).toEqual({ email: "nhan.vien@example.com" });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it("email sai dạng: câu lỗi chỉ cách sửa, không gọi service", async () => {
    const result = await inviteStaffAction("v1", {}, form({ email: "nhanvien@" }));

    expect(result.error).toBe("Email chưa đúng dạng — ví dụ: ten@gmail.com");
    expect(result.values).toEqual({ email: "nhanvien@" });
    expect(memberService.invite).not.toHaveBeenCalled();
  });

  it("thiếu nhân viên ở thao tác theo dòng: câu lỗi nói phải làm gì", async () => {
    const result = await removeStaffAction("v1", {}, form({}));

    expect(result.error).toContain("tải lại trang");
    expect(memberService.remove).not.toHaveBeenCalled();
  });
});
