"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { defineAuthedAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { venueService } from "@/services/venue.service";

/**
 * `values`: chữ vừa gõ, trả lại KÈM LỖI — React 19 tự xoá trắng form sau mọi lần
 * action chạy xong, kể cả khi báo lỗi; mất cả hồ sơ vì gõ sai một số điện thoại
 * là lý do người ta bỏ ngang việc đăng ký.
 */
export type NewVenueState = { error?: string; values?: Record<string, string> };

const FIELDS = ["name", "sportId", "address", "ward", "province", "phone", "description"] as const;

/**
 * Đăng ký một cơ sở mới → bản nháp, người bấm là chủ.
 *
 * `defineAuthedAction`, không phải quyền riêng: ai đăng nhập cũng tự mở được cơ
 * sở CỦA MÌNH — chưa có cơ sở nào thì không thể có quyền theo sân. Chủ sở hữu
 * lấy từ PHIÊN (`ctx.actorId`), không bao giờ từ form. Chặn lạm dụng nằm ở
 * service: tối đa vài hồ sơ chưa duyệt mỗi người, và bản nháp không hiện với
 * khách cho tới khi nền tảng duyệt.
 *
 * Xong thì sang trang cài đặt của cơ sở vừa tạo — nơi có danh sách việc cần làm
 * trước khi gửi duyệt. `redirect()` NGOÀI `try` (nó ném một lỗi đặc biệt).
 */
export const createVenueAction = defineAuthedAction(
  async (ctx, _prev: NewVenueState, formData: FormData): Promise<NewVenueState> => {
    const values = Object.fromEntries(
      FIELDS.map((key) => {
        const value = formData.get(key);
        return [key, typeof value === "string" ? value : ""];
      }),
    );

    const parsed = z
      .object({
        name: z.string().trim().min(2, "Tên cơ sở quá ngắn").max(120, "Tên cơ sở tối đa 120 ký tự"),
        sportId: z.string().min(1, "Chọn môn thể thao chính của cơ sở"),
        address: z.string().trim().min(2, "Ghi số nhà, tên đường").max(200),
        ward: z.string().trim().min(1, "Ghi phường/xã").max(100),
        province: z.string().trim().min(1, "Ghi tỉnh/thành phố").max(100),
        phone: z
          .string()
          .trim()
          .regex(/^0\d{9,10}$/, "Số điện thoại gồm 10–11 chữ số, bắt đầu bằng 0"),
        description: z.string().trim().max(500, "Giới thiệu ngắn tối đa 500 ký tự"),
      })
      .safeParse(values);

    if (!parsed.success) {
      const errors = z.flattenError(parsed.error).fieldErrors;
      return {
        error: Object.values(errors).flat()[0] ?? "Kiểm tra lại thông tin giúp bạn",
        values,
      };
    }

    let venueId: string;
    try {
      const venue = await venueService.create({
        name: parsed.data.name,
        sportId: parsed.data.sportId,
        address: parsed.data.address,
        ward: parsed.data.ward,
        province: parsed.data.province,
        phone: parsed.data.phone,
        description: parsed.data.description || null,
        ownerId: ctx.actorId,
      });
      venueId = venue.id;
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message, values };
      throw error;
    }

    revalidatePath("/manage");
    redirect(`/manage/${venueId}/settings`);
  },
);
