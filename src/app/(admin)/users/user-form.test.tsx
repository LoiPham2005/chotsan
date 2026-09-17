import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({ createUserAction: vi.fn() }));

import { createUserAction } from "./actions";
import { UserForm } from "./user-form";

/** Gửi form qua ĐÚNG đường thật của React: submit → action → React tự reset form. */
async function submit(form: HTMLFormElement) {
  await act(() => Promise.resolve(fireEvent.submit(form)));
}

function fill() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "an@example.com" } });
  fireEvent.change(screen.getByLabelText(/^Họ và tên/), { target: { value: "Nguyễn Văn An" } });
  fireEvent.change(screen.getByLabelText(/^Tên đăng nhập/), { target: { value: "an" } });
}

beforeEach(() => vi.clearAllMocks());

/**
 * React 19 tự `form.reset()` sau MỌI lần action chạy xong, kể cả khi action báo
 * lỗi. Quản trị viên gõ trùng tên đăng nhập thì chỉ sửa đúng ô đó — không phải
 * gõ lại cả ba ô.
 */
describe("UserForm — giữ chữ vừa gõ sau khi báo lỗi", () => {
  it("lỗi ở một ô: cả ba ô còn nguyên chữ vừa gõ, câu lỗi nằm dưới đúng ô", async () => {
    vi.mocked(createUserAction).mockResolvedValue({
      fieldErrors: { username: ["Tên đăng nhập cần ít nhất 3 ký tự"] },
      values: { email: "an@example.com", fullName: "Nguyễn Văn An", username: "an" },
    });
    const { container } = render(<UserForm />);

    fill();
    await submit(container.querySelector("form")!);

    expect(await screen.findByText("Tên đăng nhập cần ít nhất 3 ký tự")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("an@example.com");
    expect(screen.getByLabelText(/^Họ và tên/)).toHaveValue("Nguyễn Văn An");
    expect(screen.getByLabelText(/^Tên đăng nhập/)).toHaveValue("an");
  });

  it("thêm xong (action không trả `values`): form trống để thêm người tiếp theo", async () => {
    vi.mocked(createUserAction).mockResolvedValue({});
    const { container } = render(<UserForm />);

    fill();
    await submit(container.querySelector("form")!);

    expect(createUserAction).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText(/^Tên đăng nhập/)).toHaveValue("");
  });
});
