import { useState } from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ActionNoticeProvider, useActionNotice } from "./action-notice";

/**
 * Lỗi thật trước đây: khách huỷ lượt đặt / chủ sân duyệt tiền, danh sách dựng
 * lại, dòng vừa bấm đổi nhóm hoặc rời danh sách — và câu kết quả nằm trong dòng
 * đó biến mất trước khi ai kịp đọc.
 */

/** Một "dòng" báo kết quả rồi TỰ RỜI danh sách — đúng như sau `revalidatePath`. */
function Row() {
  const notify = useActionNotice();
  const [gone, setGone] = useState(false);

  if (gone) return null;

  return (
    <button
      type="button"
      onClick={() => {
        notify("Đã huỷ lượt 8F3K2M. Sân sẽ hoàn 360.000đ cho bạn.");
        setGone(true);
      }}
    >
      Huỷ
    </button>
  );
}

describe("ActionNoticeProvider", () => {
  it("câu kết quả CÒN NGUYÊN sau khi dòng phát ra nó đã bị gỡ", () => {
    render(
      <ActionNoticeProvider>
        <Row />
      </ActionNoticeProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    });

    expect(screen.queryByRole("button", { name: "Huỷ" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sân sẽ hoàn 360.000đ cho bạn.");
  });

  it("vùng đọc to có mặt TỪ TRƯỚC khi có câu nào — trình đọc màn hình mới báo được", () => {
    render(
      <ActionNoticeProvider>
        <Row />
      </ActionNoticeProvider>,
    );

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("không tự tắt; 'Đóng' mới gỡ câu", () => {
    render(
      <ActionNoticeProvider>
        <Row />
      </ActionNoticeProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("dùng ngoài provider thì không đổ trang", () => {
    render(<Row />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Huỷ" }))).not.toThrow();
  });
});
