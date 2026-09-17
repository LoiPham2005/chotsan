import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  loginAction: vi.fn(),
  registerAction: vi.fn(),
  forgotPasswordAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  verifyTwoFactorAction: vi.fn(),
}));

import {
  forgotPasswordAction,
  loginAction,
  registerAction,
  verifyTwoFactorAction,
} from "./actions";
import { AUTH_FORM_CLASS, AuthFields, type Field } from "./auth-form";
import { ForgotPasswordForm } from "./forgot-password/forgot-password-form";
import { LoginForm } from "./login/login-form";
import { TwoFactorForm } from "./login/two-factor-form";
import { RegisterForm } from "./register/register-form";

const fields: Field[] = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "password", label: "Mật khẩu", type: "password", required: true },
];

function renderFields(props: Partial<Parameters<typeof AuthFields>[0]> = {}) {
  return render(
    <form className={AUTH_FORM_CLASS}>
      <AuthFields
        fields={fields}
        state={{}}
        isPending={false}
        submitLabel="Đăng nhập"
        pendingLabel="Đang xử lý…"
        {...props}
      />
    </form>,
  );
}

/** Gửi form qua ĐÚNG đường thật của React: submit → action → React tự reset form. */
async function submit(form: HTMLFormElement) {
  await act(() => Promise.resolve(fireEvent.submit(form)));
}

beforeEach(() => vi.clearAllMocks());

describe("AuthFields", () => {
  it("gắn label đúng với input", () => {
    renderFields();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeEnabled();
  });

  it("hiện lỗi từng field và nối vào input bằng aria-describedby", () => {
    renderFields({ state: { fieldErrors: { email: ["Email không hợp lệ"] } } });

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Email không hợp lệ");
  });

  it("hiện lỗi chung với role=alert để screen reader đọc ngay", () => {
    renderFields({ state: { error: "Email hoặc mật khẩu không chính xác" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Email hoặc mật khẩu không chính xác");
  });

  it("khoá nút và đổi nhãn khi đang gửi", () => {
    renderFields({ isPending: true });

    expect(screen.getByRole("button", { name: "Đang xử lý…" })).toBeDisabled();
  });

  it("gắn đường dẫn chuyển hướng vào field ẩn", () => {
    const { container } = renderFields({ nextPath: "/users" });

    expect(container.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe("/users");
  });

  it("không render field ẩn khi không có nextPath", () => {
    const { container } = renderFields();

    expect(container.querySelector('input[name="next"]')).toBeNull();
  });

  it("ô mật khẩu KHÔNG BAO GIỜ nhận giá trị từ state, kể cả khi state lỡ mang theo", () => {
    renderFields({
      state: { values: { email: "an@example.com" } },
    });

    expect(screen.getByLabelText("Email")).toHaveValue("an@example.com");
    expect(screen.getByLabelText("Mật khẩu")).toHaveValue("");
  });
});

/**
 * React 19 tự `form.reset()` sau MỌI lần action chạy xong, kể cả khi action báo
 * lỗi. Các bài dưới chạy đường thật (submit → action giả trả lỗi → React reset)
 * và kiểm chữ vừa gõ còn nguyên — trừ mật khẩu, thứ không được đi vòng qua máy chủ.
 */
describe("form xác thực giữ chữ vừa gõ sau khi báo lỗi", () => {
  it("đăng nhập: sai mật khẩu thì email còn, ô mật khẩu trống", async () => {
    vi.mocked(loginAction).mockResolvedValue({
      error: "Email hoặc mật khẩu không chính xác",
      values: { identifier: "an@example.com" },
    });
    const { container } = render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email hoặc tên đăng nhập"), {
      target: { value: "an@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "sai-mat-khau" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("không chính xác");
    expect(screen.getByLabelText("Email hoặc tên đăng nhập")).toHaveValue("an@example.com");
    expect(screen.getByLabelText("Mật khẩu")).toHaveValue("");
  });

  it("đăng ký: email trùng thì tên và email còn nguyên", async () => {
    vi.mocked(registerAction).mockResolvedValue({
      error: "Email này đã được đăng ký",
      values: { email: "an@example.com", fullName: "Nguyễn Văn An" },
    });
    const { container } = render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText("Tên hiển thị"), { target: { value: "Nguyễn Văn An" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "an@example.com" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "mat-khau-dai-1" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("đã được đăng ký");
    expect(screen.getByLabelText("Tên hiển thị")).toHaveValue("Nguyễn Văn An");
    expect(screen.getByLabelText("Email")).toHaveValue("an@example.com");
    expect(screen.getByLabelText("Mật khẩu")).toHaveValue("");
  });

  it("quên mật khẩu: email sai dạng thì chữ vừa gõ còn để sửa", async () => {
    vi.mocked(forgotPasswordAction).mockResolvedValue({
      fieldErrors: { email: ["Email không hợp lệ"] },
      values: { email: "an@example" },
    });
    const { container } = render(<ForgotPasswordForm />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "an@example" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByText("Email không hợp lệ")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("an@example");
  });

  it("mã 2FA: gõ sai thì mã còn trong ô (không đi qua máy chủ) để sửa một ký tự", async () => {
    vi.mocked(verifyTwoFactorAction).mockResolvedValue({
      error: "Mã xác thực không đúng",
      twoFactorToken: "ve-2fa",
    });
    const { container } = render(<TwoFactorForm challengeToken="ve-2fa" />);

    fireEvent.change(screen.getByLabelText("Mã xác thực"), { target: { value: "ABCDE-12345" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("không đúng");
    expect(screen.getByLabelText("Mã xác thực")).toHaveValue("ABCDE-12345");
    // Mã gửi đi đúng như đã gõ, nhưng KHÔNG nằm trong phản hồi của action.
    expect(vi.mocked(verifyTwoFactorAction).mock.calls[0]![1].get("code")).toBe("ABCDE-12345");
  });
});
