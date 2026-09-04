-- Đồng bộ tên cột: mọi cột về snake_case.
--
-- Trước migration này database lẫn hai lối đặt tên, và lẫn NGAY TRONG CÙNG MỘT
-- BẢNG: `bookings` có `cancelled_by`, `cancel_reason`, `hold_expires_at` nằm
-- cạnh `createdAt` và `updatedAt`. Không có quy tắc nào để nhớ.
--
-- Vì sao đáng sửa, chứ không phải chuyện thẩm mỹ:
--
--   Postgres HẠ CHỮ THƯỜNG mọi định danh không đặt trong nháy kép. Nghĩa là
--   `SELECT createdAt FROM bookings` báo lỗi `column "createdat" does not
--   exist`, phải viết `SELECT "createdAt"`. Dự án này viết SQL tay ở nhiều
--   chỗ — migration có CHECK/EXCLUDE/partial index, và scripts/kiem-tra-*.ts.
--   Mỗi chỗ đó là một lần nhớ đúng hay quên; snake_case thì không phải nhớ.
--
-- ⚠️ DÙNG `RENAME COLUMN`, KHÔNG PHẢI DROP + ADD.
--
-- `prisma migrate diff` sinh ra DROP rồi ADD cho việc này, và nó XOÁ SẠCH DỮ
-- LIỆU của 116 cột. RENAME giữ nguyên dữ liệu, và Postgres tự cập nhật
-- mọi index, ràng buộc, khoá ngoại trỏ tới cột đó.
--
-- Tên phía Prisma KHÔNG đổi (`createdAt` vẫn là `createdAt` trong TypeScript),
-- nên không dòng code nào phải sửa — chỉ có `@map` được thêm vào schema.
--
-- 116 cột, 36 bảng.

-- audit_logs
ALTER TABLE "audit_logs" RENAME COLUMN "actorId" TO "actor_id";
ALTER TABLE "audit_logs" RENAME COLUMN "actorEmail" TO "actor_email";
ALTER TABLE "audit_logs" RENAME COLUMN "entityId" TO "entity_id";
ALTER TABLE "audit_logs" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "audit_logs" RENAME COLUMN "createdAt" TO "created_at";

-- bookings
ALTER TABLE "bookings" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "bookings" RENAME COLUMN "updatedAt" TO "updated_at";

-- court_closures
ALTER TABLE "court_closures" RENAME COLUMN "createdAt" TO "created_at";

-- courts
ALTER TABLE "courts" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "courts" RENAME COLUMN "updatedAt" TO "updated_at";

-- disputes
ALTER TABLE "disputes" RENAME COLUMN "createdAt" TO "created_at";

-- favorites
ALTER TABLE "favorites" RENAME COLUMN "createdAt" TO "created_at";

-- notification_recipients
ALTER TABLE "notification_recipients" RENAME COLUMN "notificationId" TO "notification_id";
ALTER TABLE "notification_recipients" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "notification_recipients" RENAME COLUMN "isRead" TO "is_read";
ALTER TABLE "notification_recipients" RENAME COLUMN "readAt" TO "read_at";
ALTER TABLE "notification_recipients" RENAME COLUMN "isPushed" TO "is_pushed";
ALTER TABLE "notification_recipients" RENAME COLUMN "pushedAt" TO "pushed_at";
ALTER TABLE "notification_recipients" RENAME COLUMN "createdAt" TO "created_at";

-- notifications
ALTER TABLE "notifications" RENAME COLUMN "imageUrl" TO "image_url";
ALTER TABLE "notifications" RENAME COLUMN "actionUrl" TO "action_url";
ALTER TABLE "notifications" RENAME COLUMN "senderId" TO "sender_id";
ALTER TABLE "notifications" RENAME COLUMN "createdAt" TO "created_at";

-- oauth_accounts
ALTER TABLE "oauth_accounts" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "oauth_accounts" RENAME COLUMN "providerAccountId" TO "provider_account_id";
ALTER TABLE "oauth_accounts" RENAME COLUMN "createdAt" TO "created_at";

-- owner_earnings
ALTER TABLE "owner_earnings" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "owner_earnings" RENAME COLUMN "updatedAt" TO "updated_at";

-- payment_events
ALTER TABLE "payment_events" RENAME COLUMN "createdAt" TO "created_at";

-- payments
ALTER TABLE "payments" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "payments" RENAME COLUMN "updatedAt" TO "updated_at";

-- payouts
ALTER TABLE "payouts" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "payouts" RENAME COLUMN "updatedAt" TO "updated_at";

-- permissions
ALTER TABLE "permissions" RENAME COLUMN "createdAt" TO "created_at";

-- price_overrides
ALTER TABLE "price_overrides" RENAME COLUMN "createdAt" TO "created_at";

-- price_rules
ALTER TABLE "price_rules" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "price_rules" RENAME COLUMN "updatedAt" TO "updated_at";

-- recovery_codes
ALTER TABLE "recovery_codes" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "recovery_codes" RENAME COLUMN "codeHash" TO "code_hash";
ALTER TABLE "recovery_codes" RENAME COLUMN "usedAt" TO "used_at";
ALTER TABLE "recovery_codes" RENAME COLUMN "createdAt" TO "created_at";

-- refresh_tokens
ALTER TABLE "refresh_tokens" RENAME COLUMN "familyId" TO "family_id";
ALTER TABLE "refresh_tokens" RENAME COLUMN "tokenHash" TO "token_hash";
ALTER TABLE "refresh_tokens" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "refresh_tokens" RENAME COLUMN "deviceId" TO "device_id";
ALTER TABLE "refresh_tokens" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "refresh_tokens" RENAME COLUMN "twoFactorAt" TO "two_factor_at";
ALTER TABLE "refresh_tokens" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "refresh_tokens" RENAME COLUMN "revokedAt" TO "revoked_at";
ALTER TABLE "refresh_tokens" RENAME COLUMN "createdAt" TO "created_at";

-- refunds
ALTER TABLE "refunds" RENAME COLUMN "createdAt" TO "created_at";

-- reviews
ALTER TABLE "reviews" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "reviews" RENAME COLUMN "updatedAt" TO "updated_at";

-- role_permissions
ALTER TABLE "role_permissions" RENAME COLUMN "roleId" TO "role_id";
ALTER TABLE "role_permissions" RENAME COLUMN "permissionId" TO "permission_id";
ALTER TABLE "role_permissions" RENAME COLUMN "createdAt" TO "created_at";

-- roles
ALTER TABLE "roles" RENAME COLUMN "isSystem" TO "is_system";
ALTER TABLE "roles" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "roles" RENAME COLUMN "updatedAt" TO "updated_at";

-- settings
ALTER TABLE "settings" RENAME COLUMN "updatedAt" TO "updated_at";

-- sports
ALTER TABLE "sports" RENAME COLUMN "createdAt" TO "created_at";

-- user_devices
ALTER TABLE "user_devices" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "user_devices" RENAME COLUMN "fcmToken" TO "fcm_token";
ALTER TABLE "user_devices" RENAME COLUMN "deviceId" TO "device_id";
ALTER TABLE "user_devices" RENAME COLUMN "deviceName" TO "device_name";
ALTER TABLE "user_devices" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "user_devices" RENAME COLUMN "lastSeenAt" TO "last_seen_at";
ALTER TABLE "user_devices" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "user_devices" RENAME COLUMN "updatedAt" TO "updated_at";

-- user_permissions
ALTER TABLE "user_permissions" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "user_permissions" RENAME COLUMN "permissionId" TO "permission_id";
ALTER TABLE "user_permissions" RENAME COLUMN "isGranted" TO "is_granted";
ALTER TABLE "user_permissions" RENAME COLUMN "grantedBy" TO "granted_by";
ALTER TABLE "user_permissions" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "user_permissions" RENAME COLUMN "createdAt" TO "created_at";

-- user_profiles
ALTER TABLE "user_profiles" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "user_profiles" RENAME COLUMN "fullName" TO "full_name";
ALTER TABLE "user_profiles" RENAME COLUMN "avatarUrl" TO "avatar_url";
ALTER TABLE "user_profiles" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "user_profiles" RENAME COLUMN "updatedAt" TO "updated_at";

-- user_roles
ALTER TABLE "user_roles" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "user_roles" RENAME COLUMN "roleId" TO "role_id";
ALTER TABLE "user_roles" RENAME COLUMN "assignedBy" TO "assigned_by";
ALTER TABLE "user_roles" RENAME COLUMN "createdAt" TO "created_at";

-- users
ALTER TABLE "users" RENAME COLUMN "emailVerifiedAt" TO "email_verified_at";
ALTER TABLE "users" RENAME COLUMN "phoneVerifiedAt" TO "phone_verified_at";
ALTER TABLE "users" RENAME COLUMN "pendingEmail" TO "pending_email";
ALTER TABLE "users" RENAME COLUMN "passwordChangedAt" TO "password_changed_at";
ALTER TABLE "users" RENAME COLUMN "failedLoginAttempts" TO "failed_login_attempts";
ALTER TABLE "users" RENAME COLUMN "lockedUntil" TO "locked_until";
ALTER TABLE "users" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "users" RENAME COLUMN "twoFactorSecret" TO "two_factor_secret";
ALTER TABLE "users" RENAME COLUMN "twoFactorEnabledAt" TO "two_factor_enabled_at";
ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at";

-- venue_images
ALTER TABLE "venue_images" RENAME COLUMN "createdAt" TO "created_at";

-- venue_members
ALTER TABLE "venue_members" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "venue_members" RENAME COLUMN "updatedAt" TO "updated_at";

-- venues
ALTER TABLE "venues" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "venues" RENAME COLUMN "updatedAt" TO "updated_at";

-- verification_tokens
ALTER TABLE "verification_tokens" RENAME COLUMN "tokenHash" TO "token_hash";
ALTER TABLE "verification_tokens" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "verification_tokens" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "verification_tokens" RENAME COLUMN "usedAt" TO "used_at";
ALTER TABLE "verification_tokens" RENAME COLUMN "createdAt" TO "created_at";

-- voucher_redemptions
ALTER TABLE "voucher_redemptions" RENAME COLUMN "createdAt" TO "created_at";

-- vouchers
ALTER TABLE "vouchers" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "vouchers" RENAME COLUMN "updatedAt" TO "updated_at";

-- webauthn_credentials
ALTER TABLE "webauthn_credentials" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "webauthn_credentials" RENAME COLUMN "credentialId" TO "credential_id";
ALTER TABLE "webauthn_credentials" RENAME COLUMN "publicKey" TO "public_key";
ALTER TABLE "webauthn_credentials" RENAME COLUMN "deviceType" TO "device_type";
ALTER TABLE "webauthn_credentials" RENAME COLUMN "backedUp" TO "backed_up";
ALTER TABLE "webauthn_credentials" RENAME COLUMN "lastUsedAt" TO "last_used_at";
ALTER TABLE "webauthn_credentials" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "webauthn_credentials" RENAME COLUMN "updatedAt" TO "updated_at";
