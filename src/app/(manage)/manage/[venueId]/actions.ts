"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { bookingService } from "@/services/booking.service";
import { paymentService } from "@/services/payment.service";

/**
 * Thao tác của chủ sân trên lịch và trên hàng chờ duyệt chuyển khoản.
 *
 * Mọi action ở đây bọc bằng `defineVenueAction`, nên `venueId` là THAM SỐ ĐẦU
 * TIÊN bắt buộc và quyền được kiểm trên đúng sân đó. Không có cách nào viết một
 * action trong tệp này mà quên kiểm sân — nó sẽ không biên dịch được.
 */
export type ManageState = { error?: string; ok?: string };

const idSchema = z.string().min(1);

/** Duyệt một khoản chuyển khoản tay. Đây là chỗ tiền được công nhận. */
export const approvePaymentAction = defineVenueAction(
  "payment:confirm",
  async (ctx, _prev: ManageState, formData: FormData): Promise<ManageState> => {
    const parsed = idSchema.safeParse(formData.get("paymentId"));
    if (!parsed.success) return { error: "Thiếu mã giao dịch" };

    try {
      await paymentService.approveManual({ paymentId: parsed.data, reviewerId: ctx.actorId });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/payments`);
    revalidatePath(`/manage/${ctx.venueId}`);
    return { ok: "Đã xác nhận đã nhận tiền" };
  },
);

/**
 * Từ chối một khoản khai chuyển khoản.
 *
 * Bắt buộc có lý do: khách nhận được câu này, và "bị từ chối" không kèm lý do
 * thì họ chỉ còn cách gọi điện cho sân — đúng thứ app sinh ra để bớt đi.
 */
export const rejectPaymentAction = defineVenueAction(
  "payment:confirm",
  async (ctx, _prev: ManageState, formData: FormData): Promise<ManageState> => {
    const parsed = z
      .object({
        paymentId: idSchema,
        reason: z.string().trim().min(4, "Ghi rõ lý do để khách biết phải làm gì").max(300),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return { error: z.flattenError(parsed.error).fieldErrors.reason?.[0] ?? "Thiếu lý do" };
    }

    try {
      await paymentService.rejectManual({
        paymentId: parsed.data.paymentId,
        reviewerId: ctx.actorId,
        reason: parsed.data.reason,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/payments`);
    return { ok: "Đã từ chối và báo cho khách" };
  },
);

/** Khách tới sân. */
export const checkInAction = defineVenueAction(
  "booking:checkin",
  async (ctx, _prev: ManageState, formData: FormData): Promise<ManageState> => {
    const parsed = idSchema.safeParse(formData.get("bookingId"));
    if (!parsed.success) return { error: "Thiếu mã lượt đặt" };

    try {
      await bookingService.checkIn(parsed.data);
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}`);
    return { ok: "Đã ghi nhận khách tới sân" };
  },
);

/**
 * Huỷ hộ khách.
 *
 * KHÔNG tự hoàn tiền — `cancel()` chỉ trả lời "có được hoàn không". Hoàn tiền
 * là luồng riêng cần quyền `payment:refund`, và gộp vào đây là giấu một thao
 * tác tiền bạc bên trong một nút trông vô hại.
 */
export const cancelBookingAction = defineVenueAction(
  "booking:cancel",
  async (ctx, _prev: ManageState, formData: FormData): Promise<ManageState> => {
    const parsed = z
      .object({ bookingId: idSchema, reason: z.string().trim().max(300).optional() })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) return { error: "Thiếu mã lượt đặt" };

    try {
      const result = await bookingService.cancel(parsed.data.bookingId, {
        reason: parsed.data.reason || "Sân huỷ",
        cancelledBy: ctx.actorId,
      });

      revalidatePath(`/manage/${ctx.venueId}`);

      return {
        ok: result.refundable
          ? `Đã huỷ. Khách còn trong hạn huỷ miễn phí — cần hoàn ${result.refundableAmount.toLocaleString("vi-VN")}đ.`
          : "Đã huỷ. Ngoài hạn huỷ miễn phí nên không phải hoàn tiền.",
      };
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }
  },
);
