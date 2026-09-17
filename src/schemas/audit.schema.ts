import { z } from "zod";
import { paginationSchema } from "@/schemas/common.schema";

export const listAuditLogsSchema = paginationSchema.extend({
  actorId: z.string().optional(),
  action: z.string().max(100).optional(),
  entity: z.string().max(100).optional(),
  entityId: z.string().optional(),
  /** Lọc theo khoảng thời gian, dạng ISO 8601. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;

/**
 * Tên hành động ghi vào nhật ký — DÙNG HẰNG, không viết chuỗi rời.
 *
 * Nhật ký chỉ tra cứu được khi tên nhất quán, mà `"user.ban"` với
 * `"user.banned"` thì không có gì báo lỗi cả. Bản cũ có đúng lỗi đó: web ghi
 * `"user.banned"`/`"user.unbanned"` (và ghi nhầm "tạm ngưng" thành "mở khoá")
 * trong khi API không ghi gì.
 *
 * Thêm hành động mới: thêm hằng ở đây, rồi mới gọi `auditService.record`.
 */
export const AUDIT_ACTIONS = {
  // Người dùng — do quản trị viên thao tác
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_DELETED: "user.deleted",
  /** Metadata `{ from, to }` — "mở khoá" từ BANNED khác hẳn từ INACTIVE. */
  USER_STATUS_CHANGED: "user.status_changed",
  USER_UNLOCKED: "user.unlocked",
  USER_ROLES_ASSIGNED: "user.roles_assigned",
  /** Metadata `{ permission, isGranted | cleared }` — cấp, tước, hoặc gỡ ngoại lệ. */
  USER_PERMISSION_OVERRIDDEN: "user.permission_overridden",

  // Đăng nhập và tài khoản
  /** Metadata `{ method }`: password, 2fa, passkey, oauth. */
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  /** Chỉ ghi cho tài khoản CÓ THẬT — xem `auditService.recordLoginFailure`. */
  LOGIN_FAILED: "auth.login_failed",
  PASSWORD_CHANGED: "auth.password_changed",
  PASSWORD_RESET: "auth.password_reset",
  SESSION_REVOKED: "auth.session_revoked",
  EMAIL_CHANGE_REQUESTED: "auth.email_change_requested",
  EMAIL_CHANGED: "auth.email_changed",
  PHONE_VERIFIED: "auth.phone_verified",
  TWO_FACTOR_FAILED: "auth.two_factor_failed",
  PASSKEY_REGISTERED: "auth.passkey_registered",
  PASSKEY_REMOVED: "auth.passkey_removed",
  TWO_FACTOR_ENABLED: "auth.two_factor_enabled",
  TWO_FACTOR_DISABLED: "auth.two_factor_disabled",
  TWO_FACTOR_RECOVERY_REGENERATED: "auth.two_factor_recovery_regenerated",
  REFRESH_TOKEN_REUSED: "auth.refresh_token_reused",

  // Vai trò
  ROLE_CREATED: "role.created",
  /** Metadata có `permissions` khi bảng quyền đổi — thao tác nguy hiểm nhất hệ thống. */
  ROLE_UPDATED: "role.updated",
  ROLE_DELETED: "role.deleted",

  // Nhân sự sân — `entityId` là id thành viên, `metadata.venueId` là sân
  VENUE_MEMBER_INVITED: "venue_member.invited",
  VENUE_MEMBER_PERMISSIONS_UPDATED: "venue_member.permissions_updated",
  VENUE_MEMBER_REMOVED: "venue_member.removed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});
