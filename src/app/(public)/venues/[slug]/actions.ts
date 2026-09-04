"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { definePublicAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { fromDateKey } from "@/lib/date";
import { bookingService } from "@/services/booking.service";

/**
 * Giữ chỗ từ màn đặt sân của khách.
 *
 * ---
 * CÔNG KHAI CÓ CHỦ ĐÍCH
 *
 * Khách vãng lai phải đặt được mà không cần tài khoản — bắt đăng ký trước khi
 * biết còn chỗ hay không là cách chắc chắn để mất khách. Đổi lại action này có
 * trần chống dội, vì dội nó nghĩa là khoá sạch khung giờ của một sân.
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
  customerName: z.string().trim().min(2, "Cho biết tên để sân gọi khi cần").max(80),
  customerPhone: z
    .string()
    .trim()
    .regex(/^0\d{9}$/, "Số điện thoại phải có 10 số, bắt đầu bằng 0"),
  customerNote: z.string().trim().max(300).optional(),
});

export type HoldBookingState = { error?: string; fields?: Record<string, string[]> };

export const holdBookingAction = definePublicAction(
  "Khách vãng lai phải đặt được sân mà không cần tài khoản",
  { key: "hold-booking", limit: 10, windowSeconds: 60 },
  async (ctx, _state: HoldBookingState, formData: FormData): Promise<HoldBookingState> => {
    const parsed = schema.safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return { fields: z.flattenError(parsed.error).fieldErrors };
    }

    const input = parsed.data;
    if (input.endMinute <= input.startMinute) {
      return { error: "Khung giờ không hợp lệ" };
    }

    let code: string;

    try {
      const booking = await bookingService.hold({
        venueId: input.venueId,
        courtId: input.courtId,
        date: fromDateKey(input.date),
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
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
