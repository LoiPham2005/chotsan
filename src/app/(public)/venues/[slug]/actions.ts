"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { dateKey, fromDateKey } from "@/lib/date";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { isSlotAligned, MINUTES_PER_DAY, SLOT_MINUTES, slotsToRanges } from "@/lib/slots";
import { bookingService } from "@/services/booking.service";
import { MANUAL_TRANSFER_PROVIDER, paymentService } from "@/services/payment.service";
import { userService } from "@/services/user.service";

/**
 * Giữ chỗ từ màn đặt sân của khách.
 *
 * ---
 * PHẢI ĐĂNG NHẬP MỚI ĐẶT ĐƯỢC
 *
 * Bản đầu cho khách vãng lai đặt không cần tài khoản, và đó là một luồng làm
 * dở: lượt đặt ấy mang `userId: null`, nên nó KHÔNG BAO GIỜ hiện ở màn "Lượt
 * đặt của tôi" và khách không tự huỷ được — họ chỉ còn cái link chứa mã, mất
 * link là mất đường vào chính lượt đặt của mình.
 *
 * Chưa kể tiền: giữ chỗ có hạn rồi chuyển khoản, và khi có tranh chấp thì
 * phải biết ai là người đặt. Một số điện thoại gõ vào ô trống không chứng minh
 * được gì.
 *
 * Đặt HỘ khách tại quầy vẫn giữ tên + số điện thoại rời (`source: COUNTER`) —
 * đó là luồng khác, do nhân viên sân thao tác.
 *
 * ---
 * MỌI THỨ TỪ FORM ĐỀU LÀ CHUỖI VÀ ĐỀU KHÔNG ĐÁNG TIN
 *
 * Kể cả `courtId` và khung giờ: người gọi tự đặt được, nên `holdCheckout()`
 * phải tự kiểm lại lịch trống chứ không tin dữ liệu gửi lên. Giá cũng do service
 * tự tính — form KHÔNG gửi số tiền.
 */
/** Tối đa bao nhiêu ô một lần — chặn một request tự chế giữ sạch cả ngày của sân. */
const MAX_SLOTS = 48;

/** Tối đa bao nhiêu lượt đặt một lần. */
const MAX_RANGES = 6;

const slotsSchema = z
  .array(
    z.object({
      courtId: z.string().min(1),
      minute: z
        .number()
        .int()
        .min(0)
        .max(MINUTES_PER_DAY - 1)
        .refine(isSlotAligned, `Khung giờ phải tròn ${SLOT_MINUTES} phút`),
    }),
  )
  .min(1, "Chọn ít nhất một khung giờ")
  .max(MAX_SLOTS, `Tối đa ${MAX_SLOTS} khung một lần`);

const schema = z.object({
  venueId: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ")
    // "2026-02-31" đúng định dạng nhưng không có thật — `new Date` lặng lẽ cuộn
    // sang 03/03 và khách bị đặt cho một ngày không hề chọn.
    .refine((value) => dateKey(fromDateKey(value)) === value, "Ngày không hợp lệ"),
  /** JSON `[{ courtId, minute }]` — các ô khách đã bấm chọn trên lưới. */
  slots: z.string().transform((raw, ctx) => {
    try {
      return slotsSchema.parse(JSON.parse(raw));
    } catch {
      ctx.addIssue({ code: "custom", message: "Danh sách khung giờ không hợp lệ" });
      return z.NEVER;
    }
  }),
  /**
   * Số điện thoại — chỉ hỏi khi hồ sơ chưa có.
   *
   * Sân cần gọi được cho khách khi có việc (mưa, mất điện, khách tới muộn).
   * Hồ sơ có sẵn thì dùng luôn, không bắt gõ lại thứ hệ thống đã biết.
   */
  customerPhone: z
    .string()
    .trim()
    .regex(/^0\d{9,10}$/, "Số điện thoại 10–11 số, bắt đầu bằng 0")
    .optional()
    .or(z.literal("")),
  customerNote: z.string().trim().max(300, "Ghi chú tối đa 300 ký tự").optional(),
});

export type HoldBookingState = { error?: string; fields?: Record<string, string[]> };

export const holdBookingAction = defineAuthedAction(
  async (ctx, _state: HoldBookingState, formData: FormData): Promise<HoldBookingState> => {
    const parsed = schema.safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      const fields = z.flattenError(parsed.error).fieldErrors;

      /*
       * Lỗi ở TRƯỜNG ẨN phải hiện ra thành một câu, không được im lặng.
       *
       * Giao diện chỉ vẽ lỗi dưới ô số điện thoại và ô ghi chú. Nếu `venueId`,
       * `courtId`, `date` hay khung giờ sai, người dùng bấm "Đặt sân" và KHÔNG
       * CÓ GÌ XẢY RA — không lỗi, không điều hướng, nút trở lại như cũ. Đã xảy
       * ra thật: form gửi `days` trong khi schema đòi `date`, và chỉ có bộ e2e
       * phát hiện ra.
       */
      const hidden = ["venueId", "date", "slots"] as const;
      if (hidden.some((key) => fields[key]?.length)) {
        return { error: "Chọn lại khung giờ giúp bạn nhé — dữ liệu gửi lên không hợp lệ." };
      }

      return { fields };
    }

    const input = parsed.data;

    // Ngày đã qua theo giờ Việt Nam: trang không bao giờ gửi ngày như vậy (dải
    // ngày bắt đầu từ hôm nay), nên đây là trang mở từ hôm qua hoặc request tự
    // chế. Service cũng chặn theo từng khung — ở đây nói gọn một câu cho cả ngày.
    if (input.date < dateKey(new Date())) {
      return { error: "Ngày này đã qua. Chọn hôm nay hoặc một ngày sắp tới giúp bạn nhé." };
    }

    // Gom các ô thành từng lượt đặt: MỘT sân + MỘT dãy giờ liền. Chọn 18:00 +
    // 18:30 sân 1 và 20:00 sân 3 là hai lượt đặt riêng.
    const ranges = slotsToRanges(input.slots);
    if (ranges.length > MAX_RANGES) {
      return {
        error: `Tối đa ${MAX_RANGES} lượt đặt một lần. Bớt vài khung rời nhau giúp bạn nhé.`,
      };
    }

    const booker = await userService.findById(ctx.actorId);
    if (!booker) return { error: "Không đọc được hồ sơ của bạn. Đăng nhập lại giúp bạn nhé." };

    // Số trong hồ sơ là nguồn chính; ô nhập chỉ dùng khi hồ sơ chưa có số.
    const phone = booker.phone ?? input.customerPhone;
    if (!phone) {
      return { error: "Cho biết số điện thoại để sân gọi được khi có việc" };
    }

    let bookings;
    try {
      // MỘT transaction cho cả lần đặt: giữ được hết hoặc không giữ gì — xem
      // `BookingService.holdCheckout`. Câu báo lỗi đã ghi rõ sân + giờ nào hỏng.
      bookings = await bookingService.holdCheckout({
        venueId: input.venueId,
        date: fromDateKey(input.date),
        ranges,
        // Vẫn ghi tên + số vào lượt đặt: nhân viên trực sân đọc DÒNG LỊCH, không
        // đi tra hồ sơ từng người. Và hồ sơ đổi tên sau này thì lượt đặt cũ vẫn
        // giữ đúng tên lúc đặt.
        customerName: booker.fullName ?? booker.email ?? "Khách",
        customerPhone: phone,
        customerNote: input.customerNote || null,
        userId: ctx.actorId,
        source: "WEB",
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      // Lỗi khác thì KHÔNG lộ ra — thông điệp của Prisma có tên bảng, tên cột
      // và cả câu truy vấn.
      throw error;
    }

    /*
     * MỞ GIAO DỊCH CHUYỂN KHOẢN NGAY TẠI ĐÂY — TRONG REQUEST POST
     *
     * Trước đây màn thanh toán tự mở giao dịch mỗi lần GET. Trình xem trước
     * link (Zalo, Messenger), bot hay lần tải lại đều GHI database chỉ bằng việc
     * mở một đường dẫn. Nay trang chỉ đọc; giao dịch mở ở đúng thao tác của
     * khách.
     *
     * Chỗ đã giữ xong rồi: mở giao dịch hỏng thì KHÔNG làm hỏng lần đặt. Trang
     * thanh toán thấy lượt thiếu giao dịch sẽ hiện nút "Tạo mã chuyển khoản".
     */
    const opened = await Promise.allSettled(
      bookings.map((booking) =>
        paymentService.start({
          bookingId: booking.id,
          provider: MANUAL_TRANSFER_PROVIDER,
          receivedBy: "VENUE",
        }),
      ),
    );

    for (const result of opened) {
      if (result.status === "rejected" && !(result.reason instanceof DomainError)) {
        logger.error("Giữ chỗ xong nhưng không mở được giao dịch chuyển khoản", result.reason, {
          bookingCode: bookings[0]!.code,
        });
      }
    }

    /*
     * LUÔN tới màn thanh toán, kể cả khi đặt nhiều lượt.
     *
     * Trước đây nhiều lượt thì đá sang "Lượt đặt của tôi", nơi mỗi lượt có nút
     * "Thanh toán" riêng: khách phải chuyển khoản N lần, và người vừa bấm "Đặt
     * sân và thanh toán" lại không thấy chỗ nào để thanh toán. Giờ các lượt mang
     * chung `checkoutCode` và màn thanh toán gộp thành MỘT lần chuyển.
     *
     * `redirect` ném một ngoại lệ đặc biệt của Next, nên phải nằm NGOÀI khối try.
     */
    redirect(`/bookings/${bookings[0]!.code}`);
  },
);
