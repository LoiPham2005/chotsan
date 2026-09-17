import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({ createRoleAction: vi.fn() }));

import { createRoleAction } from "./actions";
import { RoleCreateForm } from "./role-create-form";

/** Gửi form qua ĐÚNG đường thật của React: submit → action → React tự reset form. */
async function submit(form: HTMLFormElement) {
  await act(() => Promise.resolve(fireEvent.submit(form)));
}

beforeEach(() => vi.clearAllMocks());

/**
 * React 19 tự `form.reset()` sau MỌI lần action chạy xong, kể cả khi action báo
 * lỗi. Mã vai trò sai dạng hay đã có là lỗi hay gặp nhất — người tạo chỉ cần
 * sửa một chữ, không phải gõ lại tên và mô tả.
 */
describe("RoleCreateForm — giữ chữ vừa gõ sau khi báo lỗi", () => {
  it("mã đã tồn tại: ba ô còn nguyên, câu lỗi nằm dưới ô mã", async () => {
    vi.mocked(createRoleAction).mockResolvedValue({
      fieldErrors: { key: ['Vai trò "KE_TOAN" đã tồn tại'] },
      values: { key: "KE_TOAN", name: "Kế toán", description: "Đối soát hoá đơn" },
    });
    const { container } = render(<RoleCreateForm />);

    fireEvent.change(screen.getByLabelText("Mã vai trò"), { target: { value: "KE_TOAN" } });
    fireEvent.change(screen.getByLabelText("Tên hiển thị"), { target: { value: "Kế toán" } });
    fireEvent.change(screen.getByLabelText(/^Mô tả/), { target: { value: "Đối soát hoá đơn" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByText('Vai trò "KE_TOAN" đã tồn tại')).toBeInTheDocument();
    expect(screen.getByLabelText("Mã vai trò")).toHaveValue("KE_TOAN");
    expect(screen.getByLabelText("Tên hiển thị")).toHaveValue("Kế toán");
    expect(screen.getByLabelText(/^Mô tả/)).toHaveValue("Đối soát hoá đơn");
  });

  it("tạo xong: báo thành công và form trống để tạo vai trò tiếp theo", async () => {
    vi.mocked(createRoleAction).mockResolvedValue({ success: "Đã tạo vai trò KE_TOAN" });
    const { container } = render(<RoleCreateForm />);

    fireEvent.change(screen.getByLabelText("Mã vai trò"), { target: { value: "KE_TOAN" } });
    fireEvent.change(screen.getByLabelText("Tên hiển thị"), { target: { value: "Kế toán" } });
    await submit(container.querySelector("form")!);

    expect(await screen.findByRole("status")).toHaveTextContent("Đã tạo vai trò KE_TOAN");
    expect(screen.getByLabelText("Mã vai trò")).toHaveValue("");
    expect(screen.getByLabelText("Tên hiển thị")).toHaveValue("");
  });
});
