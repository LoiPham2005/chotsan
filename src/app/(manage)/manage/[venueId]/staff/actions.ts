"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionClientIp, defineVenueAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { firstIssueMessage } from "@/lib/form-errors";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { memberService } from "@/services/member.service";

/**
 * `values`: email vừa gõ, trả lại KÈM LỖI ở form mời — React 19 xoá trắng form sau
 * action kể cả khi báo lỗi ("email này chưa có tài khoản" là lỗi hay gặp nhất,
 * và người mời thường chỉ cần sửa một chữ).
 */
export type StaffState = { error?: string; ok?: string; values?: { email: string } };

export const inviteStaffAction = defineVenueAction(
  "member:manage",
  async (ctx, _prev: StaffState, formData: FormData): Promise<StaffState> => {
    const rawEmail = formData.get("email");
    const values = { email: typeof rawEmail === "string" ? rawEmail : "" };

    const parsed = z
      .object({
        email: z
          .string()
          .trim()
          .min(1, "Nhập email tài khoản ChốtSân của nhân viên")
          .toLowerCase()
          .pipe(z.email("Email chưa đúng dạng — ví dụ: ten@gmail.com")),
      })
      .safeParse(Object.fromEntries(formData));

    if (!parsed.success) {
      return { error: firstIssueMessage(parsed.error, "Kiểm tra lại email giúp bạn nhé"), values };
    }

    let member;
    try {
      member = await memberService.invite({
        venueId: ctx.venueId,
        email: parsed.data.email,
        invitedBy: ctx.actorId,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message, values };
      throw error;
    }

    await auditService.record({
      action: AUDIT_ACTIONS.VENUE_MEMBER_INVITED,
      entity: "venue_member",
      entityId: member.id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { venueId: ctx.venueId, email: parsed.data.email },
      ip: await actionClientIp(),
    });

    revalidatePath(`/manage/${ctx.venueId}/staff`);
    return { ok: `Đã thêm ${parsed.data.email} vào sân` };
  },
);

/** Trường ẩn `memberId` thiếu — trang cũ còn mở trong tab, hoặc request tự chế. */
const MISSING_MEMBER =
  "Không biết đang thao tác với nhân viên nào — tải lại trang rồi thử lại giúp bạn nhé.";

/**
 * Lưu danh sách quyền tick thêm cho một nhân viên.
 *
 * Gửi CẢ danh sách chứ không gửi từng thay đổi: bỏ tick một ô mà chỉ gửi ô đó
 * thì server không phân biệt được "bỏ tick" với "không đụng tới".
 *
 * Quyền `member:manage` ở đây mới là VÉ VÀO CỬA. Ai được sửa ai, cấp được quyền
 * nào — luật chống leo quyền — nằm ở `memberService`, nên `actorId` là bắt buộc.
 */
export const setStaffPermissionsAction = defineVenueAction(
  "member:manage",
  async (ctx, _prev: StaffState, formData: FormData): Promise<StaffState> => {
    const memberId = formData.get("memberId");
    if (typeof memberId !== "string" || !memberId) return { error: MISSING_MEMBER };

    const permissions = formData
      .getAll("permissions")
      .filter((v): v is string => typeof v === "string");

    let updated;
    try {
      updated = await memberService.setPermissions({
        memberId,
        venueId: ctx.venueId,
        permissions,
        actorId: ctx.actorId,
      });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    await auditService.record({
      action: AUDIT_ACTIONS.VENUE_MEMBER_PERMISSIONS_UPDATED,
      entity: "venue_member",
      entityId: memberId,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { venueId: ctx.venueId, permissions: updated.permissions },
      ip: await actionClientIp(),
    });

    revalidatePath(`/manage/${ctx.venueId}/staff`);
    return { ok: "Đã lưu quyền" };
  },
);

export const removeStaffAction = defineVenueAction(
  "member:manage",
  async (ctx, _prev: StaffState, formData: FormData): Promise<StaffState> => {
    const memberId = formData.get("memberId");
    if (typeof memberId !== "string" || !memberId) return { error: MISSING_MEMBER };

    try {
      await memberService.remove({ memberId, venueId: ctx.venueId, actorId: ctx.actorId });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }

    await auditService.record({
      action: AUDIT_ACTIONS.VENUE_MEMBER_REMOVED,
      entity: "venue_member",
      entityId: memberId,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { venueId: ctx.venueId },
      ip: await actionClientIp(),
    });

    revalidatePath(`/manage/${ctx.venueId}/staff`);
    return { ok: "Đã gỡ khỏi sân" };
  },
);
