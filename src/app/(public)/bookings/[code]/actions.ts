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

    const checkout = await bookingService.findCheckout(parsed.data.code);
    if (!checkout) return { error: "Không tìm thấy lượt đặt này" };

    /*
     * Khai cho MỌI lượt còn chờ của lần đặt, không phải lượt nào đó.
     *
     * Một lần chuyển khoản trả cho cả nhóm. Khai thiếu một lượt thì chủ sân
     * duyệt xong vẫn còn một lượt treo "chờ thanh toán" — và nó hết hạn, nhả
     * chỗ của khách đã trả tiền.
     */
    const live = checkout.holding.map((booking) =>
      booking.payments.find((payment) =>
        ["PENDING", "AWAITING_CONFIRMATION"].includes(payment.status),
      ),
    );

    if (live.length === 0) return { error: "Lần đặt này không còn lượt nào chờ thanh toán" };
    if (live.some((payment) => payment === undefined)) {
      return { error: "Thông tin thanh toán vừa thay đổi. Tải lại trang giúp bạn nhé." };
    }

    try {
      await paymentService.declareTransfer({
        paymentIds: live.map((payment) => payment!.id),
        note: parsed.data.note ?? null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/bookings/${checkout.code}`);
    return { ok: true };
  },
);
