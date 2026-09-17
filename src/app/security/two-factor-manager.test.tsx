import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  beginTwoFactorSetupAction: vi.fn(),
  disableTwoFactorAction: vi.fn(),
  enableTwoFactorAction: vi.fn(),
  regenerateRecoveryCodesAction: vi.fn(),
}));

import { disableTwoFactorAction } from "./actions";
import { TwoFactorManager } from "./two-factor-manager";

beforeEach(() => vi.clearAllMocks());

/**
 * Ô mã và ô mật khẩu của 2FA là ô CÓ KIỂM SOÁT, không nằm trong `<form>` — nên
 * không bị React 19 xoá trắng sau action. Gõ sai một ký tự của mã thì sửa đúng
 * ký tự đó, không phải mở lại app xác thực chép cả mã.
 */
describe("TwoFactorManager — tắt 2FA báo lỗi", () => {
  it("mã và mật khẩu vừa gõ còn nguyên; chúng chỉ đi TỚI action, không quay về", async () => {
    vi.mocked(disableTwoFactorAction).mockResolvedValue({ error: "Mã xác thực không đúng" });
    render(
      <TwoFactorManager enabled available enabledAt="01/09/2026" recoveryCodesRemaining={8} />,
    );

    fireEvent.change(screen.getByLabelText("Mã xác thực (hoặc mã khôi phục)"), {
      target: { value: "123457" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu (chỉ cần khi TẮT 2FA)"), {
      target: { value: "mat-khau-dung" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tắt 2FA" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mã xác thực không đúng");
    expect(disableTwoFactorAction).toHaveBeenCalledWith("mat-khau-dung", "123457");
    expect(screen.getByLabelText("Mã xác thực (hoặc mã khôi phục)")).toHaveValue("123457");
    expect(screen.getByLabelText("Mật khẩu (chỉ cần khi TẮT 2FA)")).toHaveValue("mat-khau-dung");
  });
});
