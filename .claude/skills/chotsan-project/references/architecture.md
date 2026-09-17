# Kiến trúc và hạ tầng

## 1. Các tiến trình

```
Caddy (80/443, HTTPS tự động, GHI ĐÈ X-Forwarded-For)
  ├─ /socket.io/*  → realtime  (Socket.IO, :3002, /health)
  └─ còn lại       → web       (Next standalone, :3000, /api/health)
worker   (BullMQ, lấy job từ Redis hàng đợi "app", health :3003)
Postgres (dev: Neon; Docker: postgres 16)   Redis (tuỳ chọn ở dev)
migrate  (chạy một lần trước web)          tools/purge (theo lệnh/lịch)
```

- Web KHÔNG gọi realtime (không có `socket.io-client` trong `src`). Realtime hiện chỉ là khung (sự kiện mẫu
  `ping:user`), ứng dụng chưa kết nối.
- Web ↔ worker nói chuyện qua hàng đợi Redis. Job theo lịch CHỈ worker đăng ký (xem mục 6).
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
- `verifySession(cookie "session")` chỉ kiểm chữ ký JWT, không tra DB.
- `PROTECTED_PREFIXES = ["/users", "/roles", "/sessions", "/security"]` (danh sách của bộ khung): chưa đăng
  nhập → 307 `/login?next=<pathname>`. `/account`, `/manage`, `/invoices`, `/venue-approvals` KHÔNG có ở
  đây — chúng tự chặn ở page/layout (`requireUser`/`requirePermission`/`requireVenueAccess`).
- `GUEST_ONLY_PATHS = ["/login", "/register"]`: đã đăng nhập → `/` (không gọi `landingPathFor`).
- Gắn `x-request-id`. Header tĩnh ở `next.config.mjs` (mọi đường dẫn): nosniff, `X-Frame-Options DENY`,
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
  `logger.ts`/`session.ts` import `./env` → realtime cần cả `DATABASE_URL`, worker cần `SESSION_SECRET`.

| Nhóm              | Biến (mặc định)                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bắt buộc          | `DATABASE_URL`, `SESSION_SECRET` (≥ 32 ký tự)                                                                                                                                                                                                                      |
| URL               | `APP_URL` (link email + WebAuthn qua `appUrl()` — KHÔNG có mặc định localhost), `NEXT_PUBLIC_APP_URL` (OAuth dùng `publicAppUrl`), `API_PUBLIC_URL`, `DIRECT_DATABASE_URL` (CLI Prisma), `APP_NAME` ("Base Template" — issuer TOTP/tên passkey, nên đặt "ChốtSân") |
| Phiên/token       | `SESSION_MAX_AGE_DAYS` (7), `ACCESS_TOKEN_TTL_MINUTES` (15), `REFRESH_TOKEN_TTL_DAYS` (30), `EMAIL_VERIFICATION_TTL_HOURS` (24), `PASSWORD_RESET_TTL_MINUTES` (60), `SESSION_STRICT_REVOCATION` (1), `TWO_FACTOR_CHALLENGE_TTL_MINUTES` (5)                        |
| 2FA/passkey       | `ENCRYPTION_KEY` (≥ 16; KHÔNG đổi khi đã có dữ liệu — mất mọi bí mật 2FA), `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGINS`                                                                                                                                                    |
| SMS/OTP           | `PHONE_VERIFICATION_ENABLED` (0), `PHONE_OTP_TTL_MINUTES` (5), `PHONE_OTP_MAX_PER_DAY` (5), `PHONE_OTP_RESEND_COOLDOWN_SECONDS` (60), `VERIFICATION_MAX_ATTEMPTS` (5)                                                                                              |
| Chống dò mật khẩu | `LOGIN_MAX_FAILED_ATTEMPTS` (5), `LOGIN_LOCKOUT_MINUTES` (15)                                                                                                                                                                                                      |
| Hạ tầng           | `REDIS_URL`, `QUEUE_ENABLED` (1), `REALTIME_ENABLED` (1)                                                                                                                                                                                                           |
| Email             | `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (0), `SMTP_USER`, `SMTP_PASSWORD`                                                                                                                                                                       |
| Kho tệp           | `S3_*` — validate nhưng KHÔNG mã nào đọc (chưa có bản S3)                                                                                                                                                                                                          |
| OAuth             | `GOOGLE_`/`GITHUB_`/`FACEBOOK_CLIENT_ID                                                                                                                                                                                                                            | SECRET`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY` |
| Seed              | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥ 8)                                                                                                                                                                                                                              |
| Dọn dữ liệu       | `AUDIT_RETENTION_DAYS` (365), `DEVICE_STALE_DAYS` (180)                                                                                                                                                                                                            |
| Worker            | `WORKER_CONCURRENCY` (5), `WORKER_HEALTH_PORT` (3003), `CRON_EXPIRE_HOLDS` (`* * * * *`), `CRON_PURGE_EXPIRED` (`0 3 * * *`), `CRON_INVOICE_MONTHLY` (`0 2 1 * *`), `CRON_INVOICE_OVERDUE` (`0 4 * * *`)                                                           |
| Realtime          | `REALTIME_PORT` (3002), `REALTIME_CORS_ORIGIN` (`http://localhost:3000`)                                                                                                                                                                                           |

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
| Kho tệp          | `src/lib/storage.ts`             | ghi `public/uploads/<key>`                                                                                            | ném lỗi (chưa có bản S3 → upload production luôn 500)                                                                                                               |
| Nhật ký thao tác | `src/services/audit.service.ts`  | luôn ghi; `record()` nuốt lỗi; `AuditLog.actorId` không FK                                                            | —                                                                                                                                                                   |

Chưa có điểm khởi động chung gọi `setMailer`/`setSmser`/`setStorage`/`setErrorReporter` — khi cắm phải
gọi ở nơi chạy trong CẢ web lẫn worker.

**Rate limit** (`RATE_LIMITS`, cửa sổ cố định): `login` 5/300s · `register` 5/3600s · `refresh` 30/300s ·
`passwordResetRequest` 3/900s · `emailVerificationRequest` 3/900s · `passwordChange` 10/900s ·
`twoFactor` 10/300s · `passkey` 30/300s · `phoneOtp` 5/900s · `upload` 60/300s. Web key `login:<ip>`…;
REST `enforceRateLimit(request, "api:<scope>", RATE_LIMITS.x)` key `api:<scope>:<ip>` (IP = phần tử ĐẦU
`X-Forwarded-For` → chỉ an toàn khi proxy ghi đè); `definePublicAction` key `action:<key>:…`; theo SĐT
`otp:cooldown:<số>`, `otp:daily:<số>`. Web và API đếm riêng.

**Mật mã**: mật khẩu Argon2id (`@node-rs/argon2`, m=19456, t=2, p=1; `needsRehash`; `fakeCompare` chống
dò email; KHÔNG còn đường lui bcrypt). Token mờ 32 byte base64url, lưu SHA-256; OTP/mã khôi phục băm bằng
`hashScopedToken(scope, token)`. `encryptSecret` AES-256-GCM (`v1.<iv>.<tag>.<ct>`) cho bí mật TOTP.

**Upload** (`POST /api/v1/files`, quyền `file:upload`): `assertUploadAllowed` đọc magic bytes (ảnh "không
chứng minh được là ảnh" = từ chối), `IMAGE_UPLOAD` 5MB jpeg/png/webp/gif, khoá lưu không dùng tên file gốc.

---

## 6. Hàng đợi, worker, cron

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

Lịch (`worker/worker.ts`, `queue.upsertJobScheduler(id, { pattern }, { attempts: 1 })`, giờ máy chủ):
`booking-expire-holds` + `payment-expire-pending` theo `CRON_EXPIRE_HOLDS`; `maintenance-purge-expired`
theo `CRON_PURGE_EXPIRED`; `invoice-generate-monthly`; `invoice-mark-overdue`.

⚠️ **Job theo lịch CHỈ chạy khi worker chạy.** `QUEUE_ENABLED=0` → worker tự thoát → không nhả giao dịch
PENDING quá hạn, không xuất/đánh dấu hoá đơn (lịch trống vẫn đúng nhờ `occupyingBookingWhere`). Máy dev
không Redis cũng không có lịch nào chạy (worker từ chối khởi động khi thiếu `REDIS_URL`). Tài liệu nói
"tắt hàng đợi không mất tính năng nào" là SAI với job theo lịch.

Job mới: thêm payload vào `JobPayloads`, handler idempotent GỌI SERVICE (không viết Prisma trong handler),
payload JSON nhỏ (truyền id), không log dữ liệu nhạy cảm, không log "0 bản ghi" mỗi phút; job theo lịch
thêm `CRON_*` vào `worker/env.ts` + mục trong `registerSchedules` + tên trong `handlers.test.ts`. Tắt worker
phải đợi job đang chạy (`stop_grace_period`/`kill_timeout`/`TimeoutStopSec` 60s).

---

## 7. REST API v1 (mobile)

- Envelope: thành công `{ "data": … }` (`apiOk(data, status)`); lỗi `{ "error": { code, message, fields? } }`.
  Client rẽ nhánh theo `code`, không theo `message`. Lỗi lạ → `INTERNAL_ERROR` 500, nội dung chỉ vào log.
- `handleApiError(error, { route, request })`: `ApiError` → status của nó; `DomainError` → `DOMAIN_STATUS`
  (422/401/403/404/409/423/429/502); gắn `x-request-id` cho response lỗi.
- Xác thực (`src/lib/api/auth.ts`): `getApiSession` (Bearer trước, cookie sau), `requireApiUser` (401),
  `requireApiPermission(request, permission)` (tra DB có cache, **403**), `requireVenuePermission(request,
venueId, permission)` (**404**), `requireApiAdmin` (chưa ai dùng).
- `CURRENT_API_VERSION = "v1"`, `apiPath("/x")`. Phá tương thích → THÊM `api/v2/`, giữ v1.
- **OpenAPI** (`src/lib/openapi/registry.ts`, Zod 4 `z.toJSONSchema`, KHÔNG `zod-to-openapi`): `named(id,
schema, io)`, `envelope(name, dataSchema)`, `errorResponses(...)`, `paths` viết tay. `/api/v1/openapi.json`
  - `/docs` (Scalar). `registry.test.ts` so khớp HAI CHIỀU path+method với `route.ts` trên đĩa (chỉ nhận
    `export async function GET|POST…`) — KHÔNG kiểm hình dạng response (notifications/devices đang khai sai).

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
--alias:server-only=./test/stubs/server-only.ts` → `worker/dist/worker.cjs`, `realtime/dist/server.cjs`
  (package npm vẫn `require` ngoài).
- **Docker** (7 stage: base, deps, builder, migrator, realtime, worker, runner). Compose: postgres 16 →
  migrate → web; redis 7; realtime (`replicas = REALTIME_ENABLED`); worker (`replicas = QUEUE_ENABLED`);
  tools (profile). **Cổng bind `127.0.0.1:`** (ufw không chặn được cổng Docker). Compose ép `DATABASE_URL`
  về Postgres nội bộ.
- **systemd**: `deploy/nextjs-base{,-realtime,-worker}.service` + `nextjs-base-purge.{service,timer}`, env ở
  `/etc/nextjs-base/env`; `scripts/deploy-vps.sh`.
- **PM2**: `ecosystem.config.cjs` (web cluster `PM2_INSTANCES` — nhiều instance BẮT BUỘC `REDIS_URL`,
  realtime 1, worker `PM2_WORKER_INSTANCES`); `scripts/deploy-pm2.sh`.
- **Caddy** (`deploy/Caddyfile`): HTTPS, ghi đè `X-Forwarded-For`, `/socket.io/*` → 3002.
- Tắt tiến trình phụ ở TẦNG DEPLOY (compose replicas 0, PM2 lọc + `pm2 delete`, systemd `disable --now`),
  không chỉ đổi biến. Migration chỉ tiến; dump DB trước migration phá dữ liệu. Chưa có backup tự động.
- Tên `nextjs-base` còn khắp `deploy/`, script, Makefile, `docs/DEPLOY_VPS.md` (di sản bộ khung).
- Kiểm sau deploy: `curl /api/health` (`status ok`, `database up`, `features.queue` = `redis`;
  `inline` = cờ bật mà thiếu Redis — gần như luôn là nhầm; `off` = tắt có chủ đích), `:3002/health`,
  `:3003/health`, `/api/v1/users` phải 401 JSON.

---

## 9. Nghi lỗi hạ tầng ĐÃ BIẾT (chưa sửa)

1. **[Cao] Image Docker `realtime`/`worker` có thể chết ngay**: bundle còn `require("socket.io"|"bullmq"|"@prisma/client"…)`
   nhưng stage chỉ chép `dist/`, không có `node_modules`; CI chỉ build target `runner`. PM2/systemd không bị.
2. **[Cao] Tắt hàng đợi/không chạy worker = mất mọi job theo lịch** (mục 6).
3. **[Cao] `APP_URL` và `NEXT_PUBLIC_APP_URL` lẫn nhau**: email dựng link bằng `appUrl()` (đòi `APP_URL`), còn
   `.env.example`, `DEPLOY_VPS.md`, CI chỉ nói `NEXT_PUBLIC_APP_URL`; OAuth thì báo `NEXT_PUBLIC_APP_URL` bắt buộc.
4. **[Cao với mobile] OpenAPI lệch response thật** của notifications (`id` là id thông báo, không phải id
   người nhận → client theo đặc tả gọi `/notifications/{id}/read` bị 404) và devices (khai `EmptyResponse`).
5. **[TB] Upload production luôn 500** (không có bản S3); SMS production luôn ném nếu bật OTP.
6. **[TB] Realtime/worker cần cả schema env của app** mà compose không truyền tường minh.
7. **[TB] CI e2e chạy production không Redis/APP_URL/SMTP** → luồng gửi mail ném (đăng ký sống nhờ bắt lỗi).
8. **[TB] `deploy-vps.sh` bật lại unit đã `disable`**; mặc định `SESSION_STRICT_REVOCATION`/`AUDIT_RETENTION_DAYS`/
   `DEVICE_STALE_DAYS` lệch giữa `env.ts` và `.env.example`.
9. **[TB] IP rate limit tin phần tử đầu `X-Forwarded-For`** — không proxy ghi đè thì giả được; web/API đếm riêng.
10. **[Thấp]** worker health/realtime nghe `0.0.0.0`; `POST /notifications/{id}/read` không idempotent (404
    lần hai); 429 không kèm `Retry-After`; `formatDate/formatDateTime` không đặt `timeZone` (`/security`,
    `/sessions` hiện theo giờ máy chủ); `ping:user` không validate/giới hạn; `.env.example` thiếu `APP_URL`,
    `CRON_*`, `PM2_*`; `public/uploads` chưa có trong `.gitignore`; chú thích tham chiếu `src/middleware.ts`,
    `apps/api`, `packages/core`, "Base Template", "nextjs_prisma_base API" (di sản).
