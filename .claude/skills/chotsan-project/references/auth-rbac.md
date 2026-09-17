# Xác thực, phân quyền, bảo mật

> Nguồn: đọc hết ~130 tệp auth/RBAC (17/09/2026), cập nhật lại sau đợt sửa lỗi lớn cùng ngày (thu
> hồi phiên, chốt level, OAuth, 2FA, rate limit…). Mã đổi thì tìm theo tên hàm, đừng tin số dòng. Ở
> §14, mục có ✅ là đã đối chiếu lại mã; còn lại là suy ra từ mã, chưa chạy thử.

## 0. Mười điều phải nhớ trước khi đụng vào auth

1. **Quyền luôn tra DB theo `userId`** qua `permissionService` (cache 60 giây). `roles` trong JWT
   chỉ để tham khảo, không bao giờ dùng để quyết định.
2. **Chỉ 3 vai trò nền tảng** nằm trong bảng `roles`: `USER`, `ADMIN`, `SUPER_ADMIN`. OWNER/STAFF
   là `VenueMember.role`, không phải dòng trong `roles`. Không có MANAGER. Câu hỏi theo sân chỉ
   có một dạng: `canOnVenue(userId, permission, venueId)`.
3. **Mọi Server Action bọc wrapper** (`defineAction` / `defineVenueAction` / `defineAuthedAction`
   / `definePublicAction`). Chỉ luồng đăng nhập công khai trong `(auth)`, `passkey-actions.ts`,
   `logout-action.ts` được viết trần và tự rate limit (`rateLimitAction`).
4. **Mọi route `/api/**` tự gọi guard.** Proxy cố ý không chạy trên `/api`.
5. **Mã lỗi khi thiếu quyền**: web → 404 (`notFound()`); API quyền toàn cục → 403; tài nguyên theo
   sân hoặc của người khác → 404; Server Action → chuỗi `error`.
6. **Id đến từ form/URL phải nằm trong `where`** cùng `venueId` hoặc `userId`; lệch thì NOT_FOUND
   (GOTCHAS #19).
7. **Mọi `next` đi qua `safeRedirectPath`**; route handler redirect bằng `redirectRelative`
   (GOTCHAS #16).
8. **Web đăng xuất bằng Server Action** `src/app/logout-action.ts`, không gọi
   `/api/v1/auth/logout` (GOTCHAS #14).
9. **Hàm ghi user/role/member BẮT BUỘC `actorId: string | null`** (kiểu `ActorOptions`, không còn
   tuỳ chọn). Truyền id người thao tác thật; `null` chỉ cho seed/script/job. Ghi bảng thẩm quyền
   xong phải `invalidateUser`/`invalidateAll`; đổi mật khẩu/trạng thái/xoá phải
   `securityStampService.invalidate`.
10. **Phiên thu hồi được từ server**: `getSession`, `getApiSession` và handshake realtime đều hỏi
    `securityStampService.isTokenStillValid(sub, iat)`. Khoá/xoá/đổi mật khẩu cắt phiên cũ ở
    request kế tiếp (cache ảnh phiên ≤60 giây). Proxy thì chỉ kiểm chữ ký — không phải ranh giới.

---

## 1. Bản đồ tệp

### 1.1 `src/lib`

| Tệp                | Vai trò                                                                   | Export đáng nhớ                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.ts`          | Danh tính cho web (đọc cookie)                                            | `getSession` (bọc `cache()`, verify JWT + kiểm security stamp), `getCurrentUser`, `requireUser(returnTo?)`, `requirePermission`, `requireVenueAccess(venueId, permission, returnTo?)`, `hasRevokedSessionCookie`, `createSession`, `destroySession`                  |
| `session.ts`       | Ký/verify JWT HS256, dùng chung web, mobile, proxy, realtime              | `SESSION_COOKIE_NAME = "session"`, `CURRENT_PATH_HEADER = "x-pathname"`, `signSession`, `verifySession`, `sessionCookieOptions`, `SessionPayload`                                                                                                                    |
| `tickets.ts`       | "Vé" JWT ngắn hạn, không phải phiên; mỗi vé có `jti`, dùng một lần        | `issueTwoFactorTicket`, `issueWebAuthnTicket`, `verifyTicket` (chỉ đọc), `consumeTicket` (tiêu vé qua `claimOnce`)                                                                                                                                                   |
| `totp.ts`          | TOTP (otpauth: SHA1, 6 số, 30 giây, cửa sổ ±1)                            | `createTotpSecret`, `verifyTotp`, `totpTimeStep`                                                                                                                                                                                                                     |
| `permissions.ts`   | Danh mục quyền (trong code) + gán mặc định                                | `PERMISSIONS`, `VENUE_STAFF_DEFAULT`, `VENUE_STAFF_GRANTABLE`, `VENUE_OWNER_ONLY`, `VENUE_SCOPED_PERMISSIONS`, `isVenueScopedPermission`, `isKnownPermission`, `SYSTEM_ROLES`, `DEFAULT_ROLE_PERMISSIONS`, `PERMISSION_METADATA`, `resolveSeedPermissions`           |
| `define-action.ts` | Wrapper Server Action + rate limit cho action viết trần                   | `defineAction`, `defineAuthedAction`, `definePublicAction`, `defineVenueAction`, `actionClientIp`, `rateLimitAction`                                                                                                                                                 |
| `safe-redirect.ts` | `safeRedirectPath(value, fallback)`: parse bằng `URL`, chặn mọi biến thể  | — (§8)                                                                                                                                                                                                                                                               |
| `landing.ts`       | `landingPathFor(userId)`: đích sau đăng nhập                              | —                                                                                                                                                                                                                                                                    |
| `api/auth.ts`      | Guard REST                                                                | `getApiSession` (Bearer trước, fallback cookie, cùng kiểm stamp), `requireApiUser`, `requireApiPermission`, `requireVenuePermission` (**chưa ai dùng**), `enforceRateLimit(request, bucket, options)`, `clientIp`                                                    |
| `api/tokens.ts`    | Cặp token mobile                                                          | `issueTokenPair`, `TokenPair`                                                                                                                                                                                                                                        |
| `api/redirect.ts`  | `redirectRelative(path, status = 303)`                                    | —                                                                                                                                                                                                                                                                    |
| `oauth/*`          | OAuth tự viết (không dùng `arctic`)                                       | `types.ts` (`OAUTH_PROVIDERS`), `config.ts` (`redirect_uri` = `appUrl(apiPath(...))`), `client.ts`, `profile.ts`, `pkce.ts`, `flow-cookie.ts` (cookie `oauth_flow`), `two-factor-cookie.ts` (cookie `oauth_2fa`), `apple-client-secret.ts`. Lớp lỗi ở `@/lib/errors` |
| `rate-limit.ts`    | Rate limit + đánh dấu dùng một lần                                        | `RATE_LIMITS`, `RATE_LIMIT_BUCKETS`, `ipRateLimitKey`, `clientIpFromHeaders`, `rateLimit`, `resetRateLimit`, `claimOnce` (tất cả async)                                                                                                                              |
| `errors.ts`        | Lớp `DomainError` (nguồn DUY NHẤT, kể cả lỗi OAuth), `assertLoginAllowed` | —                                                                                                                                                                                                                                                                    |
| `api/response.ts`  | `apiErrors`, `parseJsonBody`, `handleApiError`, bảng `DOMAIN_STATUS`      | —                                                                                                                                                                                                                                                                    |
| `crypto.ts`        | Argon2id (`@node-rs/argon2`), `fakeCompare`. bcrypt đã bỏ hẳn             | —                                                                                                                                                                                                                                                                    |
| `opaque-token.ts`  | Token ngẫu nhiên và mã ngắn                                               | `generateOpaqueToken`, `hashOpaqueToken`, `hashScopedToken`, `generateRecoveryCode`, `generateNumericOtp`                                                                                                                                                            |
| `encryption.ts`    | AES-256-GCM cho bí mật TOTP                                               | —                                                                                                                                                                                                                                                                    |
| `prisma-errors.ts` | Nhận diện vi phạm unique theo tên ràng buộc (Prisma 7)                    | `isUniqueViolation`                                                                                                                                                                                                                                                  |
| `env.ts`           | Biến môi trường                                                           | `env`, `appBaseUrl()` (= `APP_URL ?? NEXT_PUBLIC_APP_URL ?? null`), `appUrl(path)` (ném lỗi khi thiếu cả hai), `webAuthnConfig`, `isWebAuthnConfigured`                                                                                                              |
| `src/proxy.ts`     | CSP có nonce; gắn `x-pathname`; chặn trang khi chưa có cookie ký đúng     | —                                                                                                                                                                                                                                                                    |

`API_PUBLIC_URL`, `apiUrl()`, `publicAppUrl()` đã bị xoá — mọi URL tuyệt đối đi qua `appBaseUrl()`.

### 1.2 `src/services`

| Service                     | Hàm                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.service.ts`           | `register`, `validateCredentials` (cổng khoá tạm → mật khẩu → trạng thái → 2FA), `completeTwoFactorLogin`, `accountSecurity`, `sendEmailVerification`, `verifyEmail`, `requestPasswordReset`, `resetPassword`, `requestEmailChange`, `confirmEmailChange`, `requestPhoneVerification`, `confirmPhoneVerification`, `changePassword`; `resendEmailVerification` không ai gọi |
| `token.service.ts`          | Refresh token: `issue`, `rotate`, `revoke`, `listActive`, `revokeById`, `revokeFamily`, `revokeAllForUser({exceptFamilyId?})`, `purgeExpired`                                                                                                                                                                                                                               |
| `verification.service.ts`   | Token dùng một lần: `issue`, `consume` (link), `consumeOtp` (OTP), `purgeExpired`                                                                                                                                                                                                                                                                                           |
| `two-factor.service.ts`     | `isAvailable`, `status`, `beginSetup`, `confirmSetup`, `verifyCode` (bộ đếm theo tài khoản + chống phát lại TOTP), `disable`, `regenerateRecoveryCodes`                                                                                                                                                                                                                     |
| `webauthn.service.ts`       | `createRegistrationOptions`, `verifyRegistration`, `createAuthenticationOptions`, `verifyAuthentication`, `list`, `rename`, `remove` (`PasskeyNotFoundError`)                                                                                                                                                                                                               |
| `oauth.service.ts`          | `loginWithProfile` (ném `OAuthEmailUnverifiedError`, `TwoFactorRequiredError`), `listLinked`, `unlink`                                                                                                                                                                                                                                                                      |
| `security-stamp.service.ts` | `isEnabled`, `snapshotFor`, `isTokenStillValid(userId, iat)`, `invalidate` — xem §2                                                                                                                                                                                                                                                                                         |
| `permission.service.ts`     | `permissionsFor`, `can`, `explainFor`, `canActOnResource`, `canOnVenue`, `venuePermissions(userId, venueId)`, `invalidateUser`, `invalidateAll`                                                                                                                                                                                                                             |
| `role.service.ts`           | `list`, `findByKey`, `create`, `update`, `remove`, `listPermissions`; private `assertCanManageLevel`, `assertCanGrant`                                                                                                                                                                                                                                                      |
| `user.service.ts`           | `toPublicUser`, `findById`, `findByEmail`, `list`, `create`, `update`, `updateProfile`, `setStatus`, `unlock`, `softDelete`, `setUserPermission`, `clearUserPermission`; private `assertCanActOn`, `assertCanAssignRoles`, `catchDuplicate` (dùng `isUniqueViolation`); `getProfile` không ai gọi                                                                           |
| `member.service.ts`         | `managementScope`, `listForVenue`, `invite`, `setPermissions`, `remove` + lớp lỗi `Member*Error` (kể cả `MemberSelfManageError`, `MemberManagerProtectedError`, `MemberManagerGrantError`, `MemberGrantNotHeldError`)                                                                                                                                                       |
| `audit.service.ts`          | `record` (nuốt mọi lỗi), `recordLoginFailure`, `list`, `purgeOlderThan`. **Không có** `recordOrThrow` (CLAUDE.md nhắc nhầm)                                                                                                                                                                                                                                                 |

### 1.3 Schema (`src/schemas`)

- `auth.schema.ts`: `loginSchema {identifier, password}`, `registerSchema {email, password,
username?, fullName?}`, `changePasswordSchema` (mới ≠ cũ), các schema 2FA (`twoFactorCodeSchema`
  6–20 ký tự), đổi email (`requestEmailChangeSchema`), passkey, OTP số điện thoại
  (`verifyPhoneOtpSchema` bỏ MỌI khoảng trắng trước khi kiểm 6 chữ số).
- `user.schema.ts`: `emailSchema` (trim, chữ thường, ≤254), `usernameSchema` (3–32 ký tự
  `[a-z0-9._-]`, cấm `@`), `phoneSchema` `^(0|\+84)[1-9][0-9]{8}$`, `passwordSchema` (8–128, không
  ép luật ký tự), `userStatusSchema`, `setUserStatusSchema = z.object({ status })`,
  `createUserSchema`, `updateUserSchema`, `updateProfileSchema` (chỉ trường hồ sơ: fullName,
  avatarUrl, gender, dob, bio, địa chỉ — KHÔNG có email/phone/username/status/vai trò),
  `assignRolesSchema`, `setUserPermissionSchema`.
- `role.schema.ts`: `roleKeySchema` `^[A-Z][A-Z0-9_]*$`, `roleLevelSchema` 0–100, `createRoleSchema`
  (level mặc định 0, quyền rỗng), `updateRoleSchema`.
- `common.schema.ts`: `cuidSchema`, `paginationSchema` (limit ≤100, mặc định 20).
- `audit.schema.ts`: `AUDIT_ACTIONS` (§10), `listAuditLogsSchema`.

### 1.4 Giao diện và route

- `src/app/(auth)/actions.ts` — action công khai, không wrapper, tự rate limit bằng
  `rateLimitAction(RATE_LIMIT_BUCKETS.x, RATE_LIMITS.y)`: `loginAction`, `verifyTwoFactorAction`,
  `registerAction`, `forgotPasswordAction`, `resetPasswordAction`, `verifyEmailAction`,
  `confirmEmailChangeAction`. (Bản `logoutAction` chết ở đây đã bị xoá.)
- `(auth)/layout.tsx` (layout mới, `AuthHeader`), `auth-form.tsx`, `oauth-buttons.tsx`
  (`OAuthButtons` chỉ vẽ provider đã cấu hình, `OAuthErrorBanner`).
- `(auth)/login/`: `page.tsx` (đã đăng nhập thật → `redirect(safeRedirectPath(next, "/"))`; báo
  phiên bị thu hồi qua `hasRevokedSessionCookie`; banner `?reset=1`, `?oauthError=`,
  `?quickLogin=`; `?twoFactor=1` + cookie `oauth_2fa` hợp lệ → form nhập mã), `login-form.tsx`,
  `two-factor-form.tsx` (import action trực tiếp, không nhận qua prop), `passkey-actions.ts`
  (`getPasskeyLoginOptions`, `verifyPasskeyLogin`), `passkey-button.tsx`, `quick-login.tsx`
  (`QuickLogin`, chỉ dev).
- `(auth)/register/` (page tự chuyển người đã đăng nhập), `forgot-password/`, `reset-password/`,
  `verify-email/`, `confirm-email-change/`: mỗi thư mục một trang + một form.
- `src/app/logout-action.ts` — `logoutAction` đăng xuất web thật (xoá cookie → `/`); header dùng
  bản này.
- `src/app/api/dev/quick-login/route.ts` — đăng nhập nhanh, chỉ dev (§8).
- `src/app/(admin)/layout.tsx` — `requireUser()` không tham số (quay về đúng trang đang mở), đọc
  quyền MỘT lần bằng `permissionsFor` cho 4 mục (`venue:approve`, `invoice:manage`, `user:read`,
  `role:read`); không có mục nào thì `notFound()`. **Không phải ranh giới bảo mật.**
- `(admin)/users/` — `page.tsx` (`requirePermission("user:read")`, 20 dòng/trang), `actions.ts`
  (`createUserAction` `user:create`; `setUserStatusAction` (parse bằng `setUserStatusSchema`),
  `unlockUserAction` `user:update`; `deleteUserAction` `user:delete`) — đều truyền
  `{ actorId: ctx.actorId }`.
- `(admin)/roles/` — `page.tsx` (`requirePermission("role:read")` + cờ), `actions.ts`
  (`updateRolePermissionsAction`, `createRoleAction`, `deleteRoleAction`, đều truyền actorId).
- `src/app/security/` — `requireUser`; 8 action `defineAuthedAction`: `changePasswordAction`
  (cấp lại cookie cho trình duyệt đang thao tác), `resendVerificationEmailAction`,
  `requestEmailChangeAction` (ghi `pendingEmail`), bắt đầu/xác nhận/tắt 2FA, cấp lại mã, xoá
  passkey. Form ở `account-forms.tsx`, `two-factor-manager.tsx` (QR vẽ trong trình duyệt),
  `passkey-manager.tsx` (thêm passkey bằng `fetch(apiPath(...))`, xoá bằng action).
- `src/app/sessions/` — `requireUser`, `tokenService.listActive`, **chỉ hiện phiên mobile** (trang có
  ghi chú); `revokeSessionAction` (`defineAuthedAction`, audit `SESSION_REVOKED`).
- `src/components/layout/header.tsx` — đọc quyền một lần bằng `permissionsFor`; mục "Quản trị" trỏ
  mục đầu tiên có quyền trong venue-approvals → invoices → users → roles; đăng xuất bằng
  `logoutAction`.
- `src/components/manage/manage-nav.tsx` — dùng `permissionService.venuePermissions()` (một truy vấn
  cho mọi quyền trên sân).
- Seed: `prisma/seeds/seed-rbac.ts` (§5.5), `seed-admin.ts` (`ADMIN_EMAIL`/`ADMIN_PASSWORD` →
  **SUPER_ADMIN**, email đã xác thực, không reset mật khẩu nếu đã tồn tại), `seed-dev.ts` (4 tài
  khoản `@dev.local`, mật khẩu `matkhau123`).

### 1.5 Model liên quan (chi tiết cột ở `data-model.md`)

`Role(key unique, level, isSystem)`, `Permission`, `RolePermission`, `UserRole(assignedBy)`,
`UserPermission(isGranted, grantedBy, expiresAt)`; `User` (email/phone/username nullable, **không
`@unique`** — unique nằm ở partial index viết tay `users_{email,phone,username}_active_key WHERE
deleted_at IS NULL`; `password?`, `status`, `emailVerifiedAt`, `phoneVerifiedAt`, `pendingEmail`,
`passwordChangedAt`, `failedLoginAttempts`, `lockedUntil`, `deletedAt`, `twoFactorSecret`,
`twoFactorEnabledAt`); `UserProfile`; `RecoveryCode(userId+codeHash unique)`;
`WebAuthnCredential(credentialId unique, publicKey base64url, counter BigInt, transports[], …)`;
`OAuthAccount(provider+providerAccountId unique)`; `RefreshToken(familyId, tokenHash unique,
deviceId, userAgent, ip, twoFactorAt, expiresAt, revokedAt)`; `VerificationToken(tokenHash unique,
type EMAIL_VERIFICATION|EMAIL_CHANGE|PHONE_OTP|PASSWORD_RESET, destination, attempts)`;
`UserDevice`; `AuditLog` (không khoá ngoại tới users); `VenueMember(role OWNER|STAFF, status
INVITED|ACTIVE|DISABLED mặc định ACTIVE, permissions String[], invitedBy, unique(venueId,userId))` +
index viết tay `venue_members_mot_chu_cho_moi_co_so` (mỗi sân đúng một OWNER).

---

## 2. Phiên: web khác mobile

|            | Web (trình duyệt)                                                                                             | Mobile (REST)                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Vật mang   | Cookie `session`: httpOnly, SameSite=Lax, Secure khi production, path `/`                                     | `Authorization: Bearer <jwt>` (chữ "bearer" không phân biệt hoa thường)                        |
| Định dạng  | JWT HS256 ký bằng `SESSION_SECRET`                                                                            | Cùng JWT + một refresh token opaque                                                            |
| Hạn        | `SESSION_MAX_AGE_DAYS` (7) cho cả JWT lẫn cookie                                                              | Access `ACCESS_TOKEN_TTL_MINUTES` (15); refresh `REFRESH_TOKEN_TTL_DAYS` (30)                  |
| Claim      | `typ:"access"` (bắt buộc), `sub`, `email`, `roles[]`, `mfa?` (khi qua 2FA/passkey), `iat`, `exp`. Không `sid` | Như web + `sid` = `familyId`; `mfa` giữ qua các lần refresh (lấy từ `twoFactorAt`)             |
| Bản ghi DB | Không                                                                                                         | `RefreshToken` lưu SHA-256; `familyId` UUID ổn định qua các lần xoay vòng                      |
| Làm mới    | Không; hết hạn thì đăng nhập lại                                                                              | `POST /auth/refresh`: xoay vòng, token cũ bị `revokedAt`; ghi `ip`/`userAgent` của lần refresh |
| Thu hồi    | Security stamp (dưới đây) + xoá cookie ở trình duyệt đang thao tác                                            | Security stamp cho access; thu hồi refresh (một thiết bị / một họ / tất cả)                    |
| Đăng xuất  | Server Action `src/app/logout-action.ts` → `destroySession` → `/`                                             | `POST /auth/logout {refreshToken?, allDevices?}` (cần access còn hạn)                          |
| Danh sách  | Không hiện ở `/sessions` (trang có ghi chú)                                                                   | `GET /auth/sessions`: gộp theo `familyId`, lấy bản mới nhất                                    |

Điểm chung:

- `verifySession` trả `null` với token hỏng, hết hạn, sai chữ ký, sai cấu trúc, **thiếu hoặc sai
  `typ`** (`typ: z.literal("access")`, không còn `.default`).
- `getApiSession` ưu tiên Bearer, fallback cookie → trang web gọi REST bằng `fetch` được (ví dụ
  `passkey-manager.tsx`).

**Security stamp (`security-stamp.service.ts`)** — thu hồi phiên thật sự:

- Ảnh nhỏ `{passwordChangedAt (giây epoch), status, deleted}` cache 60 giây (khoá
  `secstamp:v2:<userId>`; Redis nếu có, không thì RAM từng tiến trình). Id không tồn tại → coi như
  đã xoá.
- `isTokenStillValid(sub, iat)`: xoá mềm hoặc `status ≠ ACTIVE` → **luôn** từ chối; nếu
  `SESSION_STRICT_REVOCATION` bật (mặc định `1`) và có `passwordChangedAt` thì cần `iat >= mốc`
  (so `>=` vì `iat` chỉ có độ phân giải giây; thiếu `iat` → từ chối). `SESSION_STRICT_REVOCATION=0`
  CHỈ tắt phép so mốc mật khẩu, không tắt kiểm khoá/xoá.
- Gọi ở: `getSession` (mọi trang, layout, 4 wrapper action), `getApiSession` (mọi guard REST),
  middleware handshake của `realtime/server.ts`.
- `invalidate(userId)` gọi NGAY sau: `resetPassword`, `changePassword`, `userService.setStatus`,
  `userService.update` có `status`, `softDelete`. Đường ghi không qua service (SQL tay) có hiệu lực
  trễ ≤60 giây.
- Đổi/đặt lại mật khẩu cấp lại phiên cho người đang thao tác: web `changePasswordAction` gọi
  `createSession` (giữ `sid`, `mfa`) sau khi đổi; API `POST /auth/change-password` trả cặp token
  mới cùng `familyId` (`sid`). Thiết bị khác bị đăng xuất.
- **Realtime** cần `DATABASE_URL` (và nên có `REDIS_URL`); `connectionStateRecovery` đặt
  `skipMiddlewares: false` (mặc định socket.io bỏ qua middleware khi phục hồi phiên). Giới hạn: chỉ
  kiểm LÚC NỐI — socket đang mở trước khi bị thu hồi sống tới khi rớt mạng/khởi động lại.
- **Đổi email KHÔNG cắt cookie web** (chỉ thu hồi refresh token) — quyết định giữ: email không nằm
  trong ảnh phiên; muốn cắt hết thì đổi mật khẩu.

**Vé (`tickets.ts`)**, ký cùng `SESSION_SECRET`, mỗi vé có `jti` ngẫu nhiên:

- `{typ:"2fa", sub}` hạn `TWO_FACTOR_CHALLENGE_TTL_MINUTES` (5).
- `{typ:"webauthn_reg", challenge, sub}` và `{typ:"webauthn_auth", challenge}` hạn 5 phút.
- `verifyTicket(token, type)` chỉ đọc, chỉ nhận đúng loại → vé không dùng thay phiên, phiên không
  dùng thay vé.
- `consumeTicket(ticket)` đánh dấu `once:ticket:<jti>` tới hết đời vé (`claimOnce`, nguyên tử);
  `false` = đã dùng → nơi gọi từ chối. Vé 2FA: tiêu SAU khi mã đúng, TRƯỚC khi cấp phiên (gõ sai mã
  vé vẫn còn). Vé passkey: tiêu ngay trước bước xác minh. Store chết → fail-open như rate limit.

**Refresh token (`token.service.ts`)**:

- `issue`: 32 byte base64url; DB lưu `hashOpaqueToken` (SHA-256 hex); không truyền `familyId` thì
  mở họ mới bằng `randomUUID`.
- `rotate`:
  1. Không tìm thấy → `null`.
  2. Đã `revokedAt` → `revokeFamily` rồi ném `RefreshTokenReuseError` (401); route ghi audit
     `REFRESH_TOKEN_REUSED`. Chỉ thu hồi **một họ**.
  3. Hết hạn → `null`.
  4. User xoá mềm hoặc `status ≠ ACTIVE` → `null`.
  5. Thu hồi token cũ; cấp token mới cùng `familyId`, giữ `deviceId`, `twoFactorAt`.
- Route refresh ký access mới có `sid` và `mfa` (từ `twoFactorAt`).

---

## 3. Các lớp kiểm và chính sách mã lỗi

1. **Proxy** (`src/proxy.ts`):
   - Matcher bỏ qua `/api/`, `/docs`, asset tĩnh.
   - Chỉ verify CHỮ KÝ cookie (không chạm DB/cache → không biết phiên đã thu hồi) cho
     `PROTECTED_PREFIXES = /users, /roles, /sessions, /security`; không có → `/login?next=<đường
dẫn kèm truy vấn>`.
   - Gắn (ghi đè) header `x-pathname` = đường dẫn + truy vấn cho mọi request trang.
   - **Không** còn đá người đã đăng nhập khỏi `/login`, `/register`: cookie ký đúng nhưng đã thu hồi
     sẽ gây vòng lặp chuyển hướng. Hai trang đó tự chuyển người đăng nhập THẬT (qua `getSession`).
   - Dựng CSP có nonce (`form-action 'self'`, `frame-ancestors 'none'`, …).
   - `/manage`, `/invoices`, `/venue-approvals`, `/account` **không** nằm trong danh sách — các
     trang đó tự chặn.
2. **Trang/layout** (`src/lib/auth.ts`):
   - `requireUser(returnTo?)`: `getCurrentUser()` (qua `getSession` nên đã lọc khoá/xoá/đổi mật
     khẩu); `null` → `/login?next=…`. Bỏ trống `returnTo` = đọc `x-pathname` (kèm query); mọi giá
     trị qua `safeRedirectPath`.
   - `requirePermission(permission, returnTo?)`: `requireUser` + `permissionService.can` → thiếu
     thì `notFound()`.
   - `requireVenueAccess(venueId, permission, returnTo?)`: `requireUser(returnTo)` + `canOnVenue` →
     thiếu thì `notFound()`. Dùng ở các trang `/manage/[venueId]/*`.
3. **Server Action**: wrapper (§4) — đây là lớp chặn thật; hai lớp trên chỉ là UX.
4. **REST** (`src/lib/api/auth.ts`):
   - `requireApiUser`: `getApiSession` (JWT + security stamp) → 401 `UNAUTHENTICATED`.
   - `requireApiPermission`: thêm `can()` → **403** `FORBIDDEN`.
   - `requireVenuePermission`: thêm `canOnVenue` → **404** "Không tìm thấy sân" (chưa ai dùng — REST
     cho sân chưa có).
   - `permissionService.canActOnResource(actor, owner, {any, own})`: có quyền `any`, hoặc (actor =
     owner và có quyền `own`).

**Chính sách**: web 404 để không xác nhận tài nguyên tồn tại; API 403 cho quyền toàn cục vì client
cần phân biệt với 401; tài nguyên theo sân và tài nguyên có `userId` trong truy vấn (phiên, passkey,
nhân sự sân) trả 404 không phân biệt "không có" với "của người khác".

**`DomainError` → HTTP** (`response.ts`): VALIDATION_ERROR 422, UNAUTHENTICATED 401, FORBIDDEN
403, NOT_FOUND 404, CONFLICT 409, ACCOUNT_BANNED 403, ACCOUNT_LOCKED 423, RATE_LIMITED 429 (kèm
`Retry-After`), PROVIDER_ERROR 502, TWO_FACTOR_REQUIRED 401. Lỗi lạ → 500 `INTERNAL_ERROR`, không lộ
nội dung.

---

## 4. Wrapper Server Action (`src/lib/define-action.ts`)

| Wrapper                                                             | Kiểm theo thứ tự                                                                                                | Khi bị từ chối                                                                                                                                                | `ctx`                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `defineAction(permission, handler)`                                 | 1) `getSession()` (JWT + stamp). 2) `permissionService.can(sub, permission)` (DB + cache)                       | Chưa đăng nhập: `{error:"Bạn cần đăng nhập để thực hiện thao tác này."}`. Thiếu quyền: `logger.warn` + `{error:"Bạn không có quyền thực hiện thao tác này."}` | `{session, actorId}`                     |
| `defineAuthedAction(handler)`                                       | Chỉ `getSession()`                                                                                              | "Bạn cần đăng nhập…"                                                                                                                                          | `{session, actorId}`                     |
| `definePublicAction(reason, {key, limit, windowSeconds}, handler)`  | 1) `getSession()` (được null). 2) IP = `actionClientIp()` (§9). 3) `rateLimit("action:<key>:<sub hoặc ip:IP>")` | `logger.warn` (kèm `reason`) + `{error:"Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại giúp bạn nhé."}`                                                     | `{session \| null, actorId \| null, ip}` |
| `defineVenueAction(permission, handler)` → hàm `(venueId, ...args)` | 1) `getSession()`. 2) `canOnVenue(sub, permission, venueId)`                                                    | "Bạn cần đăng nhập…" / `logger.warn` (kèm venueId) + `{error:"Bạn không có quyền thực hiện thao tác này trên sân này."}`                                      | `{session, actorId, venueId}`            |

- Thân không chạy khi bị từ chối; lỗi trong thân được ném tiếp, không nuốt.
- `denied()` ép `{error} as TState` → **state của action phải toàn trường tuỳ chọn**.
- Vì mọi wrapper đi qua `getSession()`, người bị khoá/xoá/đổi mật khẩu bị chặn ngay ở action kế
  tiếp; `permissionService.load` còn lọc `status: ACTIVE` làm lớp thứ hai.
- `venueId` của `defineVenueAction` chỉ chứng minh quyền trên sân đó; id con trong form vẫn phải lọc
  theo `ctx.venueId` ở service (GOTCHAS #19).
- Action viết trần (luồng đăng nhập) dùng `rateLimitAction(bucket, options)` → cùng khoá với API.

Đang dùng:

- `defineAction`: users (4), roles (3), invoices (2), venue-approvals (2).
- `defineVenueAction`: `manage/[venueId]/actions.ts` (`payment:confirm` ×2, `booking:checkin`,
  `booking:cancel`), settings (`venue:update` ×4), courts (`court:update` ×2, `pricing:update`),
  staff (`member:manage` ×3). UI gọi `.bind(null, venueId)`.
- `defineAuthedAction`: security (8), sessions (1), account/bookings (huỷ lượt, đánh giá),
  `manage/new` (`createVenueAction`), `holdBookingAction`, `bookings/[code]`
  (`declareTransferAction`, `openTransferAction`).
- `definePublicAction`: **hiện không action nào dùng** (khai chuyển khoản đã bắt đăng nhập).
- Không wrapper: `(auth)/actions.ts`, `login/passkey-actions.ts`, `app/logout-action.ts`.

---

## 5. RBAC nền tảng

### 5.1 Toàn bộ 38 permission key (`permissions.ts`)

SA = SUPER_ADMIN (có tất cả qua `"*"`), AD = ADMIN, US = USER.

| Nhóm          | Key                                                                                     | Mặc định                                                      |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Người dùng    | `user:read`, `user:create`, `user:update`                                               | SA, AD                                                        |
|               | `user:delete`                                                                           | chỉ SA                                                        |
| Hồ sơ         | `profile:read:own`, `profile:update:own`                                                | SA, AD, US                                                    |
| RBAC          | `role:read`, `role:create`, `role:update`                                               | SA, AD                                                        |
|               | `role:delete`                                                                           | chỉ SA                                                        |
| Hệ thống      | `audit:read`                                                                            | SA, AD                                                        |
|               | `system:manage`                                                                         | chỉ SA                                                        |
| Thông báo     | `notification:read`                                                                     | SA, AD, US                                                    |
|               | `notification:send`                                                                     | SA, AD                                                        |
| Tệp           | `file:upload`                                                                           | SA, AD                                                        |
| Theo sân      | `venue:read`, `court:read`, `pricing:read`, `booking:read`                              | SA, AD; STAFF mặc định                                        |
|               | `booking:create`, `booking:checkin`                                                     | SA; STAFF mặc định                                            |
|               | `booking:cancel`, `payment:refund`, `payment:confirm`, `report:read`                    | SA, AD; STAFF tick được                                       |
|               | `booking:reschedule`, `pricing:update`, `court:update`, `venue:update`, `member:manage` | SA; STAFF tick được                                           |
|               | `venue:delete`, `venue:transfer`, `payout:manage`                                       | SA có trên danh nghĩa, nhưng trên sân **chỉ OWNER** dùng được |
| Toàn nền tảng | `venue:approve`, `invoice:manage`, `dispute:resolve`                                    | SA, AD                                                        |
|               | `payout:approve`, `setting:update`                                                      | chỉ SA                                                        |

### 5.2 Vai trò hệ thống (`SYSTEM_ROLES`, `DEFAULT_ROLE_PERMISSIONS`; seed đặt `isSystem = true`)

- `SUPER_ADMIN` — level 100, "Quản trị tối cao", `"*"` (mọi quyền, kể cả quyền thêm sau này).
- `ADMIN` — level 50, "Quản trị viên", 23 quyền như bảng. **Không có**: `user:delete`,
  `role:delete`, `system:manage`, `venue:update/delete/transfer`, `court:update`, `pricing:update`,
  `booking:create/checkin/reschedule`, `member:manage`, `payout:manage`, `payout:approve`,
  `setting:update`.
- `USER` — level 0, "Người dùng": `profile:read:own`, `profile:update:own`, `notification:read`.
- Test `permissions.test.ts` bắt: key không trùng, đúng dạng `a:b(:own)`, có metadata, level tăng
  dần, vai trò bậc trên chứa mọi quyền của bậc dưới.

### 5.3 Quyền hiệu lực (`permission.service.ts`)

- **Công thức**: hợp quyền của MỌI vai trò (bỏ key không có trong code) + ngoại lệ `isGranted=true`
  − ngoại lệ `isGranted=false`. **Tước luôn thắng.** Ngoại lệ hết hạn lọc ngay trong truy vấn.
- `load` lọc `deletedAt: null` **và `status: "ACTIVE"`** — tài khoản không ACTIVE không có quyền nào
  (lớp thứ hai sau security stamp).
- Cache `perm:v1:<userId>` 60 giây: Redis nếu có `REDIS_URL`, không thì RAM từng tiến trình
  (invalidate không lan giữa instance).
- `invalidateUser` gọi ở `userService.create/update/softDelete/setUserPermission/
clearUserPermission` và `memberService.*`; `invalidateAll` ở `roleService.create/update/remove`.
- `explainFor` cho biết nguồn quyền: role / grant / denied / expiredOverride (API
  `GET /users/[id]/permissions`).

### 5.4 Chốt `Role.level` và chốt cấp quyền (chống leo thang)

- **`actorId: string | null` bắt buộc** ở mọi hàm ghi user/role (`ActorOptions`). `null` = thao tác
  hệ thống (seed/script) và bỏ qua chốt — phải viết tường minh. Mọi action web và route API hiện
  truyền `ctx.actorId` / `session.sub` ✅.
- `assertCanActOn(actor, target)` (`user.service.ts`): chặn khi level cao nhất của mục tiêu ≥ của
  người thao tác. Áp cho `update`, `setStatus`, `unlock`, `softDelete`, `setUserPermission`,
  `clearUserPermission`.
- `assertCanAssignRoles`: chặn gán vai trò có level ≥ mình (`create`, `update` có `roleKeys`).
- `assertCanManageLevel` (`role.service.ts`): chặn tạo/sửa/xoá vai trò có level ≥ mình, và chặn đặt
  `level` mới ≥ mình → ADMIN (50) không tạo/sửa/gán vai trò level ≥ 50.
- `assertCanGrant` (`role.service.ts`): `create`/`update` chỉ gán vào vai trò những quyền người thao
  tác đang có → `PermissionNotHeldError`.
- `setUserPermission` với `isGranted=true`: người cấp phải có quyền đó → `PermissionNotHeldError`
  (tước thì không cần).
- Chốt tự thao tác: không tự đổi vai trò, tự đổi trạng thái, tự xoá (`SelfActionForbiddenError`,
  409). Tự sửa hồ sơ qua API đi nhánh riêng (§11).

### 5.5 Quản trị vai trò, trạng thái, xoá, seed

- `roleService.create`: key không trùng; `isSystem` luôn false; quyền rỗng khi tạo từ web.
- `roleService.update`: đổi tên/mô tả/level; `permissions` mang nghĩa **THAY THẾ toàn bộ**. Sửa
  được cả vai trò hệ thống (trong giới hạn level).
- `roleService.remove`: chặn vai trò `isSystem` và vai trò còn người mang.
- `userService.setStatus`: về ACTIVE thì xoá khoá tạm; khác ACTIVE thì thu hồi mọi refresh token;
  luôn `securityStamp.invalidate` → cookie web/access token bị cắt ngay.
- `userService.update`: có `status` thì cùng hệ quả như `setStatus` (thu hồi refresh khi khác ACTIVE,
  invalidate stamp); đổi `email` thì reset `emailVerifiedAt = null`.
- `userService.softDelete`: `deletedAt`, status INACTIVE, gắn hậu tố `:deleted:<ts>` vào
  email/username/phone, thu hồi refresh, `invalidateUser` + `securityStamp.invalidate`.
- `userService.create`: `assertUnique`; `assertCanAssignRoles(actorId)`; `resolveRoleIds` (vai trò
  lạ → `UnknownRoleKeyError` 422); Argon2id; tạo profile + userRoles; `invalidateUser`. Trùng khoá lúc
  đua → `catchDuplicate` dùng `isUniqueViolation` theo tên index → `DuplicateFieldError`.
- **`seedRbac`**: upsert danh mục quyền; 3 vai trò hệ thống `isSystem`, `level` luôn đồng bộ từ
  code; quyền mặc định chỉ thêm cho vai trò MỚI tạo hoặc quyền MỚI xuất hiện trong code (SUPER_ADMIN
  `"*"` luôn đủ) — **không thêm lại quyền mặc định admin đã cố ý gỡ**.

---

## 6. Quyền theo sân

**`VenueMember`**: `role` OWNER | STAFF; `status` INVITED | ACTIVE | DISABLED; `permissions[]` chỉ
có nghĩa với STAFF. Mỗi sân đúng một OWNER (index viết tay).

Ba danh sách trong `permissions.ts` (mỗi quyền theo sân nằm trong đúng MỘT):

- `VENUE_STAFF_DEFAULT`: `venue:read`, `court:read`, `pricing:read`, `booking:read`,
  `booking:checkin`, `booking:create`.
- `VENUE_STAFF_GRANTABLE`: `booking:cancel`, `payment:confirm`, `booking:reschedule`,
  `payment:refund`, `pricing:update`, `court:update`, `venue:update`, `report:read`,
  `member:manage`.
- `VENUE_OWNER_ONLY`: `payout:manage`, `venue:delete`, `venue:transfer`. Giao diện **không có ô
  tick** cho ba quyền này.

**Thứ tự xét `canOnVenue(userId, permission, venueId)`**:

1. Key không có trong code → false.
2. Không thuộc OWNER_ONLY và có quyền toàn cục → true (không truy vấn membership).
3. Không phải quyền theo sân → false.
4. Tra `venueMember(venueId, userId)` kèm `venue.deletedAt`: không có, status ≠ ACTIVE, hoặc **sân
   đã xoá mềm** → false.
5. OWNER → true, kể cả OWNER_ONLY.
6. STAFF: OWNER_ONLY → false; còn lại → thuộc DEFAULT hoặc nằm trong `member.permissions`.

`venuePermissions(userId, venueId)` trả toàn bộ tập quyền trên một sân trong một lượt truy vấn, luôn
khớp `canOnVenue` với mọi key (test giữ tính chất này). Dùng cho `ManageNav` và
`memberService.managementScope`.

Hệ quả:

- ADMIN dùng được `booking:cancel`, `payment:refund`, `payment:confirm`, các quyền `:read` trên
  **mọi sân** (vì có quyền toàn cục) — kể cả sân đã xoá mềm (cố ý: cần mở dữ liệu cũ khi khiếu nại).
- SUPER_ADMIN cũng không rút tiền hộ, không xoá hay chuyển nhượng sân hộ chủ.
- Sân `ADMIN_LOCKED`/`SUSPENDED`/`UNDER_MAINTENANCE` **không** bị chặn ở đây, có chủ đích (còn lượt
  đã trả tiền, giao dịch chờ duyệt, hoàn tiền); service nghiệp vụ tự chặn theo trạng thái sân.

**`invoice:manage` ≠ `payout:approve`**: `invoice:manage` = ghi nhận tiền THU VÀO (hoá đơn hoa
hồng), ADMIN có; `payout:approve` = duyệt tiền CHI RA cho chủ sân, chỉ SUPER_ADMIN; `payout:manage`
= chủ sân xin rút.

**`memberService`** (3 action đều `defineVenueAction("member:manage")`, truyền `actorId`, ghi audit
`VENUE_MEMBER_*`):

- `invite`: email phải có tài khoản; chưa là thành viên; tạo STAFF **ACTIVE ngay**, `permissions:
[]` (luồng INVITED/chấp nhận lời mời chưa có).
- `setPermissions`: tìm theo `{id, venueId}`; **không tự sửa mình** (`MemberSelfManageError`);
  OWNER → `MemberOwnerFixedError`; key OWNER_ONLY → `MemberOwnerOnlyPermissionError`; key không
  grantable → `MemberPermissionError` (422); rồi theo `managementScope`:
  - chỉ chủ sân (hoặc quản trị nền tảng có `member:manage` toàn cục) mới cấp/thu `member:manage`
    (`MemberManagerGrantError`) và sửa người đang giữ nó (`MemberManagerProtectedError`);
  - nhân viên có `member:manage` chỉ cấp được quyền mình đang có (`MemberGrantNotHeldError`).
  - Loại trùng; `invalidateUser`.
- `remove`: không tự gỡ mình; không gỡ OWNER; người đang giữ `member:manage` chỉ chủ sân gỡ được.

---

## 7. Các luồng đăng nhập và tài khoản

### 7.1 Mật khẩu và khoá tài khoản

**Identifier** là một ô: có `@` → tra email, không có → tra username (username cấm `@`). **Không**
đăng nhập bằng số điện thoại.

`authService.validateCredentials`:

1. `identifier.trim().toLowerCase()` → `findFirst({deletedAt:null, email|username})`.
2. Không có user hoặc `password = null` → `fakeCompare` + `InvalidCredentialsError`.
3. **Còn `lockedUntil` → `fakeCompare` + `AccountLockedError` (423) — kiểm TRƯỚC khi so mật khẩu**:
   trong lúc khoá, đúng hay sai đều cùng một lỗi và không đếm thêm lần sai (hết "oracle" mật khẩu;
   cái giá là lộ tài khoản tồn tại và đang khoá).
4. Argon2id sai → `registerFailedAttempt` (tăng bộ đếm; chạm `LOGIN_MAX_FAILED_ATTEMPTS` (5) thì về
   0 và `lockedUntil = now + LOGIN_LOCKOUT_MINUTES` (15)) → `InvalidCredentialsError(userId)`.
5. Mật khẩu đúng → `assertLoginAllowed(status)`: BANNED → `AccountBannedError`; INACTIVE →
   `AccountInactiveError`.
6. Reset bộ đếm; `needsRehash` thì băm lại (lỗi bị nuốt).
7. **Cổng 2FA**: `twoFactorEnabledAt` khác null → ném `TwoFactorRequiredError(userId)`.
8. Trả `PublicUser` (`roles[]`, `twoFactorEnabled`, không có `password`).

Web `loginAction`: `rateLimitAction(login)` → `loginSchema.safeParse` → `validateCredentials`
(`TwoFactorRequired` → trả `{twoFactorToken}`; mọi `DomainError` → `recordLoginFailure` + message,
kể cả tài khoản tạm ngưng) → `resetRateLimit` → `createSession` → audit `LOGIN_SUCCEEDED` →
`redirect(safeRedirectPath(next || landing, "/"))`.

API `POST /auth/login` trả **hai hình dạng** (cố ý, để client rẽ nhánh tường minh):

- Cần 2FA: `{data:{twoFactorRequired:true, challengeToken, expiresIn}}`.
- Không: `{data:{user, accessToken, expiresIn, tokenType:"Bearer", refreshToken, refreshExpiresAt,
sessionId}}` (`sessionId` = `familyId`).

Admin mở khoá: `unlock` (xoá `lockedUntil`, không đụng `status`, có chốt level); `setStatus("ACTIVE")`
cũng xoá.

### 7.2 2FA TOTP và mã khôi phục (`two-factor.service.ts`)

- **Bật ba bước**: `beginSetup` (thiếu `ENCRYPTION_KEY` → `ProviderNotConfiguredError`; chặn nếu đã
  bật; bí mật 20 byte mã hoá AES-256-GCM `v1.iv.tag.ct`, CHƯA đặt `twoFactorEnabledAt`; trả
  `{secret, uri}` với issuer `APP_NAME`) → quét QR (vẽ trong trình duyệt) → `confirmSetup(code)`
  (sinh 10 mã khôi phục `XXXXX-XXXXX`; một transaction; mã trả ra **một lần**).
- **Xác minh** `verifyCode` — ba chốt:
  1. Bộ đếm theo TÀI KHOẢN `2fa-account:<userId>` = `RATE_LIMITS.twoFactorAccount` (5 / 15 phút),
     đếm MỌI lần thử trước khi kiểm (INCR nguyên tử), chung web/API/tắt 2FA/cấp lại mã; vượt ngưỡng
     → `TooManyTwoFactorAttemptsError` kể cả mã đúng; nhập đúng thì reset.
  2. Chống phát lại TOTP: `claimOnce("totp:<userId>:<step>", 90s)` + nhớ bước lớn nhất đã dùng
     (`totp:last-step:<userId>`) — mã cũ hơn mã đã nhận bị từ chối.
  3. Mã khôi phục dùng một lần (`updateMany {usedAt:null}`, `logger.warn`).
- **Tắt** `disable`: cần mật khẩu (nếu có) + một mã hợp lệ. **Cấp lại mã**: cần một mã hợp lệ.
- **Bước 2 trên web** `verifyTwoFactorAction`: `rateLimitAction(twoFactor)` → vé từ field ẩn
  `twoFactorToken` (luồng mật khẩu) HOẶC cookie `oauth_2fa` (luồng OAuth) → `verifyTicket` →
  `verifyCode` (sai → audit `TWO_FACTOR_FAILED`) → `consumeTicket` → `completeTwoFactorLogin` (kiểm
  lại status) → xoá cookie `oauth_2fa` → `createSession({..., mfa})` → audit `LOGIN_SUCCEEDED
{method:"2fa", firstFactor}` → `next` hoặc landing.
- **Bước 2 trên API** `POST /auth/2fa/verify`: cùng các chốt; sai → audit `TWO_FACTOR_FAILED` + 401.
- Tự phục vụ ở `/security`: xác nhận/tắt/cấp lại mã có `rateLimitAction(twoFactor)`; bắt đầu thiết
  lập thì không. Thiếu `ENCRYPTION_KEY` → `isAvailable() = false`, giao diện ẩn nút.
- Không có "thiết bị tin cậy" (cố ý).

### 7.3 Passkey / WebAuthn (`@simplewebauthn` v14)

- **Cấu hình**: có cả `WEBAUTHN_RP_ID` và `WEBAUTHN_ORIGINS` thì dùng thẳng; không thì suy từ
  `appBaseUrl()`; thiếu cả hai → `ProviderNotConfiguredError` (nút bị ẩn). `rpName = APP_NAME`.
- **Đăng ký** (đã đăng nhập): `PasskeyManager` `fetch(apiPath("/auth/passkeys/register/options"))`
  → `createRegistrationOptions` (`residentKey:"required"`, `userVerification:"required"`, vé
  `webauthn_reg` có `sub`) → `startRegistration` → `POST /register/verify` (rate limit; vé đúng
  loại, `sub === session.sub`, `consumeTicket`) → lưu, audit `PASSKEY_REGISTERED`.
- **Đăng nhập web**: `PasskeyButton` → `getPasskeyLoginOptions()` (rate limit `passkey`, không
  `allowCredentials`) → `startAuthentication` → `verifyPasskeyLogin(challengeToken, response, next)`:
  `rateLimitAction(passkey)` → `verifyTicket("webauthn_auth")` + `consumeTicket` →
  `verifyAuthentication` (không có credential → lỗi; cập nhật counter + `lastUsedAt`;
  `assertLoginAllowed`; **không áp `lockedUntil`**) → `createSession({..., mfa})` → audit
  `LOGIN_SUCCEEDED {method:"passkey"}` → `{ok, next: safeRedirectPath(next || landing, "/")}`.
- **Không hỏi TOTP** kể cả khi đã bật 2FA — quyết định có chủ đích: `userVerification:"required"`
  đã là hai yếu tố. `consumeTicket` chặn phát lại (passkey đồng bộ thường giữ counter = 0).
- **API**: `/passkeys/login/{options,verify}` (cả hai rate limit) → `issueTokenPair(twoFactorAt: now)`.
- **Quản lý**: `rename`/`remove` đặt `userId` trong `where`, không thấy → `PasskeyNotFoundError`;
  `remove` từ chối nếu là cách đăng nhập cuối cùng → `ForbiddenError`.

### 7.4 OAuth (tự viết bằng `fetch`/`jose`)

| Provider | Scope                  | PKCE  | Ghi chú                                                                       |
| -------- | ---------------------- | ----- | ----------------------------------------------------------------------------- |
| google   | `openid email profile` | có    | email lấy từ `id_token` khi `email_verified`                                  |
| github   | `read:user user:email` | không | gọi `/user` + `/user/emails`, lấy primary đã verified                         |
| facebook | `email public_profile` | có    | Graph v21.0, gọi `/me`                                                        |
| apple    | `name email`           | không | `response_mode=form_post`, client secret JWT ES256 tự ký; tên chỉ gửi lần đầu |

Provider chỉ "đã cấu hình" khi đủ ID + SECRET (Apple cần 4 biến) **và** có `appBaseUrl()`; nút chỉ
hiện khi đã cấu hình.

1. `GET /api/v1/auth/oauth/<p>/start?next=…`: provider lạ → 404 qua `handleApiError` (envelope);
   chưa cấu hình → `redirectRelative("/login?oauthError=not_configured")`; `next =
safeRedirectPath(next, "")`; sinh `state` (+ `codeVerifier` nếu PKCE); cookie `oauth_flow` = JSON
   `{provider, state, codeVerifier, next}` (httpOnly, 10 phút, **không ký**; SameSite=Lax, riêng
   Apple/form_post là `SameSite=None; Secure`); `redirect_uri = appUrl(apiPath("/auth/oauth/<p>/
callback"))`.
2. Callback (GET; Apple là POST form): có `error` → `/login?oauthError=<error>`;
   `consumeOAuthFlowCookie` đọc rồi xoá, kiểm `provider`, `state`, có `code` (sai →
   `OAuthStateMismatchError`); đổi code lấy token; `fetchOAuthProfile`.
3. `oauthService.loginWithProfile`: email về chữ thường; đã có liên kết → `findById` (tài khoản xoá
   mềm → `InvalidCredentialsError`); chưa có: bắt buộc email; email trùng user đang sống → **chỉ
   liên kết khi tài khoản đó đã `emailVerifiedAt`**, không thì `OAuthEmailUnverifiedError`; không
   trùng → tạo user (`emailVerifiedAt = now`, `password = null`, vai trò USER); `assertLoginAllowed`;
   không áp `lockedUntil`; **tài khoản đã bật 2FA → `TwoFactorRequiredError`**.
4. Thành công: `createSession` (không `mfa`) → audit `LOGIN_SUCCEEDED {method:"oauth", provider}` →
   `redirectRelative(safeRedirectPath(flow.next || landing, "/"))`.
5. Cần 2FA: cấp vé 2FA, đặt cookie `oauth_2fa` = `{ticket, next}` (httpOnly, SameSite=Lax, **path
   `/login`**, sống bằng hạn vé) → `/login?twoFactor=1`; vé không bao giờ nằm trên URL.
6. Lỗi → `/login?oauthError=state_mismatch|email_required|email_unverified|not_configured|
exchange_failed|banned|account_unavailable|invalid_provider|unknown`; chỉ `unknown` mới
   `logger.error`. Mọi lớp lỗi lấy từ `@/lib/errors` (không còn bộ lớp trùng tên trong
   `oauth/types.ts`).

- Chỉ phục vụ web (đặt cookie). Chưa có endpoint OAuth cho mobile, chưa có giao diện quản lý liên kết.
- `unlink` từ chối khi không có mật khẩu và còn ≤1 liên kết (không tính passkey).
- Redirect URI khai trên console provider phải khớp 100%:
  `<APP_URL hoặc NEXT_PUBLIC_APP_URL>/api/v1/auth/oauth/{google|github|facebook|apple}/callback`
  (CLAUDE.md ghi `/api/auth/oauth/...` là sai).

### 7.5 Đăng ký

- Web `registerAction`: `rateLimitAction(register)`; đọc email/password/fullName (**không đọc
  username**); `authService.register`; `DuplicateFieldError` → message; `createSession`;
  `redirect(safeRedirectPath(next || landing, "/"))`.
- API `POST /auth/register`: nhận cả username; 201 kèm token.
- `authService.register`: status ACTIVE, `roleKeys:[USER]` — **không bao giờ đọc vai trò từ
  input**; gửi email xác thực (lỗi chỉ ghi log). Xác thực email **không bắt buộc để đăng nhập**,
  nhưng là điều kiện để OAuth liên kết vào tài khoản (§7.4).

### 7.6 Email: xác thực, quên/đặt lại/đổi mật khẩu, đổi email

Token trong link (`verification.service.ts`): 32 byte, lưu SHA-256; `issue` xoá token chưa dùng
cùng loại; `consume` trả `null` khi sai loại/đã dùng/hết hạn, đánh dấu bằng `updateMany {id,
usedAt:null}` + kiểm `count === 1`. Hạn: EMAIL_VERIFICATION và EMAIL_CHANGE 24h, PASSWORD_RESET 60
phút. Email đi qua hàng đợi; link dựng bằng `appUrl()` (`APP_URL`, thiếu thì `NEXT_PUBLIC_APP_URL`).
Đường dẫn: `/verify-email?token=`, `/reset-password?token=`, `/confirm-email-change?token=`.

- **Xác thực email**: mở trang chỉ hiện nút; token chỉ tiêu khi BẤM. `verifyEmailAction` →
  `verifyEmail` (chỉ ghi khi đang null). API: `POST /verify-email` (công khai), `POST
/verify-email/request` (đã đăng nhập). Web: nút "Gửi lại email xác thực" ở `/security`
  (`resendVerificationEmailAction`, địa chỉ lấy từ tài khoản).
- **Quên mật khẩu**: `forgotPasswordAction` → `requestPasswordReset` (bỏ tài khoản xoá mềm; tài
  khoản chưa có mật khẩu vẫn được cấp link); nuốt mọi lỗi; luôn trả "Nếu địa chỉ này có tài khoản…".
- **Đặt lại mật khẩu**: `resetPasswordAction` → `resetPassword`: `consume` → nếu email tài khoản
  đang CHƯA xác thực và link gửi đúng địa chỉ đó (`destination === email`) thì **đánh dấu
  `emailVerifiedAt`, gỡ passkey, mã khôi phục và 2FA cũ** (chống tiền-chiếm) → băm mới, đặt
  `passwordChangedAt`, xoá khoá tạm (một transaction) → `revokeAllForUser` +
  `securityStamp.invalidate` → email báo. Action audit `PASSWORD_RESET`, `destroySession()`, rồi
  `redirect("/login?reset=1")`.
- **Đổi mật khẩu**: web `/security` (`changePasswordAction`) và API `POST /auth/change-password`.
  `changePassword` đòi mật khẩu hiện tại (`fakeCompare` nếu chưa có mật khẩu); ghi
  `passwordChangedAt`; `revokeAllForUser` (mọi họ) + `securityStamp.invalidate`; email báo. Nơi gọi
  cấp lại phiên cho thiết bị đang thao tác (§2). Audit `PASSWORD_CHANGED`.
- **Đổi email**: web `/security` (`requestEmailChangeAction`) hoặc API `POST /auth/change-email` →
  `requestEmailChange` (nhập lại mật khẩu; email mới đã có người → `DuplicateFieldError`; ghi
  **`pendingEmail`**; link tới địa chỉ MỚI; cảnh báo che một phần tới địa chỉ CŨ) → xác nhận qua web
  `/confirm-email-change` (không cần đăng nhập) hoặc API `/change-email/confirm` →
  `confirmEmailChange` (ghi email mới, `emailVerifiedAt = now`, `pendingEmail = null`, trùng →
  `isUniqueViolation`, `revokeAllForUser`; **không** cắt cookie web — quyết định giữ). Audit
  `EMAIL_CHANGE_REQUESTED` / `EMAIL_CHANGED`.

### 7.7 OTP số điện thoại (chỉ API; mặc định TẮT `PHONE_VERIFICATION_ENABLED=0`)

- `requestPhoneVerification`: kiểm cờ → `normalizePhone` (bỏ khoảng trắng/chấm/gạch, `+84` → `0`)
  → số đã thuộc người khác → trùng (kiểm TRƯỚC khi gửi) → giãn cách `otp:cooldown:<số>` 1 lần/60
  giây → trần ngày `otp:daily:<số>` 5/24h → `issue(PHONE_OTP)`: 6 chữ số, băm
  `hashScopedToken("<userId>:PHONE_OTP", code)`, hạn 5 phút → SMS không dấu qua hàng đợi. Route
  thêm rate limit IP 5/15′ (bucket `phone-otp-request`).
- `confirmPhoneVerification`: `destination` lấy từ token đang chờ; `consumeOtp` (sai tăng
  `attempts`; chạm `VERIFICATION_MAX_ATTEMPTS` (5) → huỷ mã + `TooManyVerificationAttemptsError`
  429); ghi `phone` + `phoneVerifiedAt`; trùng → `DuplicateFieldError`. Route rate limit bucket
  `phone-otp-verify`.
- `smser`: dev ghi mã ra log; production chưa `setSmser()` → ném lỗi.

### 7.8 Quản lý phiên (mobile)

- `GET /auth/sessions`: `id` (familyId), `userAgent`, `createdAt`, `expiresAt`.
- `DELETE /auth/sessions`: thu hồi mọi họ trừ `session.sid` (`exceptFamilyId`); audit
  `SESSION_REVOKED`.
- `DELETE /auth/sessions/[id]` và web `revokeSessionAction`: `revokeById(familyId, userId)` với
  `userId` trong `where`; không thu hồi được gì → 404 / "Không tìm thấy phiên đăng nhập này."; cả
  hai ghi audit `SESSION_REVOKED`. Access token của thiết bị kia vẫn sống ≤15 phút (thu hồi refresh
  không đụng security stamp).
- `listActive` chỉ lấy token chưa thu hồi, chưa hết hạn, gộp theo họ.

---

## 8. Đích sau đăng nhập, `?next=`, đăng nhập nhanh

**`landingPathFor(userId)`** (`landing.ts`), xét hẹp → rộng: `venue:approve` → `/venue-approvals`;
`invoice:manage` → `/invoices`; `user:read` → `/users`; `role:read` → `/roles`; có sân ACTIVE chưa
xoá → `/manage`; còn lại `/`.

**Luật `next`**:

- `next` không rỗng thì **LUÔN thắng**; mọi đích đi qua `safeRedirectPath(…, "/")`. Áp dụng ở
  login, 2FA (kể cả `next` trong cookie `oauth_2fa`), register, passkey, quick-login, OAuth
  (làm sạch ở `start` VÀ lại ở callback vì cookie `oauth_flow` không ký), và trang `/login`,
  `/register` khi người đã đăng nhập mở lại.
- `next` không hợp lệ rơi về fallback (`/`), không về landing.
- `requireUser()` tự tạo `?next=` từ `x-pathname` (kèm query); proxy tự tạo `?next=` cho 4 prefix.
- Luồng đặt sân dùng luật này để giữ lựa chọn: `SelectAndBook` dựng `returnPath` kèm
  `&chon=<encodeSelection>` cho link đăng nhập/đăng ký → quay lại trang sân khôi phục khung đã chọn
  (chi tiết ở `booking-payment.md`). Sửa luồng đăng nhập mà làm rơi `next` là hỏng luồng này — e2e
  `guest-booking.spec.ts` và `auth.spec.ts` sẽ bắt.

**`safeRedirectPath(value, fallback)`**: nhận chuỗi bắt đầu `/`, không bắt đầu `//`, không chứa `\`
hay ký tự điều khiển (kể cả DEL); parse bằng `new URL(value, "http://internal.invalid")`, origin
phải giữ nguyên; kiểm lại dạng đã chuẩn hoá (chặn `/.//evil.com`) và `pathname` đã giải mã (chặn
`/%5Cevil.com`, `%2F%2F`); trả dạng đã chuẩn hoá `pathname + search + hash`.

**`redirectRelative(path, status = 303)`**: `new Response(null, {status, headers:{Location: path}})`.
Lý do: ở `next dev`, `request.url` luôn là localhost; redirect tuyệt đối sang localhost khi người
dùng mở qua IP LAN bị CSP `form-action 'self'` chặn (GOTCHAS #16). Hàm không tự kiểm path — nơi gọi
phải làm sạch trước.

**Đăng nhập nhanh (chỉ dev)**:

- `QuickLogin` (`(auth)/login/quick-login.tsx`) trả `null` khi `NODE_ENV === "production"`. Mỗi tài
  khoản là một form thường `POST /api/dev/quick-login` với field ẩn `identifier`,
  `password=matkhau123`, `next`.
- Route: production → 404; kiểm kiểu string (400); chỉ nhận identifier đuôi `@dev.local` (không thì
  404); `validateCredentials` trong try/catch: `TwoFactorRequiredError` → `/login?quickLogin=2fa`,
  lỗi khác → `/login?quickLogin=failed`; `createSession`; `redirectRelative(safeRedirectPath(next ||
landing, "/"), 303)`. Không rate limit, không audit.

| Email                | Vai trò nền tảng | Quyền theo sân                                        | Đích mặc định      |
| -------------------- | ---------------- | ----------------------------------------------------- | ------------------ |
| `admin@dev.local`    | ADMIN            | —                                                     | `/venue-approvals` |
| `chusan@dev.local`   | USER             | OWNER mọi sân mẫu                                     | `/manage`          |
| `nhanvien@dev.local` | USER             | STAFF ACTIVE mọi sân mẫu, tick thêm `payment:confirm` | `/manage`          |
| `user@dev.local`     | USER             | —                                                     | `/`                |
| `ADMIN_EMAIL` (env)  | SUPER_ADMIN      | —                                                     | `/venue-approvals` |

Mật khẩu chung `matkhau123`. e2e dùng cùng bộ qua `e2e/helpers.ts` (`ACCOUNTS.{admin,owner,staff,
customer}`, `PASSWORD`, `login()`). `prisma/seed.ts`: production chỉ chạy rbac + sports + admin; dev
chạy thêm dev + venues + images.

---

## 9. Rate limit cho luồng auth (`rate-limit.ts`)

- Cửa sổ cố định. Có `REDIS_URL` → Redis (INCR + EXPIRE NX); không → RAM. Store lỗi → **fail-open**
  (có chủ đích). 429 kèm `Retry-After` (API) / câu "đợi N giây" (web).
- **IP** (`clientIpFromHeaders`, dùng chung cho `clientIp` của API và `actionClientIp` của action):
  phần tử `hops[len − TRUSTED_PROXY_HOPS]` của `X-Forwarded-For` (mặc định 1 = phần tử CUỐI, do
  proxy của ta thêm; ít phần tử hơn số hop thì lấy phần tử đầu) → không có XFF hoặc
  `TRUSTED_PROXY_HOPS=0` thì `x-real-ip` → `"unknown"` (mọi người chung một xô).
- **Web và API CHUNG xô**: khoá = `ipRateLimitKey(bucket, ip)` = `<bucket>:<ip>`, tên xô trong
  `RATE_LIMIT_BUCKETS`. Không còn tiền tố `api:` cho luồng có cả hai cửa.
- `claimOnce(key, ttl)` = `rateLimit("once:<key>", limit 1)` — dùng cho vé `jti` và bước TOTP.

| Xô (`RATE_LIMIT_BUCKETS`)                                      | Ngưỡng (`RATE_LIMITS`)            |
| -------------------------------------------------------------- | --------------------------------- |
| `login`                                                        | login 5 / 300s                    |
| `register`                                                     | register 5 / 3600s                |
| `refresh`                                                      | refresh 30 / 300s                 |
| `password-reset-request`, `email-verification-request`         | 3 / 900s                          |
| `email-change-request`, `email-change-confirm`                 | emailVerificationRequest 3 / 900s |
| `password-reset`, `password-change`, `email-verify`            | passwordChange 10 / 900s          |
| `2fa` (theo IP: verify web/API, bật, tắt, cấp lại mã)          | twoFactor 10 / 300s               |
| `2fa-account:<userId>` (theo TÀI KHOẢN, trong `verifyCode`)    | twoFactorAccount 5 / 900s         |
| `passkey` (options + verify đăng nhập web/API, đăng ký verify) | passkey 30 / 300s                 |
| `phone-otp-request`, `phone-otp-verify`                        | phoneOtp 5 / 900s                 |
| `api:upload` (chỉ API)                                         | upload 60 / 300s                  |

**Không có rate limit**: `api/dev/quick-login`, `POST /2fa/setup` và `beginTwoFactorSetupAction`,
`/passkeys/register/options`, OAuth `start`/`callback`, `POST /auth/logout`, `/auth/sessions*`.

---

## 10. Audit log

`auditService.record` không bao giờ ném lỗi; bảng không có khoá ngoại tới users; `actorEmail` chép
tại lúc ghi. **Mọi nơi dùng hằng `AUDIT_ACTIONS`** (`audit.schema.ts`) — không còn chuỗi tự do như
`"user.banned"`.

**Có ghi**:

- `LOGIN_SUCCEEDED` (`metadata.method` = password / 2fa / passkey / oauth): web mật khẩu, web 2FA,
  web passkey, OAuth callback, API login, API 2fa/verify, API passkey.
- `LOGIN_FAILED` qua `recordLoginFailure` (web + API mật khẩu): chỉ tài khoản CÓ THẬT, `reason` =
  invalid_password / locked / banned / inactive.
- `TWO_FACTOR_FAILED` (web + API), `TWO_FACTOR_ENABLED`/`DISABLED`/`RECOVERY_REGENERATED`,
  `PASSKEY_REGISTERED`, `PASSKEY_REMOVED`, `PASSWORD_CHANGED`, `PASSWORD_RESET`,
  `EMAIL_CHANGE_REQUESTED`, `EMAIL_CHANGED` (web + API), `PHONE_VERIFIED`, `REFRESH_TOKEN_REUSED`,
  `SESSION_REVOKED` (web một phiên, API một phiên, API mọi phiên khác).
- Quản trị: `USER_CREATED`, `USER_UPDATED` (API PATCH, kể cả tự sửa `{self:true}`), `USER_DELETED`,
  `USER_STATUS_CHANGED` (`{from, to}`), `USER_UNLOCKED`, `USER_ROLES_ASSIGNED`,
  `USER_PERMISSION_OVERRIDDEN`, `ROLE_CREATED`/`UPDATED`/`DELETED` (web + API).
- Nhân sự sân: `VENUE_MEMBER_INVITED`, `VENUE_MEMBER_PERMISSIONS_UPDATED`, `VENUE_MEMBER_REMOVED`.

**Không ghi**: quick-login, đăng ký, đăng xuất, liên kết/gỡ OAuth, đổi tên passkey, bắt đầu thiết lập
2FA, đăng nhập thất bại với email không tồn tại (cố ý).

---

## 11. REST API auth / users / roles (`/api/v1`)

| Route                                                  | Guard                                                                        | Rate limit (xô)                       | Việc                                                              | Audit                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| POST auth/register                                     | công khai                                                                    | register                              | `register` → `issueTokenPair` (201)                               | —                                         |
| POST auth/login                                        | công khai                                                                    | login                                 | `validateCredentials`; cần 2FA thì trả vé                         | LOGIN_SUCCEEDED / LOGIN_FAILED            |
| POST auth/2fa/verify                                   | vé 2FA                                                                       | 2fa                                   | verifyTicket + verifyCode + consumeTicket → token (`twoFactorAt`) | TWO_FACTOR_FAILED / LOGIN_SUCCEEDED       |
| POST auth/refresh                                      | refresh token                                                                | refresh                               | `rotate` → access mới có `sid`, `mfa`                             | REFRESH_TOKEN_REUSED                      |
| POST auth/logout                                       | requireApiUser                                                               | —                                     | `revoke(refreshToken)` hoặc `allDevices`                          | —                                         |
| GET auth/me                                            | requireApiUser                                                               | —                                     | `findById`                                                        | —                                         |
| POST auth/forgot-password                              | công khai                                                                    | password-reset-request                | luôn 200                                                          | —                                         |
| POST auth/reset-password; POST auth/verify-email       | token                                                                        | password-reset / email-verify         | `resetPassword` / `verifyEmail`                                   | PASSWORD_RESET / —                        |
| POST auth/verify-email/request                         | requireApiUser                                                               | email-verification-request            | `sendEmailVerification`                                           | —                                         |
| POST auth/change-password                              | requireApiUser                                                               | password-change                       | `changePassword` → cặp token mới cùng `familyId`                  | PASSWORD_CHANGED                          |
| POST auth/change-email; POST auth/change-email/confirm | requireApiUser / token                                                       | email-change-request/-confirm         | `requestEmailChange` / `confirmEmailChange`                       | EMAIL_CHANGE_REQUESTED / EMAIL_CHANGED    |
| GET, DELETE auth/2fa                                   | requireApiUser                                                               | DELETE: 2fa                           | status (+`available`) / `disable`                                 | TWO_FACTOR_DISABLED                       |
| POST auth/2fa/setup                                    | requireApiUser                                                               | **không**                             | `beginSetup`                                                      | —                                         |
| POST auth/2fa/enable; POST auth/2fa/recovery-codes     | requireApiUser                                                               | 2fa                                   | `confirmSetup` / `regenerateRecoveryCodes`                        | TWO_FACTOR_ENABLED / RECOVERY_REGENERATED |
| GET auth/passkeys; PATCH, DELETE auth/passkeys/[id]    | requireApiUser                                                               | —                                     | `list` / `rename` / `remove`                                      | PASSKEY_REMOVED                           |
| POST auth/passkeys/register/options                    | requireApiUser                                                               | **không**                             | options + vé `webauthn_reg`                                       | —                                         |
| POST auth/passkeys/register/verify                     | requireApiUser                                                               | passkey                               | vé.sub = session.sub, consumeTicket → lưu                         | PASSKEY_REGISTERED                        |
| POST auth/passkeys/login/options; …/login/verify       | công khai / vé                                                               | passkey                               | options + vé / consumeTicket + xác minh → token                   | LOGIN_SUCCEEDED                           |
| POST auth/phone/request-otp; POST auth/phone/verify    | requireApiUser                                                               | phone-otp-request/-verify (+ theo số) | gửi / xác nhận OTP                                                | PHONE_VERIFIED                            |
| GET, DELETE auth/sessions; DELETE auth/sessions/[id]   | requireApiUser                                                               | —                                     | `listActive` / thu hồi trừ `sid` / `revokeById` (404)             | SESSION_REVOKED (hai DELETE)              |
| GET auth/oauth/providers                               | công khai                                                                    | —                                     | provider đã cấu hình                                              | —                                         |
| GET auth/oauth/linked; DELETE auth/oauth/[provider]    | requireApiUser                                                               | —                                     | `listLinked` / `unlink`                                           | —                                         |
| GET auth/oauth/[provider]/start; GET, POST …/callback  | công khai                                                                    | —                                     | luồng redirect, **đặt cookie phiên web** hoặc cookie `oauth_2fa`  | LOGIN_SUCCEEDED                           |
| GET users                                              | `user:read`                                                                  | —                                     | `list`                                                            | —                                         |
| POST users                                             | `user:create`                                                                | —                                     | `create(body, {actorId})` ✅                                      | USER_CREATED                              |
| GET users/[id]                                         | requireApiUser + `canActOnResource(user:read / profile:read:own)` → 403      | —                                     |                                                                   | —                                         |
| PATCH users/[id]                                       | id = mình: `profile:update:own`, trường cấm → 422; người khác: `user:update` | —                                     | mình: `updateProfile`; người khác: `update(actorId)`              | USER_UPDATED                              |
| DELETE users/[id]                                      | `user:delete`                                                                | —                                     | `softDelete(actorId)`                                             | USER_DELETED                              |
| PATCH users/[id]/status                                | `user:update`                                                                | —                                     | `setStatus(actorId)`                                              | USER_STATUS_CHANGED                       |
| POST users/[id]/unlock                                 | `user:update`                                                                | —                                     | `unlock(actorId)`                                                 | USER_UNLOCKED                             |
| PUT users/[id]/roles                                   | `user:update`                                                                | —                                     | `update({roleKeys}, actorId)`                                     | USER_ROLES_ASSIGNED                       |
| GET, PUT users/[id]/permissions                        | `user:read` / `user:update`                                                  | —                                     | `explainFor` / `setUserPermission(actorId)`                       | USER_PERMISSION_OVERRIDDEN (PUT)          |
| DELETE users/[id]/permissions/[permissionKey]          | `user:update`                                                                | —                                     | `clearUserPermission(actorId)`                                    | USER_PERMISSION_OVERRIDDEN                |
| GET roles, GET roles/[key], GET permissions            | `role:read`                                                                  | —                                     | vai trò (`description` là chuỗi) + danh mục quyền (từ code)       | —                                         |
| POST roles; PATCH, DELETE roles/[key]                  | `role:create` / `role:update` / `role:delete`                                | —                                     | create / update / remove, **đều truyền actorId** ✅               | ROLE_CREATED / UPDATED / DELETED          |

- PATCH users/[id] tự sửa: `email`, `phone`, `password`, `username`, `status`, `roleKeys` trong body
  → 422 kèm câu chỉ đúng luồng (`SELF_FORBIDDEN_FIELDS`).
- Thêm route mới phải khai báo trong `src/lib/openapi/registry.ts` (test so khớp hai chiều).

---

## 12. Bất biến — không được phá

1. **Mọi Server Action bọc wrapper**; chỉ luồng đăng nhập công khai được viết trần. _Lý do:_ action
   là HTTP endpoint công khai; proxy và layout không bảo vệ; wrapper biến việc quên kiểm quyền thành
   lỗi biên dịch.
2. **Mọi route `/api/**` tự gọi guard.** _Lý do:_ proxy cố ý không chạy trên `/api` để trả JSON 401
   thay vì redirect.
3. **Quyền tra DB theo userId, không đọc từ JWT.** _Lý do:_ token sống lâu; tước quyền phải có hiệu
   lực ngay (cache ≤60 giây).
4. **Câu hỏi theo sân chỉ một dạng `canOnVenue`** (hoặc `venuePermissions` khớp với nó), không bao
   giờ `role === "OWNER"`; id con lọc theo `ctx.venueId` trong truy vấn, lệch sân → NOT_FOUND. _Lý
   do:_ bản cũ chỉ kiểm phạm vi sân ở 2/29 service, nhân viên sân A thao tác được sân B.
5. **`VENUE_OWNER_ONLY` không bao giờ tới tay STAFF hay quyền toàn cục**; giao diện không có ô tick.
   _Lý do:_ đây là tiền rời hệ thống và mất sân; service chặn cả khi ghi thẳng vào DB.
6. **`invoice:manage` ≠ `payout:approve`.** _Lý do:_ người thu tiền không được mở đường chi tiền.
7. **Danh mục quyền nằm trong code, việc gán nằm trong DB**; key lạ trong DB bị bỏ qua
   (`isKnownPermission`). _Lý do:_ quyền chỉ có nghĩa khi có dòng mã kiểm nó.
8. **Mọi đường ghi thẩm quyền gọi `invalidateUser`/`invalidateAll`; mọi đường đổi mật khẩu/trạng
   thái/xoá gọi `securityStampService.invalidate`.** _Lý do:_ quên thì hiệu lực trễ tới 60 giây.
9. **Tước (`isGranted=false`) luôn thắng; ngoại lệ hết hạn lọc trong truy vấn.**
10. **`actorId` bắt buộc (`string | null`) ở mọi hàm ghi user/role/member; `level` luôn đồng bộ từ
    code khi seed; không cấp quyền mình không có.** _Lý do:_ chặn ADMIN tự tạo SUPER_ADMIN hay tự
    tick quyền chỉ SA có — bản cũ để `actorId` tuỳ chọn và mọi nơi quên truyền.
11. **Không đọc vai trò từ form web; đăng ký công khai luôn là USER; `isSystem` không nhận từ input;
    tự sửa hồ sơ không đổi được email/phone/username/status/vai trò.** _Lý do:_ tránh tự phong
    ADMIN hoặc lách luồng xác thực bằng một field.
12. **Không tự đổi vai trò, tự khoá, tự xoá chính mình; nhân viên không tự sửa/gỡ mình trên sân.**
    _Lý do:_ quản trị viên cuối cùng không tự khoá mình ra ngoài; không tự leo quyền.
13. **Thất bại đăng nhập đồng nhất**: cùng một lỗi, `fakeCompare` cho user không tồn tại; khoá tạm
    kiểm TRƯỚC mật khẩu; BANNED/INACTIVE chỉ lộ SAU KHI mật khẩu đúng; cổng 2FA đặt cuối và dùng
    exception. _Lý do:_ chống dò tài khoản/mật khẩu; nơi gọi không thể "quên" 2FA.
14. **`assertLoginAllowed` ở mọi đường đăng nhập** (mật khẩu, bước 2FA, passkey, OAuth);
    `lockedUntil` chỉ áp cho mật khẩu; OAuth với tài khoản bật 2FA phải qua bước mã.
15. **JWT phân loại bằng `typ` bắt buộc**: `verifySession` chỉ nhận `"access"`, `verifyTicket` nhận
    đúng loại; vé tiêu bằng `consumeTicket`. _Lý do:_ mọi JWT dùng chung một khoá; thiếu phép kiểm
    thì vé 2FA dùng như phiên hoàn chỉnh; không tiêu vé thì phát lại được.
16. **Bí mật chỉ lưu dạng băm**: refresh và link token SHA-256 trần; OTP và mã khôi phục dùng
    `hashScopedToken` kèm userId; OTP đi qua `consumeOtp`, link qua `consume` (gọi nhầm thì ném lỗi);
    tiêu thụ bằng `updateMany … usedAt: null`. _Lý do:_ rò DB không lộ phiên; `SHA256("123456")` là
    hằng số nên tra chéo được; đua request chỉ một bên thắng.
17. **Bí mật TOTP mã hoá AES-256-GCM; không đổi `ENCRYPTION_KEY`.** _Lý do:_ đổi khoá là hỏng mọi
    2FA đã bật.
18. **Refresh token xoay vòng giữ `familyId`; `sessionId` trả client là `familyId`** (login, refresh,
    change-password phải khớp). _Lý do:_ client nhận ra "thiết bị này"; lỗi trả `id` đã từng xảy ra.
19. **Ràng buộc sở hữu nằm trong `where`** (revokeById, passkey, member theo venueId); trả 404 không
    phân biệt. _Lý do:_ id đến từ client.
20. **Web trả 404 khi thiếu quyền; API trả 401/403** (theo sân thì 404).
21. **Không lộ email có tồn tại hay không**: quên mật khẩu luôn thành công và nuốt lỗi; gửi lại email
    xác thực lấy địa chỉ từ tài khoản; `LOGIN_FAILED` không ghi cho email không tồn tại.
22. **Token trong link chỉ tiêu khi BẤM NÚT (POST).** _Lý do:_ bộ quét link của Gmail/Outlook.
23. **Mọi `next` qua `safeRedirectPath`; route handler redirect bằng `redirectRelative`.**
24. **Web đăng xuất bằng Server Action xoá cookie**, không gọi `/api/v1/auth/logout` (endpoint đó
    đòi body JSON, GOTCHAS #14).
25. **Passkey không hỏi TOTP; không xoá hoặc gỡ được "cách đăng nhập cuối cùng".**
26. **Đăng nhập nhanh chỉ ở dev** (loại khỏi bundle production, route 404, chỉ `@dev.local`, vẫn kiểm
    mật khẩu).
27. **Chỉ 3 vai trò nền tảng**; không thêm OWNER/STAFF vào bảng `roles`. _Lý do:_ `STAFF` tồn tại ở
    hai nơi với hai nghĩa là cái bẫy đã làm hỏng bản cũ.
28. **Giữ index viết tay** `users_{email,phone,username}_active_key` và
    `venue_members_mot_chu_cho_moi_co_so`; không dùng `prisma migrate dev` (GOTCHAS #11).
29. **SMS mặc định tắt, ba lớp chặn** (IP, giãn cách theo số, trần ngày theo số). _Lý do:_ mỗi tin
    là tiền thật.
30. **Web và API của cùng một luồng đếm CHUNG xô rate limit; IP đọc qua `clientIpFromHeaders`.**
    _Lý do:_ hai xô là gấp đôi số lần thử; đọc phần tử đầu XFF là để kẻ dò tự chọn xô.
31. **Liên kết OAuth chỉ vào tài khoản đã xác thực email.** _Lý do:_ chống tiền-chiếm tài khoản.

---

## 13. Mẫu mã khi viết mới

**13.1 Server Action cần quyền toàn cục**

```ts
"use server";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";
import { AUDIT_ACTIONS } from "@/schemas/audit.schema";

export type XState = { error?: string; ok?: string }; // mọi trường tuỳ chọn

export const approveXAction = defineAction(
  "venue:approve",
  async (ctx, _prev: XState, formData: FormData): Promise<XState> => {
    const parsed = xSchema.safeParse(Object.fromEntries(formData)); // tên field phải khớp schema
    if (!parsed.success) return { error: "Dữ liệu không hợp lệ" };
    try {
      await xService.approve(parsed.data, { actorId: ctx.actorId });
    } catch (e) {
      if (e instanceof DomainError) return { error: e.message };
      throw e;
    }
    await auditService.record({
      action: AUDIT_ACTIONS.X,
      entity: "x",
      entityId: parsed.data.id,
      actorId: ctx.actorId,
      actorEmail: ctx.session.email,
    });
    revalidatePath("/x");
    return {};
  },
);
```

- Luôn truyền `actorId` xuống service có chốt level (kiểu bắt buộc, quên là lỗi biên dịch). Tên audit
  dùng hằng `AUDIT_ACTIONS` (thêm hằng trước nếu chưa có).
- Không đọc vai trò hay quyền từ form. Trang tương ứng gọi `await requirePermission("venue:approve")`
  (không cần viết cứng đường quay về).

**13.2 Action theo sân**: `defineVenueAction("booking:cancel", async (ctx, _prev, formData) => …)`;
UI gọi `action.bind(null, venueId)`. Service lọc id con ngay trong truy vấn, ví dụ `where: { id:
bookingId, venueId: ctx.venueId }`, không thấy → lỗi NOT_FOUND. Test phải có ca "id của sân khác →
NOT_FOUND" với mock lọc thật. Trang dùng `requireVenueAccess(venueId, "booking:read")`. Màn cần nhiều
quyền trên sân một lúc thì dùng `permissionService.venuePermissions(userId, venueId)`.

**13.3 Chỉ cần đăng nhập** (dữ liệu của chính mình): `defineAuthedAction`, luôn ràng buộc `userId:
ctx.actorId` trong `where`. Luồng có bản REST tương ứng thì thêm `rateLimitAction(RATE_LIMIT_BUCKETS.x,
RATE_LIMITS.y)` cùng xô với API. **Công khai**: `definePublicAction("lý do", { key: "ten", limit: 10,
windowSeconds: 60 }, handler)`, xử lý `ctx.actorId` có thể null.

**13.4 Route API cần đăng nhập hoặc quyền**

```ts
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireApiPermission(request, "user:update"); // hoặc requireApiUser / requireVenuePermission
    const body = await parseJsonBody(request, schema); // 400/422 tự động
    return apiOk({ item: await service.do(id, body, { actorId: session.sub }) });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/…", request });
  }
}
```

- Endpoint công khai: `enforceRateLimit(request, RATE_LIMIT_BUCKETS.x, RATE_LIMITS.y)` — luồng có
  cả bản web thì PHẢI dùng hằng xô chung; chuỗi tự do (`"api:upload"`) chỉ cho luồng chỉ có ở API.
  Tài nguyên của chính người gọi: `userId` trong `where`, không thấy → `apiErrors.notFound()`. Khai
  báo route trong `src/lib/openapi/registry.ts`.

**13.5 Thêm permission mới**

1. Thêm key vào `PERMISSIONS` (dạng `tài-nguyên:hành-động`).
2. Thêm vào `PERMISSION_METADATA` (TypeScript bắt nếu thiếu).
3. Thêm vào `DEFAULT_ROLE_PERMISSIONS` nếu cần; ADMIN phải vẫn chứa mọi quyền của USER (test kiểm).
4. Quyền theo sân: đặt vào đúng MỘT trong `VENUE_STAFF_DEFAULT` / `VENUE_STAFF_GRANTABLE` /
   `VENUE_OWNER_ONLY`.
5. `pnpm db:seed` (không cần migration). Quyền mới được seed thêm vào vai trò mặc định; quyền cũ đã
   bị gỡ thì không bị thêm lại.

**13.6 Ghi vào bảng thẩm quyền**: gọi `permissionService.invalidateUser(userId)` hoặc
`invalidateAll()`; đi qua `assertCanActOn` / `assertCanAssignRoles` / `assertCanManageLevel` /
`assertCanGrant` với `actorId` thật. Đổi mật khẩu/trạng thái/xoá thì thêm
`securityStampService.invalidate(userId)`.

**13.7 Thêm một đường đăng nhập mới**: `assertLoginAllowed(user.status, user.id)`; tài khoản bật 2FA
thì ném/xử lý `TwoFactorRequiredError` (trừ passkey); web `createSession({typ:"access", sub, email,
roles, mfa?})`, mobile `issueTokenPair(user, {userAgent, ip, twoFactorAt?})`; đích
`safeRedirectPath(next || await landingPathFor(user.id), "/")`, route handler dùng
`redirectRelative`; audit `LOGIN_SUCCEEDED` kèm `metadata.method`; thất bại thì
`recordLoginFailure`; rate limit bằng xô chung.

**13.8 Token hoặc mã mới**: token 256 bit → `generateOpaqueToken` + `hashOpaqueToken`; mã entropy
thấp → `hashScopedToken(scope, code)` + bộ đếm lần thử + hạn ngắn; JWT ngắn hạn → thêm một `typ` vào
union trong `tickets.ts` (có sẵn `jti`), tiêu bằng `consumeTicket`, không dùng `signSession`.

**13.9 Lỗi nghiệp vụ**: kế thừa `DomainError` với `code` có sẵn, khai trong `src/lib/errors.ts` (kể
cả lỗi OAuth); `handleApiError` tự ánh xạ HTTP; action trả `error.message`. Trùng khoá bắt bằng
`isUniqueViolation` (`src/lib/prisma-errors.ts`), không đọc `meta.target` (GOTCHAS #10).

---

## 14. Nghi lỗi và lỗ hổng ĐÃ BIẾT (còn mở tại 17/09/2026, sau đợt sửa)

> Đây là danh sách để **biết**, không phải việc tự ý làm. Task chạm vào vùng đó thì báo user kèm mục
> số; sửa thì phải có test chứng minh lỗi trước. ✅ = đã đối chiếu lại mã. Các mục cũ đã sửa chuyển
> sang §15.

### 14.1 Mức TRUNG BÌNH

1. ✅ **Socket realtime đang mở không bị cắt khi thu hồi phiên.** Security stamp chỉ kiểm lúc
   handshake (và lúc phục hồi phiên); socket mở trước khi khoá/đổi mật khẩu vẫn nhận tin tới khi rớt
   mạng hoặc máy chủ khởi động lại.
2. ✅ **Thiếu `REDIS_URL` thì thu hồi và tước quyền không lan giữa instance.** `invalidate` /
   `invalidateUser` chỉ xoá cache RAM của tiến trình đang chạy; tiến trình khác trễ tới 60 giây. Rate
   limit, `claimOnce` (vé dùng một lần, chống phát lại TOTP) cũng đếm riêng từng tiến trình.
3. ✅ **Rate limit và `claimOnce` fail-open** khi Redis lỗi: trong lúc đó vé 2FA/passkey dùng lại
   được tới hết hạn và không có trần thử mã theo tài khoản. Có chủ đích nhưng phải biết.
4. ✅ **Thu hồi một phiên mobile không cắt access token của phiên đó** (`revokeById` chỉ đụng refresh
   token, không đụng stamp) → sống thêm ≤15 phút.
5. **CSRF trên REST**: cookie fallback của `getApiSession` chỉ dựa vào `SameSite=Lax`, không kiểm
   Origin hay token CSRF; mọi subdomain cùng site đều là "same-site".

### 14.2 Mức THẤP / không nhất quán

- Không rate limit: `POST /auth/2fa/setup`, `beginTwoFactorSetupAction`,
  `/passkeys/register/options`, OAuth `start`/`callback`, `api/dev/quick-login` (chỉ dev).
- Chênh thời gian: sai mật khẩu có thêm ghi DB (`registerFailedAttempt`), không tồn tại chỉ
  `fakeCompare`.
- Claim `mfa` chỉ được giữ lại khi cấp lại phiên, chưa nơi nào đọc để quyết định (chưa có step-up).
- Khoá tạm cho người không biết mật khẩu biết tài khoản tồn tại và đang bị khoá (cái giá có chủ
  đích của việc kiểm khoá trước mật khẩu).
- Proxy chỉ kiểm chữ ký: cookie đã thu hồi vẫn qua proxy tới 4 prefix được bảo vệ; trang tự chặn
  bằng `getSession` (không phải lỗ hổng, nhưng đừng coi proxy là ranh giới).
- Quick-login không audit.

---

## 15. Lỗi đã gặp và ĐÃ sửa (đừng tái phạm)

- Form gửi `email` trong khi schema đòi `identifier`, `name` thay vì `fullName` → đăng nhập hỏng
  mà không lớp nào báo (GOTCHAS #1, #13). Chỉ e2e bắt được loại này.
- Đích mặc định `/users` sau đăng nhập/đăng ký/2FA/passkey/proxy làm người thường rơi vào 404;
  redirect hỏng giữa chừng còn làm mất cookie. Nay dùng `landingPathFor`.
- Header và layout từng gọi `can(user.roles.join())` thay vì `can(user.id)` → menu quản trị không
  bao giờ hiện.
- Nút đăng xuất trỏ `/api/v1/auth/logout` → hiện trang JSON thô (GOTCHAS #14).
- Redirect tuyệt đối từ `request.url` bị CSP chặn khi mở qua IP LAN (GOTCHAS #16).
- `/auth/refresh` từng trả `id` thay vì `familyId`.
- `setUserPermission` từng quên invalidate cache.
- Action theo sân chỉ kiểm venueId của URL → IDOR ở 5 action (GOTCHAS #19).
- `registerAction` và passkey từng bỏ qua `next` → khách đăng ký giữa luồng đặt sân mất khung đã
  chọn.
- `prisma migrate dev` đã xoá index viết tay (GOTCHAS #11).

**Đợt sửa 17/09/2026** (từng nằm ở §14, nay đã sửa trong mã):

- Thu hồi phiên không hoạt động (`isTokenStillValid` không ai gọi); khoá/ban không cắt cookie web;
  `defineAuthedAction`/`requireApiUser` cho qua user đã xoá mềm → nay security stamp ở mọi cửa +
  `permissionService.load` lọc ACTIVE.
- Chốt `Role.level` không bao giờ chạy vì không nơi nào truyền `actorId` (roles web/API, `POST
/users` cho ADMIN tạo SUPER_ADMIN) → `actorId` thành bắt buộc; thêm `assertCanGrant`.
- Tiền-chiếm tài khoản qua OAuth (liên kết vào email chưa xác thực) → `email_unverified`;
  `resetPassword` xác thực email và gỡ passkey/2FA cũ.
- Khoá tạm là "oracle" mật khẩu → kiểm khoá TRƯỚC khi so mật khẩu.
- Open redirect `/\evil.com`, `/<TAB>/evil.com` qua `safeRedirectPath` → parse bằng `URL`.
- Nút Khoá/Mở khoá `/users` luôn báo lỗi (parse sai schema) → `setUserStatusSchema`.
- `PATCH /users/[id]` tự sửa luôn 403 → nhánh `updateProfile` riêng, trường cấm → 422.
- Trùng khoá lúc đua thành 500 (`catchDuplicate` đọc `meta.target`) → `isUniqueViolation`.
- Lỗi OAuth so `instanceof` với lớp trùng tên → một nguồn `@/lib/errors`; tài khoản tạm
  ngưng/xoá mềm → `account_unavailable`.
- OAuth bỏ qua TOTP → cookie `oauth_2fa` + `/login?twoFactor=1`.
- Apple `form_post` không nhận cookie Lax → `SameSite=None; Secure` cho luồng đó (chưa thử trên trình
  duyệt thật với Apple).
- 2FA không có bộ đếm theo tài khoản, vé dùng lại được, web/API hai xô, TOTP phát lại được → bộ
  đếm `twoFactorAccount`, `jti` + `consumeTicket`, xô chung, chống phát lại bước TOTP.
- Nhân viên có `member:manage` tự leo quyền → luật tự sửa/chủ sân/chỉ cấp quyền mình có.
- `clearUserPermission`/`unlock` không chốt level; `setUserPermission` cấp được quyền người cấp
  không có → sửa.
- `APP_URL` vs `NEXT_PUBLIC_APP_URL` lệch giữa email/OAuth/passkey → `appBaseUrl()`.
- `canOnVenue` cho thành viên thao tác trên sân đã xoá mềm → chặn nhánh thành viên.
- Rate limit đọc phần tử ĐẦU của XFF (client tự đặt được) → `TRUSTED_PROXY_HOPS`.
- Thấp: `update` đổi status không thu hồi; `rotate` không chặn INACTIVE; admin đổi email không reset
  `emailVerifiedAt`; refresh làm mất `mfa`/`ip`; `typ` có `.default("access")`; web không bắt
  `AccountInactiveError`; quick-login 500 khi sai mật khẩu/2FA; layout quản trị và
  `requireVenueAccess` viết cứng đường quay về; header thiếu `/invoices`; proxy đá người đăng nhập
  khỏi `/login` bỏ qua `next` (và gây vòng lặp khi phiên bị thu hồi); audit dùng chuỗi tự do (đặt
  INACTIVE ghi thành `"user.unbanned"`); schema auth khai báo thừa/lệch; `verifyPhoneOtpSchema` chặn
  khoảng trắng giữa; passkey không tồn tại báo "Không tìm thấy người dùng"; `/2fa/setup` thiếu
  `ENCRYPTION_KEY` → 500; `GET /roles` trả `description` là object; `passkey-manager` viết cứng
  `/api/v1`; `TwoFactorForm` nhận action qua prop; `oauth/start` trả JSON ngoài envelope; `seedRbac`
  thêm lại quyền đã gỡ.

---

## 16. Việc dở, mã chết

- Web **chưa có** giao diện: xác thực số điện thoại, quản lý liên kết OAuth. (Đổi mật khẩu, đổi
  email, gửi lại email xác thực đã có ở `/security`.)
- Mã không ai dùng: `requireVenuePermission` (chờ REST cho sân), `resendEmailVerification`,
  `userService.getProfile`. Đã xoá hẳn: `requireAdmin`, `requireApiAdmin`, `canAny`, `canAll`,
  `venuesWithPermission`, `isGrantableToStaff`, `permissionsByCategory`, `logoutAction` trong
  `(auth)/actions.ts`, `API_PUBLIC_URL`/`apiUrl`/`publicAppUrl`.
- Luồng lời mời nhân viên (INVITED, trang chấp nhận) chưa có: mời xong là ACTIVE ngay.
- Chưa có endpoint OAuth cho mobile; chưa có REST cho sân.

---

## 17. Di sản bộ khung và tài liệu lệch mã

- Giao diện `(auth)/**`, `/security`, `/sessions`, `/users`, `/roles` đã làm lại theo hệ token mới
  (không còn inline style, `.badge-*`/`.alert-*`, `trang-title`). Dấu vết đổi tên regex và dấu vết
  NestJS/monorepo trong chú thích auth đã dọn; `APP_NAME` mặc định là "ChốtSân"; tên tiếng Việt trong
  mã (`lyDo`, `DangNhapNhanh`…) đã đổi sang tiếng Anh (`reason`, `QuickLogin`).
- **README.md** được cập nhật song song với đợt sửa này; khi lệch với mã thì tin mã và tệp này.
- **`docs/HUONG_DAN_KIEN_TRUC_RBAC_VA_AUTH.md` gần như lỗi thời hoàn toàn** (bcrypt; 5 vai trò
  MANAGER/STAFF/CUSTOMER; `User.roleId`; access token mang permissions; refresh 7 ngày;
  `seed-prod.ts`; "không cho sửa System Roles"). Đầu tệp đã có khối cảnh báo trỏ về đây. Đừng tin.
- **CLAUDE.md** còn lệch: nhắc `recordOrThrow()` (không tồn tại); OAuth route `/api/auth/oauth/...`
  (thực tế `/api/v1/auth/oauth/...`); lớp trang `requireAdmin` (đã xoá); `permissionService.invalidate()`
  (thực tế `invalidateUser`/`invalidateAll`); lệnh `pnpm db:migrate` (script đã gỡ, dùng
  `db:migrate:diff` + `db:deploy`).

---

## 18. Vận hành

| Biến                                                                                                                                             | Mặc định            | Tác dụng                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                                                                                                                                 | bắt buộc, ≥32 ký tự | Ký JWT phiên và mọi vé; `realtime/` phải dùng giá trị trùng. Xoay khoá = mọi người đăng nhập lại                                                                     |
| `SESSION_MAX_AGE_DAYS`                                                                                                                           | 7 (≤365)            | Hạn cookie/JWT web; cửa sổ thiệt hại khi lộ cookie mà tài khoản chưa bị khoá/đổi mật khẩu                                                                            |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS`                                                                                            | 15 / 30             | Token mobile                                                                                                                                                         |
| `TWO_FACTOR_CHALLENGE_TTL_MINUTES`                                                                                                               | 5 (≤30)             | Hạn vé 2FA và cookie `oauth_2fa`                                                                                                                                     |
| `SESSION_STRICT_REVOCATION`                                                                                                                      | 1                   | Bật phép so `iat` với `passwordChangedAt`. `0` chỉ tắt phép so đó; khoá/xoá luôn cắt phiên. Chỉ nhận `1`/`0`                                                         |
| `LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES`                                                                                            | 5 / 15              | Khoá tạm theo tài khoản                                                                                                                                              |
| `EMAIL_VERIFICATION_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES`                                                                                    | 24 / 60             | Hạn link (đổi email dùng chung 24h)                                                                                                                                  |
| `PHONE_VERIFICATION_ENABLED`, `PHONE_OTP_TTL_MINUTES`, `PHONE_OTP_RESEND_COOLDOWN_SECONDS`, `PHONE_OTP_MAX_PER_DAY`, `VERIFICATION_MAX_ATTEMPTS` | 0, 5, 60, 5, 5      | Luồng SMS. Chỉ nhận `1`/`0`. `VERIFICATION_MAX_ATTEMPTS` chỉ đếm OTP SMS, không liên quan 2FA                                                                        |
| `ENCRYPTION_KEY`                                                                                                                                 | trống (≥16 khi đặt) | AES-256-GCM (SHA-256 của chuỗi) cho bí mật TOTP. Trống = 2FA ẩn. **Không đổi sau khi đã có dữ liệu**                                                                 |
| `APP_URL`                                                                                                                                        | trống               | Gốc URL công khai cho link email, `redirect_uri` OAuth, rpID/origin passkey (`appBaseUrl()`)                                                                         |
| `NEXT_PUBLIC_APP_URL`                                                                                                                            | trống               | Dự phòng khi thiếu `APP_URL`. Thiếu cả hai: `appUrl` ném lỗi, OAuth và passkey bị ẩn                                                                                 |
| `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGINS`                                                                                                            | trống               | Phải đặt **cả hai** mới bỏ qua `appBaseUrl()`. Đổi RP ID = mọi passkey cũ chết. App mobile cần thêm origin `android:apk-key-hash:…`                                  |
| `APP_NAME`                                                                                                                                       | "ChốtSân"           | Issuer TOTP và rpName passkey                                                                                                                                        |
| `TRUSTED_PROXY_HOPS`                                                                                                                             | 1 (0–10)            | Số reverse proxy tin cậy đứng trước app; IP = phần tử `len − hops` của XFF. `0` = bỏ XFF, dùng `x-real-ip`                                                           |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_*`, `FACEBOOK_*`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY`                                                | trống               | Thiếu thì provider bị ẩn. Khoá `.p8` dán `\n` dạng chữ vẫn được                                                                                                      |
| `REDIS_URL`                                                                                                                                      | trống               | Rate limit, `claimOnce`, cache quyền, cache security stamp dùng chung giữa instance. Thiếu = RAM từng tiến trình: ngưỡng nhân theo số instance, invalidate không lan |
| `DATABASE_URL` (realtime)                                                                                                                        | bắt buộc            | Tiến trình realtime cần để kiểm security stamp lúc handshake                                                                                                         |
| `QUEUE_ENABLED`                                                                                                                                  | 1                   | Email/SMS qua hàng đợi (cần worker + Redis); `0` = gửi ngay trong request                                                                                            |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`                                                                                                                 | trống (mật khẩu ≥8) | `db:seed` tạo **SUPER_ADMIN**; đã tồn tại thì không reset mật khẩu                                                                                                   |
| `SMTP_*`, `MAIL_FROM`                                                                                                                            | —                   | Mailer (dev ghi log, production thiếu cấu hình thì ném lỗi)                                                                                                          |
| `AUDIT_RETENTION_DAYS`                                                                                                                           | 365                 | Dọn nhật ký                                                                                                                                                          |
| `NODE_ENV`                                                                                                                                       | —                   | Chặn đăng nhập nhanh; cookie `Secure`; CSP dev có `unsafe-eval`                                                                                                      |

- **OAuth**: redirect URI `<APP_URL>/api/v1/auth/oauth/<p>/callback` khớp 100% trên console
  provider; GitHub cần scope `user:email`; Facebook Graph v21.0; Apple `form_post` cần HTTPS (cookie
  `SameSite=None; Secure`).
- **SMS**: gọi `setSmser({ send })` lúc khởi động. Hàng đợi mặc định thử lại 3 lần — nhà cung cấp
  tính phí cả khi báo lỗi thì hạ `attempts` của job `sms:send`.
- **Reverse proxy**: đặt `TRUSTED_PROXY_HOPS` đúng số proxy đứng trước app (Caddy/nginx đơn = 1).
  Proxy nối thêm (`proxy_add_x_forwarded_for`) hay ghi đè XFF đều ra đúng; khai thiếu/thừa hop là
  rate limit và định danh `definePublicAction` bị lách hoặc gộp nhầm. Log thấy IP `unknown` = proxy
  chưa đặt header. App, realtime và worker `/health` chỉ nên nghe `127.0.0.1` (biến `HOST`).
- **CSRF**: REST dùng cookie fallback chỉ dựa vào `SameSite=Lax` (§14 mục 5). Server Action có cơ chế
  kiểm Origin của Next.
- **Seed**: `pnpm db:seed` ở dev = rbac, sports, admin, 4 tài khoản dev, sân mẫu, ảnh;
  `pnpm db:seed:prod` = rbac, sports, admin. Chạy lại sau mỗi lần thêm permission. Seed ghi đè
  `level` từ code nhưng không thêm lại quyền mặc định đã bị gỡ.
- **Dọn dẹp**: `pnpm db:purge` gọi `tokenService.purgeExpired` (refresh hết hạn hoặc thu hồi quá 30
  ngày) và `verificationService.purgeExpired`; có systemd timer đi kèm (`chotsan-purge.timer`).
- **Migration**: script `db:migrate`, `db:push`, `db:reset` đã bị gỡ. `pnpm db:migrate:diff` → đọc
  SQL, gỡ mọi `DROP` đụng `users_*_active_key`, `venue_members_mot_chu_cho_moi_co_so`, trigram index
  và các ràng buộc/sequence viết tay → `pnpm db:deploy` → `db:generate` → `db:check-conflict` → khởi
  động lại dev (chi tiết ở `data-model.md`).
- **Header bảo mật**: `next.config.mjs` (nosniff, `X-Frame-Options: DENY`, Referrer-Policy,
  Permissions-Policy, HSTS). CSP có nonce theo request dựng trong `src/proxy.ts`, chỉ áp cho trang,
  không áp cho `/api`.
