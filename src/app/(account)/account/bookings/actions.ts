"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
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

    try {
      const result = await bookingService.cancel(booking.id, {
        reason: "Khách tự huỷ",
        cancelledBy: ctx.actorId,
      });

      revalidatePath("/account/bookings");

      return {
        ok: result.refundable
          ? `Đã huỷ. Sân sẽ hoàn ${result.refundableAmount.toLocaleString("vi-VN")}đ cho bạn.`
          : "Đã huỷ. Quá hạn huỷ miễn phí nên không được hoàn tiền.",
      };
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }
  },
);
