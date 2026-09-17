import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  changePasswordAction: vi.fn(),
  requestEmailChangeAction: vi.fn(),
  resendVerificationEmailAction: vi.fn(),
}));

import { changePasswordAction, requestEmailChangeAction } from "./actions";
import { ChangeEmailForm, ChangePasswordForm } from "./account-forms";

/** Gửi form qua ĐÚNG đường thật của React: submit → action → React tự reset form. */
async function submit(form: HTMLFormElement) {
  await act(() => Promise.resolve(fireEvent.submit(form)));
}

beforeEach(() => vi.clearAllMocks());

/**
 * React 19 tự `form.reset()` sau MỌI lần action chạy xong, kể cả khi action báo
 * lỗi. Ô chữ thường được dựng lại bằng chữ vừa gõ; ô MẬT KHẨU thì trống lại —
 * mật khẩu không đi vòng từ máy chủ về trình duyệt.
 */
describe("form trên /security — giữ chữ vừa gõ sau khi báo lỗi", () => {
  it("đổi email, sai mật khẩu: email mới còn nguyên, ô mật khẩu trống", async () => {
    vi.mocked(requestEmailChangeAction).mockResolvedValue({
      fieldErrors: { password: ["Mật khẩu hiện tại không đúng"] },
      values: { newEmail: "moi@example.com" },
    });
    const { container } = render(<ChangeEmailForm />);

    fireEvent.change(screen.getByLabelText("Email mới"), { target: { value: "moi@example.com" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "sai" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByText("Mật khẩu hiện tại không đúng")).toBeInTheDocument();
    expect(screen.getByLabelText("Email mới")).toHaveValue("moi@example.com");
    expect(screen.getByLabelText("Mật khẩu hiện tại")).toHaveValue("");
  });

  it("đổi mật khẩu báo lỗi: cả hai ô mật khẩu trống lại, không ô nào nhận giá trị từ máy chủ", async () => {
    vi.mocked(changePasswordAction).mockResolvedValue({
      fieldErrors: { currentPassword: ["Mật khẩu hiện tại không đúng"] },
    });
    const { container } = render(<ChangePasswordForm />);

    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "cu-sai" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "moi-dai-hon-8" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByText("Mật khẩu hiện tại không đúng")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu hiện tại")).toHaveValue("");
    expect(screen.getByLabelText("Mật khẩu mới")).toHaveValue("");
  });
});
