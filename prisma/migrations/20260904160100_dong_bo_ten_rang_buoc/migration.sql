-- Đổi tên ràng buộc và index cho khớp tên cột mới.
--
-- `RENAME COLUMN` ở migration trước giữ nguyên dữ liệu và tự cập nhật ĐỊNH
-- NGHĨA của mọi index/khoá ngoại, nhưng KHÔNG đổi TÊN chúng — nên còn lại
-- những cái tên như `oauth_accounts_userId_fkey` trỏ tới cột `user_id`.
--
-- Không chỉ là chuyện gọn gàng: tên ràng buộc đi vào thông điệp lỗi của
-- Postgres, và `src/lib/prisma-errors.ts` DÒ THEO TÊN đó để dịch lỗi trùng
-- khoá thành lỗi nghiệp vụ. Tên nói dối về cột nào là chỗ dò nhầm chờ sẵn.
--
-- ⚠️ Prisma còn sinh thêm DROP INDEX cho venues_name_trgm_idx và
-- venues_address_trgm_idx — ĐÃ BỎ. Xem GOTCHAS #11.
--
-- 49 lệnh đổi tên, không có lệnh nào xoá cột hay bảng.

-- RenameForeignKey
ALTER TABLE "notification_recipients" RENAME CONSTRAINT "notification_recipients_notificationId_fkey" TO "notification_recipients_notification_id_fkey";

-- RenameForeignKey
ALTER TABLE "notification_recipients" RENAME CONSTRAINT "notification_recipients_userId_fkey" TO "notification_recipients_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "oauth_accounts" RENAME CONSTRAINT "oauth_accounts_userId_fkey" TO "oauth_accounts_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "recovery_codes" RENAME CONSTRAINT "recovery_codes_userId_fkey" TO "recovery_codes_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "refresh_tokens_deviceId_fkey" TO "refresh_tokens_device_id_fkey";

-- RenameForeignKey
ALTER TABLE "refresh_tokens" RENAME CONSTRAINT "refresh_tokens_userId_fkey" TO "refresh_tokens_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "role_permissions" RENAME CONSTRAINT "role_permissions_permissionId_fkey" TO "role_permissions_permission_id_fkey";

-- RenameForeignKey
ALTER TABLE "role_permissions" RENAME CONSTRAINT "role_permissions_roleId_fkey" TO "role_permissions_role_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_devices" RENAME CONSTRAINT "user_devices_userId_fkey" TO "user_devices_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_permissions" RENAME CONSTRAINT "user_permissions_permissionId_fkey" TO "user_permissions_permission_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_permissions" RENAME CONSTRAINT "user_permissions_userId_fkey" TO "user_permissions_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_profiles" RENAME CONSTRAINT "user_profiles_userId_fkey" TO "user_profiles_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_roles" RENAME CONSTRAINT "user_roles_roleId_fkey" TO "user_roles_role_id_fkey";

-- RenameForeignKey
ALTER TABLE "user_roles" RENAME CONSTRAINT "user_roles_userId_fkey" TO "user_roles_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "verification_tokens" RENAME CONSTRAINT "verification_tokens_userId_fkey" TO "verification_tokens_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "webauthn_credentials" RENAME CONSTRAINT "webauthn_credentials_userId_fkey" TO "webauthn_credentials_user_id_fkey";

-- RenameIndex
ALTER INDEX "audit_logs_action_createdAt_idx" RENAME TO "audit_logs_action_created_at_idx";

-- RenameIndex
ALTER INDEX "audit_logs_actorId_createdAt_idx" RENAME TO "audit_logs_actor_id_created_at_idx";

-- RenameIndex
ALTER INDEX "audit_logs_createdAt_idx" RENAME TO "audit_logs_created_at_idx";

-- RenameIndex
ALTER INDEX "audit_logs_entity_entityId_idx" RENAME TO "audit_logs_entity_entity_id_idx";

-- RenameIndex
ALTER INDEX "disputes_status_createdAt_idx" RENAME TO "disputes_status_created_at_idx";

-- RenameIndex
ALTER INDEX "notification_recipients_notificationId_userId_key" RENAME TO "notification_recipients_notification_id_user_id_key";

-- RenameIndex
ALTER INDEX "notification_recipients_userId_createdAt_idx" RENAME TO "notification_recipients_user_id_created_at_idx";

-- RenameIndex
ALTER INDEX "notification_recipients_userId_isRead_idx" RENAME TO "notification_recipients_user_id_is_read_idx";

-- RenameIndex
ALTER INDEX "notifications_type_createdAt_idx" RENAME TO "notifications_type_created_at_idx";

-- RenameIndex
ALTER INDEX "oauth_accounts_provider_providerAccountId_key" RENAME TO "oauth_accounts_provider_provider_account_id_key";

-- RenameIndex
ALTER INDEX "oauth_accounts_userId_idx" RENAME TO "oauth_accounts_user_id_idx";

-- RenameIndex
ALTER INDEX "payments_status_createdAt_idx" RENAME TO "payments_status_created_at_idx";

-- RenameIndex
ALTER INDEX "recovery_codes_userId_codeHash_key" RENAME TO "recovery_codes_user_id_code_hash_key";

-- RenameIndex
ALTER INDEX "recovery_codes_userId_idx" RENAME TO "recovery_codes_user_id_idx";

-- RenameIndex
ALTER INDEX "refresh_tokens_expiresAt_idx" RENAME TO "refresh_tokens_expires_at_idx";

-- RenameIndex
ALTER INDEX "refresh_tokens_familyId_idx" RENAME TO "refresh_tokens_family_id_idx";

-- RenameIndex
ALTER INDEX "refresh_tokens_tokenHash_key" RENAME TO "refresh_tokens_token_hash_key";

-- RenameIndex
ALTER INDEX "refresh_tokens_userId_idx" RENAME TO "refresh_tokens_user_id_idx";

-- RenameIndex
ALTER INDEX "refunds_status_createdAt_idx" RENAME TO "refunds_status_created_at_idx";

-- RenameIndex
ALTER INDEX "reviews_venue_id_is_hidden_createdAt_idx" RENAME TO "reviews_venue_id_is_hidden_created_at_idx";

-- RenameIndex
ALTER INDEX "role_permissions_permissionId_idx" RENAME TO "role_permissions_permission_id_idx";

-- RenameIndex
ALTER INDEX "user_devices_fcmToken_key" RENAME TO "user_devices_fcm_token_key";

-- RenameIndex
ALTER INDEX "user_devices_userId_idx" RENAME TO "user_devices_user_id_idx";

-- RenameIndex
ALTER INDEX "user_permissions_expiresAt_idx" RENAME TO "user_permissions_expires_at_idx";

-- RenameIndex
ALTER INDEX "user_permissions_permissionId_idx" RENAME TO "user_permissions_permission_id_idx";

-- RenameIndex
ALTER INDEX "user_profiles_userId_key" RENAME TO "user_profiles_user_id_key";

-- RenameIndex
ALTER INDEX "user_roles_roleId_idx" RENAME TO "user_roles_role_id_idx";

-- RenameIndex
ALTER INDEX "users_deletedAt_createdAt_idx" RENAME TO "users_deleted_at_created_at_idx";

-- RenameIndex
ALTER INDEX "verification_tokens_expiresAt_idx" RENAME TO "verification_tokens_expires_at_idx";

-- RenameIndex
ALTER INDEX "verification_tokens_tokenHash_key" RENAME TO "verification_tokens_token_hash_key";

-- RenameIndex
ALTER INDEX "verification_tokens_userId_type_idx" RENAME TO "verification_tokens_user_id_type_idx";

-- RenameIndex
ALTER INDEX "webauthn_credentials_credentialId_key" RENAME TO "webauthn_credentials_credential_id_key";

-- RenameIndex
ALTER INDEX "webauthn_credentials_userId_idx" RENAME TO "webauthn_credentials_user_id_idx";
