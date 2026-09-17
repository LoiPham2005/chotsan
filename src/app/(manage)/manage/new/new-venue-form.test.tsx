import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * React 19 tự `form.reset()` sau MỌI lần form action chạy xong — kể cả khi
 * action báo lỗi. Ô nhập không kiểm soát (`defaultValue`) quay về giá trị ban
 * đầu: người đăng ký gõ sai số điện thoại là mất trắng cả hồ sơ.
 *
 * Bài này chạy ĐÚNG đường thật của React (submit → action → reset) trên jsdom,
 * với action giả trả lỗi kèm `values`.
 */

vi.mock("./actions", () => ({ createVenueAction: vi.fn() }));

import { createVenueAction } from "./actions";
import { NewVenueForm } from "./new-venue-form";

const SPORTS = [
  { id: "s-badminton", name: "Cầu lông" },
  { id: "s-football", name: "Bóng đá" },
];

beforeEach(() => vi.clearAllMocks());

describe("NewVenueForm", () => {
  it("action báo lỗi thì mọi ô — kể cả ô chọn môn — giữ nguyên chữ vừa gõ", async () => {
    const typed = {
      name: "Sân cầu lông Mới",
      sportId: "s-football",
      address: "12 Láng Hạ",
      ward: "Phường Láng Hạ",
      province: "Hà Nội",
      phone: "0912",
      description: "Có bãi đỗ xe",
    };
    vi.mocked(createVenueAction).mockResolvedValue({
      error: "Số điện thoại gồm 10–11 chữ số, bắt đầu bằng 0",
      values: typed,
    });

    const { container } = render(<NewVenueForm sports={SPORTS} />);

    fireEvent.change(screen.getByLabelText("Tên cơ sở"), { target: { value: typed.name } });
    fireEvent.change(screen.getByLabelText("Môn chính"), { target: { value: typed.sportId } });
    fireEvent.change(screen.getByLabelText("Số nhà, tên đường"), {
      target: { value: typed.address },
    });
    fireEvent.change(screen.getByLabelText("Phường/xã"), { target: { value: typed.ward } });
    fireEvent.change(screen.getByLabelText("Tỉnh/thành phố"), {
      target: { value: typed.province },
    });
    fireEvent.change(screen.getByLabelText("Số điện thoại của sân"), {
      target: { value: typed.phone },
    });
    fireEvent.change(screen.getByLabelText(/Giới thiệu ngắn/), {
      target: { value: typed.description },
    });

    await act(() => Promise.resolve(fireEvent.submit(container.querySelector("form")!)));

    expect(await screen.findByRole("alert")).toHaveTextContent("Số điện thoại gồm 10–11 chữ số");
    expect(createVenueAction).toHaveBeenCalledTimes(1);

    expect(screen.getByLabelText("Tên cơ sở")).toHaveValue(typed.name);
    expect(screen.getByLabelText("Môn chính")).toHaveValue(typed.sportId);
    expect(screen.getByLabelText("Số nhà, tên đường")).toHaveValue(typed.address);
    expect(screen.getByLabelText("Phường/xã")).toHaveValue(typed.ward);
    expect(screen.getByLabelText("Tỉnh/thành phố")).toHaveValue(typed.province);
    expect(screen.getByLabelText("Số điện thoại của sân")).toHaveValue(typed.phone);
    expect(screen.getByLabelText(/Giới thiệu ngắn/)).toHaveValue(typed.description);
  });

  it("chưa chọn môn thì ô chọn đứng ở dòng nhắc, không tự chọn môn đầu tiên", () => {
    render(<NewVenueForm sports={SPORTS} />);

    expect(screen.getByLabelText("Môn chính")).toHaveValue("");
  });
});
