"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { invoiceService } from "@/services/invoice.service";

/**
 * `reason` đi kèm khi báo lỗi miễn hoá đơn: React 19 tự xoá trắng form sau MỌI
 * lần action chạy xong, kể cả khi lỗi — trả lại để ô lý do dựng lại đúng chữ.
 */
export type InvoiceState = { error?: string; ok?: string; reason?: string };

/** Ô ẩn `invoiceId` thiếu — chỉ xảy ra khi trang cũ còn mở trong tab hoặc request tự chế. */
const MISSING_INVOICE =
  "Không biết đang xử lý hoá đơn nào — tải lại trang rồi bấm lại giúp bạn nhé.";

/** Đánh dấu đã thu được tiền hoa hồng. */
export const markInvoicePaidAction = defineAction(
  "invoice:manage",
  async (_ctx, _prev: InvoiceState, formData: FormData): Promise<InvoiceState> => {
    const parsed = z.string().min(1).safeParse(formData.get("invoiceId"));
    if (!parsed.success) return { error: MISSING_INVOICE };

    let alreadyPaid: boolean;
    try {
      ({ alreadyPaid } = await invoiceService.markPaid(parsed.data));
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath("/invoices");
    // Trang đang mở có thể đã cũ (người khác vừa ghi nhận): nói đúng sự thật,
    // đừng báo "đã ghi nhận" như thể lần bấm này vừa làm việc đó.
    return {
      ok: alreadyPaid ? "Hoá đơn này đã được ghi nhận thu tiền từ trước" : "Đã ghi nhận thu tiền",
    };
  },
);

/**
 * Miễn một hoá đơn.
 *
 * Bắt buộc có lý do: đây là tiền nền tảng tự bỏ, và sáu tháng sau sẽ có người
 * hỏi vì sao tháng đó thiếu — câu trả lời phải nằm ngay trên hoá đơn.
 */
export const waiveInvoiceAction = defineAction(
  "invoice:manage",
  async (ctx, _prev: InvoiceState, formData: FormData): Promise<InvoiceState> => {
    const rawReason = formData.get("reason");
    const reason = typeof rawReason === "string" ? rawReason : "";

    const parsed = z
      .object({
        invoiceId: z.string().min(1),
        reason: z.string().trim().min(4, "Ghi rõ lý do miễn").max(300, "Lý do tối đa 300 ký tự"),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return {
        // Lý do là ô duy nhất người dùng gõ; thiếu gì khác là thiếu ô ẨN (hoá đơn).
        error: z.flattenError(parsed.error).fieldErrors.reason?.[0] ?? MISSING_INVOICE,
        reason,
      };
    }

    let alreadyWaived: boolean;
    try {
      ({ alreadyWaived } = await invoiceService.waive({
        invoiceId: parsed.data.invoiceId,
        by: ctx.actorId,
        reason: parsed.data.reason,
      }));
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message, reason };
      throw error;
    }

    revalidatePath("/invoices");
    return { ok: alreadyWaived ? "Hoá đơn này đã được miễn từ trước" : "Đã miễn hoá đơn" };
  },
);
