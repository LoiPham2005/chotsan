import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Màn đối soát hoá đơn. Lỗi thật trước đây: tab "Đã thu"/"Đã miễn" vẫn hiện
 * "Đã thu được tiền" và "Miễn hoá đơn"; bấm lại báo "đã ghi nhận" như thể vừa
 * thu thêm lần nữa.
 */

vi.mock("@/app/(admin)/invoices/actions", () => ({
  markInvoicePaidAction: vi.fn(),
  waiveInvoiceAction: vi.fn(),
}));

import { waiveInvoiceAction } from "@/app/(admin)/invoices/actions";
import { InvoiceRow, type InvoiceItem } from "./invoice-row";

const INVOICE: InvoiceItem = {
  id: "i1",
  number: "CS-202609-000042",
  venueName: "Sân ABC",
  venueArea: "Phường Láng Hạ, Hà Nội",
  period: "01/09/2026 – 30/09/2026",
  dueDate: "15/10/2026",
  overdueDays: 0,
  bookingCount: 10,
  grossRevenue: 5_000_000,
  commissionRate: 8,
  commissionAmount: 400_000,
  status: "DUE",
};

beforeEach(() => vi.clearAllMocks());

describe("InvoiceRow — nút theo trạng thái", () => {
  it("còn phải thu (Đang chờ, Quá hạn) thì có đủ hai thao tác", () => {
    for (const status of ["DUE", "OVERDUE"]) {
      const { unmount } = render(<InvoiceRow invoice={{ ...INVOICE, status }} />);

      expect(screen.getByRole("button", { name: "Đã thu được tiền" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Miễn hoá đơn" })).toBeInTheDocument();
      unmount();
    }
  });

  it("đã thu hoặc đã miễn thì KHÔNG có nút nào — chỉ nói trạng thái", () => {
    for (const [status, label] of [
      ["PAID", "Đã thu tiền"],
      ["WAIVED", "Đã miễn"],
    ] as const) {
      // Ngày quá hạn cũ không được hiện "Quá hạn" cho hoá đơn đã xong.
      const { unmount } = render(<InvoiceRow invoice={{ ...INVOICE, status, overdueDays: 40 }} />);

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(/ngưỡng khoá sân/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("miễn hoá đơn báo lỗi thì lý do vừa gõ còn nguyên", async () => {
    vi.mocked(waiveInvoiceAction).mockResolvedValue({
      error: "Hoá đơn đã thu tiền rồi, không miễn được",
      reason: "Đối tác chiến lược",
    });
    render(<InvoiceRow invoice={INVOICE} />);

    fireEvent.click(screen.getByRole("button", { name: "Miễn hoá đơn" }));
    const reason = screen.getByLabelText(/Lý do miễn/);
    fireEvent.change(reason, { target: { value: "Đối tác chiến lược" } });

    await act(() => Promise.resolve(fireEvent.submit(reason.closest("form")!)));

    expect(await screen.findByRole("alert")).toHaveTextContent("không miễn được");
    expect(screen.getByLabelText(/Lý do miễn/)).toHaveValue("Đối tác chiến lược");
  });
});
