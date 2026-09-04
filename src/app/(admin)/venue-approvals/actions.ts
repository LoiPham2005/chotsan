"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { venueService } from "@/services/venue.service";

export type ApprovalState = { error?: string; ok?: string };

/**
 * Nền tảng duyệt hoặc từ chối một cơ sở mới.
 *
 * `defineAction("venue:approve")` — quyền TOÀN NỀN TẢNG, không gắn sân. Đây là
 * một trong số ít thao tác không dùng `defineVenueAction`: người duyệt không
 * phải thành viên của sân đó, và không được là.
 */
export const decideVenueAction = defineAction(
  "venue:approve",
  async (_ctx, _prev: ApprovalState, formData: FormData): Promise<ApprovalState> => {
    const parsed = z
      .object({
        venueId: z.string().min(1),
        decision: z.enum(["ACTIVE", "ADMIN_LOCKED"]),
        note: z.string().trim().max(300).optional(),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) return { error: "Thiếu thông tin" };

    if (parsed.data.decision === "ADMIN_LOCKED" && !parsed.data.note) {
      // Từ chối mà không nói lý do thì chủ sân chỉ còn cách gọi điện hỏi.
      return { error: "Ghi lý do từ chối để chủ sân biết phải sửa gì" };
    }

    try {
      await venueService.setStatus(parsed.data.venueId, parsed.data.decision, {
        byAdmin: true,
        inactiveNote: parsed.data.note ?? null,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath("/venue-approvals");
    return {
      ok: parsed.data.decision === "ACTIVE" ? "Đã duyệt, sân bắt đầu nhận đặt" : "Đã từ chối",
    };
  },
);
