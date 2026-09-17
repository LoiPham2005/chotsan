import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Sân con: nhân viên chỉ có quyền XEM không được thấy nút sửa (trước đây thấy
 * đủ, bấm xong mới nhận "không có quyền"), và thêm sân báo lỗi thì không mất
 * chữ vừa gõ (React 19 tự xoá trắng form sau action).
 */

vi.mock("@/app/(manage)/manage/[venueId]/courts/actions", () => ({
  createCourtAction: vi.fn(),
  toggleCourtAction: vi.fn(),
  savePriceRulesAction: vi.fn(),
}));

import {
  createCourtAction,
  savePriceRulesAction,
} from "@/app/(manage)/manage/[venueId]/courts/actions";
import { CourtManager } from "./court-manager";
import { nextPriority, PriceRuleEditor } from "./price-rule-editor";

const COURTS = [
  { id: "c1", name: "Sân 1", surface: "WOOD", isIndoor: true, isActive: true },
  { id: "c2", name: "Sân 2", surface: null, isIndoor: false, isActive: false },
];

const RULE = {
  courtId: null,
  weekdays: [],
  startMinute: 360,
  endMinute: 1320,
  pricePerSlot: 70_000,
  isPeak: false,
  priority: 0,
};

beforeEach(() => vi.clearAllMocks());

describe("CourtManager", () => {
  it("không có quyền sửa sân: thấy danh sách + trạng thái, KHÔNG có nút thêm/tắt", () => {
    render(<CourtManager venueId="v1" courts={COURTS} canEdit={false} />);

    expect(screen.getByText("Đang mở bán")).toBeInTheDocument();
    expect(screen.getByText("Đã tắt")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Bạn đang xem/)).toBeInTheDocument();
  });

  it("có quyền sửa thì có nút thêm sân và nút bật/tắt từng sân", () => {
    render(<CourtManager venueId="v1" courts={COURTS} canEdit />);

    expect(screen.getByRole("button", { name: "+ Thêm sân" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tắt sân" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mở lại" })).toBeInTheDocument();
  });

  it("thêm sân báo lỗi: tên, mặt sân, trong nhà vẫn còn như vừa nhập", async () => {
    vi.mocked(createCourtAction).mockResolvedValue({
      error: "Tên sân tối đa 50 ký tự",
      values: { name: "Sân VIP", surface: "EPOXY", isIndoor: "true" },
    });
    const { container } = render(<CourtManager venueId="v1" courts={[]} canEdit />);

    fireEvent.change(screen.getByLabelText("Tên sân"), { target: { value: "Sân VIP" } });
    fireEvent.change(screen.getByLabelText("Mặt sân"), { target: { value: "EPOXY" } });
    fireEvent.click(screen.getByLabelText("Trong nhà"));

    await act(() => Promise.resolve(fireEvent.submit(container.querySelector("form")!)));

    expect(await screen.findByRole("alert")).toHaveTextContent("tối đa 50 ký tự");
    expect(screen.getByLabelText("Tên sân")).toHaveValue("Sân VIP");
    expect(screen.getByLabelText("Mặt sân")).toHaveValue("EPOXY");
    expect(screen.getByLabelText("Trong nhà")).toBeChecked();
  });
});

describe("PriceRuleEditor", () => {
  it("luật vừa thêm có ưu tiên CAO HƠN mọi luật đang có — thêm hai luật liền không tự chồng nhau", () => {
    expect(nextPriority([])).toBe(0);
    expect(nextPriority([RULE])).toBe(10);
    expect(nextPriority([RULE, { ...RULE, priority: 10 }])).toBe(20);
    expect(nextPriority([{ ...RULE, priority: -5 }])).toBe(5);
  });

  it("bấm '+ Thêm luật' hai lần ra hai ưu tiên khác nhau", () => {
    render(<PriceRuleEditor venueId="v1" courts={COURTS} initial={[]} canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "+ Thêm luật" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Thêm luật" }));

    const priorities = screen
      .getAllByRole("spinbutton")
      .filter((input) => input.closest("label")?.textContent?.includes("Ưu tiên"))
      .map((input) => (input as HTMLInputElement).value);
    expect(priorities).toEqual(["0", "10"]);
  });

  it("không có quyền sửa giá: bảng chỉ xem, không ô nhập, không nút lưu", () => {
    render(<PriceRuleEditor venueId="v1" courts={COURTS} initial={[RULE]} canEdit={false} />);

    expect(screen.getByText("Luật 1")).toBeInTheDocument();
    expect(screen.getByText("Mọi ngày")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  /**
   * Bảng giá nằm trong state của React, ngoài thẻ form — lưu báo lỗi thì bảng
   * đang sửa dở phải còn nguyên (khác các form dùng `defaultValue`).
   */
  it("lưu báo lỗi (luật chồng nhau) thì bảng đang sửa còn nguyên, và luật có số thứ tự", async () => {
    vi.mocked(savePriceRulesAction).mockResolvedValue({
      error: "Luật 1 và luật 2 chồng nhau: cùng ưu tiên 0",
    });
    const { container } = render(
      <PriceRuleEditor venueId="v1" courts={COURTS} initial={[RULE, RULE]} canEdit />,
    );

    const prices = screen.getAllByDisplayValue("70000");
    fireEvent.change(prices[1]!, { target: { value: "90000" } });

    await act(() => Promise.resolve(fireEvent.submit(container.querySelector("form")!)));

    expect(await screen.findByRole("alert")).toHaveTextContent("Luật 1 và luật 2 chồng nhau");
    expect(screen.getByText("Luật 2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("90000")).toBeInTheDocument();
  });
});
