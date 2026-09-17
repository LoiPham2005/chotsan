import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmButton } from "./confirm-button";

/**
 * Nút cho thao tác không lấy lại được (huỷ lượt đặt). Hai thứ phải đúng: bấm
 * một lần KHÔNG gửi gì, và người dùng bàn phím đi hết được hai bước mà không
 * bị bỏ lại giữa trang.
 */

function renderInForm(onSubmit = vi.fn()) {
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <ConfirmButton
        label="Huỷ lượt đặt"
        prompt="Huỷ lượt 18:00–19:00? Chỗ được nhả cho người khác ngay."
        confirmLabel="Xác nhận huỷ"
        pendingLabel="Đang huỷ…"
      >
        <label htmlFor="reason">Lý do</label>
        <input id="reason" name="reason" />
      </ConfirmButton>
    </form>,
  );
  return onSubmit;
}

describe("ConfirmButton", () => {
  it("bấm lần đầu CHỈ mở bước xác nhận, không gửi form", () => {
    const onSubmit = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: "Huỷ lượt đặt" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /Chỗ được nhả cho người khác/ })).toBeInTheDocument();
    // Ô nhập thêm (lý do) chỉ hiện ở bước xác nhận.
    expect(screen.getByLabelText("Lý do")).toBeInTheDocument();
  });

  it("nút xác nhận mới gửi form", () => {
    const onSubmit = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: "Huỷ lượt đặt" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận huỷ" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("mở bước xác nhận thì tiêu điểm nhảy vào nút xác nhận — Enter lần nữa là gửi", () => {
    renderInForm();

    fireEvent.click(screen.getByRole("button", { name: "Huỷ lượt đặt" }));

    expect(screen.getByRole("button", { name: "Xác nhận huỷ" })).toHaveFocus();
  });

  it("Esc đóng bước xác nhận và trả tiêu điểm về nút ban đầu", () => {
    const onSubmit = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: "Huỷ lượt đặt" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Xác nhận huỷ" }), { key: "Escape" });

    expect(screen.queryByRole("button", { name: "Xác nhận huỷ" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Huỷ lượt đặt" })).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("'Thôi' cũng đóng lại mà không gửi gì", () => {
    const onSubmit = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: "Huỷ lượt đặt" }));
    fireEvent.click(screen.getByRole("button", { name: "Thôi" }));

    expect(screen.getByRole("button", { name: "Huỷ lượt đặt" })).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("lần dựng đầu KHÔNG giật tiêu điểm của trang", () => {
    render(
      <form>
        <input aria-label="Ô khác" autoFocus />
        <ConfirmButton label="Huỷ" prompt="Huỷ?" confirmLabel="Xác nhận" pendingLabel="…" />
      </form>,
    );

    expect(screen.getByLabelText("Ô khác")).toHaveFocus();
  });
});
