"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { firstIssueMessage, formErrorMap } from "@/lib/form-errors";
import { courtService } from "@/services/court.service";

/**
 * `values`: chữ vừa gõ ở form thêm sân, trả lại KÈM LỖI. React 19 tự xoá trắng
 * form sau mọi lần action chạy xong — kể cả khi báo lỗi — nên không trả lại thì
 * người dùng phải gõ lại từ đầu chỉ vì một ô sai.
 */
export type CourtState = {
  error?: string;
  ok?: string;
  values?: { name: string; surface: string; isIndoor: string };
};

const SURFACES = [
  "NATURAL_GRASS",
  "ARTIFICIAL_GRASS",
  "WOOD",
  "RUBBER",
  "CONCRETE",
  "CLAY",
  "EPOXY",
] as const;

/**
 * Đọc một trường JSON của form.
 *
 * `JSON.parse` NÉM LỖI với chuỗi hỏng; để nó ngoài `try` là một form tự chế
 * (hoặc một bản giao diện cũ còn trong tab) văng thẳng ra error boundary thay
 * vì nhận câu "không hợp lệ". Chuỗi hỏng → `null` → schema từ chối như mọi dữ
 * liệu sai khác.
 */
function readJson(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Tên ô người dùng nhìn thấy ở form thêm sân và ở từng dòng bảng giá. */
const COURT_LABELS = { name: "Tên sân", surface: "Mặt sân", isIndoor: "Trong nhà" } as const;
const PRICE_RULE_LABELS = {
  courtId: "Áp cho",
  weekdays: "Ngày áp dụng",
  startMinute: "Từ giờ",
  endMinute: "Đến giờ",
  pricePerSlot: "Giá / 30 phút",
  isPeak: "Giờ vàng",
  priority: "Ưu tiên",
} as const;

/** Thêm một sân con. */
export const createCourtAction = defineVenueAction(
  "court:update",
  async (ctx, _prev: CourtState, formData: FormData): Promise<CourtState> => {
    const text = (key: string) => {
      const value = formData.get(key);
      return typeof value === "string" ? value : "";
    };
    const values = { name: text("name"), surface: text("surface"), isIndoor: text("isIndoor") };

    const parsed = z
      .object({
        name: z.string().trim().min(1, "Đặt tên cho sân").max(50, "Tên sân tối đa 50 ký tự"),
        surface: z.enum(SURFACES).optional().or(z.literal("")),
        isIndoor: z.coerce.boolean().optional(),
      })
      .safeParse(Object.fromEntries(formData), { error: formErrorMap(COURT_LABELS) });

    if (!parsed.success) {
      return {
        error: firstIssueMessage(parsed.error, "Kiểm tra lại tên và mặt sân giúp bạn nhé"),
        values,
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
      if (error instanceof DomainError) return { error: error.message, values };
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

    if (!parsed.success) {
      // Hai ô ẨN — người dùng không sửa được, chỉ có thể do trang cũ trong tab.
      return { error: "Không biết đang bật/tắt sân nào — tải lại trang rồi bấm lại giúp bạn nhé." };
    }

    try {
      // `venueId`: sân con phải thuộc đúng cơ sở mà người bấm có quyền.
      await courtService.update(
        parsed.data.courtId,
        { isActive: parsed.data.isActive },
        { venueId: ctx.venueId },
      );
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/courts`);
    return { ok: parsed.data.isActive ? "Đã mở bán lại sân này" : "Đã tắt sân này" };
  },
);

/**
 * Câu lỗi của bảng giá, CHỈ RA LUẬT NÀO sai: "Luật 3: Giá / 30 phút phải từ 0 trở
 * lên". Bảng có tới 50 dòng — "bảng giá không hợp lệ" là bắt chủ sân dò từng dòng.
 *
 * Lỗi không gắn được với dòng nào (JSON hỏng, không phải danh sách) chỉ đến từ
 * trang cũ còn mở trong tab hoặc request tự chế — nói thẳng cách sửa là tải lại.
 */
function priceRulesError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Chưa lưu được bảng giá — tải lại trang rồi thử lại giúp bạn nhé";

  const [row] = issue.path;
  if (typeof row === "number") return `Luật ${row + 1}: ${issue.message}`;
  if (issue.code === "too_big") return issue.message;
  return "Không đọc được bảng giá gửi lên — tải lại trang rồi sửa lại giúp bạn nhé";
}

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
      .safeParse(readJson(formData, "rules"), { error: formErrorMap(PRICE_RULE_LABELS) });

    if (!parsed.success) return { error: priceRulesError(parsed.error) };

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
