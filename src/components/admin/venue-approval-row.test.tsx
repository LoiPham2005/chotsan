import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Hàng chờ duyệt cơ sở: từ chối là TRẢ HỒ SƠ về bản nháp (không khoá), lý do
 * vừa gõ không mất khi action báo lỗi, và thiếu tài khoản nhận tiền thì không
 * duyệt được.
 */

vi.mock("@/app/(admin)/venue-approvals/actions", () => ({ decideVenueAction: vi.fn() }));

import { decideVenueAction } from "@/app/(admin)/venue-approvals/actions";
import { ApprovalRow, type PendingVenue } from "./venue-approval-row";

const VENUE: PendingVenue = {
  id: "v1",
  name: "Sân ABC",
  description: null,
  address: "1 Nguyễn Trãi, Phường Thanh Xuân, Hà Nội",
  phone: "0987654321",
  sportName: "Cầu lông",
  sportKey: "badminton",
  createdAt: "2026-09-10T03:00:00.000Z",
  courtCount: 4,
  priceRuleCount: 2,
  openDayCount: 7,
  hasBankAccount: true,
  ownerName: "Nguyễn Văn A",
  ownerEmail: "a@example.com",
};

beforeEach(() => vi.clearAllMocks());

describe("ApprovalRow", () => {
  it("chưa khai tài khoản nhận tiền thì báo thiếu và KHOÁ nút duyệt", () => {
    render(<ApprovalRow venue={{ ...VENUE, hasBankAccount: false }} />);

    expect(screen.getByText("Chưa khai")).toBeInTheDocument();
    // Nút mờ nói vì sao chưa bấm được (SKILL.md §5), không chỉ đơ ra.
    expect(
      screen.getByRole("button", { name: "Chưa duyệt được — hồ sơ còn thiếu" }),
    ).toBeDisabled();
  });

  it("trả hồ sơ gửi quyết định DRAFT (không phải khoá); lỗi thì lý do vừa gõ còn nguyên", async () => {
    vi.mocked(decideVenueAction).mockResolvedValue({
      error: "Trạng thái cơ sở vừa được người khác thay đổi.",
      note: "Thiếu ảnh sân",
    });
    render(<ApprovalRow venue={VENUE} />);

    fireEvent.click(screen.getByRole("button", { name: "Trả hồ sơ" }));
    const note = screen.getByLabelText(/Lý do trả hồ sơ/);
    fireEvent.change(note, { target: { value: "Thiếu ảnh sân" } });

    await act(() => Promise.resolve(fireEvent.submit(note.closest("form")!)));

    const sent = vi.mocked(decideVenueAction).mock.calls[0]![1];
    expect(sent.get("decision")).toBe("DRAFT");
    expect(await screen.findByRole("alert")).toHaveTextContent("vừa được người khác thay đổi");
    expect(screen.getByLabelText(/Lý do trả hồ sơ/)).toHaveValue("Thiếu ảnh sân");
  });
});
