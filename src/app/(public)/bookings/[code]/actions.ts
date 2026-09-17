"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { bookingService } from "@/services/booking.service";
import { MANUAL_TRANSFER_PROVIDER, paymentService } from "@/services/payment.service";

/**
 * Thao tác của NGƯỜI ĐẶT trên màn thanh toán `/bookings/[code]`.
 *
 * ---
 * ĐĂNG NHẬP VÀ ĐÚNG NGƯỜI ĐẶT — MÃ ĐẶT SÂN KHÔNG PHẢI QUYỀN
 *
 * Đặt sân đã bắt buộc đăng nhập, nên mọi lần đặt đều có chủ. Bản trước để hai
 * action này công khai với lý do "khách vãng lai chỉ có mã đặt sân" — lý do đó
 * không còn: ai biết mã (đọc qua điện thoại, chụp màn hình, lịch sử trình duyệt
 * máy dùng chung) là khai chuyển khoản được cho lượt của người khác.
 *
 * Nhân viên sân XEM được màn này (`booking:read`) nhưng không thao tác thay
 * khách — khai "đã chuyển" hộ khách là tự tạo lời khai cho chính mình duyệt.
 */

const codeSchema = z.string().trim().min(4).max(12);

/** Tìm lần đặt theo mã, chỉ khi người đang thao tác là người đặt. */
async function findOwnCheckout(code: string, actorId: string) {
  const checkout = await bookingService.findCheckout(code);
  // Không có và không phải của mình trả về CÙNG một kết quả — nói khác đi là
  // xác nhận cho người dò rằng mã đó có thật.
  return checkout && checkout.userId === actorId ? checkout : null;
}

type Checkout = NonNullable<Awaited<ReturnType<typeof findOwnCheckout>>>;

/** Giao dịch chuyển khoản đang sống của một lượt, nếu có. */
function liveTransfer(booking: Checkout["holding"][number]) {
  return booking.payments.find(
    (payment) =>
      payment.provider === MANUAL_TRANSFER_PROVIDER &&
      (payment.status === "PENDING" || payment.status === "AWAITING_CONFIRMATION"),
  );
}

export type DeclareTransferState = { error?: string; ok?: boolean };

/**
 * Khách bấm "Tôi đã chuyển khoản".
 *
 * ---
 * ACTION NÀY KHÔNG XÁC NHẬN GÌ CẢ
 *
 * Nó chỉ đẩy giao dịch vào hàng chờ duyệt của chủ sân. Tin lời khách là ai
 * cũng đặt được sân miễn phí — xem `PaymentService.declareTransfer`.
 */
export const declareTransferAction = defineAuthedAction(
  async (ctx, _state: DeclareTransferState, formData: FormData): Promise<DeclareTransferState> => {
    const parsed = z
      .object({
        code: codeSchema,
        note: z.string().trim().max(300, "Ghi chú tối đa 300 ký tự").optional(),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return { error: z.flattenError(parsed.error).fieldErrors.note?.[0] ?? "Thiếu mã đặt sân" };
    }

    const checkout = await findOwnCheckout(parsed.data.code, ctx.actorId);
    if (!checkout) return { error: "Không tìm thấy lượt đặt này" };

    /*
     * Khai cho MỌI lượt còn chờ của lần đặt, không phải lượt nào đó.
     *
     * Một lần chuyển khoản trả cho cả nhóm. Khai thiếu một lượt thì chủ sân
     * duyệt xong vẫn còn một lượt treo "chờ thanh toán" — và nó hết hạn, nhả
     * chỗ của khách đã trả tiền.
     */
    const live = checkout.holding.map(liveTransfer);

    if (live.length === 0) {
      return { error: "Lần đặt này không còn lượt nào chờ thanh toán" };
    }
    if (live.some((payment) => payment === undefined)) {
      return { error: "Mã chuyển khoản chưa sẵn sàng. Tải lại trang giúp bạn nhé." };
    }

    try {
      await paymentService.declareTransfer({
        paymentIds: live.map((payment) => payment!.id),
        note: parsed.data.note || null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/bookings/${checkout.code}`);
    return { ok: true };
  },
);

export type OpenTransferState = { error?: string };

/**
 * Nút "Tạo mã chuyển khoản" — mở giao dịch cho những lượt ĐANG GIỮ CHỖ mà chưa có.
 *
 * Bình thường giao dịch đã mở ngay lúc giữ chỗ (`holdBookingAction`). Nút này
 * cho những lúc không có: mở giao dịch hỏng giữa chừng, chủ sân vừa từ chối lần
 * khai trước (giao dịch cũ thành FAILED), hay cron đã huỷ giao dịch quá hạn.
 * Trang thanh toán chỉ ĐỌC — mọi thứ ghi database đi qua một thao tác POST.
 */
export const openTransferAction = defineAuthedAction(
  async (ctx, _state: OpenTransferState, formData: FormData): Promise<OpenTransferState> => {
    const parsed = codeSchema.safeParse(formData.get("code"));
    if (!parsed.success) return { error: "Thiếu mã đặt sân" };

    const checkout = await findOwnCheckout(parsed.data, ctx.actorId);
    if (!checkout) return { error: "Không tìm thấy lượt đặt này" };

    if (checkout.holdExpired) {
      return { error: "Đã hết thời gian giữ chỗ. Đặt lại các khung này giúp bạn nhé." };
    }

    const missing = checkout.holding.filter((booking) => liveTransfer(booking) === undefined);

    try {
      // Tuần tự, không song song: hỏng ở lượt nào thì dừng và báo đúng câu của lượt đó.
      for (const booking of missing) {
        await paymentService.start({
          bookingId: booking.id,
          provider: MANUAL_TRANSFER_PROVIDER,
          receivedBy: "VENUE",
        });
      }
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/bookings/${checkout.code}`);
    return {};
  },
);
