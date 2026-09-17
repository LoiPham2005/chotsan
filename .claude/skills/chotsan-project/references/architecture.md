# Kiến trúc và hạ tầng

## 1. Các tiến trình

```
Caddy (80/443, HTTPS tự động, GHI ĐÈ X-Forwarded-For)
  ├─ /socket.io/*  → realtime  (Socket.IO, :3002, /health)
  └─ còn lại       → web       (Next standalone, :3000, /api/health)
worker   (BullMQ, lấy job từ Redis hàng đợi "app", health :3003)
Postgres (dev: Neon; Docker: postgres 16; CI: 17)   Redis (tuỳ chọn ở dev)
migrate  (chạy một lần trước web)                  tools/purge (theo lệnh/lịch)
```

- Phiên bản đáng nhớ: **Next 16.3.5** (16.3.1 dính 2 lỗ RCE critical GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4),
  BullMQ 6 + **`ioredis`** (BullMQ 6 nạp lười — thiếu gói là worker chết lúc chạy), **`cron-parser`** (bộ chạy
  lịch trong tiến trình web). Node 24.

- Web KHÔNG gọi realtime (không có `socket.io-client` trong `src`). Realtime hiện chỉ là khung (sự kiện mẫu
  `ping:user`), ứng dụng chưa kết nối.
- Web ↔ worker nói chuyện qua hàng đợi Redis. Job theo lịch: worker HOẶC chính web (xem mục 6).
- Realtime và `/health` của worker nghe **`127.0.0.1`** mặc định (biến `HOST`; Docker đặt `0.0.0.0` cho realtime
  vì cổng compose đi vào card mạng container). Web systemd/PM2 nghe `HOSTNAME=127.0.0.1`.
- Cổng: web 3000 · realtime 3002 · worker health 3003 · Postgres 5432 · Redis 6379 · e2e 3100 · Prisma Studio 5555.

---

## 2. Tầng lớp trong web

```
src/proxy.ts (CSP + chặn trang)  →  page/layout (Server Component)  →  service  →  Prisma
                                     Server Action (define*Action)  ↗
                                     route handler /api/v1 (require*) ↗
```

- **Service là nơi DUY NHẤT gọi Prisma** (`src/services/*.service.ts`, class nhận `db = prisma` qua
  constructor + export instance dùng chung). ESLint cấm `@/lib/prisma`/`PrismaClient` trong `src/app/**`,
  `src/components/**`, `realtime/**` (không phủ `src/jobs/**`, `worker/**`).
- **Hai bề mặt, một tầng nghiệp vụ**: web = Server Action (17 tệp `"use server"`) + cookie `session`
  (JWT HS256); mobile = `/api/v1/**` + `Authorization: Bearer`. TOÀN BỘ nghiệp vụ ChốtSân (đặt sân,
  `/manage/**`, `/account/bookings`, `/invoices`, `/venue-approvals`, thanh toán) hiện CHỈ có Server
  Action; `/api/v1` mới có nhóm của bộ khung (auth, 2FA, passkeys, sessions, OAuth, users, roles,
  permissions, notifications, devices, files, audit-logs, openapi.json). Web chỉ gọi REST ở nút OAuth và `/docs`.

---

## 3. Proxy — CSP và chặn trang (`src/proxy.ts`)

- **Matcher** `/((?!api/|docs|_next/static|_next/image|favicon.ico|.*\.[\w]+$).*)` — KHÔNG chạy cho `/api/**`
  (mobile cần 401 JSON, không phải 307), `/docs`, asset. Hệ quả: MỌI route handler tự kiểm quyền.
- **CSP có nonce** (`btoa(crypto.randomUUID())`, gắn vào REQUEST header để Next tự đọc khi SSR; chỉ hoạt
  động vì layout render động):
  `default-src 'self'`; `script-src 'self' 'nonce-…' 'strict-dynamic'` (+`'unsafe-eval'` ở dev);
  `style-src 'self' 'unsafe-inline'`; **`img-src 'self' data: blob:`** (ảnh host ngoài sẽ bị chặn);
  `font-src 'self' data:`; `connect-src 'self'` (+`ws: wss:` ở dev); `object-src 'none'`; `base-uri 'self'`;
  **`form-action 'self'`** (áp cả chuyển hướng sau khi gửi form — GOTCHAS #16); `frame-ancestors 'none'`;
  `upgrade-insecure-requests` ở prod.
- `verifySession(cookie "session")` chỉ kiểm chữ ký JWT, không tra DB (security stamp kiểm ở `getSession`).
- `PROTECTED_PREFIXES = ["/users", "/roles", "/sessions", "/security"]` (danh sách của bộ khung): chưa đăng
  nhập → 307 `/login?next=<pathname + query>`. `/account`, `/manage`, `/invoices`, `/venue-approvals` KHÔNG
  có ở đây — chúng tự chặn ở page/layout (`requireUser`/`requirePermission`/`requireVenueAccess`).
- Proxy KHÔNG còn đá người đã đăng nhập khỏi `/login`, `/register` (cookie đúng chữ ký của phiên đã thu hồi sẽ
  kẹt vòng lặp) — hai trang tự chuyển hướng bằng `getSession()` đầy đủ.
- Gắn (ghi đè) `x-pathname` — `requireUser()` không tham số quay về đúng trang kèm query — và `x-request-id`. Header tĩnh ở `next.config.mjs` (mọi đường dẫn): nosniff, `X-Frame-Options DENY`,
  `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy`, HSTS 2 năm. Caddy KHÔNG khai lại.

`next.config.mjs` đáng nhớ: `output: "standalone"` (trừ `VERCEL=1`), `poweredByHeader: false`,
**`allowedDevOrigins`** dải LAN (`192.168.*.*`, `10.*.*.*`, `172.16.*.*`, `*.local` — không có thì mở qua IP
LAN không chạy JS, GOTCHAS #15), `typedRoutes: true`, `outputFileTracingIncludes` kéo `@swc/helpers`.
Không có cấu hình `images` (ảnh nội bộ không cần).

---

## 4. Biến môi trường (`src/lib/env.ts`)

- Validate MỘT lần lúc nạp module bằng Zod; lỗi → `Error("Cấu hình môi trường không hợp lệ: …")`. Chuỗi
  rỗng = không khai. `SKIP_ENV_VALIDATION=1` (chỉ bước build Docker) trộn giá trị giả.
- **Cờ chỉ nhận `1`/`0`** (`featureFlag()` trong `src/lib/feature-flag.ts`): `QUEUE_ENABLED`,
  `REALTIME_ENABLED`, `PHONE_VERIFICATION_ENABLED`, `SMTP_SECURE`, `S3_FORCE_PATH_STYLE`,
  `SESSION_STRICT_REVOCATION`. Compose dùng chính `QUEUE_ENABLED`/`REALTIME_ENABLED` làm `replicas`.
- Worker (`worker/env.ts`) và realtime (`realtime/env.ts`) có schema bổ sung, NHƯNG vẫn nạp schema app vì
  `logger.ts`/`session.ts` import `./env` → cả hai cần `DATABASE_URL` + `SESSION_SECRET` (compose truyền tường
  minh). Realtime còn ĐỌC database thật: kiểm security stamp lúc bắt tay (kể cả khi phục hồi phiên), nên
  `DATABASE_URL` phải đúng, nên có `REDIS_URL` để dùng chung cache ảnh phiên.
- `.env.example` đã viết lại, mặc định khớp mã (có `APP_URL`, `TRUSTED_PROXY_HOPS`, `CRON_*`, `PM2_*`, `HOST`).

| Nhóm              | Biến (mặc định)                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bắt buộc          | `DATABASE_URL`, `SESSION_SECRET` (≥ 32 ký tự)                                                                                                                                                                                                                                                                          |
| URL               | `APP_URL`, `NEXT_PUBLIC_APP_URL` — email/OAuth/WebAuthn đều dùng `appBaseUrl()` = `APP_URL ?? NEXT_PUBLIC_APP_URL` (thiếu cả hai → `appUrl()` ném; KHÔNG có mặc định localhost). `DIRECT_DATABASE_URL` (CLI Prisma), `APP_NAME` ("ChốtSân" — issuer TOTP/tên passkey). Đã xoá `API_PUBLIC_URL`/`apiUrl`/`publicAppUrl` |
| Phiên/token       | `SESSION_MAX_AGE_DAYS` (7), `ACCESS_TOKEN_TTL_MINUTES` (15), `REFRESH_TOKEN_TTL_DAYS` (30), `EMAIL_VERIFICATION_TTL_HOURS` (24), `PASSWORD_RESET_TTL_MINUTES` (60), `SESSION_STRICT_REVOCATION` (1), `TWO_FACTOR_CHALLENGE_TTL_MINUTES` (5)                                                                            |
| 2FA/passkey       | `ENCRYPTION_KEY` (≥ 16; KHÔNG đổi khi đã có dữ liệu — mất mọi bí mật 2FA), `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS`                                                                                                                                                                                                        |
| SMS/OTP           | `PHONE_VERIFICATION_ENABLED` (0), `PHONE_OTP_TTL_MINUTES` (5), `PHONE_OTP_MAX_PER_DAY` (5), `PHONE_OTP_RESEND_COOLDOWN_SECONDS` (60), `VERIFICATION_MAX_ATTEMPTS` (5)                                                                                                                                                  |
| Chống dò mật khẩu | `LOGIN_MAX_FAILED_ATTEMPTS` (5), `LOGIN_LOCKOUT_MINUTES` (15)                                                                                                                                                                                                                                                          |
| Hạ tầng           | `REDIS_URL`, `QUEUE_ENABLED` (1), `REALTIME_ENABLED` (1), `TRUSTED_PROXY_HOPS` (1, 0–10)                                                                                                                                                                                                                               |
| Email             | `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (0), `SMTP_USER`, `SMTP_PASSWORD`                                                                                                                                                                                                                           |
| Kho tệp           | `S3_*` — validate nhưng KHÔNG mã nào đọc (chưa có bản S3)                                                                                                                                                                                                                                                              |
| OAuth             | `GOOGLE_`/`GITHUB_`/`FACEBOOK_CLIENT_ID                                                                                                                                                                                                                                                                                | SECRET`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY` |
| Seed              | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 8)                                                                                                                                                                                                                                                                                  |
| Dọn dữ liệu       | `AUDIT_RETENTION_DAYS` (365), `DEVICE_STALE_DAYS` (180)                                                                                                                                                                                                                                                                |
| Worker            | `WORKER_CONCURRENCY` (5), `WORKER_HEALTH_PORT` (3003), `HOST` (`127.0.0.1`)                                                                                                                                                                                                                                            |
| Lịch (web+worker) | `CRON_EXPIRE_HOLDS` (`* * * * *`), `CRON_PURGE_EXPIRED` (`0 3 * * *`), `CRON_INVOICE_MONTHLY` (`30 2 * * *`), `CRON_INVOICE_OVERDUE` (`0 4 * * *`) — khai ở `scheduleEnvSchema` (`src/jobs/schedules.ts`)                                                                                                              |
| Realtime          | `REALTIME_PORT` (3002), `HOST` (`127.0.0.1`), `REALTIME_CORS_ORIGIN` (`http://localhost:3000`)                                                                                                                                                                                                                         |
| PM2               | `PM2_INSTANCES` (1), `PM2_WORKER_INSTANCES` (1) — đọc trong `ecosystem.config.cjs`, không qua `env.ts`                                                                                                                                                                                                                 |

Thêm biến mới: khai trong `envSchema` (không đọc `process.env` rải rác), dòng có chú thích trong
`.env.example`, schema worker/realtime nếu cần, compose `environment` tường minh, `vitest.config.ts testEnv`
nếu bắt buộc.

```ts
MY_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(30),
MY_FEATURE_ENABLED: featureFlag(false),
MY_API_KEY: optionalString(z.string().min(1).optional()),
```

---

## 5. Các lớp hạ tầng — một interface hẹp + bản mặc định, cắm thật bằng `setX()`

| Lớp              | Tệp                              | Mặc định                                                                                                              | Production khi chưa cắm                                                                                                                                             |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logger           | `src/lib/logger.ts`              | JSON một dòng `{level,time,message,…}`; che khoá nhạy cảm (`password`, `token`, `secret`, `authorization`, `cookie`…) | —                                                                                                                                                                   |
| Giám sát lỗi     | `src/lib/observability.ts`       | no-op (`setErrorReporter`)                                                                                            | im lặng (lỗi đã có trong log). `logger.error()` tự gọi `captureException` — đừng rải `Sentry.captureException`. File này KHÔNG import `./env` (chạy cả trình duyệt) |
| Cache            | `src/lib/cache.ts`               | Redis (`cache:` + key, SCAN) hoặc RAM                                                                                 | lỗi = miss, không ném                                                                                                                                               |
| Rate limit       | `src/lib/rate-limit.ts`          | Redis (`rl:`, INCR + EXPIRE NX) hoặc RAM                                                                              | **fail-open** khi store lỗi; hàm async — luôn `await`                                                                                                               |
| Hàng đợi         | `src/lib/queue.ts`               | xem mục 6                                                                                                             | ném lỗi khi `QUEUE_ENABLED=1` mà thiếu `REDIS_URL`                                                                                                                  |
| Email            | `src/lib/mailer.ts`, `emails.ts` | có `SMTP_HOST` → nodemailer; không → ghi log (cả link)                                                                | ném lỗi                                                                                                                                                             |
| SMS              | `src/lib/smser.ts`, `sms.ts`     | ghi log mã                                                                                                            | ném lỗi (chưa nơi nào `setSmser`)                                                                                                                                   |
| Kho tệp          | `src/lib/storage.ts`             | ghi `public/uploads/<key>` (đã có trong `.gitignore`)                                                                 | ném `StorageNotConfiguredError` → `POST /api/v1/files` trả **503** (chưa có bản S3); `instrumentation.ts` cảnh báo lúc khởi động                                    |
| Nhật ký thao tác | `src/services/audit.service.ts`  | luôn ghi; `record()` nuốt lỗi; `AuditLog.actorId` không FK                                                            | —                                                                                                                                                                   |

Chưa nơi nào gọi `setMailer`/`setSmser`/`setStorage`/`setErrorReporter`. Khi cắm: đặt trong `register()` của
`src/instrumentation.ts` (TRƯỚC khối kiểm cấu hình production) VÀ trong `worker/main.ts`.

**Rate limit** (`RATE_LIMITS`, cửa sổ cố định): `login` 5/300s · `register` 5/3600s · `refresh` 30/300s ·
`passwordResetRequest` 3/900s · `emailVerificationRequest` 3/900s · `passwordChange` 10/900s ·
`twoFactor` 10/300s · `twoFactorAccount` 5/900s (theo tài khoản) · `passkey` 30/300s · `phoneOtp` 5/900s ·
`upload` 60/300s. Key IP = `<bucket>:<ip>` (`ipRateLimitKey`); luồng có cả web lẫn API dùng CHUNG tên xô trong
`RATE_LIMIT_BUCKETS` (`login`, `register`, `2fa`, `password-reset`…) → web và API **chung một xô**. REST
`enforceRateLimit(request, RATE_LIMIT_BUCKETS.x | "api:<chỉ-API>", RATE_LIMITS.x)`; `definePublicAction` key
`action:<key>:…`; theo SĐT `otp:cooldown:<số>`, `otp:daily:<số>`. **IP** (`clientIpFromHeaders`) = phần tử
`len − TRUSTED_PROXY_HOPS` của `X-Forwarded-For` (mặc định 1 = phần tử cuối do Caddy thêm); `0` hoặc không có
XFF → `x-real-ip` → `"unknown"` (mọi người chung xô). Caddy ghi đè XFF nên chuỗi chỉ một phần tử; thêm tầng phía trước có NỐI IP thì tăng số. 429 kèm `Retry-After`.

**Mật mã**: mật khẩu Argon2id (`@node-rs/argon2`, m=19456, t=2, p=1; `needsRehash`; `fakeCompare` chống
dò email; KHÔNG còn đường lui bcrypt). Token mờ 32 byte base64url, lưu SHA-256; OTP/mã khôi phục băm bằng
`hashScopedToken(scope, token)`. `encryptSecret` AES-256-GCM (`v1.<iv>.<tag>.<ct>`) cho bí mật TOTP.

**Upload** (`POST /api/v1/files`, quyền `file:upload`): `assertUploadAllowed` đọc magic bytes (ảnh "không
chứng minh được là ảnh" = từ chối), `IMAGE_UPLOAD` 5MB jpeg/png/webp/gif, khoá lưu không dùng tên file gốc.

---

## 6. Hàng đợi, worker, lịch job

`enqueue(name, payload, { jobId?, delay? })` (`src/lib/queue.ts`):

1. `QUEUE_ENABLED=0` → chạy `jobHandlers[name](payload)` NGAY trong request (kể cả production, không cảnh
   báo; lỗi bung ra).
2. Cờ bật, thiếu `REDIS_URL` → production NÉM LỖI ("thiếu là quên, tắt là chọn"); dev/test cảnh báo rồi chạy thẳng.
3. Có Redis → `Queue("app").add(...)`, `attempts: 3`, backoff mũ 1s.

Nơi đẩy job: `emails.ts` (`email:send`), `sms.ts` (`sms:send`), `notification.service.ts` (`push:send` — FCM
chưa cắm, chỉ log rồi đánh dấu `isPushed`).

Danh mục job (`src/jobs/types.ts`) — handler DUY NHẤT ở `src/jobs/handlers.ts` (worker và `enqueue` chạy
thẳng dùng chung): `email:send`, `sms:send`, `push:send`, `maintenance:purge-expired`,
`booking:expire-holds`, `payment:expire-pending`, `invoice:generate-monthly`, `invoice:mark-overdue`.

**Lịch job định nghĩa MỘT nơi: `src/jobs/schedules.ts`** (`scheduleEnvSchema` + `buildSchedules(env)`), cron
diễn giải theo `SCHEDULE_TIMEZONE = "Asia/Ho_Chi_Minh"` (máy chủ chạy UTC). Biểu thức sai hoặc không bao giờ tới
(`0 0 31 2 *`) → tiến trình dừng lúc khởi động kèm tên biến.

| id                          | job                         | `CRON_*` (mặc định)                   | thử lại               |
| --------------------------- | --------------------------- | ------------------------------------- | --------------------- |
| `booking-expire-holds`      | `booking:expire-holds`      | `CRON_EXPIRE_HOLDS` (`* * * * *`)     | 1 lần                 |
| `payment-expire-pending`    | `payment:expire-pending`    | `CRON_EXPIRE_HOLDS` (`* * * * *`)     | 1 lần                 |
| `maintenance-purge-expired` | `maintenance:purge-expired` | `CRON_PURGE_EXPIRED` (`0 3 * * *`)    | 1 lần                 |
| `invoice-generate-monthly`  | `invoice:generate-monthly`  | `CRON_INVOICE_MONTHLY` (`30 2 * * *`) | 3 lần, backoff mũ 60s |
| `invoice-mark-overdue`      | `invoice:mark-overdue`      | `CRON_INVOICE_OVERDUE` (`0 4 * * *`)  | 3 lần, backoff mũ 60s |

Hoá đơn tháng chạy **mỗi ngày 02:30** (không chỉ mùng 1): handler tự bù mọi tháng đã kết thúc còn thiếu trong 3
tháng gần nhất, bỏ qua kỳ đã xuất. ĐỔI `id` là đẻ lịch thứ hai trong Redis (lịch cũ chạy tới khi xoá tay).

**Ai chạy lịch** — `schedulingMode()`, hiện ở `/api/health` → `features.schedules`:

- `worker` — `QUEUE_ENABLED=1` + `REDIS_URL`: `worker/worker.ts` `registerSchedules` →
  `queue.upsertJobScheduler(id, { pattern, tz }, …)`; Redis chốt mỗi mốc một job.
- `in-process` — `QUEUE_ENABLED=0`: web tự chạy lịch qua `register()` của `src/instrumentation.ts`
  (`startInProcessScheduler`, timer chia quãng ≤ 60s vì `setTimeout` > 24,8 ngày bị Node rút còn 1ms; không chạy
  chồng lượt trong một tiến trình; không chống trùng giữa nhiều instance → mọi handler PHẢI idempotent; không
  chạy bù mốc lỡ). Worker tự thoát (mã 0) khi cờ tắt.
- `off` — bật cờ mà thiếu `REDIS_URL`: KHÔNG ai chạy lịch. Production → `logger.error` lúc khởi động (và
  `enqueue()` ném). **Dev → cố ý off** (chỉ log info): lịch mỗi phút làm Neon không bao giờ ngủ, đốt hết giờ
  compute. Cần thử lịch ở dev: `pnpm worker:dev` có Redis, hoặc `QUEUE_ENABLED=0`.

Worker `/health` (`HOST`:`WORKER_HEALTH_PORT`) đếm job với trần `HEALTH_TIMEOUT_MS = 2000` → mất Redis thì trả
**503 sau 2s** (trước đây treo vô hạn).

Job mới: thêm payload vào `JobPayloads`, handler idempotent GỌI SERVICE (không viết Prisma trong handler),
payload JSON nhỏ (truyền id), không log dữ liệu nhạy cảm, không log "0 bản ghi" mỗi phút; job theo lịch
(payload rỗng) thêm `CRON_*` vào `scheduleEnvSchema` + mục trong `buildSchedules` + dòng trong `.env.example`
(cả worker lẫn web tự nhận). Tắt worker phải đợi job đang chạy (`stop_grace_period`/`kill_timeout`/
`TimeoutStopSec` 60s).

**Realtime** (`realtime/server.ts`): middleware bắt tay kiểm JWT + security stamp (`securityStampService`, cache
60s) — `connectionStateRecovery.skipMiddlewares: false` để phục hồi phiên vẫn đi qua middleware. `ping:user`
validate payload (payload `null`/rác từng làm sập tiến trình) và giới hạn `PING_USER_RATE_LIMIT` 10 tin/10s mỗi
socket; `ack` chỉ gọi khi là hàm. Giới hạn: chỉ kiểm LÚC NỐI — socket mở trước khi bị thu hồi sống tới khi rớt.

---

## 7. REST API v1 (mobile)

- Envelope: thành công `{ "data": … }` (`apiOk(data, status)`); lỗi `{ "error": { code, message, fields? } }`.
  Client rẽ nhánh theo `code`, không theo `message`. Lỗi lạ → `INTERNAL_ERROR` 500, nội dung chỉ vào log.
- `handleApiError(error, { route, request })`: `ApiError` → status của nó; `DomainError` → `DOMAIN_STATUS`
  (422/401/403/404/409/423/429/502); gắn `x-request-id` cho response lỗi.
- Xác thực (`src/lib/api/auth.ts`): `getApiSession` (Bearer trước, cookie sau), `requireApiUser` (401),
  `requireApiPermission(request, permission)` (tra DB có cache, **403**), `requireVenuePermission(request,
venueId, permission)` (**404**). `requireApiAdmin` đã xoá (mã chết).
- `CURRENT_API_VERSION = "v1"`, `apiPath("/x")`. Phá tương thích → THÊM `api/v2/`, giữ v1.
- **OpenAPI** (`src/lib/openapi/registry.ts`, Zod 4 `z.toJSONSchema`, KHÔNG `zod-to-openapi`): `named(id,
schema, io)`, `envelope(name, dataSchema)`, `errorResponses(...)`, `paths` viết tay. `/api/v1/openapi.json`
  - `/docs` (Scalar), title "ChốtSân API". `registry.test.ts` so khớp HAI CHIỀU path+method với `route.ts` trên
    đĩa (chỉ nhận `export async function GET|POST…`), kiểm `$ref`, envelope, và riêng notifications/devices/files
    khớp response thật: Notification có `recipientId` (id truyền vào `/notifications/{id}/read` là `recipientId`,
    `/read` idempotent), devices không còn khai `EmptyResponse` (DELETE có body `fcmToken`), `POST /files` khai
    503 khi chưa cắm storage, 429 khai header `Retry-After`. Các nhóm khác vẫn KHÔNG kiểm hình dạng response.

```ts
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await requireApiPermission(request, "thing:create");
    await enforceRateLimit(request, "api:thing-create", RATE_LIMITS.upload);
    const body = await parseJsonBody(request, createThingSchema);
    return apiOk({ thing: await thingService.create(session.sub, body) }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/things", request });
  }
}
```

Route thuộc sân dùng `requireVenuePermission`; ràng buộc sở hữu nằm trong `where`, trả 404 cho cả "không
tồn tại" lẫn "của người khác".

---

## 8. Build và deploy

- `pnpm build` → `next build` (standalone) → `postbuild` `scripts/prepare-standalone.mjs` chép `public/` +
  `.next/static/` vào standalone. `pnpm start` = `node --env-file-if-exists=.env .next/standalone/server.js`.
- Worker/realtime: `esbuild --bundle --platform=node --format=cjs --packages=external
--alias:server-only=./test/stubs/server-only.ts --metafile=…/dist/meta.json` → `worker/dist/worker.cjs`,
  `realtime/dist/server.cjs` (package npm vẫn `require` ngoài; systemd/PM2 lấy từ `node_modules` của thư mục dự án).
- **Docker** (9 stage: base, deps, builder, migrator, realtime-deps, worker-deps, realtime, worker, runner).
  Image realtime/worker có `node_modules` TỐI THIỂU: `deploy/runtime-package.mjs manifest` đọc metafile esbuild
  → `package.json` với đúng các gói bundle `require` (phiên bản chính xác đang cài, kèm gói nạp lười như `ioredis`,
  chép Prisma Client đã generate); stage `*-deps` `pnpm install --prod` rồi `finalize` (từ chối phiên bản không
  có trong `pnpm-lock.yaml` gốc, `require` thử từng gói — thiếu là BUILD đỏ). Compose: postgres 16 → migrate → web; redis 7; realtime
  (`replicas = REALTIME_ENABLED`, `HOST=0.0.0.0`); worker (`replicas = QUEUE_ENABLED`); tools (profile).
  **Cổng bind `127.0.0.1:`** (ufw không chặn được cổng Docker). Compose ép `DATABASE_URL` về Postgres nội bộ
  và truyền `SESSION_SECRET` tường minh cho cả ba.
- **systemd**: `deploy/chotsan.service`, `chotsan-realtime.service`, `chotsan-worker.service`,
  `chotsan-purge.{service,timer}` (purge là lưới dự phòng — lịch đã dọn mỗi ngày); user `deploy`, mã ở
  `/var/www/chotsan`, env ở `/etc/chotsan/env`. `scripts/deploy-vps.sh`: nạp env → `git pull --ff-only` →
  `pnpm install --frozen-lockfile` → `pnpm db:deploy` → build web/realtime/worker → restart. Tiến trình phụ:
  cờ `=0` → `disable --now`; chưa cài → cảnh báo; bị disable tay khi cờ bật → KHÔNG tự bật lại, chỉ cảnh báo.
  Còn unit tên cũ `nextjs-base*` → cảnh báo (không tự gỡ — có thể của dự án khác).
- **PM2**: `ecosystem.config.cjs` — app `chotsan` (web, `PM2_INSTANCES`, nhiều instance BẮT BUỘC `REDIS_URL`),
  `chotsan-realtime` (1), `chotsan-worker` (`PM2_WORKER_INSTANCES`, `kill_timeout` 60s); `scripts/deploy-pm2.sh`.
- **Caddy** (`deploy/Caddyfile`): HTTPS, ghi đè `X-Forwarded-For`, `/socket.io/*` → 3002.
- Tắt tiến trình phụ ở TẦNG DEPLOY (compose replicas 0, PM2 lọc + `pm2 delete`, systemd `disable --now`),
  không chỉ đổi biến. Migration chỉ tiến; dump DB trước migration phá dữ liệu. Chưa có backup tự động.
- Kiểm sau deploy: `curl /api/health` (`status ok`, `database up`, `features.queue` = `redis`;
  `inline` = cờ bật mà thiếu Redis — gần như luôn là nhầm; `off` = tắt có chủ đích; `features.schedules` phải
  là `worker` hoặc `in-process`, `off` trên production = không ai chạy lịch), `127.0.0.1:3002/health`,
  `127.0.0.1:3003/health` (gọi TRÊN máy chủ / trong container — nghe loopback), `/api/v1/users` phải 401 JSON.

---

## 9. Nghi lỗi hạ tầng ĐÃ BIẾT (chưa sửa)

1. **[TB] Upload production luôn 503** — chưa có adapter S3 nào gọi `setStorage` (các biến `S3_*` validate
   nhưng không mã nào đọc). SMS production luôn ném nếu bật `PHONE_VERIFICATION_ENABLED` (chưa nơi nào
   `setSmser`); `instrumentation.ts` chỉ báo lỗi lúc khởi động.
2. **[TB] Bộ chạy lịch `in-process` không chống trùng giữa nhiều instance** (`QUEUE_ENABLED=0` + PM2 cluster =
   N lượt mỗi mốc) và không chạy bù mốc đã lỡ khi tiến trình tắt — chấp nhận được chỉ vì mọi handler idempotent.
3. **[Thấp] Chưa có backup database tự động**; `docker-compose.yml` vẫn Postgres 16 trong khi Neon/CI là 17.
