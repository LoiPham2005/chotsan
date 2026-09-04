"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { definePublicAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { bookingService } from "@/services/booking.service";
import { paymentService } from "@/services/payment.service";

/**
 * Khách bấm "Tôi đã chuyển khoản".
 *
 * ---
 * ACTION NÀY KHÔNG XÁC NHẬN GÌ CẢ
 *
 * Nó chỉ đẩy giao dịch vào hàng chờ duyệt của chủ sân. Tin lời khách là ai
 * cũng đặt được sân miễn phí — xem `PaymentService.declareTransfer`.
 *
 * ---
 * MÃ ĐẶT SÂN LÀ THỨ DUY NHẤT ĐỂ NHẬN DIỆN
 *
 * Khách vãng lai không có tài khoản. Nên quyền ở đây là "biết mã": 6 ký tự
 * trên bảng 28 chữ. Kèm trần chống dội để không ai dò được bằng cách thử.
 * Tác hại lớn nhất nếu đoán trúng là đánh dấu "đã chuyển" cho lượt của người
 * khác — chủ sân vẫn phải mở app ngân hàng đối chiếu trước khi duyệt.
 */
const schema = z.object({
  code: z.string().trim().min(4).max(12),
  note: z.string().trim().max(300).optional(),
});

export type DeclareTransferState = { error?: string; ok?: boolean };

export const declareTransferAction = definePublicAction(
  "Khách vãng lai không có tài khoản; mã đặt sân là thứ duy nhất họ có",
  { key: "khai-chuyen-khoan", limit: 8, windowSeconds: 60 },
  async (_ctx, _state: DeclareTransferState, formData: FormData) => {
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { error: "Thiếu mã đặt sân" };

    const booking = await bookingService.findByCode(parsed.data.code);
    if (!booking) return { error: "Không tìm thấy lượt đặt này" };

    // Lấy giao dịch còn sống. `ngay()` đã chặn ở database chuyện có hai cái,
    // nên ở đây nhiều nhất là một.
    const payment = booking.payments.find((payment) =>
      ["PENDING", "AWAITING_CONFIRMATION"].includes(payment.status),
    );

    if (!payment) return { error: "Lượt đặt này không còn giao dịch nào đang chờ" };

    try {
      await paymentService.declareTransfer({
        paymentId: payment.id,
        note: parsed.data.note ?? null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/bookings/${booking.code}`);
    return { ok: true };
  },
);
