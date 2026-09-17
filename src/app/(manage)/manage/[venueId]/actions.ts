"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { formatVnd } from "@/lib/slots";
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

/*
 * Ô ẨN thiếu — người dùng không sửa được, chỉ xảy ra khi trang cũ còn mở trong
 * tab hoặc request tự chế. Câu lỗi nói cách sửa thay vì "thiếu mã…".
 */
const MISSING_PAYMENT =
  "Không biết đang xử lý khoản chuyển khoản nào — tải lại trang rồi bấm lại giúp bạn nhé.";
const MISSING_BOOKING =
  "Không biết đang thao tác với lượt đặt nào — tải lại trang rồi bấm lại giúp bạn nhé.";

/**
 * Các giao dịch của MỘT lần chuyển khoản — form gửi nhiều ô `paymentId` cùng tên.
 *
 * Service tự lọc theo `ctx.venueId`: id của sân khác gửi lên thì cả lô bị từ
 * chối như không tồn tại. Xem `PaymentService.requireVenuePayments`.
 */
const paymentIdsSchema = z.array(idSchema).min(1).max(50);

/** Duyệt một khoản chuyển khoản tay. Đây là chỗ tiền được công nhận. */
export const approvePaymentAction = defineVenueAction(
  "payment:confirm",
  async (ctx, _prev: ManageState, formData: FormData): Promise<ManageState> => {
    const parsed = paymentIdsSchema.safeParse(formData.getAll("paymentId"));
    if (!parsed.success) return { error: MISSING_PAYMENT };

    try {
      await paymentService.approveManual({
        paymentIds: parsed.data,
        venueId: ctx.venueId,
        reviewerId: ctx.actorId,
      });
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
        paymentIds: paymentIdsSchema,
        reason: z
          .string()
          .trim()
          .min(4, "Ghi rõ lý do để khách biết phải làm gì")
          .max(300, "Lý do tối đa 300 ký tự — rút gọn lại giúp bạn nhé"),
      })
      .safeParse({ paymentIds: formData.getAll("paymentId"), reason: formData.get("reason") });

    if (!parsed.success) {
      // Lý do là ô người dùng gõ; thiếu gì khác là thiếu ô ẨN (mã giao dịch).
      return { error: z.flattenError(parsed.error).fieldErrors.reason?.[0] ?? MISSING_PAYMENT };
    }

    try {
      await paymentService.rejectManual({
        paymentIds: parsed.data.paymentIds,
        venueId: ctx.venueId,
        reviewerId: ctx.actorId,
        reason: parsed.data.reason,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/payments`);
    // Lượt đặt được cấp hạn giữ chỗ mới — lịch sân phải thấy hạn đó.
    revalidatePath(`/manage/${ctx.venueId}`);
    return { ok: "Đã từ chối và báo cho khách" };
  },
);

/** Khách tới sân. */
export const checkInAction = defineVenueAction(
  "booking:checkin",
  async (ctx, _prev: ManageState, formData: FormData): Promise<ManageState> => {
    const parsed = idSchema.safeParse(formData.get("bookingId"));
    if (!parsed.success) return { error: MISSING_BOOKING };

    try {
      // `venueId`: lượt đặt phải thuộc đúng sân mà người bấm có quyền.
      await bookingService.checkIn(parsed.data, { venueId: ctx.venueId });
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
 * KHÔNG tự hoàn tiền — `cancel()` chỉ trả lời "phải hoàn bao nhiêu". Hoàn tiền
 * là luồng riêng cần quyền `payment:refund`, và gộp vào đây là giấu một thao
 * tác tiền bạc bên trong một nút trông vô hại.
 *
 * `VENUE`: sân huỷ được cả lượt khách đã báo chuyển khoản — giao dịch chờ duyệt
 * huỷ theo, và câu trả về nhắc sân đối chiếu khoản khách đã khai.
 */
export const cancelBookingAction = defineVenueAction(
  "booking:cancel",
  async (ctx, _prev: ManageState, formData: FormData): Promise<ManageState> => {
    const parsed = z
      .object({
        bookingId: idSchema,
        reason: z.string().trim().max(300, "Lý do tối đa 300 ký tự").optional(),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return {
        error: z.flattenError(parsed.error).fieldErrors.reason?.[0] ?? MISSING_BOOKING,
      };
    }

    let result;
    try {
      result = await bookingService.cancel(parsed.data.bookingId, {
        actor: "VENUE",
        reason: parsed.data.reason || "Sân huỷ",
        cancelledBy: ctx.actorId,
        // Lượt đặt phải thuộc đúng sân mà người bấm có quyền (GOTCHAS #19).
        venueId: ctx.venueId,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}`);
    revalidatePath(`/manage/${ctx.venueId}/payments`);

    return { ok: `Đã huỷ lượt ${result.booking.code}. ${ownerRefundSentence(result)}` };
  },
);

/**
 * Câu cho người trực sân: phải làm gì với tiền. Tính theo tiền ĐÃ NHẬN và tiền
 * khách ĐÃ KHAI — không theo giá lượt đặt, vì lượt chưa trả thì không có gì để hoàn.
 */
function ownerRefundSentence(result: {
  refundable: boolean;
  paidAmount: number;
  refundableAmount: number;
  awaitingAmount: number;
}): string {
  if (result.awaitingAmount > 0) {
    return `Khách đã báo chuyển ${formatVnd(result.awaitingAmount)} — đối chiếu sao kê, nếu đã nhận thì hoàn lại cho khách.`;
  }
  if (result.paidAmount === 0) {
    return "Khách chưa thanh toán nên không phải hoàn tiền.";
  }
  if (result.refundableAmount > 0) {
    return result.refundable
      ? `Khách còn trong hạn huỷ miễn phí — cần hoàn ${formatVnd(result.refundableAmount)}.`
      : `Ngoài hạn huỷ miễn phí — sau phí huỷ vẫn cần hoàn ${formatVnd(result.refundableAmount)}.`;
  }
  return "Ngoài hạn huỷ miễn phí nên không phải hoàn tiền.";
}
