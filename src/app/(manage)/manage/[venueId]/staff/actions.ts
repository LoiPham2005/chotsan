"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { memberService } from "@/services/member.service";

export type StaffState = { error?: string; ok?: string };

export const inviteStaffAction = defineVenueAction(
  "member:manage",
  async (ctx, _prev: StaffState, formData: FormData): Promise<StaffState> => {
    const parsed = z
      .object({ email: z.string().trim().toLowerCase().pipe(z.email("Email không hợp lệ")) })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) return { error: "Email không hợp lệ" };

    try {
      await memberService.invite({
        venueId: ctx.venueId,
        email: parsed.data.email,
        invitedBy: ctx.actorId,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/staff`);
    return { ok: `Đã thêm ${parsed.data.email} vào sân` };
  },
);

/**
 * Lưu danh sách quyền tick thêm cho một nhân viên.
 *
 * Gửi CẢ danh sách chứ không gửi từng thay đổi: bỏ tick một ô mà chỉ gửi ô đó
 * thì server không phân biệt được "bỏ tick" với "không đụng tới".
 */
export const setStaffPermissionsAction = defineVenueAction(
  "member:manage",
  async (ctx, _prev: StaffState, formData: FormData): Promise<StaffState> => {
    const memberId = formData.get("memberId");
    if (typeof memberId !== "string" || !memberId) return { error: "Thiếu nhân sự" };

    const permissions = formData
      .getAll("permissions")
      .filter((v): v is string => typeof v === "string");

    try {
      await memberService.setPermissions({ memberId, venueId: ctx.venueId, permissions });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/staff`);
    return { ok: "Đã lưu quyền" };
  },
);

export const removeStaffAction = defineVenueAction(
  "member:manage",
  async (ctx, _prev: StaffState, formData: FormData): Promise<StaffState> => {
    const memberId = formData.get("memberId");
    if (typeof memberId !== "string" || !memberId) return { error: "Thiếu nhân sự" };

    try {
      await memberService.remove({ memberId, venueId: ctx.venueId });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    revalidatePath(`/manage/${ctx.venueId}/staff`);
    return { ok: "Đã gỡ khỏi sân" };
  },
);
