"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BANK_BINS } from "@/lib/vietqr";
import { defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { venueService } from "@/services/venue.service";

export type SettingsState = { error?: string; ok?: string };

/** Hồ sơ cơ sở — tên, mô tả, địa chỉ, liên hệ, chính sách. */
export const updateVenueAction = defineVenueAction(
  "venue:update",
  async (ctx, _prev: SettingsState, formData: FormData): Promise<SettingsState> => {
    const parsed = z
      .object({
        name: z.string().trim().min(2, "Tên sân quá ngắn").max(120),
        description: z.string().trim().max(2000).optional(),
        address: z.string().trim().min(2).max(200),
        ward: z.string().trim().min(1, "Chọn phường/xã").max(100),
        province: z.string().trim().min(1, "Chọn tỉnh/thành").max(100),
        phone: z
          .string()
          .trim()
          .regex(/^0\d{9,10}$/, "Số điện thoại 10–11 số")
          .optional()
          .or(z.literal("")),
        amenities: z.string().trim().max(500).optional(),
        holdMinutes: z.coerce.number().int().min(5).max(120),
        freeCancelHours: z.coerce.number().int().min(0).max(168),
        cancelFeePercent: z.coerce.number().int().min(0).max(100),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      const errors = z.flattenError(parsed.error).fieldErrors;
      return { error: Object.values(errors).flat()[0] ?? "Dữ liệu không hợp lệ" };
    }

    const input = parsed.data;

    try {
      await venueService.update(ctx.venueId, {
        name: input.name,
        description: input.description || null,
        address: input.address,
        ward: input.ward,
        province: input.province,
        phone: input.phone || null,
        // Tiện ích nhập bằng dấu phẩy — bỏ khoảng trắng thừa và mục rỗng, nếu
        // không "Wifi, , Bãi xe" sẽ đẻ ra một tiện ích tên rỗng trên trang khách.
        amenities: (input.amenities ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        holdMinutes: input.holdMinutes,
        freeCancelHours: input.freeCancelHours,
        cancelFeePercent: input.cancelFeePercent,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/settings`);
    revalidatePath(`/manage/${ctx.venueId}`);
    return { ok: "Đã lưu hồ sơ sân" };
  },
);

/**
 * Tài khoản nhận tiền.
 *
 * ---
 * SAI MỘT SỐ Ở ĐÂY LÀ TIỀN VÀO TÀI KHOẢN NGƯỜI KHÁC
 *
 * Mã QR VietQR dựng từ đúng ba giá trị này. Nên chúng được kiểm chặt: ngân hàng
 * phải nằm trong danh sách BIN đã biết, số tài khoản chỉ gồm chữ số, tên chủ
 * tài khoản viết HOA không dấu — đúng dạng ngân hàng trả về khi đối chiếu.
 */
export const updateBankAction = defineVenueAction(
  "venue:update",
  async (ctx, _prev: SettingsState, formData: FormData): Promise<SettingsState> => {
    const parsed = z
      .object({
        bankName: z
          .string()
          .trim()
          .refine((v) => v === "" || v in BANK_BINS, "Chọn ngân hàng trong danh sách"),
        bankAccountNumber: z
          .string()
          .trim()
          .regex(/^$|^\d{4,19}$/, "Số tài khoản chỉ gồm chữ số"),
        bankAccountName: z.string().trim().max(100),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return {
        error: Object.values(z.flattenError(parsed.error).fieldErrors).flat()[0] ?? "Sai định dạng",
      };
    }

    const input = parsed.data;
    const filled = [input.bankName, input.bankAccountNumber, input.bankAccountName].filter(Boolean);

    // Khai một nửa còn tệ hơn không khai: QR dựng ra sẽ thiếu, khách quét không
    // được, mà chủ sân thì tưởng đã xong.
    if (filled.length > 0 && filled.length < 3) {
      return { error: "Điền đủ cả ba ô, hoặc để trống cả ba" };
    }

    try {
      await venueService.update(ctx.venueId, {
        bankName: input.bankName || null,
        bankAccountNumber: input.bankAccountNumber || null,
        bankAccountName: input.bankAccountName.toUpperCase() || null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/settings`);
    return { ok: "Đã lưu tài khoản nhận tiền" };
  },
);

/** Giờ mở cửa bảy ngày. Gửi cả tuần một lần. */
export const updateHoursAction = defineVenueAction(
  "venue:update",
  async (ctx, _prev: SettingsState, formData: FormData): Promise<SettingsState> => {
    const raw = formData.get("hours");
    const parsed = z
      .array(
        z.object({
          weekday: z.number().int().min(0).max(6),
          openMinute: z
            .number()
            .int()
            .min(0)
            .max(24 * 60),
          closeMinute: z
            .number()
            .int()
            .min(0)
            .max(24 * 60),
          isClosed: z.boolean(),
        }),
      )
      .length(7, "Phải khai đủ bảy ngày")
      .safeParse(typeof raw === "string" ? JSON.parse(raw) : null);

    if (!parsed.success) return { error: "Giờ mở cửa không hợp lệ" };

    try {
      await venueService.setHours(ctx.venueId, parsed.data);
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/settings`);
    revalidatePath(`/manage/${ctx.venueId}`);
    return { ok: "Đã lưu giờ mở cửa" };
  },
);
