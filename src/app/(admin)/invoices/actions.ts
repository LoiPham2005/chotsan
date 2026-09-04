"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { invoiceService } from "@/services/invoice.service";

export type InvoiceState = { error?: string; ok?: string };

/** Đánh dấu đã thu được tiền hoa hồng. */
export const markInvoicePaidAction = defineAction(
  "invoice:manage",
  async (_ctx, _prev: InvoiceState, formData: FormData): Promise<InvoiceState> => {
    const parsed = z.string().min(1).safeParse(formData.get("invoiceId"));
    if (!parsed.success) return { error: "Thiếu hoá đơn" };

    try {
      await invoiceService.markPaid(parsed.data);
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath("/invoices");
    return { ok: "Đã ghi nhận thu tiền" };
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
    const parsed = z
      .object({
        invoiceId: z.string().min(1),
        reason: z.string().trim().min(4, "Ghi rõ lý do miễn").max(300),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return { error: z.flattenError(parsed.error).fieldErrors.reason?.[0] ?? "Thiếu lý do" };
    }

    try {
      await invoiceService.waive({
        invoiceId: parsed.data.invoiceId,
        by: ctx.actorId,
        reason: parsed.data.reason,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath("/invoices");
    return { ok: "Đã miễn hoá đơn" };
  },
);
