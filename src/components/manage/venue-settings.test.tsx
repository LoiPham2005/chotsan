import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

/**
 * Trang cài đặt sân: ba lỗi đã gặp thật ở đây.
 *
 * 1. Ngày chưa khai giờ khởi tạo là MỞ 06–22 trong khi chữ trên màn nói "chưa
 *    khai = đóng cửa" → lưu một thay đổi bất kỳ là mở bán luôn những ngày đó.
 * 2. React 19 xoá trắng form sau khi action báo lỗi → mất hồ sơ đang sửa.
 * 3. Cơ sở bản nháp không có đường gửi duyệt.
 */

vi.mock("@/app/(manage)/manage/[venueId]/settings/actions", () => ({
  updateVenueAction: vi.fn(),
  updateBankAction: vi.fn(),
  updateHoursAction: vi.fn(),
  submitForReviewAction: vi.fn(),
}));

import {
  submitForReviewAction,
  updateBankAction,
  updateHoursAction,
  updateVenueAction,
} from "@/app/(manage)/manage/[venueId]/settings/actions";
import {
  initialHourRows,
  VenueReviewPanel,
  VenueSettings,
  type VenueSettingsData,
} from "./venue-settings";

const VENUE: VenueSettingsData = {
  name: "Sân ABC",
  description: null,
  address: "1 Nguyễn Trãi",
  ward: "Phường Thanh Xuân",
  province: "Hà Nội",
  phone: "0987654321",
  amenities: [],
  holdMinutes: 10,
  freeCancelHours: 2,
  cancelFeePercent: 100,
  bankName: "VCB",
  bankAccountNumber: "1234567890",
  bankAccountName: "NGUYEN VAN A",
};

const MONDAY = { weekday: 1, openMinute: 360, closeMinute: 1320, isClosed: false };

function renderSettings(hours = [MONDAY]) {
  return render(
    <VenueSettings venueId="v1" venue={VENUE} hours={hours} banks={["VCB", "TCB", "MB"]} />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("giờ mở cửa — ngày chưa khai", () => {
  it("khởi tạo là ĐÓNG CỬA, khớp câu hướng dẫn trên màn", () => {
    const rows = initialHourRows([MONDAY]);

    expect(rows.map((row) => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(rows[0]).toEqual(MONDAY);
    expect(rows.slice(1).every((row) => row.isClosed)).toBe(true);
  });

  it("lưu bảng giờ khi chỉ khai Thứ 2 KHÔNG mở bán luôn các ngày còn lại", async () => {
    vi.mocked(updateHoursAction).mockResolvedValue({ ok: "Đã lưu giờ mở cửa" });
    renderSettings();

    const block = screen.getByRole("heading", { name: "Giờ mở cửa" }).closest("section")!;
    expect(within(block).getAllByText("Nghỉ cả ngày")).toHaveLength(6);

    await act(() => Promise.resolve(fireEvent.submit(block.querySelector("form")!)));

    const sent = vi.mocked(updateHoursAction).mock.calls[0]![2];
    const hours = JSON.parse(sent.get("hours") as string) as {
      weekday: number;
      isClosed: boolean;
    }[];
    expect(hours.filter((hour) => !hour.isClosed).map((hour) => hour.weekday)).toEqual([1]);
  });

  /**
   * Bảng giờ nằm trong state của React, NGOÀI thẻ form (form chỉ mang ô ẩn) —
   * React xoá trắng form khi lỗi cũng không đụng tới giờ đang sửa.
   */
  it("lưu giờ báo lỗi thì ngày vừa bật mở cửa vẫn đang mở", async () => {
    vi.mocked(updateHoursAction).mockResolvedValue({ error: "Giờ đóng cửa phải sau giờ mở cửa" });
    renderSettings();

    const block = screen.getByRole("heading", { name: "Giờ mở cửa" }).closest("section")!;
    fireEvent.click(within(block).getAllByRole("checkbox")[1]!); // Thứ 3

    await act(() => Promise.resolve(fireEvent.submit(block.querySelector("form")!)));

    expect(await within(block).findByRole("alert")).toHaveTextContent("Giờ đóng cửa");
    expect(within(block).getAllByText("Nghỉ cả ngày")).toHaveLength(5);
    expect(within(block).getAllByRole("checkbox")[1]).toBeChecked();
  });
});

describe("hồ sơ + ngân hàng — giữ dữ liệu khi action báo lỗi", () => {
  it("hồ sơ sân: gõ sai thì các ô giữ nguyên chữ vừa gõ, không quay về dữ liệu cũ", async () => {
    vi.mocked(updateVenueAction).mockResolvedValue({
      error: "Số điện thoại 10–11 số",
      values: {
        name: "Sân ABC mới",
        description: "Thêm đèn LED",
        address: "1 Nguyễn Trãi",
        ward: "Phường Thanh Xuân",
        province: "Hà Nội",
        phone: "09",
        amenities: "Wifi",
        holdMinutes: "15",
        freeCancelHours: "2",
        cancelFeePercent: "100",
      },
    });
    renderSettings();

    const block = screen.getByRole("heading", { name: "Hồ sơ sân" }).closest("section")!;
    const name = within(block).getByDisplayValue("Sân ABC");
    const phone = within(block).getByDisplayValue("0987654321");
    fireEvent.change(name, { target: { value: "Sân ABC mới" } });
    fireEvent.change(phone, { target: { value: "09" } });

    await act(() => Promise.resolve(fireEvent.submit(block.querySelector("form")!)));

    expect(await within(block).findByRole("alert")).toHaveTextContent("Số điện thoại");
    expect(name).toHaveValue("Sân ABC mới");
    expect(within(block).getByDisplayValue("09")).toBeInTheDocument();
    expect(within(block).getByDisplayValue("Thêm đèn LED")).toBeInTheDocument();
    expect(within(block).getByDisplayValue("15")).toBeInTheDocument();
  });

  it("ngân hàng: ngân hàng đã chọn và số tài khoản đã gõ còn nguyên sau lỗi", async () => {
    vi.mocked(updateBankAction).mockResolvedValue({
      error: "Điền đủ cả ba ô, hoặc để trống cả ba",
      values: { bankName: "TCB", bankAccountNumber: "999888777", bankAccountName: "" },
    });
    renderSettings();

    const block = screen.getByRole("heading", { name: "Tài khoản nhận tiền" }).closest("section")!;
    fireEvent.change(within(block).getByRole("combobox"), { target: { value: "TCB" } });
    fireEvent.change(within(block).getByDisplayValue("1234567890"), {
      target: { value: "999888777" },
    });
    fireEvent.change(within(block).getByDisplayValue("NGUYEN VAN A"), { target: { value: "" } });

    await act(() => Promise.resolve(fireEvent.submit(block.querySelector("form")!)));

    expect(await within(block).findByRole("alert")).toHaveTextContent("đủ cả ba ô");
    expect(within(block).getByRole("combobox")).toHaveValue("TCB");
    expect(within(block).getByDisplayValue("999888777")).toBeInTheDocument();
  });
});

describe("VenueReviewPanel — gửi duyệt", () => {
  const ITEMS = [
    { key: "hours" as const, label: "giờ mở cửa", done: true },
    { key: "courts" as const, label: "ít nhất một sân con", done: false },
    { key: "pricing" as const, label: "bảng giá", done: true },
    { key: "bank" as const, label: "tài khoản nhận tiền", done: false },
  ];

  it("bản nháp chưa đủ: liệt kê việc còn thiếu, KHOÁ nút và nói phải làm gì", () => {
    render(
      <VenueReviewPanel
        venueId="v1"
        status="DRAFT"
        inactiveNote={null}
        items={ITEMS}
        ready={false}
      />,
    );

    expect(screen.getByText("Ít nhất một sân con")).toBeInTheDocument();
    expect(screen.getAllByText("Đã xong")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /khai ở Sân & giá/ })).toHaveAttribute(
      "href",
      "/manage/v1/courts",
    );
    expect(screen.getByRole("link", { name: /khai bên dưới/ })).toHaveAttribute("href", "#bank");
    expect(
      screen.getByRole("button", { name: "Làm xong các mục trên để gửi duyệt" }),
    ).toBeDisabled();
  });

  it("bị trả hồ sơ thì hiện lý do của nền tảng", () => {
    render(
      <VenueReviewPanel
        venueId="v1"
        status="DRAFT"
        inactiveNote="Thiếu ảnh sân"
        items={ITEMS.map((item) => ({ ...item, done: true }))}
        ready
      />,
    );

    expect(screen.getByText(/Hồ sơ bị trả về:/).closest("p")).toHaveTextContent("Thiếu ảnh sân");
    expect(screen.getByRole("button", { name: "Gửi duyệt" })).toBeEnabled();
  });

  it("bấm gửi duyệt gọi action của đúng sân; lỗi thì hiện câu báo", async () => {
    vi.mocked(submitForReviewAction).mockResolvedValue({
      error: "Chưa gửi duyệt được: sân còn thiếu bảng giá",
    });
    const { container } = render(
      <VenueReviewPanel
        venueId="v1"
        status="DRAFT"
        inactiveNote={null}
        items={ITEMS.map((item) => ({ ...item, done: true }))}
        ready
      />,
    );

    await act(() => Promise.resolve(fireEvent.submit(container.querySelector("form")!)));

    expect(await screen.findByRole("alert")).toHaveTextContent("còn thiếu bảng giá");
    expect(vi.mocked(submitForReviewAction).mock.calls[0]![0]).toBe("v1");
  });

  it("đang chờ duyệt thì nói rõ, không còn nút gửi", () => {
    render(
      <VenueReviewPanel
        venueId="v1"
        status="PENDING"
        inactiveNote={null}
        items={[]}
        ready={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Hồ sơ đang chờ duyệt" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("bị khoá thì nói là KHOÁ (không lẫn với bị trả hồ sơ); đang bán thì không hiện gì", () => {
    const { rerender, container } = render(
      <VenueReviewPanel
        venueId="v1"
        status="ADMIN_LOCKED"
        inactiveNote="Nợ hoa hồng quá hạn"
        items={[]}
        ready={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "đang bị ChốtSân khoá: Nợ hoa hồng quá hạn",
    );

    rerender(
      <VenueReviewPanel venueId="v1" status="ACTIVE" inactiveNote={null} items={[]} ready />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
