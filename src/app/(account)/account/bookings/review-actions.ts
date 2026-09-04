"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
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
        bookingId: z.string().min(1),
        rating: z.coerce.number().int().min(1).max(5),
        comment: z.string().trim().max(1000).optional(),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) return { error: "Chọn số sao trước khi gửi" };

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
