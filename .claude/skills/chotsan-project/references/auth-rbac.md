# Xác thực, phân quyền, bảo mật

> Nguồn: đọc hết ~130 tệp auth/RBAC (17/09/2026). `tệp:dòng` đúng tại lúc đọc; mã đổi thì tìm
> theo tên hàm. Ở §14, dòng có ✅ là đã đối chiếu lại mã; còn lại là suy ra từ mã, chưa chạy thử.

## 0. Mười điều phải nhớ trước khi đụng vào auth

1. **Quyền luôn tra DB theo `userId`** qua `permissionService` (cache 60 giây). `roles` trong JWT
   chỉ để tham khảo, không bao giờ dùng để quyết định.
2. **Chỉ 3 vai trò nền tảng** nằm trong bảng `roles`: `USER`, `ADMIN`, `SUPER_ADMIN`. OWNER/STAFF
   là `VenueMember.role`, không phải dòng trong `roles`. Không có MANAGER. Câu hỏi theo sân chỉ
   có một dạng: `canOnVenue(userId, permission, venueId)`.
3. **Mọi Server Action bọc wrapper** (`defineAction` / `defineVenueAction` / `defineAuthedAction`
   / `definePublicAction`). Chỉ luồng đăng nhập công khai trong `(auth)`, `passkey-actions.ts`,
   `logout-action.ts` được viết trần và tự rate limit.
4. **Mọi route `/api/**` tự gọi guard.** Proxy cố ý không chạy trên `/api`.
5. **Mã lỗi khi thiếu quyền**: web → 404 (`notFound()`); API quyền toàn cục → 403; tài nguyên theo
   sân hoặc của người khác → 404; Server Action → chuỗi `error`.
6. **Id đến từ form/URL phải nằm trong `where`** cùng `venueId` hoặc `userId`; lệch thì NOT_FOUND
   (GOTCHAS #19).
7. **Mọi `next` đi qua `safeRedirectPath`**; route handler redirect bằng `redirectRelative`
   (GOTCHAS #16).
8. **Web đăng xuất bằng Server Action** `src/app/logout-action.ts`, không gọi
   `/api/v1/auth/logout` (GOTCHAS #14).
9. **Ghi vào bảng thẩm quyền** (vai trò, quyền, ngoại lệ, VenueMember) thì phải
   `invalidateUser`/`invalidateAll` VÀ truyền `actorId` thật để chốt `Role.level` chạy.
10. **Phiên web hiện không thu hồi được từ server**: không có `sid`, security stamp chưa nối vào
    đâu. Khoá hay đổi mật khẩu không đá được cookie cũ (§14 mục 1–2).

---

## 1. Bản đồ tệp

### 1.1 `src/lib`

| Tệp                | Vai trò                                                                         | Export đáng nhớ                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.ts`          | Danh tính cho web (đọc cookie)                                                  | `getSession` (bọc `cache()`, chỉ verify JWT), `getCurrentUser` (DB qua `userService.findById`), `requireUser`, `requirePermission`, `requireVenueAccess`, `createSession`, `destroySession`, `requireAdmin` (**không ai dùng**)                                      |
| `session.ts`       | Ký/verify JWT HS256, dùng chung web, mobile, proxy, realtime                    | `SESSION_COOKIE_NAME = "session"`, `signSession`, `verifySession`, `sessionCookieOptions`, `SessionPayload`                                                                                                                                                          |
| `tickets.ts`       | "Vé" JWT ngắn hạn, không phải phiên                                             | `issueTwoFactorTicket`, `issueWebAuthnTicket`, `verifyTicket`                                                                                                                                                                                                        |
| `totp.ts`          | TOTP (otpauth: SHA1, 6 số, 30 giây, cửa sổ ±1)                                  | `createTotpSecret`, `verifyTotp`                                                                                                                                                                                                                                     |
| `permissions.ts`   | Danh mục quyền (trong code) + gán mặc định                                      | `PERMISSIONS`, `VENUE_STAFF_DEFAULT`, `VENUE_STAFF_GRANTABLE`, `VENUE_OWNER_ONLY`, `VENUE_SCOPED_PERMISSIONS`, `isVenueScopedPermission`, `isKnownPermission`, `SYSTEM_ROLES`, `DEFAULT_ROLE_PERMISSIONS`, `PERMISSION_METADATA`, `resolveSeedPermissions`           |
| `define-action.ts` | Wrapper Server Action                                                           | `defineAction`, `defineAuthedAction`, `definePublicAction`, `defineVenueAction` (test chỉ phủ 2 cái đầu)                                                                                                                                                             |
| `safe-redirect.ts` | `safeRedirectPath(value, fallback)`: nhận chuỗi bắt đầu `/`, không bắt đầu `//` | —                                                                                                                                                                                                                                                                    |
| `landing.ts`       | `landingPathFor(userId)`: đích sau đăng nhập                                    | —                                                                                                                                                                                                                                                                    |
| `api/auth.ts`      | Guard REST                                                                      | `getApiSession` (Bearer trước, fallback cookie), `requireApiUser`, `requireApiPermission`, `enforceRateLimit`, `clientIp`; `requireApiAdmin` và `requireVenuePermission` **không ai dùng**                                                                           |
| `api/tokens.ts`    | Cặp token mobile                                                                | `issueTokenPair`, `TokenPair`                                                                                                                                                                                                                                        |
| `api/redirect.ts`  | `redirectRelative(path, status = 303)`                                          | —                                                                                                                                                                                                                                                                    |
| `oauth/*`          | OAuth tự viết (không dùng `arctic`)                                             | `types.ts` (`OAUTH_PROVIDERS`, 4 lớp lỗi kế thừa `Error` thường), `config.ts`, `client.ts` (`decodeIdToken` không kiểm chữ ký — token đến qua kênh sau), `profile.ts`, `pkce.ts`, `flow-cookie.ts` (cookie `oauth_flow`), `apple-client-secret.ts` (JWT ES256 tự ký) |
| `rate-limit.ts`    | `RATE_LIMITS`, `rateLimit`, `resetRateLimit` (async)                            | —                                                                                                                                                                                                                                                                    |
| `errors.ts`        | Lớp `DomainError`, `assertLoginAllowed`                                         | —                                                                                                                                                                                                                                                                    |
| `api/response.ts`  | `apiErrors`, `parseJsonBody`, `handleApiError`, bảng `DOMAIN_STATUS`            | —                                                                                                                                                                                                                                                                    |
| `crypto.ts`        | Argon2id (`@node-rs/argon2`), `fakeCompare`. bcrypt đã bỏ hẳn                   | —                                                                                                                                                                                                                                                                    |
| `opaque-token.ts`  | Token ngẫu nhiên và mã ngắn                                                     | `generateOpaqueToken`, `hashOpaqueToken`, `hashScopedToken`, `generateRecoveryCode`, `generateNumericOtp`                                                                                                                                                            |
| `encryption.ts`    | AES-256-GCM cho bí mật TOTP                                                     | —                                                                                                                                                                                                                                                                    |
| `env.ts`           | Biến môi trường                                                                 | `env`, `webAuthnConfig`, `isWebAuthnConfigured`, `appUrl` (bắt buộc `APP_URL`), `publicAppUrl`, `apiUrl` (không dùng)                                                                                                                                                |
| `src/proxy.ts`     | CSP có nonce; chặn trang khi chưa đăng nhập                                     | —                                                                                                                                                                                                                                                                    |

### 1.2 `src/services`

| Service                     | Hàm                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.service.ts`           | `register`, `validateCredentials` (chứa cổng khoá tài khoản và cổng 2FA), `completeTwoFactorLogin`, `sendEmailVerification`, `verifyEmail`, `requestPasswordReset`, `resetPassword`, `requestEmailChange`, `confirmEmailChange`, `requestPhoneVerification`, `confirmPhoneVerification`, `changePassword`; `resendEmailVerification` không ai gọi |
| `token.service.ts`          | Refresh token: `issue`, `rotate`, `revoke`, `listActive`, `revokeById`, `revokeFamily`, `revokeAllForUser`, `purgeExpired`                                                                                                                                                                                                                        |
| `verification.service.ts`   | Token dùng một lần: `issue`, `consume` (link), `consumeOtp` (OTP), `purgeExpired`                                                                                                                                                                                                                                                                 |
| `two-factor.service.ts`     | `isAvailable`, `status`, `beginSetup`, `confirmSetup`, `verifyCode`, `disable`, `regenerateRecoveryCodes`                                                                                                                                                                                                                                         |
| `webauthn.service.ts`       | `createRegistrationOptions`, `verifyRegistration`, `createAuthenticationOptions`, `verifyAuthentication`, `list`, `rename`, `remove`                                                                                                                                                                                                              |
| `oauth.service.ts`          | `loginWithProfile`, `listLinked`, `unlink`                                                                                                                                                                                                                                                                                                        |
| `security-stamp.service.ts` | `isEnabled`, `stampFor`, `isTokenStillValid` (**không ai gọi**), `invalidate`                                                                                                                                                                                                                                                                     |
| `permission.service.ts`     | `permissionsFor`, `can`, `explainFor`, `canActOnResource`, `canOnVenue`, `invalidateUser`, `invalidateAll`; `canAny`/`canAll`/`venuesWithPermission` không ai dùng                                                                                                                                                                                |
| `role.service.ts`           | `list`, `findByKey`, `create`, `update`, `remove`, `listPermissions`; private `assertCanManageLevel`                                                                                                                                                                                                                                              |
| `user.service.ts`           | `toPublicUser`, `findById`, `findByEmail`, `list`, `create`, `update`, `setStatus`, `unlock`, `softDelete`, `setUserPermission`, `clearUserPermission`; private `assertCanActOn`, `assertCanAssignRoles`, `catchDuplicate`; `updateProfile`/`getProfile` không ai gọi                                                                             |
| `member.service.ts`         | `listForVenue`, `invite`, `setPermissions`, `remove` + 6 lớp lỗi `Member*Error`                                                                                                                                                                                                                                                                   |
| `audit.service.ts`          | `record` (nuốt mọi lỗi), `list`, `purgeOlderThan`. **Không có** `recordOrThrow` (CLAUDE.md nhắc nhầm)                                                                                                                                                                                                                                             |

### 1.3 Schema (`src/schemas`)

- `auth.schema.ts`: `loginSchema {identifier, password}`, `registerSchema {email, password,
username?, fullName?}`, `changePasswordSchema` (mới ≠ cũ), các schema 2FA (`twoFactorCodeSchema`
  6–20 ký tự), đổi email, passkey, OTP số điện thoại. `tokenPairSchema`/`authResponseSchema`/
  `activeSessionSchema` khai báo mà không dùng (và lệch response thật).
- `user.schema.ts`: `emailSchema` (trim, chữ thường, ≤254), `usernameSchema` (3–32 ký tự
  `[a-z0-9._-]`, cấm `@`), `phoneSchema` `^(0|\+84)[1-9][0-9]{8}$`, `passwordSchema` (8–128, không
  ép luật ký tự), `userStatusSchema = z.enum(["ACTIVE","INACTIVE","BANNED"])`,
  `setUserStatusSchema = z.object({ status })`, `createUserSchema`, `updateUserSchema`,
  `assignRolesSchema`, `setUserPermissionSchema`.
- `role.schema.ts`: `roleKeySchema` `^[A-Z][A-Z0-9_]*$`, `roleLevelSchema` 0–100, `createRoleSchema`
  (level mặc định 0, quyền rỗng), `updateRoleSchema`.
- `common.schema.ts`: `cuidSchema`, `paginationSchema` (limit ≤100, mặc định 20).
- `audit.schema.ts`: `AUDIT_ACTIONS`, `listAuditLogsSchema`.

### 1.4 Giao diện và route

- `src/app/(auth)/actions.ts` — action công khai, không wrapper, tự rate limit: `loginAction`,
  `verifyTwoFactorAction`, `registerAction`, `forgotPasswordAction`, `resetPasswordAction`,
  `verifyEmailAction`, `confirmEmailChangeAction`; `logoutAction` ở đây là **bản chết** (vẫn là
  endpoint gọi được).
- `(auth)/auth-form.tsx` (`AuthFields`, `Field`, field ẩn `next`), `oauth-buttons.tsx`
  (`OAuthButtons` chỉ vẽ provider đã cấu hình, `OAuthErrorBanner`).
- `(auth)/login/`: `page.tsx` (banner `?reset=1`, OAuth, form, passkey, khối đăng nhập nhanh dev),
  `login-form.tsx` (có vé 2FA thì đổi sang `TwoFactorForm`), `two-factor-form.tsx`,
  `passkey-actions.ts` (`getPasskeyLoginOptions`, `verifyPasskeyLogin`), `passkey-button.tsx`,
  `dang-nhap-nhanh.tsx` (`DangNhapNhanh`).
- `(auth)/register/`, `forgot-password/`, `reset-password/`, `verify-email/`,
  `confirm-email-change/`: mỗi thư mục một trang + một form.
- `src/app/logout-action.ts` — đăng xuất web thật (xoá cookie → `/`); header dùng bản này.
- `src/app/api/dev/quick-login/route.ts` — đăng nhập nhanh, chỉ dev.
- `src/app/(admin)/layout.tsx` — `requireUser("/users")` (đặt cứng), hỏi 4 quyền (`user:read`,
  `role:read`, `venue:approve`, `invoice:manage`), không có quyền nào thì `notFound()`; chỉ vẽ
  sidebar khi có từ 2 mục. **Không phải ranh giới bảo mật.**
- `(admin)/users/` — `page.tsx` (`requirePermission("user:read","/users")`, 20 dòng/trang),
  `actions.ts` (`createUserAction` `user:create`; `setUserStatusAction`, `unlockUserAction`
  `user:update`; `deleteUserAction` `user:delete`), `user-form.tsx`, `user-status-button.tsx`,
  `user-delete-button.tsx`.
- `(admin)/roles/` — `page.tsx` (`requirePermission("role:read","/roles")` + 3 cờ),
  `actions.ts` (`updateRolePermissionsAction`, `createRoleAction`, `deleteRoleAction`), 3 form.
- `src/app/security/` — `requireUser("/security")`; 5 action `defineAuthedAction` (bật/xác nhận/
  tắt 2FA, cấp lại mã, xoá passkey); `two-factor-manager.tsx` (QR vẽ trong trình duyệt bằng
  `qrcode`); `passkey-manager.tsx` (thêm passkey bằng `fetch` REST, xoá bằng action).
- `src/app/sessions/` — `requireUser`, `tokenService.listActive`, **chỉ hiện phiên mobile**;
  `revokeSessionAction` (`defineAuthedAction`).
- `src/components/layout/header.tsx` — `getCurrentUser`, `can(user.id, user:read / role:read /
venue:approve)`, `venueService.listForUser`. Nav: "Tìm sân"; "Quản lý sân" nếu có sân; "Lượt
  đặt" nếu đã đăng nhập; "Quản trị" trỏ mục đầu tiên có quyền trong venue-approvals → users →
  roles (thiếu `/invoices`). Tên người dùng dẫn tới `/sessions`.
- Seed: `prisma/seeds/seed-rbac.ts` (upsert danh mục quyền, 3 vai trò hệ thống `isSystem`, `level`
  luôn lấy từ code, `createMany skipDuplicates` quyền mặc định), `seed-admin.ts` (`ADMIN_EMAIL`/
  `ADMIN_PASSWORD` → **SUPER_ADMIN**, email đã xác thực, không reset mật khẩu nếu đã tồn tại),
  `seed-dev.ts` (4 tài khoản `@dev.local`, mật khẩu `matkhau123`).

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

|            | Web (trình duyệt)                                                                                             | Mobile (REST)                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Vật mang   | Cookie `session`: httpOnly, SameSite=Lax, Secure khi production, path `/`                                     | `Authorization: Bearer <jwt>` (chữ "bearer" không phân biệt hoa thường)       |
| Định dạng  | JWT HS256 ký bằng `SESSION_SECRET`                                                                            | Cùng JWT + một refresh token opaque                                           |
| Hạn        | `SESSION_MAX_AGE_DAYS` (7) cho cả JWT lẫn cookie                                                              | Access `ACCESS_TOKEN_TTL_MINUTES` (15); refresh `REFRESH_TOKEN_TTL_DAYS` (30) |
| Claim      | `typ:"access"`, `sub`, `email`, `roles[]`, `mfa?` (chỉ khi 2FA/passkey web), `iat`, `exp`. **Không có `sid`** | Như web + `sid` = `familyId`; `mfa` khi đăng nhập bằng 2FA/passkey            |
| Bản ghi DB | Không                                                                                                         | `RefreshToken` lưu SHA-256; `familyId` UUID ổn định qua các lần xoay vòng     |
| Làm mới    | Không; hết hạn thì đăng nhập lại                                                                              | `POST /auth/refresh`: xoay vòng, token cũ bị `revokedAt`                      |
| Thu hồi    | Chỉ xoá cookie ở trình duyệt đang thao tác. JWT lộ vẫn dùng được tới `exp`                                    | Thu hồi refresh (một thiết bị / một họ / tất cả). Access vẫn sống ≤15 phút    |
| Đăng xuất  | Server Action `src/app/logout-action.ts` → `destroySession` → `/`                                             | `POST /auth/logout {refreshToken?, allDevices?}` (cần access còn hạn)         |
| Danh sách  | Không hiện ở `/sessions` (trang có ghi chú)                                                                   | `GET /auth/sessions`: gộp theo `familyId`, lấy bản mới nhất                   |

Điểm chung:

- `verifySession` trả `null` với token hỏng, hết hạn, sai chữ ký, sai cấu trúc, `typ ≠ "access"`.
  Nhưng schema để `typ: z.literal("access").default("access")` nên JWT **không có** `typ` vẫn được
  nhận (hiện chưa có JWT nào như vậy).
- `getApiSession` ưu tiên Bearer, fallback cookie → trang web gọi REST bằng `fetch` được (ví dụ
  `passkey-manager.tsx`).

**Vé (`tickets.ts`)**, ký cùng `SESSION_SECRET`:

- `{typ:"2fa", sub}` hạn `TWO_FACTOR_CHALLENGE_TTL_MINUTES` (5).
- `{typ:"webauthn_reg", challenge, sub}` và `{typ:"webauthn_auth", challenge}` hạn 5 phút.
- `verifyTicket(token, type)` chỉ nhận đúng loại → vé không dùng thay phiên, phiên không dùng
  thay vé.
- Vé **không dùng-một-lần**: dùng lại được tới khi hết hạn.

**Refresh token (`token.service.ts`)**:

- `issue`: 32 byte base64url; DB lưu `hashOpaqueToken` (SHA-256 hex); không truyền `familyId` thì
  mở họ mới bằng `randomUUID`.
- `rotate`:
  1. Không tìm thấy → `null`.
  2. Đã `revokedAt` → `revokeFamily` rồi ném `RefreshTokenReuseError` (401). Chỉ thu hồi **một họ**
     (chú thích ở vài nơi nói "toàn bộ phiên" là sai).
  3. Hết hạn → `null`.
  4. User xoá mềm hoặc BANNED → `null` (INACTIVE **không** bị chặn).
  5. Thu hồi token cũ; cấp token mới cùng `familyId`, giữ `deviceId`, `twoFactorAt`.
- Route refresh tra lại user rồi ký access mới có `sid`; access mới **mất** `mfa`, token mới không
  lưu `ip`.

**Security stamp**: so `iat` với `passwordChangedAt` (cache 5 phút). `resetPassword` và
`changePassword` có gọi `invalidate`, nhưng `isTokenStillValid` **không được gọi** ở `getSession`,
`getApiSession`, proxy hay realtime ✅. `SESSION_STRICT_REVOCATION` vì thế không có tác dụng.

---

## 3. Các lớp kiểm và chính sách mã lỗi

1. **Proxy** (`src/proxy.ts`):
   - Matcher bỏ qua `/api/`, `/docs`, asset tĩnh.
   - Chỉ verify chữ ký cookie cho `PROTECTED_PREFIXES = /users, /roles, /sessions, /security`;
     không hợp lệ → `/login?next=<pathname>`.
   - Đã đăng nhập mà vào `/login`, `/register` → `/` (bỏ qua `next`).
   - Dựng CSP có nonce (`form-action 'self'`, `frame-ancestors 'none'`, …).
   - `/manage`, `/invoices`, `/venue-approvals`, `/account` **không** nằm trong danh sách — các
     trang đó tự chặn.
2. **Trang/layout** (`src/lib/auth.ts`):
   - `requireUser(returnTo?)`: `getCurrentUser()` (DB, lọc `deletedAt`, **không lọc status**);
     `null` → `redirect("/login?next=" + encodeURIComponent(returnTo))`.
   - `requirePermission(permission, returnTo?)`: `requireUser` + `permissionService.can` → thiếu
     thì `notFound()`.
   - `requireVenueAccess(venueId, permission)`: `requireUser("/manage/" + venueId)` (đặt cứng) +
     `canOnVenue` → thiếu thì `notFound()`. Dùng ở 6 trang `/manage/[venueId]/*`.
   - `requireAdmin`: `roles.includes("ADMIN")` — không ai dùng, và SUPER_ADMIN sẽ trượt. Đừng dùng.
3. **Server Action**: wrapper (§4) — đây là lớp chặn thật; hai lớp trên chỉ là UX.
4. **REST** (`src/lib/api/auth.ts`):
   - `requireApiUser`: chỉ verify JWT, không chạm DB → 401 `UNAUTHENTICATED`.
   - `requireApiPermission`: thêm `can()` → **403** `FORBIDDEN`.
   - `requireVenuePermission`: thêm `canOnVenue` → **404** "Không tìm thấy sân" (chưa ai dùng — REST
     cho sân chưa có).
   - `requireApiAdmin`: so vai trò từ token → 403. Không dùng, **đừng dùng** (SUPER_ADMIN trượt).
   - `permissionService.canActOnResource(actor, owner, {any, own})`: có quyền `any`, hoặc (actor =
     owner và có quyền `own`).

**Chính sách**: web 404 để không xác nhận tài nguyên tồn tại; API 403 cho quyền toàn cục vì client
cần phân biệt với 401; tài nguyên theo sân và tài nguyên có `userId` trong truy vấn (phiên, passkey,
nhân sự sân) trả 404 không phân biệt "không có" với "của người khác".

**`DomainError` → HTTP** (`response.ts`): VALIDATION_ERROR 422, UNAUTHENTICATED 401, FORBIDDEN
403, NOT_FOUND 404, CONFLICT 409, ACCOUNT_BANNED 403, ACCOUNT_LOCKED 423, RATE_LIMITED 429,
PROVIDER_ERROR 502, TWO_FACTOR_REQUIRED 401. Lỗi lạ → 500 `INTERNAL_ERROR`, không lộ nội dung.

---

## 4. Wrapper Server Action (`src/lib/define-action.ts`)

| Wrapper                                                             | Kiểm theo thứ tự                                                                                                                            | Khi bị từ chối                                                                                                                                                | `ctx`                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `defineAction(permission, handler)`                                 | 1) `getSession()` (chỉ verify JWT). 2) `permissionService.can(sub, permission)` (DB + cache)                                                | Chưa đăng nhập: `{error:"Bạn cần đăng nhập để thực hiện thao tác này."}`. Thiếu quyền: `logger.warn` + `{error:"Bạn không có quyền thực hiện thao tác này."}` | `{session, actorId}`                     |
| `defineAuthedAction(handler)`                                       | Chỉ `getSession()` — không chạm DB                                                                                                          | "Bạn cần đăng nhập…"                                                                                                                                          | `{session, actorId}`                     |
| `definePublicAction(lyDo, {key, limit, windowSeconds}, handler)`    | 1) `getSession()` (được null). 2) IP = `x-forwarded-for[0]` ?? `x-real-ip` ?? `"khong-ro"`. 3) `rateLimit("action:<key>:<sub hoặc ip:IP>")` | `logger.warn` (kèm `lyDo`) + `{error:"Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại giúp bạn nhé."}`                                                       | `{session \| null, actorId \| null, ip}` |
| `defineVenueAction(permission, handler)` → hàm `(venueId, ...args)` | 1) `getSession()`. 2) `canOnVenue(sub, permission, venueId)`                                                                                | "Bạn cần đăng nhập…" / `logger.warn` (kèm venueId) + `{error:"Bạn không có quyền thực hiện thao tác này trên sân này."}`                                      | `{session, actorId, venueId}`            |

- Thân không chạy khi bị từ chối; lỗi trong thân được ném tiếp, không nuốt.
- `denied()` ép `{error} as TState` → **state của action phải toàn trường tuỳ chọn**.
- **Không wrapper nào kiểm `status` của user.**
- `venueId` của `defineVenueAction` chỉ chứng minh quyền trên sân đó; id con trong form vẫn phải lọc
  theo `ctx.venueId` ở service (GOTCHAS #19).

Đang dùng:

- `defineAction`: users (4), roles (3), invoices (2), venue-approvals (1).
- `defineVenueAction`: `manage/[venueId]/actions.ts` (duyệt/từ chối tiền `payment:confirm`,
  check-in `booking:checkin`, huỷ `booking:cancel`), settings (`venue:update` ×3), courts
  (`court:update` ×2, `pricing:update`), staff (`member:manage` ×3). UI gọi `.bind(null, venueId)`.
- `defineAuthedAction`: security (5), sessions (1), account/bookings (2), `holdBookingAction`.
- `definePublicAction`: chỉ `declareTransferAction`.
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
- `load` chỉ lọc user `deletedAt: null`, **không lọc status** ✅.
- Cache `perm:v1:<userId>` 60 giây: Redis nếu có `REDIS_URL`, không thì RAM từng tiến trình
  (invalidate không lan giữa instance).
- `invalidateUser` gọi ở `userService.create/update/softDelete/setUserPermission/
clearUserPermission` và `memberService.*`; `invalidateAll` ở `roleService.create/update/remove`.
- `explainFor` cho biết nguồn quyền: role / grant / denied / expiredOverride (API
  `GET /users/[id]/permissions`).

### 5.4 Chốt `Role.level` (chống leo thang)

- `assertCanActOn(actor, target)` (`user.service.ts`): chặn khi level cao nhất của mục tiêu ≥ của
  người thao tác.
- `assertCanAssignRoles`: chặn gán vai trò có level ≥ mình.
- `assertCanManageLevel` (`role.service.ts`): chặn tạo/sửa/xoá vai trò có level ≥ mình.
- **Cả ba `return` ngay khi `actorId` rỗng** (coi là thao tác hệ thống) ✅ — nên nơi gọi QUÊN truyền
  `actorId` là chốt biến mất (§14 mục 3–4).
- Chốt tự thao tác: không tự đổi vai trò, tự đổi trạng thái, tự xoá (`SelfActionForbiddenError`,
  409).

### 5.5 Quản trị vai trò, trạng thái, xoá

- `roleService.create`: key không trùng; `isSystem` luôn false; quyền rỗng khi tạo từ web.
- `roleService.update`: đổi tên/mô tả/level; `permissions` mang nghĩa **THAY THẾ toàn bộ**. Sửa
  được cả vai trò hệ thống.
- `roleService.remove`: chặn vai trò `isSystem` và vai trò còn người mang.
- `userService.setStatus`: về ACTIVE thì xoá khoá tạm; khác ACTIVE thì thu hồi mọi refresh token
  (không đụng cookie web).
- `userService.softDelete`: `deletedAt`, status INACTIVE, gắn hậu tố `:deleted:<ts>` vào
  email/username/phone (GOTCHAS #7 tả khác — tin mã), thu hồi refresh, `invalidateUser`.
- `userService.create`: `assertUnique`; `assertCanAssignRoles(actorId)`; `resolveRoleIds` (vai trò
  lạ → `UnknownRoleKeyError` 422); Argon2id; tạo profile + userRoles; `invalidateUser`; P2002 →
  `catchDuplicate` (đọc `meta.target` — hỏng với Prisma 7, §14 mục 10).

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
4. Tra `venueMember(venueId, userId)`: không có, hoặc status ≠ ACTIVE → false.
5. OWNER → true, kể cả OWNER_ONLY.
6. STAFF: OWNER_ONLY → false; còn lại → thuộc DEFAULT hoặc nằm trong `member.permissions`.

Hệ quả:

- ADMIN dùng được `booking:cancel`, `payment:refund`, `payment:confirm`, các quyền `:read` trên
  **mọi sân** (vì có quyền toàn cục).
- SUPER_ADMIN cũng không rút tiền hộ, không xoá hay chuyển nhượng sân hộ chủ.
- Không kiểm sân đã xoá mềm hay đang bị khoá.

**`invoice:manage` ≠ `payout:approve`**: `invoice:manage` = ghi nhận tiền THU VÀO (hoá đơn hoa
hồng), ADMIN có; `payout:approve` = duyệt tiền CHI RA cho chủ sân, chỉ SUPER_ADMIN; `payout:manage`
= chủ sân xin rút.

**`memberService`** (3 action đều `defineVenueAction("member:manage")`):

- `invite`: email phải có tài khoản; chưa là thành viên; tạo STAFF **ACTIVE ngay**, `permissions:
[]` (luồng INVITED/chấp nhận lời mời chưa có).
- `setPermissions`: tìm theo `{id, venueId}`; OWNER → `MemberOwnerFixedError`; key OWNER_ONLY →
  `MemberOwnerOnlyPermissionError`; key không grantable → `MemberPermissionError` (422); loại trùng;
  `invalidateUser`.
- `remove`: không gỡ được OWNER.

---

## 7. Các luồng đăng nhập và tài khoản

### 7.1 Mật khẩu và khoá tài khoản

**Identifier** là một ô: có `@` → tra email, không có → tra username (username cấm `@`). **Không**
đăng nhập bằng số điện thoại.

`authService.validateCredentials`:

1. `identifier.trim().toLowerCase()` → `findFirst({deletedAt:null, email|username})`.
2. Không có user hoặc `password = null` → `fakeCompare` + `InvalidCredentialsError` ("Thông tin
   đăng nhập không chính xác").
3. Argon2id sai → `registerFailedAttempt` (bỏ qua nếu đang khoá; tăng bộ đếm; chạm
   `LOGIN_MAX_FAILED_ATTEMPTS` (5) thì về 0 và `lockedUntil = now + LOGIN_LOCKOUT_MINUTES` (15)) →
   `InvalidCredentialsError`.
4. Mật khẩu đúng → `assertLoginAllowed(status)`: BANNED → `AccountBannedError`; INACTIVE →
   `AccountInactiveError` (mã ACCOUNT_BANNED).
5. Còn `lockedUntil` → `AccountLockedError` (423, kèm số phút).
6. Reset bộ đếm; `needsRehash` thì băm lại (lỗi bị nuốt).
7. **Cổng 2FA**: `twoFactorEnabledAt` khác null → ném `TwoFactorRequiredError(userId)`. Dùng
   exception để nơi gọi không thể "quên" 2FA.
8. Trả `PublicUser` (`roles[]`, `twoFactorEnabled`, không có `password`).

Web `loginAction`: `rateLimit("login:<ip>", 5/300s)` → `loginSchema.safeParse` →
`validateCredentials` (`TwoFactorRequired` → trả `{twoFactorToken}`; bắt `InvalidCredentials`/
`Banned`/`Locked` → message) → `resetRateLimit` → `createSession({typ, sub, email, roles})` →
`redirect(safeRedirectPath(next || landing, "/"))`.

API `POST /auth/login` trả **hai hình dạng** (cố ý, để client rẽ nhánh tường minh):

- Cần 2FA: `{data:{twoFactorRequired:true, challengeToken, expiresIn}}`.
- Không: `{data:{user, accessToken, expiresIn, tokenType:"Bearer", refreshToken, refreshExpiresAt,
sessionId}}` (`sessionId` = `familyId`).

Admin mở khoá: `unlock` (xoá `lockedUntil`, không đụng `status`); `setStatus("ACTIVE")` cũng xoá.

### 7.2 2FA TOTP và mã khôi phục (`two-factor.service.ts`)

- **Bật ba bước**: `beginSetup` (chặn nếu đã bật; bí mật 20 byte; mã hoá AES-256-GCM dạng
  `v1.iv.tag.ct` vào `twoFactorSecret`, CHƯA đặt `twoFactorEnabledAt`; trả `{secret, uri}` với
  issuer `APP_NAME`) → người dùng quét QR (vẽ trong trình duyệt) → `confirmSetup(code)`
  (`verifyTotp`; sinh 10 mã khôi phục `XXXXX-XXXXX` Crockford base32; một transaction: đặt
  `twoFactorEnabledAt`, xoá mã cũ, lưu `hashScopedToken(userId, normalized)`; mã trả ra **một
  lần**). Bật ngay từ bước 1 thì người quét hỏng bị khoá khỏi tài khoản.
- **Xác minh** `verifyCode`: TOTP trước (±1 bước), rồi mã khôi phục (10 ký tự sau chuẩn hoá,
  `updateMany {usedAt:null}` nguyên tử, `logger.warn` khi dùng).
- **Tắt** `disable`: cần mật khẩu (nếu có) + một mã hợp lệ; xoá bí mật và mã khôi phục.
  **Cấp lại mã** `regenerateRecoveryCodes`: cần một mã hợp lệ.
- **Bước 2 trên web** `verifyTwoFactorAction`: `rateLimit("2fa:<ip>", 10/300s)` →
  `verifyTicket(token,"2fa")` → `verifyCode` → `completeTwoFactorLogin` (kiểm lại status) →
  `createSession({..., mfa: now})` → `next` hoặc landing. Sai mã thì trả lại vé để nhập tiếp.
- **Bước 2 trên API** `POST /auth/2fa/verify`: sai → audit `TWO_FACTOR_FAILED` + 401.
- Tự phục vụ ở `/security` (không rate limit). Thiếu `ENCRYPTION_KEY` → `isAvailable() = false`,
  giao diện ẩn nút.
- Không có "thiết bị tin cậy"; không có bộ đếm lần sai theo tài khoản hay theo vé.

### 7.3 Passkey / WebAuthn (`@simplewebauthn` v14)

- **Cấu hình**: có cả `WEBAUTHN_RP_ID` và `WEBAUTHN_ORIGINS` thì dùng thẳng; không thì suy từ
  `APP_URL`; thiếu cả hai → `ProviderNotConfiguredError` (nút bị ẩn). `rpName = APP_NAME`.
- **Đăng ký** (đã đăng nhập): `PasskeyManager` `fetch POST /api/v1/auth/passkeys/register/options`
  (viết cứng `/api/v1`) → `createRegistrationOptions` (`userID` = bytes của user.id,
  `attestationType:"none"`, `excludeCredentials`, `residentKey:"required"`,
  `userVerification:"required"`, vé `webauthn_reg` có `sub`) → `startRegistration` →
  `POST /register/verify` (rate limit; vé đúng loại và `sub === session.sub`; lỗi chi tiết chỉ vào
  log, ra ngoài là `WebAuthnVerificationError`) → lưu, `name = navigator.platform`, audit.
- **Đăng nhập web**: `PasskeyButton` → `getPasskeyLoginOptions()` (Server Action, không rate limit,
  không `allowCredentials` nên không cần nhập email) → `startAuthentication` →
  `verifyPasskeyLogin(challengeToken, response, next)`: `rateLimit("passkey:<ip>", 30/300s)` →
  `verifyTicket("webauthn_auth")` → `verifyAuthentication` (tra `credentialId`, không có →
  `InvalidCredentialsError`; thư viện so counter; cập nhật counter + `lastUsedAt`;
  `assertLoginAllowed`; **không áp `lockedUntil`**) → `createSession({..., mfa: now})` → audit
  `LOGIN_SUCCEEDED {method:"passkey"}` → trả `{ok, next: safeRedirectPath(next || landing, "/")}`,
  client `router.push` + `refresh`.
- **Không hỏi TOTP** kể cả khi đã bật 2FA — quyết định có chủ đích: `userVerification:"required"`
  đã là hai yếu tố.
- **API**: `/passkeys/login/{options,verify}` → `issueTokenPair(twoFactorAt: now)`.
- **Quản lý**: `rename`/`remove` đặt `userId` trong `where`; `remove` từ chối nếu là cách đăng
  nhập cuối cùng (không mật khẩu, 0 OAuth, ≤1 passkey) → `ForbiddenError`.

### 7.4 OAuth (tự viết bằng `fetch`/`jose`)

| Provider | Scope                  | PKCE  | Ghi chú                                                                       |
| -------- | ---------------------- | ----- | ----------------------------------------------------------------------------- |
| google   | `openid email profile` | có    | email lấy từ `id_token` khi `email_verified`                                  |
| github   | `read:user user:email` | không | gọi `/user` + `/user/emails`, lấy primary đã verified                         |
| facebook | `email public_profile` | có    | Graph v21.0, gọi `/me`                                                        |
| apple    | `name email`           | không | `response_mode=form_post`, client secret JWT ES256 tự ký; tên chỉ gửi lần đầu |

Provider chỉ "đã cấu hình" khi đủ ID + SECRET (Apple cần 4 biến); nút chỉ hiện khi đã cấu hình.

1. `GET /api/v1/auth/oauth/<p>/start?next=…`: provider lạ → JSON 404 (không theo envelope); chưa cấu
   hình → `redirectRelative("/login?oauthError=not_configured")`; `next = safeRedirectPath(next,
"")`; sinh `state` 32 byte (+ `codeVerifier` nếu PKCE); cookie `oauth_flow` = JSON `{provider,
state, codeVerifier, next}` (httpOnly, lax, 10 phút, **không ký**); `redirect_uri =
${NEXT_PUBLIC_APP_URL ?? APP_URL}/api/v1/auth/oauth/<p>/callback`.
2. Callback (GET; Apple là POST form): có `error` → `/login?oauthError=<error>`;
   `consumeOAuthFlowCookie` đọc rồi xoá, kiểm `provider`, `state`, có `code` (sai →
   `OAuthStateMismatchError`); `exchangeCodeForToken` (lỗi bọc thành `OAuthExchangeError`);
   `fetchOAuthProfile`.
3. `oauthService.loginWithProfile`: email về chữ thường; đã có liên kết → user đó
   (`includeDeleted: true`); chưa có: bắt buộc email; email trùng user đang sống → **gắn liên kết
   vào user đó, không kiểm `emailVerifiedAt`** ✅; không trùng → tạo user (`emailVerifiedAt = now`,
   `password = null`, vai trò USER, profile, liên kết); `assertLoginAllowed`; không áp `lockedUntil`.
4. `createSession({typ, sub, email, roles})` (không `mfa`, **không hỏi TOTP**) →
   `redirectRelative(flow.next || landingPathFor)`.
5. Lỗi → `/login?oauthError=state_mismatch|email_required|not_configured|exchange_failed|banned|
account_unavailable|unknown`; `OAuthErrorBanner` hiển thị.

- Chỉ phục vụ web (đặt cookie). Chưa có endpoint OAuth cho mobile.
- `unlink` từ chối khi không có mật khẩu và còn ≤1 liên kết (không tính passkey).
- Redirect URI khai trên console provider phải khớp 100%:
  `<NEXT_PUBLIC_APP_URL>/api/v1/auth/oauth/{google|github|facebook|apple}/callback` (CLAUDE.md ghi
  `/api/auth/oauth/...` là sai).

### 7.5 Đăng ký

- Web `registerAction`: `rateLimit("register:<ip>", 5/3600s)`; đọc email/password/fullName
  (**không đọc username**); `authService.register`; `DuplicateFieldError` → message;
  `createSession`; `redirect(safeRedirectPath(next || landing, "/"))` (tài khoản mới không có
  `next` thì về `/`).
- API `POST /auth/register`: nhận cả username; 201 kèm token.
- `authService.register`: `users.create` với status ACTIVE, `roleKeys:[USER]` — **không bao giờ đọc
  vai trò từ input**; gửi email xác thực (lỗi chỉ ghi log). Xác thực email **không bắt buộc**:
  `emailVerifiedAt` không được kiểm ở đâu.

### 7.6 Email: xác thực, quên/đặt lại/đổi mật khẩu, đổi email

Token trong link (`verification.service.ts`): 32 byte, lưu SHA-256; `issue` xoá token chưa dùng
cùng loại trong transaction; `consume` trả `null` khi sai loại/đã dùng/hết hạn, đánh dấu bằng
`updateMany {id, usedAt:null}` + kiểm `count === 1`. Hạn: EMAIL_VERIFICATION và EMAIL_CHANGE 24h
(`EMAIL_VERIFICATION_TTL_HOURS`), PASSWORD_RESET 60 phút. Email đi qua hàng đợi; link dựng bằng
`appUrl()` → **bắt buộc `APP_URL`**. Đường dẫn: `/verify-email?token=`, `/reset-password?token=`,
`/confirm-email-change?token=`.

- **Xác thực email**: mở trang chỉ hiện nút; token chỉ tiêu khi BẤM (bộ quét link Gmail/Outlook sẽ
  đốt token nếu tiêu lúc GET). `verifyEmailAction` (10/15′) → `verifyEmail` (chỉ ghi khi đang null).
  API: `POST /verify-email` (công khai), `POST /verify-email/request` (đã đăng nhập, email lấy từ
  phiên). Web chưa có nút gửi lại.
- **Quên mật khẩu**: `forgotPasswordAction` (3/15′) → `requestPasswordReset` (tra `findByEmail`, bỏ
  tài khoản xoá mềm; tài khoản chưa có mật khẩu vẫn được cấp link); nuốt mọi lỗi; luôn trả "Nếu địa
  chỉ này có tài khoản…".
- **Đặt lại mật khẩu**: `resetPasswordAction` (10/15′) → `resetPassword`: `consume` → băm mới, đặt
  `passwordChangedAt`, xoá khoá tạm → `revokeAllForUser` + `securityStamp.invalidate` (không tác
  dụng) → email báo. Action gọi `destroySession()` rồi `redirect("/login?reset=1")`.
- **Đổi mật khẩu** (chỉ API): `changePassword` đòi mật khẩu hiện tại (`fakeCompare` nếu chưa có
  mật khẩu); ghi `passwordChangedAt`; `revokeAllForUser(exceptFamilyId)` nhưng route không truyền
  `keepFamilyId`; email báo.
- **Đổi email** (xin đổi chỉ API): `requestEmailChange` (nhập lại mật khẩu; email mới đã có người
  → `DuplicateFieldError`; `issue(EMAIL_CHANGE, destination = email mới)`; link tới địa chỉ MỚI;
  cảnh báo che một phần tới địa chỉ CŨ) → xác nhận qua web `/confirm-email-change`
  (`confirmEmailChangeAction`, 3/15′, không cần đăng nhập) hoặc API `/change-email/confirm` →
  `confirmEmailChange` (ghi email mới, `emailVerifiedAt = now`, `pendingEmail = null`, P2002 →
  trùng, `revokeAllForUser`). Cột `pendingEmail` thực tế không bao giờ được ghi khác null.

### 7.7 OTP số điện thoại (chỉ API; mặc định TẮT `PHONE_VERIFICATION_ENABLED=0`)

- `requestPhoneVerification`: kiểm cờ → `normalizePhone` (bỏ khoảng trắng/chấm/gạch, `+84` → `0`)
  → số đã thuộc người khác → trùng (kiểm TRƯỚC khi gửi) → giãn cách `otp:cooldown:<số>` 1 lần/60
  giây → trần ngày `otp:daily:<số>` 5/24h → `issue(PHONE_OTP)`: 6 chữ số `randomInt`, băm
  `hashScopedToken("<userId>:PHONE_OTP", code)`, hạn 5 phút → SMS không dấu qua hàng đợi. Route
  thêm rate limit IP 5/15′.
- `confirmPhoneVerification`: `destination` lấy từ token đang chờ (không nhận số từ client);
  `consumeOtp` (sai tăng `attempts`; chạm `VERIFICATION_MAX_ATTEMPTS` (5) → huỷ mã +
  `TooManyVerificationAttemptsError` 429); ghi `phone` + `phoneVerifiedAt`; P2002 → trùng.
- `smser`: dev ghi mã ra log; production chưa `setSmser()` → ném lỗi.

### 7.8 Quản lý phiên (mobile)

- `GET /auth/sessions`: `id` (familyId), `userAgent`, `createdAt`, `expiresAt` — không trả `ip`
  hay `current`.
- `DELETE /auth/sessions`: thu hồi mọi họ trừ `session.sid`; audit `SESSION_REVOKED`.
- `DELETE /auth/sessions/[id]` và web `revokeSessionAction`: `revokeById(familyId, userId)` với
  `userId` trong `where`; không thu hồi được gì → 404 / "Không tìm thấy phiên đăng nhập này."
- `listActive` chỉ lấy token chưa thu hồi, chưa hết hạn, gộp theo họ.

---

## 8. Đích sau đăng nhập, `?next=`, đăng nhập nhanh

**`landingPathFor(userId)`** (`landing.ts`), xét hẹp → rộng: `venue:approve` → `/venue-approvals`;
`invoice:manage` → `/invoices`; `user:read` → `/users`; `role:read` → `/roles`; có sân ACTIVE chưa
xoá → `/manage`; còn lại `/`. (Trước đây mặc định `/users` làm người thường rơi vào 404.)

**Luật `next`**:

- `next` không rỗng thì **LUÔN thắng**; mọi đích đi qua `safeRedirectPath(…, "/")`. Áp dụng ở
  login, 2FA, register, passkey, quick-login. OAuth làm sạch `next` ở bước start, callback dùng
  `flow.next || landing`.
- `next` không hợp lệ rơi về `/`, không về landing.
- `requireUser` và proxy tự tạo `?next=`.
- Luồng đặt sân dùng luật này để giữ lựa chọn: `SelectAndBook` dựng `returnPath` kèm
  `&chon=<encodeSelection>` cho link đăng nhập/đăng ký → quay lại trang sân khôi phục khung đã chọn
  (chi tiết ở `booking-payment.md`). Sửa luồng đăng nhập mà làm rơi `next` là hỏng luồng này — e2e
  `khach-dat-san.spec.ts` và `auth.spec.ts` sẽ bắt.

**`redirectRelative(path, status = 303)`**: `new Response(null, {status, headers:{Location: path}})`.
Lý do: ở `next dev`, `request.url` luôn là localhost; redirect tuyệt đối sang localhost khi người
dùng mở qua IP LAN bị CSP `form-action 'self'` chặn (GOTCHAS #16). Hàm không tự kiểm path — nơi gọi
phải làm sạch trước.

**Đăng nhập nhanh (chỉ dev)**:

- `DangNhapNhanh` trả `null` khi `NODE_ENV === "production"` (mã bị loại khỏi bundle). Mỗi tài khoản
  là một form thường `POST /api/dev/quick-login` với field ẩn `identifier`, `password=matkhau123`,
  `next`.
- Route: production → 404; kiểm kiểu string; chỉ nhận identifier đuôi `@dev.local` (không thì 404);
  `validateCredentials` (không try/catch); `createSession`; `redirectRelative(next || landing, 303)`.

| Email                | Vai trò nền tảng | Quyền theo sân                                        | Đích mặc định      |
| -------------------- | ---------------- | ----------------------------------------------------- | ------------------ |
| `admin@dev.local`    | ADMIN            | —                                                     | `/venue-approvals` |
| `chusan@dev.local`   | USER             | OWNER mọi sân mẫu                                     | `/manage`          |
| `nhanvien@dev.local` | USER             | STAFF ACTIVE mọi sân mẫu, tick thêm `payment:confirm` | `/manage`          |
| `user@dev.local`     | USER             | —                                                     | `/`                |
| `ADMIN_EMAIL` (env)  | SUPER_ADMIN      | —                                                     | `/venue-approvals` |

Mật khẩu chung `matkhau123`. `prisma/seed.ts`: production chỉ chạy rbac + sports + admin; dev chạy
thêm dev + venues + images.

---

## 9. Rate limit cho luồng auth (`rate-limit.ts`)

- Cửa sổ cố định. Có `REDIS_URL` → Redis (INCR + EXPIRE NX); không → RAM. Store lỗi → **fail-open**
  (có chủ đích).
- Key IP: `x-forwarded-for[0]` → `x-real-ip` → `unknown` ⇒ reverse proxy phải GHI ĐÈ header này.
- Web và API dùng **bucket khác nhau** (ví dụ `login:` và `api:login:`).

| Bucket                                                        | Ngưỡng    |
| ------------------------------------------------------------- | --------- |
| login                                                         | 5 / 300s  |
| register                                                      | 5 / 3600s |
| refresh                                                       | 30 / 300s |
| passwordResetRequest, emailVerificationRequest                | 3 / 900s  |
| passwordChange (reset, verify-email web/API, change-password) | 10 / 900s |
| twoFactor                                                     | 10 / 300s |
| passkey                                                       | 30 / 300s |
| phoneOtp                                                      | 5 / 900s  |
| upload                                                        | 60 / 300s |

**Không có rate limit**: `api/dev/quick-login`, `getPasskeyLoginOptions`, `/2fa/setup`,
`/passkeys/register/options`, action 2FA ở `/security`, OAuth.

---

## 10. Audit log

`auditService.record` không bao giờ ném lỗi; bảng không có khoá ngoại tới users; `actorEmail` chép
tại lúc ghi.

**Có ghi**: `LOGIN_SUCCEEDED` (API login, API 2fa/verify, API passkey, web passkey);
`TWO_FACTOR_FAILED` (chỉ API); `TWO_FACTOR_ENABLED`/`DISABLED`/`RECOVERY_REGENERATED` (API và web
`/security`); `PASSKEY_REGISTERED` (API); `PASSKEY_REMOVED` (API và web); `EMAIL_CHANGE_REQUESTED`,
`EMAIL_CHANGED` (chỉ API); `PHONE_VERIFIED`; `SESSION_REVOKED` (chỉ `DELETE /auth/sessions`);
`USER_ROLES_ASSIGNED` (API PUT roles); chuỗi tự do từ web admin: `"user.created"`,
`"user.banned"`/`"user.unbanned"`, `"user.unlocked"`, `"user.deleted"`,
`"role.permissions_updated"`, `"role.created"`, `"role.deleted"`.

**Không ghi**: đăng nhập mật khẩu và 2FA trên web, OAuth, quick-login, register, LOGIN_FAILED, đặt
lại/đổi mật khẩu, refresh token bị dùng lại (chỉ `logger.warn`), thao tác user/role qua API (trừ PUT
roles), status/unlock/permission override qua API, thu hồi một phiên, liên kết/gỡ OAuth, mời/tick
quyền/gỡ nhân sự sân, xác nhận đổi email trên web.

---

## 11. REST API auth / users / roles (`/api/v1`)

| Route                                                  | Guard                                                                                   | Rate limit        | Việc                                                  | Audit                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- | ----------------------------------------- |
| POST auth/register                                     | công khai                                                                               | api:register 5/1h | `register` → `issueTokenPair` (201)                   | —                                         |
| POST auth/login                                        | công khai                                                                               | api:login 5/5′    | `validateCredentials`; cần 2FA thì trả vé             | LOGIN_SUCCEEDED                           |
| POST auth/2fa/verify                                   | vé 2FA                                                                                  | api:2fa 10/5′     | verifyTicket + verifyCode → token (`twoFactorAt`)     | TWO_FACTOR_FAILED / LOGIN_SUCCEEDED       |
| POST auth/refresh                                      | refresh token                                                                           | api:refresh 30/5′ | `rotate` → access mới có `sid`                        | —                                         |
| POST auth/logout                                       | requireApiUser                                                                          | —                 | `revoke(refreshToken)` hoặc `allDevices`              | —                                         |
| GET auth/me                                            | requireApiUser                                                                          | —                 | `findById`                                            | —                                         |
| POST auth/forgot-password                              | công khai                                                                               | 3/15′             | luôn 200                                              | —                                         |
| POST auth/reset-password; POST auth/verify-email       | token                                                                                   | 10/15′            | `resetPassword` / `verifyEmail`                       | —                                         |
| POST auth/verify-email/request                         | requireApiUser                                                                          | 3/15′             | `sendEmailVerification`                               | —                                         |
| POST auth/change-password                              | requireApiUser                                                                          | 10/15′            | `changePassword` (không giữ phiên hiện tại)           | —                                         |
| POST auth/change-email; POST auth/change-email/confirm | requireApiUser / token                                                                  | 3/15′             | `requestEmailChange` / `confirmEmailChange`           | EMAIL_CHANGE_REQUESTED / EMAIL_CHANGED    |
| GET, DELETE auth/2fa                                   | requireApiUser                                                                          | DELETE: api:2fa   | status (+`available`) / `disable`                     | TWO_FACTOR_DISABLED                       |
| POST auth/2fa/setup                                    | requireApiUser                                                                          | **không**         | `beginSetup`                                          | —                                         |
| POST auth/2fa/enable; POST auth/2fa/recovery-codes     | requireApiUser                                                                          | api:2fa           | `confirmSetup` / `regenerateRecoveryCodes`            | TWO_FACTOR_ENABLED / RECOVERY_REGENERATED |
| GET auth/passkeys; PATCH, DELETE auth/passkeys/[id]    | requireApiUser                                                                          | —                 | `list` / `rename` / `remove`                          | PASSKEY_REMOVED                           |
| POST auth/passkeys/register/options                    | requireApiUser                                                                          | **không**         | options + vé `webauthn_reg`                           | —                                         |
| POST auth/passkeys/register/verify                     | requireApiUser                                                                          | api:passkey 30/5′ | vé.sub = session.sub → lưu                            | PASSKEY_REGISTERED                        |
| POST auth/passkeys/login/options; …/login/verify       | công khai / vé                                                                          | api:passkey       | options + vé / xác minh → token                       | LOGIN_SUCCEEDED                           |
| POST auth/phone/request-otp; POST auth/phone/verify    | requireApiUser                                                                          | 5/15′ (+ theo số) | gửi / xác nhận OTP                                    | PHONE_VERIFIED                            |
| GET, DELETE auth/sessions; DELETE auth/sessions/[id]   | requireApiUser                                                                          | —                 | `listActive` / thu hồi trừ `sid` / `revokeById` (404) | chỉ DELETE auth/sessions                  |
| GET auth/oauth/providers                               | công khai                                                                               | —                 | provider đã cấu hình                                  | —                                         |
| GET auth/oauth/linked; DELETE auth/oauth/[provider]    | requireApiUser                                                                          | —                 | `listLinked` / `unlink`                               | —                                         |
| GET auth/oauth/[provider]/start; GET, POST …/callback  | công khai                                                                               | —                 | luồng redirect, **đặt cookie phiên web**              | —                                         |
| GET users                                              | `user:read`                                                                             | —                 | `list`                                                | —                                         |
| POST users                                             | `user:create`                                                                           | —                 | `create(body)` — **không truyền actorId** ✅          | —                                         |
| GET users/[id]                                         | requireApiUser + `canActOnResource(user:read / profile:read:own)` → 403                 | —                 |                                                       | —                                         |
| PATCH users/[id]                                       | như trên với `user:update / profile:update:own`; `roleKeys` luôn đòi thêm `user:update` | —                 | `update(actorId)`                                     | —                                         |
| DELETE users/[id]                                      | `user:delete`                                                                           | —                 | `softDelete(actorId)`                                 | —                                         |
| PATCH users/[id]/status                                | `user:update`                                                                           | —                 | `setStatus(actorId)`                                  | —                                         |
| POST users/[id]/unlock                                 | `user:update`                                                                           | —                 | `unlock(id)` — không actorId                          | —                                         |
| PUT users/[id]/roles                                   | `user:update`                                                                           | —                 | `update({roleKeys}, actorId)`                         | USER_ROLES_ASSIGNED                       |
| GET, PUT users/[id]/permissions                        | `user:read` / `user:update`                                                             | —                 | `explainFor` / `setUserPermission(actorId)`           | —                                         |
| DELETE users/[id]/permissions/[permissionKey]          | `user:update`                                                                           | —                 | `clearUserPermission` — không actorId                 | —                                         |
| GET roles, GET roles/[key], GET permissions            | `role:read`                                                                             | —                 | vai trò + danh mục quyền (từ code)                    | —                                         |
| POST roles; PATCH, DELETE roles/[key]                  | `role:create` / `role:update` / `role:delete`                                           | —                 | create / update / remove — **cả ba không actorId** ✅ | —                                         |

Thêm route mới phải khai báo trong `src/lib/openapi/registry.ts` (test so khớp hai chiều).

---

## 12. Bất biến — không được phá

1. **Mọi Server Action bọc wrapper**; chỉ luồng đăng nhập công khai được viết trần. _Lý do:_ action
   là HTTP endpoint công khai; proxy và layout không bảo vệ; wrapper biến việc quên kiểm quyền thành
   lỗi biên dịch.
2. **Mọi route `/api/**` tự gọi guard.** _Lý do:_ proxy cố ý không chạy trên `/api` để trả JSON 401
   thay vì redirect.
3. **Quyền tra DB theo userId, không đọc từ JWT.** _Lý do:_ token sống lâu; tước quyền phải có hiệu
   lực ngay (cache ≤60 giây).
4. **Câu hỏi theo sân chỉ một dạng `canOnVenue`**, không bao giờ `role === "OWNER"`; id con lọc theo
   `ctx.venueId` trong truy vấn, lệch sân → NOT_FOUND. _Lý do:_ bản cũ chỉ kiểm phạm vi sân ở 2/29
   service, nhân viên sân A thao tác được sân B.
5. **`VENUE_OWNER_ONLY` không bao giờ tới tay STAFF hay quyền toàn cục**; giao diện không có ô tick.
   _Lý do:_ đây là tiền rời hệ thống và mất sân; service chặn cả khi ghi thẳng vào DB.
6. **`invoice:manage` ≠ `payout:approve`.** _Lý do:_ người thu tiền không được mở đường chi tiền.
7. **Danh mục quyền nằm trong code, việc gán nằm trong DB**; key lạ trong DB bị bỏ qua
   (`isKnownPermission`). _Lý do:_ quyền chỉ có nghĩa khi có dòng mã kiểm nó.
8. **Mọi đường ghi thẩm quyền gọi `invalidateUser`/`invalidateAll`.** _Lý do:_ quên thì người bị
   tước quyền vẫn thao tác được tới 60 giây.
9. **Tước (`isGranted=false`) luôn thắng; ngoại lệ hết hạn lọc trong truy vấn.**
10. **Chốt `Role.level` cần `actorId` thật**; `level` luôn đồng bộ từ code khi seed. _Lý do:_ chặn
    ADMIN tự tạo SUPER_ADMIN (hiện nhiều nơi quên truyền, §14).
11. **Không đọc vai trò từ form web; đăng ký công khai luôn là USER; `isSystem` không nhận từ input.**
    _Lý do:_ tránh tự phong ADMIN bằng một field ẩn.
12. **Không tự đổi vai trò, tự khoá, tự xoá chính mình.** _Lý do:_ quản trị viên cuối cùng không tự
    khoá mình ra ngoài.
13. **Thất bại đăng nhập đồng nhất**: cùng một lỗi, `fakeCompare` cho user không tồn tại;
    BANNED/INACTIVE/khoá tạm chỉ lộ SAU KHI mật khẩu đúng; cổng 2FA đặt cuối và dùng exception.
    _Lý do:_ chống dò tài khoản; nơi gọi không thể "quên" 2FA.
14. **`assertLoginAllowed` ở mọi đường đăng nhập** (mật khẩu, bước 2FA, passkey, OAuth);
    `lockedUntil` chỉ áp cho mật khẩu.
15. **JWT phân loại bằng `typ`**: `verifySession` chỉ nhận `"access"`, `verifyTicket` nhận đúng
    loại. _Lý do:_ mọi JWT dùng chung một khoá; thiếu phép kiểm thì vé 2FA dùng như phiên hoàn chỉnh.
16. **Bí mật chỉ lưu dạng băm**: refresh và link token SHA-256 trần; OTP và mã khôi phục dùng
    `hashScopedToken` kèm userId; OTP đi qua `consumeOtp`, link qua `consume` (gọi nhầm thì ném lỗi);
    tiêu thụ bằng `updateMany … usedAt: null`. _Lý do:_ rò DB không lộ phiên; `SHA256("123456")` là
    hằng số nên tra chéo được; đua request chỉ một bên thắng.
17. **Bí mật TOTP mã hoá AES-256-GCM; không đổi `ENCRYPTION_KEY`.** _Lý do:_ đổi khoá là hỏng mọi
    2FA đã bật.
18. **Refresh token xoay vòng giữ `familyId`; `sessionId` trả client là `familyId`** (login và
    refresh phải khớp). _Lý do:_ client nhận ra "thiết bị này"; lỗi trả `id` đã từng xảy ra.
19. **Ràng buộc sở hữu nằm trong `where`** (revokeById, passkey, member theo venueId); trả 404 không
    phân biệt. _Lý do:_ id đến từ client.
20. **Web trả 404 khi thiếu quyền; API trả 401/403** (theo sân thì 404).
21. **Không lộ email có tồn tại hay không**: quên mật khẩu luôn thành công và nuốt lỗi; gửi lại email
    xác thực lấy địa chỉ từ phiên.
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

---

## 13. Mẫu mã khi viết mới

**13.1 Server Action cần quyền toàn cục**

```ts
"use server";
import { defineAction } from "@/lib/define-action";
import { DomainError } from "@/lib/errors";

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

- Luôn truyền `actorId` xuống service có chốt level. Tên audit dùng hằng `AUDIT_ACTIONS`.
- Không đọc vai trò hay quyền từ form. Trang tương ứng gọi `await requirePermission("venue:approve",
"/x")`.

**13.2 Action theo sân**: `defineVenueAction("booking:cancel", async (ctx, _prev, formData) => …)`;
UI gọi `action.bind(null, venueId)`. Service lọc id con ngay trong truy vấn, ví dụ `where: { id:
bookingId, venueId: ctx.venueId }`, không thấy → lỗi NOT_FOUND. Test phải có ca "id của sân khác →
NOT_FOUND" với mock lọc thật. Trang dùng `requireVenueAccess(venueId, "booking:read")`.

**13.3 Chỉ cần đăng nhập** (dữ liệu của chính mình): `defineAuthedAction`, luôn ràng buộc `userId:
ctx.actorId` trong `where`. **Công khai**: `definePublicAction("lý do", { key: "ten", limit: 10,
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

- Không dùng `requireApiAdmin`. Endpoint công khai: `enforceRateLimit(request, "api:<scope>",
RATE_LIMITS.x)`. Tài nguyên của chính người gọi: `userId` trong `where`, không thấy →
  `apiErrors.notFound()`. Khai báo route trong `src/lib/openapi/registry.ts`.

**13.5 Thêm permission mới**

1. Thêm key vào `PERMISSIONS` (dạng `tài-nguyên:hành-động`).
2. Thêm vào `PERMISSION_METADATA` (TypeScript bắt nếu thiếu).
3. Thêm vào `DEFAULT_ROLE_PERMISSIONS` nếu cần; ADMIN phải vẫn chứa mọi quyền của USER (test kiểm).
4. Quyền theo sân: đặt vào đúng MỘT trong `VENUE_STAFF_DEFAULT` / `VENUE_STAFF_GRANTABLE` /
   `VENUE_OWNER_ONLY`.
5. `pnpm db:seed` (không cần migration).

**13.6 Ghi vào bảng thẩm quyền**: gọi `permissionService.invalidateUser(userId)` hoặc
`invalidateAll()`; đi qua `assertCanActOn` / `assertCanAssignRoles` / `assertCanManageLevel` với
`actorId` thật.

**13.7 Thêm một đường đăng nhập mới**: `assertLoginAllowed(user.status)`; đi bằng mật khẩu thì xử lý
`TwoFactorRequiredError`; web `createSession({typ:"access", sub, email, roles, mfa?})`, mobile
`issueTokenPair(user, {userAgent, ip, twoFactorAt?})`; đích `safeRedirectPath(next || await
landingPathFor(user.id), "/")`, route handler dùng `redirectRelative`; audit `LOGIN_SUCCEEDED` kèm
`metadata.method`.

**13.8 Token hoặc mã mới**: token 256 bit → `generateOpaqueToken` + `hashOpaqueToken`; mã entropy
thấp → `hashScopedToken(scope, code)` + bộ đếm lần sai + hạn ngắn; JWT ngắn hạn → thêm một `typ` vào
union trong `tickets.ts`, không dùng `signSession`.

**13.9 Lỗi nghiệp vụ**: kế thừa `DomainError` với `code` có sẵn; `handleApiError` tự ánh xạ HTTP;
action trả `error.message`. Trùng khoá bắt bằng `isUniqueViolation` (`src/lib/prisma-errors.ts`),
không đọc `meta.target` (GOTCHAS #10).

---

## 14. Nghi lỗi và lỗ hổng ĐÃ BIẾT (chưa sửa tại 17/09/2026)

> Đây là danh sách để **biết**, không phải việc tự ý làm. Task chạm vào vùng đó thì báo user kèm mục
> số; sửa thì phải có test chứng minh lỗi trước. ✅ = đã đối chiếu lại mã.

### 14.1 Mức CAO

1. ✅ **Thu hồi tức thì không hoạt động.** `isTokenStillValid` không được gọi ở `auth.ts`,
   `api/auth.ts`, `proxy.ts` hay realtime. Chú thích `auth.service.ts` ("đá kẻ tấn công ra NGAY"),
   `env.ts` và CLAUDE.md ("`passwordChangedAt` thu hồi TỨC THÌ") sai với thực tế. Đổi/đặt lại mật
   khẩu không vô hiệu cookie web (sống tới 7 ngày) hay access token mobile (15 phút).
2. ✅ **Khoá (BANNED/INACTIVE) không cắt phiên web.** `permissionService.load` và
   `userService.findById` chỉ lọc `deletedAt`; `setStatus` chỉ thu hồi refresh token. Admin bị ban
   vẫn dùng mọi trang và action `defineAction` bằng cookie cũ tới `SESSION_MAX_AGE_DAYS`.
   `defineAuthedAction` và `requireApiUser` còn cho qua cả user đã xoá mềm (không chạm DB).
3. ✅ **Chốt level của vai trò không bao giờ chạy.** Mọi lời gọi `roleService.create/update/remove`
   đều không truyền `actorId`: `(admin)/roles/actions.ts:62,108,141`, `api/v1/roles/route.ts:41`,
   `api/v1/roles/[key]/route.ts:40,55`. ADMIN có `role:update` tick được `user:delete`,
   `role:delete`, `system:manage`, `setting:update`, `payout:approve` cho chính vai trò ADMIN, hoặc
   sửa/hạ quyền SUPER_ADMIN/USER → **leo thang đặc quyền**. Sửa: truyền `{ actorId: ctx.actorId }` /
   `{ actorId: session.sub }`.
4. ✅ **`POST /api/v1/users` không truyền actorId** (`api/v1/users/route.ts:47`) →
   `assertCanAssignRoles` bị bỏ qua; ADMIN gửi `roleKeys:["SUPER_ADMIN"]` tạo được tài khoản tối
   cao. Route test còn khẳng định hành vi này (`route.test.ts`) — sửa thì sửa cả test.
5. ✅ **Tiền-chiếm tài khoản qua OAuth.** Liên kết theo email không kiểm `emailVerifiedAt` của tài
   khoản có sẵn, trong khi đăng ký không cần xác thực email. Kẻ xấu đăng ký trước bằng email nạn
   nhân; nạn nhân sau đó "Tiếp tục với Google" và bị gắn vào tài khoản mà kẻ xấu vẫn giữ mật khẩu.
6. **Khoá tạm thành "oracle" mật khẩu.** Trong lúc khoá, sai mật khẩu nhận `InvalidCredentials`, đúng
   mật khẩu nhận `AccountLockedError` → kẻ dò vẫn đoán tiếp được và biết khi nào trúng.
7. ✅ (logic) / chưa thử trình duyệt — **Nghi open redirect**: `safeRedirectPath` chỉ chặn `//` ở đầu,
   nên cho qua `/\evil.com` và `/<TAB>/evil.com`, mà trình duyệt chuẩn hoá thành `//evil.com`. Nguy
   hiểm nhất là OAuth `start?next=/%5Cevil.com` → callback; cũng áp cho login/2FA/register/passkey.

### 14.2 Mức TRUNG BÌNH

8. ✅ **Nút Khoá/Mở khoá trên `/users` luôn báo "Trạng thái không hợp lệ"**: `setUserStatusAction`
   gọi `userStatusSchema.safeParse(status)` (schema là `z.enum`) trong khi nút gửi object `{ status:
next }` → parse luôn thất bại. Phải dùng `setUserStatusSchema` hoặc truyền chuỗi. Test không phủ.
9. **`PATCH /api/v1/users/[id]` sửa chính mình luôn bị chặn**: `assertCanActOn(actorId, id)` với
   actor = target → level ≥ level luôn đúng. Test mock service nên không thấy. ⚠️ Nếu "sửa" bằng cách
   bỏ chốt cho tự sửa, `updateUserSchema` sẽ cho tự đổi `email` (bỏ luồng hai bước, giữ
   `emailVerifiedAt`), `phone`, `status` — phải tách schema tự sửa.
10. **Trùng khoá lúc đua thành 500**: `catchDuplicate` đọc `meta.target`, thứ không tồn tại với
    Prisma 7 + adapter-pg (GOTCHAS #10). Dùng `isUniqueViolation`.
11. ✅ **Lỗi OAuth không khớp lớp**: `oauth.service.ts` ném `OAuthEmailRequiredError` từ
    `@/lib/errors`, callback so `instanceof` với lớp cùng tên trong `@/lib/oauth/types` →
    `email_required` rơi vào `unknown` và bị `logger.error`. `AccountInactiveError` và tài khoản xoá
    mềm có liên kết cũng rơi vào `unknown`.
12. **OAuth bỏ qua TOTP** cho tài khoản đã bật 2FA; chưa có tài liệu nói đây là quyết định có chủ
    đích (khác passkey).
13. **Apple nghi không đăng nhập được**: callback nhận POST cross-site (`form_post`) nhưng cookie
    `oauth_flow` đặt `sameSite:"lax"` nên không được gửi kèm → `state_mismatch`.
14. **2FA không có bộ đếm lần sai theo tài khoản/vé**; vé dùng lại được 5 phút; web và API là hai
    bucket IP riêng. Chú thích nói `VERIFICATION_MAX_ATTEMPTS` bảo vệ mã khôi phục nhưng
    `two-factor.service.ts` không dùng. TOTP không chống phát lại trong cửa sổ ±30s.
15. **STAFF có `member:manage` tự leo quyền trong sân**: `setPermissions`/`remove` không cấm sửa
    chính mình hay gỡ người khác, mà `member:manage` lại grantable.
16. **`clearUserPermission` không chốt level, không actorId**: ADMIN gỡ được lệnh tước quyền đặt trên
    ADMIN khác hoặc SUPER_ADMIN. **`setUserPermission` không kiểm người cấp có quyền đó không**:
    ADMIN cấp được `payout:approve`/`setting:update` cho tài khoản thấp hơn. **`unlock` qua API**
    thiếu actorId.
17. **`APP_URL` vs `NEXT_PUBLIC_APP_URL`**: `.env.example` chỉ khai `NEXT_PUBLIC_APP_URL`, nhưng link
    email dùng `appUrl()` bắt buộc `APP_URL`, WebAuthn cũng suy từ `APP_URL`. Thiếu `APP_URL` → email
    đăng ký/quên mật khẩu hỏng im lặng (lỗi bị nuốt), passkey bị ẩn. `API_PUBLIC_URL`/`apiUrl()` khai
    báo mà không dùng. (Chưa đối chiếu `.env` thật — không đọc `.env`.)
18. **`canOnVenue` không kiểm trạng thái sân** (xoá mềm, ADMIN_LOCKED) — chưa xác minh service có tự
    kiểm không.

### 14.3 Mức THẤP / không nhất quán

- `userService.update` đổi status không thu hồi refresh (khác `setStatus`); `rotate` không chặn
  INACTIVE; admin đổi email không reset `emailVerifiedAt`.
- Refresh bỏ mất `mfa` và `ip`. Claim `mfa` được ghi nhưng không nơi nào đọc (chưa có step-up).
- Chú thích nói refresh token bị dùng lại sẽ "huỷ TOÀN BỘ phiên" (`token.service.ts`,
  `refresh/route.ts`, `errors.ts`, README) — mã chỉ thu hồi một họ.
- ✅ `session.ts` để `typ` `.default("access")`: JWT không có `typ` vẫn được nhận, trái chú thích
  "danh sách trắng".
- Chênh thời gian: sai mật khẩu có thêm ghi DB, không tồn tại chỉ `fakeCompare`.
- Web chưa bắt `AccountInactiveError` → rơi vào "Login failed unexpectedly".
- `quick-login` không rate limit, không try/catch: tài khoản dev bật 2FA hoặc sai mật khẩu → 500.
  Chú thích `dang-nhap-nhanh.tsx` ("gửi tới CHÍNH action đăng nhập… rate limit… 2FA") sai.
- `(admin)/layout.tsx` đặt cứng `requireUser("/users")`; `requireVenueAccess` đặt cứng
  `/manage/<id>`. Header thiếu `/invoices` → người chỉ có `invoice:manage` không thấy mục "Quản trị".
  Proxy chuyển người đã đăng nhập vào `/login` về `/`, bỏ qua `next`.
- Audit dùng chuỗi ngoài `AUDIT_ACTIONS`; đặt INACTIVE bị ghi thành `"user.unbanned"`. Nhiều hằng
  không ai dùng (LOGIN_FAILED, PASSWORD_*, USER_STATUS_CHANGED, USER_PERMISSION_OVERRIDDEN,
  REFRESH_TOKEN_REUSED, ROLE_UPDATED).
- `auth.schema.ts` có hai JSDoc mâu thuẫn về `sessionId`; `authResponseSchema` (dạng `tokens` lồng)
  lệch response phẳng thật; `activeSessionSchema` có `ip`/`current` mà API không trả;
  `OAUTH_PROVIDERS` khai báo hai lần; `verifyPhoneOtpSchema` nói nhận khoảng trắng nhưng regex chặn
  khoảng trắng ở giữa.
- `webauthn.service.ts` báo "Không tìm thấy người dùng" cho passkey không tồn tại. `/2fa/setup` thiếu
  `ENCRYPTION_KEY` ném `Error` thường → 500.
- `GET /api/v1/roles` trả `description` là cả object metadata (khác `/permissions`); `if (!role)` ở
  `roles/[key]/route.ts` không bao giờ chạy tới.
- Chú thích cũ: `api/v1/users/[id]/route.ts` ("SelfDeletionError", "onDelete: Cascade" — thực tế xoá
  mềm); `api/v1/users/route.ts` ("roleKey", "RoleNotFoundError"); `roles/page.tsx` ("giữ vai trò cũ
  trong token"); `session-revoke-button.tsx` nói thiết bị kia bị đăng xuất "ngay lập tức" (access còn
  sống ≤15 phút); `define-action.ts` nói `lyDo` luôn nằm trong log (chỉ ghi khi bị chặn).
- `passkey-manager.tsx` viết cứng `/api/v1` thay vì `apiPath`. `TwoFactorForm` nhận Server Action qua
  prop, trái ghi chú ở `auth-form.tsx`. `oauth/start` trả JSON `{error}` không theo envelope.
- `seedRbac` thêm lại quyền mặc định mà admin đã cố ý gỡ, mỗi lần seed → chạy seed khi deploy là trả
  lại quyền đã tước; `level` luôn bị ghi đè từ code.

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
- Action theo sân chỉ kiểm venueId của URL → IDOR ở 5 action (GOTCHAS #19, sửa 17/09).
- `registerAction` và passkey từng bỏ qua `next` → khách đăng ký giữa luồng đặt sân bị đưa về
  landing, mất khung đã chọn (sửa 17/09).
- `prisma migrate dev` đã xoá index viết tay (GOTCHAS #11).

---

## 16. Việc dở, mã chết

- Web **chưa có** giao diện: đổi mật khẩu, xin đổi email, xác thực số điện thoại, gửi lại email xác
  thực (trang `verify-email` bảo "Đăng nhập rồi yêu cầu gửi lại" nhưng không có chỗ), quản lý liên
  kết OAuth.
- Mã không ai dùng: `requireAdmin`, `requireApiAdmin`, `requireVenuePermission`, `canAny`, `canAll`,
  `venuesWithPermission`, `isGrantableToStaff`, `permissionsByCategory`, `resendEmailVerification`,
  `updateProfile`, `getProfile`, `logoutAction` trong `(auth)/actions.ts`, cột `pendingEmail`.
- Luồng lời mời nhân viên (INVITED, trang chấp nhận) chưa có: mời xong là ACTIVE ngay.
- Chưa có endpoint OAuth cho mobile; chưa có REST cho sân (`requireVenuePermission` chờ dùng).

---

## 17. Di sản bộ khung và tài liệu lệch mã

- **Trang `/users`, `/roles`, `/security`, `/sessions` vẫn mang style bộ khung**: inline `style={{}}`
  với biến `--text-muted`, `--border-color`, `--danger-color`, `--radius-md`; class `.user-list`,
  `.user-item`, `.badge-*`, `.alert-*`, `.form-grid`, `.permission-grid`; emoji. Class
  **`trang-title` không tồn tại** ✅ (`globals.css` chỉ có `.page-title`) → tiêu đề 4 trang mất
  style — di chứng đổi tên regex "page" → "trang".
- Dấu vết đổi tên regex trong chú thích: `ngay` thay `start` (`safe-redirect.ts`, `oauth/config.ts`,
  `flow-cookie.ts`); `lấy` thay `read` (`permissions.test.ts`, `permission.venue.test.ts`,
  `api/v1/users/[id]/route.ts`); `trang` thay `page` (`common.schema.ts`); "ĐÃ WEEKDAY_NAMES HỒI"
  (`token.service.test.ts`).
- Dấu vết monorepo/NestJS của base_template trong chú thích: `auth.service.ts` (apps/api,
  JwtService, packages/core, `@RateLimit`), `permissions.ts` (`@repo/core`), `webauthn.service.ts`,
  `crypto.ts`, `user.schema.ts`, `env.ts` (`JwtAuthGuard`), `smser.ts`, `emails.ts` (`apps/web`),
  `proxy.ts`, `role.schema.ts` (thang STAFF/MANAGER không còn), `profile.ts` (User-Agent
  "nextjs-prisma-base"). **`APP_NAME` mặc định "Base Template"** → thành issuer TOTP và rpName
  passkey; nên đặt `APP_NAME=ChốtSân`.
- Tên tiếng Việt trong mã (trái quy ước "mã tiếng Anh"): `lyDo`, `danhTinh` (`define-action.ts`),
  `DangNhapNhanh`, `TAI_KHOAN`, `MAT_KHAU` (`dang-nhap-nhanh.tsx`), biến `dich`.
- **README.md lệch mã**: bảng tài khoản (admin@example.com / devpassword123); "token sống 7 ngày";
  còn tương thích bcrypt; chữ ký `canActOnResource`; `PERMISSION_DESCRIPTIONS`; cache theo vai
  trò/tiến trình và "quyền tra theo role trong token"; regex username và "email bắt buộc"; ví dụ
  `"role":"USER"`; khuyên dùng `requireApiAdmin`; nói web chưa phân trang `/users`; nói email cần
  `NEXT_PUBLIC_APP_URL` (thực tế `APP_URL`).
- **`docs/HUONG_DAN_KIEN_TRUC_RBAC_VA_AUTH.md` gần như lỗi thời hoàn toàn**: bcrypt; 5 vai trò
  (MANAGER/STAFF/CUSTOMER); `User.roleId`; access token mang permissions; refresh 7 ngày;
  `seed-prod.ts`; "không cho sửa System Roles" (thực tế `roleService.update` cho sửa). Đừng tin.
- **CLAUDE.md**: nhắc `recordOrThrow()` (không tồn tại); OAuth route `/api/auth/oauth/...` (thực tế
  `/api/v1/auth/oauth/...`); `passwordChangedAt` "thu hồi TỨC THÌ" (chưa nối); `db:migrate` là
  `prisma migrate dev` (cấm, GOTCHAS #11). GOTCHAS #7 tả mangle email khi xoá mềm
  (`deleted_<id>@deleted.invalid`) khác mã thật (`<email>:deleted:<ts>`).

---

## 18. Vận hành

| Biến                                                                                                                                             | Mặc định            | Tác dụng                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                                                                                                                                 | bắt buộc, ≥32 ký tự | Ký JWT phiên và mọi vé; `realtime/` phải dùng giá trị trùng. Xoay khoá = mọi người đăng nhập lại                                               |
| `SESSION_MAX_AGE_DAYS`                                                                                                                           | 7 (≤365)            | Hạn cookie/JWT web; cũng là cửa sổ thiệt hại khi lộ cookie hoặc khi tài khoản bị khoá                                                          |
| `ACCESS_TOKEN_TTL_MINUTES` / `REFRESH_TOKEN_TTL_DAYS`                                                                                            | 15 / 30             | Token mobile                                                                                                                                   |
| `TWO_FACTOR_CHALLENGE_TTL_MINUTES`                                                                                                               | 5 (≤30)             | Hạn vé 2FA                                                                                                                                     |
| `SESSION_STRICT_REVOCATION`                                                                                                                      | 1                   | Hiện **không có tác dụng** (chưa nối)                                                                                                          |
| `LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES`                                                                                            | 5 / 15              | Khoá tạm theo tài khoản                                                                                                                        |
| `EMAIL_VERIFICATION_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES`                                                                                    | 24 / 60             | Hạn link (đổi email dùng chung 24h)                                                                                                            |
| `PHONE_VERIFICATION_ENABLED`, `PHONE_OTP_TTL_MINUTES`, `PHONE_OTP_RESEND_COOLDOWN_SECONDS`, `PHONE_OTP_MAX_PER_DAY`, `VERIFICATION_MAX_ATTEMPTS` | 0, 5, 60, 5, 5      | Luồng SMS. Chỉ nhận `1`/`0`                                                                                                                    |
| `ENCRYPTION_KEY`                                                                                                                                 | trống (≥16 khi đặt) | AES-256-GCM (SHA-256 của chuỗi) cho bí mật TOTP. Trống = 2FA ẩn. **Không đổi sau khi đã có dữ liệu**                                           |
| `APP_URL`                                                                                                                                        | trống               | Link email (`appUrl` ném lỗi khi thiếu); suy rpID/origin passkey                                                                               |
| `NEXT_PUBLIC_APP_URL`                                                                                                                            | trống               | `publicAppUrl` → `redirect_uri` OAuth (fallback `APP_URL`)                                                                                     |
| `WEBAUTHN_RP_ID` + `WEBAUTHN_ORIGINS`                                                                                                            | trống               | Phải đặt **cả hai** mới bỏ qua `APP_URL`. Đổi RP ID = mọi passkey cũ chết. App mobile cần thêm origin `android:apk-key-hash:…`                 |
| `APP_NAME`                                                                                                                                       | "Base Template"     | Issuer TOTP và rpName — nên đổi thành ChốtSân                                                                                                  |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_*`, `FACEBOOK_*`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY`                                                | trống               | Thiếu thì provider bị ẩn. Khoá `.p8` dán `\n` dạng chữ vẫn được                                                                                |
| `REDIS_URL`                                                                                                                                      | trống               | Rate limit, cache quyền, cache stamp dùng chung giữa instance. Thiếu = RAM từng tiến trình: ngưỡng nhân theo số instance, invalidate không lan |
| `QUEUE_ENABLED`                                                                                                                                  | 1                   | Email/SMS qua hàng đợi (cần worker + Redis); `0` = gửi ngay trong request                                                                      |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`                                                                                                                 | trống (mật khẩu ≥8) | `db:seed` tạo **SUPER_ADMIN**; đã tồn tại thì không reset mật khẩu                                                                             |
| `SMTP_*`, `MAIL_FROM`                                                                                                                            | —                   | Mailer (dev ghi log, production thiếu cấu hình thì ném lỗi)                                                                                    |
| `AUDIT_RETENTION_DAYS`                                                                                                                           | 365                 | Dọn nhật ký                                                                                                                                    |
| `NODE_ENV`                                                                                                                                       | —                   | Chặn đăng nhập nhanh; cookie `Secure`; CSP dev có `unsafe-eval`                                                                                |

- **OAuth**: redirect URI `<NEXT_PUBLIC_APP_URL>/api/v1/auth/oauth/<p>/callback` khớp 100% trên
  console provider; GitHub cần scope `user:email`; Facebook Graph v21.0; Apple `form_post` (xem §14
  mục 13).
- **SMS**: gọi `setSmser({ send })` lúc khởi động. Hàng đợi mặc định thử lại 3 lần — nhà cung cấp
  tính phí cả khi báo lỗi thì hạ `attempts` của job `sms:send`.
- **Reverse proxy**: phải GHI ĐÈ `X-Forwarded-For` bằng IP thật (Caddy `{remote_host}`, nginx
  `$remote_addr`), không thì rate limit và định danh `definePublicAction` bị lách. App chỉ nên nghe
  `127.0.0.1`.
- **CSRF**: REST dùng cookie fallback chỉ dựa vào `SameSite=Lax`, không kiểm Origin hay token CSRF.
  Server Action có cơ chế kiểm Origin của Next. Mọi subdomain cùng site đều là "same-site".
- **Seed**: `pnpm db:seed` ở dev = rbac, sports, admin, 4 tài khoản dev, sân mẫu, ảnh;
  `pnpm db:seed:prod` = rbac, sports, admin. Chạy lại sau mỗi lần thêm permission. ⚠️ seed thêm lại
  quyền mặc định đã bị gỡ và ghi đè `level`.
- **Dọn dẹp**: `pnpm db:purge` gọi `tokenService.purgeExpired` (refresh hết hạn hoặc thu hồi quá 30
  ngày) và `verificationService.purgeExpired`; có systemd timer đi kèm.
- **Migration**: không `prisma migrate dev` / `pnpm db:migrate`. `migrate diff` → đọc SQL, gỡ mọi
  `DROP` đụng `users_*_active_key`, `venue_members_mot_chu_cho_moi_co_so` và trigram index →
  `migrate deploy` → `db:generate` → `db:check-conflict` → khởi động lại dev (chi tiết ở
  `data-model.md`).
- **Header bảo mật**: `next.config.mjs` (nosniff, `X-Frame-Options: DENY`, Referrer-Policy,
  Permissions-Policy, HSTS). CSP có nonce theo request dựng trong `src/proxy.ts`, chỉ áp cho trang,
  không áp cho `/api`.
