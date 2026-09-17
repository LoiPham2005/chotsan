"use server";

import { revalidatePath } from "next/cache";
import { actionClientIp, defineAuthedAction } from "@/lib/define-action";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";
import { auditService } from "@/services/audit.service";
import { tokenService } from "@/services/token.service";

/**
 * Thu hồi một phiên đăng nhập của CHÍNH MÌNH.
 *
 * Dùng `defineAuthedAction` chứ không phải `defineAction`: đây là thao tác lên
 * dữ liệu của chính người dùng, không cần quyền quản trị nào. Nhưng vẫn phải
 * bọc — action là endpoint công khai, không bọc thì ai cũng gọi được.
 *
 * ⚠️ `sessionId` đến từ client nên tự đặt được. Ràng buộc quyền sở hữu nằm
 * TRONG câu truy vấn của `revokeById` (`where: { id, userId }`), không phải
 * một phép kiểm tra riêng ở đây — kiểm tra riêng thì có ngày ai đó thêm đường
 * gọi mới mà quên mất nó.
 */
export const revokeSessionAction = defineAuthedAction(
  async (ctx, sessionId: string): Promise<{ error?: string }> => {
    const revoked = await tokenService.revokeById(sessionId, ctx.actorId);

    if (!revoked) {
      // Không phân biệt "không tồn tại" với "của người khác" — phân biệt là
      // xác nhận cho người hỏi biết id đó có thật.
      return { error: "Không tìm thấy phiên đăng nhập này." };
    }

    logger.info("Người dùng tự thu hồi một phiên", {
      userId: ctx.actorId,
      sessionId,
    });

    // Cùng bản ghi với `DELETE /api/v1/auth/sessions/[id]` — "ai đăng xuất thiết
    // bị nào" không được phụ thuộc vào việc bấm từ web hay từ app.
    await auditService.record({
      action: AUDIT_ACTIONS.SESSION_REVOKED,
      entity: "user",
      entityId: ctx.actorId,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
      metadata: { sessionId, scope: "one_device", surface: "web" },
      ip: await actionClientIp(),
    });

    revalidatePath("/sessions");
    return {};
  },
);
