"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { courtService } from "@/services/court.service";

export type CourtState = { error?: string; ok?: string };

const SURFACES = [
  "NATURAL_GRASS",
  "ARTIFICIAL_GRASS",
  "WOOD",
  "RUBBER",
  "CONCRETE",
  "CLAY",
  "EPOXY",
] as const;

/** Thêm một sân con. */
export const createCourtAction = defineVenueAction(
  "court:update",
  async (ctx, _prev: CourtState, formData: FormData): Promise<CourtState> => {
    const parsed = z
      .object({
        name: z.string().trim().min(1, "Đặt tên cho sân").max(50),
        surface: z.enum(SURFACES).optional().or(z.literal("")),
        isIndoor: z.coerce.boolean().optional(),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return {
        error: z.flattenError(parsed.error).fieldErrors.name?.[0] ?? "Dữ liệu không hợp lệ",
      };
    }

    try {
      await courtService.create({
        venueId: ctx.venueId,
        name: parsed.data.name,
        surface: parsed.data.surface === "" ? null : (parsed.data.surface ?? null),
        isIndoor: parsed.data.isIndoor ?? false,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/courts`);
    return { ok: `Đã thêm ${parsed.data.name}` };
  },
);

/**
 * Bật/tắt một sân con.
 *
 * TẮT chứ không xoá: sân đang sửa vẫn còn lịch sử đặt và doanh thu gắn với nó.
 * Xoá là mất luôn phần đó khỏi mọi báo cáo.
 */
export const toggleCourtAction = defineVenueAction(
  "court:update",
  async (ctx, _prev: CourtState, formData: FormData): Promise<CourtState> => {
    const parsed = z
      .object({ courtId: z.string().min(1), isActive: z.coerce.boolean() })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) return { error: "Thiếu thông tin sân" };

    try {
      await courtService.update(parsed.data.courtId, { isActive: parsed.data.isActive });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/courts`);
    return { ok: parsed.data.isActive ? "Đã mở bán lại sân này" : "Đã tắt sân này" };
  },
);

/**
 * Ghi lại TOÀN BỘ bảng giá.
 *
 * Thay cả bảng chứ không sửa từng dòng: giá phụ thuộc vào thứ tự ưu tiên giữa
 * các luật, nên sửa lẻ một dòng có thể đổi giá của khung giờ khác mà người sửa
 * không thấy. Gửi cả bảng thì thứ họ bấm "Lưu" đúng là thứ sẽ áp dụng.
 */
export const savePriceRulesAction = defineVenueAction(
  "pricing:update",
  async (ctx, _prev: CourtState, formData: FormData): Promise<CourtState> => {
    const raw = formData.get("rules");
    const parsed = z
      .array(
        z.object({
          courtId: z.string().nullable().optional(),
          weekdays: z.array(z.number().int().min(0).max(6)),
          startMinute: z
            .number()
            .int()
            .min(0)
            .max(24 * 60),
          endMinute: z
            .number()
            .int()
            .min(0)
            .max(24 * 60),
          pricePerSlot: z.number().int().min(0),
          isPeak: z.boolean(),
          priority: z.number().int(),
        }),
      )
      .max(50, "Tối đa 50 luật giá")
      .safeParse(typeof raw === "string" ? JSON.parse(raw) : null);

    if (!parsed.success) return { error: "Bảng giá không hợp lệ" };

    try {
      await courtService.setPriceRules(ctx.venueId, parsed.data);
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/courts`);
    revalidatePath(`/manage/${ctx.venueId}`);
    return { ok: "Đã lưu bảng giá" };
  },
);
