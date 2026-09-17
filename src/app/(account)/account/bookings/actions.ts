"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { formatVnd } from "@/lib/slots";
import { bookingService } from "@/services/booking.service";

export type CancelState = { error?: string; ok?: string };

/**
 * Khách tự huỷ lượt đặt của mình.
 *
 * ---
 * `defineAuthedAction` CHỨ KHÔNG PHẢI `defineAction`
 *
 * Không có quyền nào tên "huỷ lượt đặt của chính mình" — mọi người dùng đều
 * làm được. Quyền `booking:cancel` là để huỷ lượt của NGƯỜI KHÁC (chủ sân,
 * nhân viên), và dùng nó ở đây sẽ chặn đúng người cần dùng.
 *
 * Thay vào đó, quyền sở hữu được kiểm bằng `findOwnedByUser` — điều kiện nằm
 * ngay trong câu truy vấn, không phải một phép so sánh rời có thể quên.
 */
export const cancelOwnBookingAction = defineAuthedAction(
  async (ctx, _prev: CancelState, formData: FormData): Promise<CancelState> => {
    const parsed = z.string().min(1).safeParse(formData.get("bookingId"));
    if (!parsed.success) return { error: "Thiếu mã lượt đặt" };

    const booking = await bookingService.findOwnedByUser(parsed.data, ctx.actorId);
    // Không tìm thấy và không phải của mình trả về CÙNG một câu — nói khác đi
    // là xác nhận lượt đặt đó có tồn tại.
    if (!booking) return { error: "Không tìm thấy lượt đặt này" };

    let result;
    try {
      // `CUSTOMER`: khách đã báo chuyển khoản thì service từ chối — tiền có thể
      // đã về tài khoản sân, chỉ sân quyết được có huỷ và hoàn hay không.
      result = await bookingService.cancel(booking.id, {
        actor: "CUSTOMER",
        reason: "Khách tự huỷ",
        cancelledBy: ctx.actorId,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath("/account/bookings");

    return { ok: `Đã huỷ lượt ${booking.code}. ${refundSentence(result)}` };
  },
);

/**
 * Câu nói về tiền sau khi huỷ — theo tiền ĐÃ TRẢ, không theo giá lượt đặt.
 *
 * Lỗi thật trước đây: khách huỷ lượt chưa trả đồng nào vẫn đọc "Sân sẽ hoàn
 * 360.000đ", còn huỷ trễ ở sân chỉ giữ lại 30% thì đọc "không được hoàn tiền"
 * dù còn 70% phải hoàn.
 */
function refundSentence(result: {
  refundable: boolean;
  feePercent: number;
  paidAmount: number;
  refundableAmount: number;
}): string {
  if (result.paidAmount === 0) {
    return "Bạn chưa thanh toán nên không có khoản nào cần hoàn.";
  }
  if (result.refundable) {
    return `Sân sẽ hoàn ${formatVnd(result.refundableAmount)} cho bạn.`;
  }
  if (result.refundableAmount > 0) {
    return `Đã quá hạn huỷ miễn phí nên sân giữ lại ${result.feePercent}% — bạn được hoàn ${formatVnd(result.refundableAmount)}.`;
  }
  return "Đã quá hạn huỷ miễn phí nên không được hoàn tiền.";
}
