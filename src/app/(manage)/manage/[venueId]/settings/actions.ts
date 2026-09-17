"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BANK_BINS } from "@/lib/vietqr";
import { defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { firstIssueMessage, formErrorMap } from "@/lib/form-errors";
import { venueService } from "@/services/venue.service";

/**
 * `values`: chữ vừa gõ, trả lại KÈM LỖI. React 19 tự xoá trắng form sau mọi lần
 * action chạy xong — kể cả khi báo lỗi — nên không trả lại thì chủ sân gõ sai
 * một số điện thoại là mất trắng cả hồ sơ vừa sửa.
 */
export type SettingsState = { error?: string; ok?: string; values?: Record<string, string> };

const PROFILE_FIELDS = [
  "name",
  "description",
  "address",
  "ward",
  "province",
  "phone",
  "amenities",
  "holdMinutes",
  "freeCancelHours",
  "cancelFeePercent",
] as const;

const BANK_FIELDS = ["bankName", "bankAccountNumber", "bankAccountName"] as const;

/**
 * Tên ô ĐÚNG như trên màn cài đặt — để câu lỗi nói ô nào sai ("Giữ chỗ (phút) phải
 * từ 5 trở lên") thay vì câu chung hay câu tiếng Anh mặc định của Zod.
 */
const SETTINGS_LABELS = {
  name: "Tên sân",
  description: "Giới thiệu",
  address: "Số nhà, đường",
  ward: "Phường/xã",
  province: "Tỉnh/thành",
  phone: "Điện thoại",
  amenities: "Tiện ích",
  holdMinutes: "Giữ chỗ (phút)",
  freeCancelHours: "Huỷ miễn phí trước (giờ)",
  cancelFeePercent: "Phí huỷ trễ (%)",
  bankName: "Ngân hàng",
  bankAccountNumber: "Số tài khoản",
  bankAccountName: "Chủ tài khoản",
} as const;

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

/** Đúng các ô của form, dạng chuỗi như người dùng gõ — để dựng lại form khi báo lỗi. */
function submitted(formData: FormData, keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => {
      const value = formData.get(key);
      return [key, typeof value === "string" ? value : ""];
    }),
  );
}

/**
 * Đọc một trường JSON của form. `JSON.parse` ném lỗi với chuỗi hỏng — bắt ở đây
 * để dữ liệu hỏng thành lỗi kiểm dữ liệu, không văng ra error boundary.
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

/** Hồ sơ cơ sở — tên, mô tả, địa chỉ, liên hệ, chính sách. */
export const updateVenueAction = defineVenueAction(
  "venue:update",
  async (ctx, _prev: SettingsState, formData: FormData): Promise<SettingsState> => {
    const values = submitted(formData, PROFILE_FIELDS);

    const parsed = z
      .object({
        name: z.string().trim().min(2, "Tên sân quá ngắn").max(120),
        description: z.string().trim().max(2000).optional(),
        address: z.string().trim().min(2, "Ghi số nhà, tên đường").max(200),
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
      .safeParse(Object.fromEntries(formData), { error: formErrorMap(SETTINGS_LABELS) });

    if (!parsed.success) {
      return {
        error: firstIssueMessage(parsed.error, "Kiểm tra lại hồ sơ sân giúp bạn nhé"),
        values,
      };
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
      if (error instanceof DomainError) return { error: error.message, values };
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
    const values = submitted(formData, BANK_FIELDS);

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
      .safeParse(Object.fromEntries(formData), { error: formErrorMap(SETTINGS_LABELS) });

    if (!parsed.success) {
      return {
        error: firstIssueMessage(
          parsed.error,
          "Kiểm tra lại ba ô tài khoản nhận tiền giúp bạn nhé",
        ),
        values,
      };
    }

    const input = parsed.data;
    const filled = [input.bankName, input.bankAccountNumber, input.bankAccountName].filter(Boolean);

    // Khai một nửa còn tệ hơn không khai: QR dựng ra sẽ thiếu, khách quét không
    // được, mà chủ sân thì tưởng đã xong.
    if (filled.length > 0 && filled.length < 3) {
      return { error: "Điền đủ cả ba ô, hoặc để trống cả ba", values };
    }

    try {
      await venueService.update(ctx.venueId, {
        bankName: input.bankName || null,
        bankAccountNumber: input.bankAccountNumber || null,
        bankAccountName: input.bankAccountName.toUpperCase() || null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message, values };
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
    const raw = readJson(formData, "hours");
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
      .safeParse(raw);

    if (!parsed.success) {
      // Bảng giờ dựng từ các ô chọn trên màn nên chỉ hỏng khi trang cũ còn mở
      // trong tab hoặc request tự chế. Vẫn chỉ ra NGÀY nào đọc không được nếu biết.
      const row = parsed.error.issues[0]?.path[0];
      const weekday =
        typeof row === "number" && Array.isArray(raw)
          ? (raw[row] as { weekday?: unknown } | undefined)?.weekday
          : undefined;
      const day = typeof weekday === "number" ? WEEKDAY_NAMES[weekday] : undefined;
      return {
        error: day
          ? `Không đọc được giờ mở cửa của ${day} — tải lại trang rồi chọn lại giờ giúp bạn nhé`
          : "Không đọc được bảng giờ mở cửa gửi lên — tải lại trang rồi sửa lại giúp bạn nhé",
      };
    }

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

/**
 * Gửi hồ sơ cơ sở cho nền tảng duyệt (bản nháp → chờ duyệt).
 *
 * Không nhận gì từ form: việc gì cũng làm trên CHÍNH cơ sở của URL, nơi quyền
 * vừa được kiểm. Service tự kiểm đủ giờ, sân con, bảng giá, tài khoản nhận tiền
 * — nút trên màn hình có khoá cũng không thay được phép kiểm này.
 */
export const submitForReviewAction = defineVenueAction(
  "venue:update",
  async (ctx, _prev: SettingsState, _formData: FormData): Promise<SettingsState> => {
    try {
      await venueService.setStatus(ctx.venueId, "PENDING", { actor: "owner" });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/settings`);
    revalidatePath("/manage");
    revalidatePath("/venue-approvals");
    return { ok: "Đã gửi hồ sơ. ChốtSân sẽ xem và mở bán cho bạn." };
  },
);
