"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { venueService } from "@/services/venue.service";

/**
 * `note` đi kèm khi báo lỗi: React 19 tự xoá trắng form sau MỌI lần action
 * chạy xong, kể cả khi báo lỗi — trả lại lý do vừa gõ để ô nhập dựng lại đúng
 * chữ đó, người duyệt không phải gõ lại cả câu.
 */
export type ApprovalState = { error?: string; ok?: string; note?: string };

/**
 * Nền tảng duyệt hoặc TRẢ VỀ một cơ sở mới.
 *
 * `defineAction("venue:approve")` — quyền TOÀN NỀN TẢNG, không gắn sân. Đây là
 * một trong số ít thao tác không dùng `defineVenueAction`: người duyệt không
 * phải thành viên của sân đó, và không được là.
 *
 * Từ chối = trả hồ sơ về BẢN NHÁP kèm lý do, không phải khoá (`ADMIN_LOCKED`):
 * chủ sân sửa theo lý do rồi gửi duyệt lại được; khoá là hình phạt vi phạm.
 */
export const decideVenueAction = defineAction(
  "venue:approve",
  async (_ctx, _prev: ApprovalState, formData: FormData): Promise<ApprovalState> => {
    const rawNote = formData.get("note");
    const note = typeof rawNote === "string" ? rawNote : "";

    const parsed = z
      .object({
        venueId: z.string().min(1),
        decision: z.enum(["ACTIVE", "DRAFT"]),
        note: z.string().trim().max(300, "Lý do tối đa 300 ký tự").optional(),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return {
        // `note` là ô duy nhất người duyệt gõ; `venueId`/`decision` là ô ẨN — sai
        // thì chỉ có thể do trang cũ còn mở trong tab, nói thẳng cách sửa.
        error:
          z.flattenError(parsed.error).fieldErrors.note?.[0] ??
          "Không biết đang duyệt cơ sở nào — tải lại trang rồi bấm lại giúp bạn nhé.",
        note,
      };
    }

    if (parsed.data.decision === "DRAFT" && !parsed.data.note) {
      // Trả hồ sơ mà không nói lý do thì chủ sân chỉ còn cách gọi điện hỏi.
      return { error: "Ghi lý do trả hồ sơ để chủ sân biết phải sửa gì", note };
    }

    try {
      await venueService.setStatus(parsed.data.venueId, parsed.data.decision, {
        actor: "admin",
        inactiveNote: parsed.data.note ?? null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message, note };
      throw error;
    }

    revalidatePath("/venue-approvals");
    return {
      ok:
        parsed.data.decision === "ACTIVE"
          ? "Đã duyệt, sân bắt đầu nhận đặt"
          : "Đã trả hồ sơ về cho chủ sân sửa",
    };
  },
);
