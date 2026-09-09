"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { fromDateKey } from "@/lib/date";
import { bookingService } from "@/services/booking.service";
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
 * Chưa kể tiền: giữ chỗ 10 phút rồi chuyển khoản, và khi có tranh chấp thì
 * phải biết ai là người đặt. Một số điện thoại gõ vào ô trống không chứng minh
 * được gì.
 *
 * Đặt HỘ khách tại quầy vẫn giữ tên + số điện thoại rời (`source: COUNTER`) —
 * đó là luồng khác, do nhân viên sân thao tác.
 *
 * ---
 * MỌI THỨ TỪ FORM ĐỀU LÀ CHUỖI VÀ ĐỀU KHÔNG ĐÁNG TIN
 *
 * Kể cả `courtId` và khung giờ: người gọi tự đặt được, nên `hold()` phải tự
 * kiểm lại lịch trống chứ không tin dữ liệu gửi lên. Giá cũng do service tự
 * tính — form KHÔNG gửi số tiền.
 */
const schema = z.object({
  venueId: z.string().min(1),
  courtId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
  startMinute: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  endMinute: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60),
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
  customerNote: z.string().trim().max(300).optional(),
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
       * Giao diện chỉ vẽ lỗi dưới ô tên và ô số điện thoại. Nếu `venueId`,
       * `courtId`, `date` hay khung giờ sai, người dùng bấm "Đặt sân" và
       * KHÔNG CÓ GÌ XẢY RA — không lỗi, không điều hướng, nút trở lại như cũ.
       * Đã xảy ra thật: form gửi `days` trong khi schema đòi `date`, và chỉ có
       * bộ e2e phát hiện ra.
       */
      const hidden = ["venueId", "courtId", "date", "startMinute", "endMinute"] as const;
      if (hidden.some((key) => fields[key]?.length)) {
        return { error: "Chọn lại khung giờ giúp bạn nhé — dữ liệu gửi lên không hợp lệ." };
      }

      return { fields };
    }

    const input = parsed.data;
    if (input.endMinute <= input.startMinute) {
      return { error: "Khung giờ không hợp lệ" };
    }

    const nguoiDat = await userService.findById(ctx.actorId);
    if (!nguoiDat) return { error: "Không đọc được hồ sơ của bạn. Đăng nhập lại giúp bạn nhé." };

    // Số trong hồ sơ là nguồn chính; ô nhập chỉ dùng khi hồ sơ chưa có số.
    const soDienThoai = nguoiDat.phone ?? input.customerPhone;
    if (!soDienThoai) {
      return { error: "Cho biết số điện thoại để sân gọi được khi có việc" };
    }

    let code: string;

    try {
      const booking = await bookingService.hold({
        venueId: input.venueId,
        courtId: input.courtId,
        date: fromDateKey(input.date),
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        // Vẫn ghi tên + số vào lượt đặt: nhân viên trực sân đọc DÒNG LỊCH, không
        // đi tra hồ sơ từng người. Và hồ sơ đổi tên sau này thì lượt đặt cũ vẫn
        // giữ đúng tên lúc đặt.
        customerName: nguoiDat.fullName ?? nguoiDat.email ?? "Khách",
        customerPhone: soDienThoai,
        customerNote: input.customerNote ?? null,
        userId: ctx.actorId,
        source: "WEB",
      });

      code = booking.code;
    } catch (error) {
      // Lỗi nghiệp vụ đã có sẵn câu tiếng Việt viết cho người dùng cuối
      // ("Khung giờ này vừa có người đặt mất…"). Lỗi khác thì KHÔNG lộ ra —
      // thông điệp của Prisma có tên bảng, tên cột và cả câu truy vấn.
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    // `redirect` ném một ngoại lệ đặc biệt của Next, nên phải nằm NGOÀI khối
    // try — bắt nhầm nó là trang đứng im mà không ai hiểu vì sao.
    redirect(`/bookings/${code}`);
  },
);
