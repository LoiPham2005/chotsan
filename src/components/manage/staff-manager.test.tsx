import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

/**
 * Trang nhân sự tính sẵn ai sửa được ai (`canManageMember`) và người xem cấp
 * được quyền nào (`managementScope.grantable`). Component chỉ việc KHÔNG hiện
 * thứ bấm vào là bị từ chối — và không được làm rơi quyền chủ sân đã cấp khi
 * nhân viên quản lý lưu một ô khác.
 */

vi.mock("@/app/(manage)/manage/[venueId]/staff/actions", () => ({
  inviteStaffAction: vi.fn(),
  removeStaffAction: vi.fn(),
  setStaffPermissionsAction: vi.fn(),
}));

import { inviteStaffAction } from "@/app/(manage)/manage/[venueId]/staff/actions";
import { StaffManager, type StaffMember } from "./staff-manager";

const PERMISSION_KEYS = ["payment:confirm", "payment:refund", "member:manage"];

function member(overrides: Partial<StaffMember> & Pick<StaffMember, "id" | "name">): StaffMember {
  return {
    role: "STAFF",
    email: null,
    permissions: [],
    isSelf: false,
    editable: true,
    ...overrides,
  };
}

function renderAsManager(members: StaffMember[]) {
  // Người xem là nhân viên quản lý chỉ đang có `payment:confirm`.
  return render(
    <StaffManager
      venueId="v1"
      members={members}
      permissionKeys={PERMISSION_KEYS}
      grantable={["payment:confirm"]}
    />,
  );
}

function row(name: string) {
  return within(screen.getByText(name).closest("li")!);
}

beforeEach(() => vi.clearAllMocks());

describe("StaffManager", () => {
  it("dòng của chính mình: không có nút Quyền/Gỡ, nói rõ vì sao", () => {
    renderAsManager([member({ id: "m-ql", name: "Quản lý", isSelf: true, editable: false })]);

    expect(row("Quản lý").queryByRole("button")).toBeNull();
    expect(row("Quản lý").getByText(/không tự sửa quyền của mình/)).toBeInTheDocument();
  });

  it("người đang quản lý nhân sự mà mình không phải chủ: không có nút", () => {
    renderAsManager([
      member({
        id: "m-ql2",
        name: "Quản lý khác",
        permissions: ["member:manage"],
        editable: false,
      }),
    ]);

    expect(row("Quản lý khác").queryByRole("button", { name: "Gỡ" })).toBeNull();
    expect(row("Quản lý khác").getByText(/chỉ chủ sân mới sửa quyền/)).toBeInTheDocument();
  });

  it("ô chưa tick mà không cấp được thì khoá; ô chủ sân đã tick vẫn gửi đi khi lưu", () => {
    renderAsManager([member({ id: "m-nv", name: "Bình", permissions: ["payment:refund"] })]);

    fireEvent.click(row("Bình").getByRole("button", { name: /Quyền/ }));

    const confirm = screen.getByRole("checkbox", { name: /Xác nhận đã nhận tiền/ });
    const refund = screen.getByRole("checkbox", { name: /Hoàn tiền/ });
    const manage = screen.getByRole("checkbox", { name: /Quản lý nhân sự/ });

    // Cấp được → mở.
    expect(confirm).toBeEnabled();
    // Chủ sân đã cấp, mình không có → vẫn mở (và vẫn tick) để lưu không làm rơi nó.
    expect(refund).toBeEnabled();
    expect(refund).toBeChecked();
    // Không cấp được, chưa tick → khoá.
    expect(manage).toBeDisabled();
    expect(screen.getByText("Chỉ chủ sân cấp được")).toBeInTheDocument();

    const submitted = new FormData(refund.closest("form")!).getAll("permissions");
    expect(submitted).toEqual(["payment:refund"]);
  });

  /**
   * React 19 tự `form.reset()` sau khi action chạy xong, kể cả khi báo lỗi. Ô
   * email mời phải dựng lại bằng chữ vừa gõ — "email này chưa có tài khoản" là
   * lỗi hay gặp nhất, và thường chỉ cần sửa một chữ.
   */
  it("mời báo lỗi thì ô email còn nguyên chữ vừa gõ", async () => {
    vi.mocked(inviteStaffAction).mockResolvedValue({
      error: "Email này chưa có tài khoản ChốtSân. Bảo họ đăng ký trước rồi mời lại.",
      values: { email: "nhan.vien@gmial.com" },
    });
    renderAsManager([]);

    const email = screen.getByLabelText("Email của nhân viên");
    fireEvent.change(email, { target: { value: "nhan.vien@gmial.com" } });
    await act(() => Promise.resolve(fireEvent.submit(email.closest("form")!)));

    expect(await screen.findByRole("alert")).toHaveTextContent("chưa có tài khoản");
    expect(screen.getByLabelText("Email của nhân viên")).toHaveValue("nhan.vien@gmial.com");
  });
});
