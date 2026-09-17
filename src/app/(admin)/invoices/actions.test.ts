import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/session";
import { InvoicePaidError } from "@/lib/errors";
import type * as InvoiceServiceModule from "@/services/invoice.service";

/**
 * Đối soát hoá đơn: câu báo phải nói đúng sự thật — bấm "Đã thu" trên một hoá
 * đơn người khác vừa ghi nhận thì KHÔNG được báo như thể vừa thu thêm lần nữa.
 */

vi.mock("@/lib/auth", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/permission.service", () => ({
  permissionService: { can: vi.fn() },
}));
vi.mock("@/services/invoice.service", async (importOriginal) => {
  const actual = await importOriginal<typeof InvoiceServiceModule>();
  return { ...actual, invoiceService: { markPaid: vi.fn(), waive: vi.fn() } };
});

import { getSession } from "@/lib/auth";
import { permissionService } from "@/services/permission.service";
import { invoiceService } from "@/services/invoice.service";
import { markInvoicePaidAction, waiveInvoiceAction } from "./actions";

const admin: SessionPayload = {
  typ: "access",
  sub: "admin-1",
  email: "admin@example.com",
  roles: ["ADMIN"],
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(admin);
  vi.mocked(permissionService.can).mockResolvedValue(true);
});

describe("markInvoicePaidAction", () => {
  it("vừa ghi nhận thì báo 'Đã ghi nhận thu tiền'", async () => {
    vi.mocked(invoiceService.markPaid).mockResolvedValue({ alreadyPaid: false });

    const result = await markInvoicePaidAction({}, form({ invoiceId: "i1" }));

    expect(result.ok).toBe("Đã ghi nhận thu tiền");
  });

  it("đã thu từ trước thì NÓI RÕ là từ trước", async () => {
    vi.mocked(invoiceService.markPaid).mockResolvedValue({ alreadyPaid: true });

    const result = await markInvoicePaidAction({}, form({ invoiceId: "i1" }));

    expect(result.ok).toBe("Hoá đơn này đã được ghi nhận thu tiền từ trước");
  });

  it("không có `invoice:manage` thì bị chặn", async () => {
    vi.mocked(permissionService.can).mockResolvedValue(false);

    await markInvoicePaidAction({}, form({ invoiceId: "i1" }));

    expect(invoiceService.markPaid).not.toHaveBeenCalled();
  });
});

describe("waiveInvoiceAction", () => {
  it("lý do quá ngắn thì báo và trả lại chữ đã gõ", async () => {
    const result = await waiveInvoiceAction({}, form({ invoiceId: "i1", reason: "ok" }));

    expect(result).toEqual({ error: "Ghi rõ lý do miễn", reason: "ok" });
    expect(invoiceService.waive).not.toHaveBeenCalled();
  });

  it("người miễn là người đang đăng nhập; lỗi nghiệp vụ vẫn giữ lý do", async () => {
    vi.mocked(invoiceService.waive).mockRejectedValue(new InvoicePaidError());

    const result = await waiveInvoiceAction(
      {},
      form({ invoiceId: "i1", reason: "Đối tác chiến lược" }),
    );

    expect(invoiceService.waive).toHaveBeenCalledWith({
      invoiceId: "i1",
      by: "admin-1",
      reason: "Đối tác chiến lược",
    });
    expect(result).toEqual({
      error: "Hoá đơn đã thu tiền rồi, không miễn được",
      reason: "Đối tác chiến lược",
    });
  });

  it("thiếu mã hoá đơn: nói phải làm gì — không báo nhầm là 'thiếu lý do' khi lý do đã gõ", async () => {
    const result = await waiveInvoiceAction({}, form({ reason: "Đối tác chiến lược" }));

    expect(result).toEqual({
      error: "Không biết đang xử lý hoá đơn nào — tải lại trang rồi bấm lại giúp bạn nhé.",
      reason: "Đối tác chiến lược",
    });
    expect(invoiceService.waive).not.toHaveBeenCalled();
  });

  it("đã miễn từ trước thì nói rõ, không báo như vừa miễn", async () => {
    vi.mocked(invoiceService.waive).mockResolvedValue({ alreadyWaived: true });

    const result = await waiveInvoiceAction(
      {},
      form({ invoiceId: "i1", reason: "Đối tác chiến lược" }),
    );

    expect(result.ok).toBe("Hoá đơn này đã được miễn từ trước");
  });
});
