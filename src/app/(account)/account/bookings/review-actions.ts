"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { firstIssueMessage } from "@/lib/form-errors";
import { reviewService } from "@/services/review.service";

export type ReviewState = { error?: string; ok?: string };

/**
 * Khách chấm sao cho một lượt đặt đã chơi.
 *
 * `defineAuthedAction` chứ không phải quyền riêng: mọi người dùng đều đánh giá
 * được lượt đặt CỦA MÌNH. Ràng buộc sở hữu nằm trong `reviewService.create`,
 * ngay trong câu truy vấn (`where: { id, userId }`).
 */
export const createReviewAction = defineAuthedAction(
  async (ctx, _prev: ReviewState, formData: FormData): Promise<ReviewState> => {
    const parsed = z
      .object({
        bookingId: z
          .string()
          .min(1, "Không biết đang đánh giá lượt nào — tải lại trang rồi gửi lại giúp bạn nhé"),
        rating: z.coerce
          .number("Chọn số sao trước khi gửi")
          .int("Chọn số sao trước khi gửi")
          .min(1, "Chọn số sao trước khi gửi")
          .max(5, "Chọn từ 1 tới 5 sao"),
        comment: z
          .string()
          .trim()
          .max(1000, "Nhận xét tối đa 1000 ký tự — rút gọn lại giúp bạn nhé")
          .optional(),
      })
      .safeParse(Object.fromEntries(formData));

    // Câu của ĐÚNG ô sai. Bản trước báo "Chọn số sao" cho mọi lỗi — kể cả khi
    // đã chọn sao mà nhận xét quá dài, người dùng không biết sửa chỗ nào.
    if (!parsed.success) {
      return { error: firstIssueMessage(parsed.error, "Chọn số sao trước khi gửi") };
    }

    try {
      await reviewService.create({
        bookingId: parsed.data.bookingId,
        userId: ctx.actorId,
        rating: parsed.data.rating,
        comment: parsed.data.comment ?? null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath("/account/bookings");
    return { ok: "Cảm ơn bạn đã đánh giá" };
  },
);
