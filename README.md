# ChốtSân — Next.js 16 + Prisma

**ChốtSân** là nền tảng đặt sân thể thao, dựng trên bộ khung `nextjs_base`. README
này mô tả **phần khung** (bảo mật, phân quyền, token, deploy, realtime, REST
API); nghiệp vụ đặt sân, vai trò theo sân và giao diện xem `CLAUDE.md` và
`.claude/skills/chotsan-project/`.

Bộ khung: Next.js 16 (App Router) + Prisma + PostgreSQL cho ứng dụng web có đăng
nhập, đã siết bảo mật và có sẵn đường mở REST API cho mobile.

**Ngăn xếp:** Next.js 16 · React 19 · TypeScript (strict) · Prisma 7 · Zod 4 ·
jose (JWT session) · Tailwind CSS 4 · Vitest 4 · pnpm 10 · Node 24 · Docker

---

## Khởi chạy lần đầu

Yêu cầu **Node 24** (`engines: 24.x`) và **pnpm** (corepack tự chọn đúng bản).

```bash
pnpm install                       # cài dependencies (corepack tự dùng đúng pnpm)
cp .env.example .env               # rồi mở .env điền giá trị

# Sinh khoá ký session và dán vào SESSION_SECRET
openssl rand -base64 48

docker compose up -d postgres      # hoặc trỏ DATABASE_URL tới Postgres sẵn có
pnpm db:deploy                     # áp migration đã commit (KHÔNG dùng `migrate dev`)
pnpm db:seed                       # nạp dữ liệu mẫu
pnpm dev                           # http://localhost:3000
```

`make setup` làm đúng chuỗi trên (trừ `pnpm dev`).

Tài khoản sau khi `db:seed`:

| Email                | Quyền                            | Mật khẩu                      |
| -------------------- | -------------------------------- | ----------------------------- |
| `ADMIN_EMAIL` (env)  | SUPER_ADMIN                      | `ADMIN_PASSWORD` trong `.env` |
| `admin@dev.local`    | ADMIN                            | `matkhau123`                  |
| `chusan@dev.local`   | USER — chủ (OWNER) các sân mẫu   | `matkhau123`                  |
| `nhanvien@dev.local` | USER — nhân viên (STAFF) sân mẫu | `matkhau123`                  |
| `user@dev.local`     | USER                             | `matkhau123`                  |

Bốn tài khoản `@dev.local` và sân mẫu **chỉ tạo ngoài production**
(`pnpm db:seed:prod` chỉ đồng bộ quyền/vai trò, danh mục môn và tài khoản
`ADMIN_EMAIL`). Không đặt `ADMIN_EMAIL`/`ADMIN_PASSWORD` thì seed bỏ qua bước
tạo SUPER_ADMIN và nói rõ ra.

---

## Cấu trúc

```
sports_booking_v2/
├── prisma.config.ts           # Cấu hình Prisma CLI (Prisma 7 bỏ `url` khỏi schema)
├── prisma/
│   ├── schema.prisma          # Schema database
│   ├── migrations/            # Migration đã commit, kèm ràng buộc viết tay — bắt buộc để deploy
│   ├── seed.ts                # Điểm vào `pnpm db:seed`
│   └── seeds/                 # rbac, sports, admin (mọi môi trường) · dev, venues, venue-images (chỉ dev)
├── src/
│   ├── proxy.ts               # CSP + gắn x-pathname + chặn trang chưa đăng nhập (Next 16 gọi là Proxy)
│   ├── instrumentation.ts     # Khởi động lịch job trong tiến trình web khi QUEUE_ENABLED=0
│   ├── app/
│   │   ├── page.tsx           # Trang chủ
│   │   ├── (public)/          # venues/, bookings/[code] — tìm sân, xem sân, đặt sân
│   │   ├── (account)/         # account/bookings — lượt đặt của người chơi
│   │   ├── (manage)/          # manage/, manage/new, manage/[venueId]/** — khu chủ sân/nhân viên
│   │   ├── (admin)/           # users/, roles/, venue-approvals/, invoices/ — khu quản trị nền tảng
│   │   ├── (auth)/            # login/register/forgot-password/reset-password/verify-email/confirm-email-change
│   │   ├── security/          # 2FA, passkey, đổi mật khẩu/email
│   │   ├── sessions/          # thiết bị đang đăng nhập
│   │   ├── docs/              # Giao diện tài liệu API (đọc /api/v1/openapi.json)
│   │   ├── api/
│   │   │   ├── health/        # Health check — KHÔNG versioned, đọc bởi Docker/deploy script
│   │   │   ├── dev/           # quick-login — chỉ dev, production trả 404
│   │   │   └── v1/            # REST API cho mobile, có version — xem mục riêng bên dưới
│   │   │       ├── auth/      # register, login, refresh, logout, me, 2fa, passkeys, oauth/*…
│   │   │       ├── users/     # CRUD qua JSON, kể cả status/unlock/roles/permissions
│   │   │       ├── roles/     # Quản trị vai trò và bảng phân quyền
│   │   │       └── openapi.json/  # Đặc tả OpenAPI sinh từ Zod schema
│   │   ├── error.tsx          # Error boundary
│   │   ├── global-error.tsx   # Bắt lỗi xảy ra ngay trong root layout
│   │   ├── not-found.tsx
│   │   └── icon.svg, apple-icon.png, manifest.ts
│   ├── components/            # layout/, ui/ (Button, Input, Notice, ConfirmButton), booking/, manage/, admin/, venue/, account/
│   ├── jobs/                  # handlers.ts + schedules.ts — MỘT danh sách lịch cho worker lẫn web
│   ├── lib/
│   │   ├── env.ts             # Validate biến môi trường bằng Zod lúc khởi động; `appBaseUrl()`
│   │   ├── session.ts         # Ký/verify JWT — không dính cookie, dùng chung web+mobile
│   │   ├── auth.ts            # Bản cho web: đọc cookie, requireUser/requirePermission/requireVenueAccess
│   │   ├── define-action.ts   # defineAction/defineAuthedAction/definePublicAction/defineVenueAction
│   │   ├── api/               # Bản cho REST API: Bearer token, envelope JSON, map lỗi
│   │   ├── oauth/             # OAuth 2.0 + PKCE tự viết (Google/Github/Facebook/Apple)
│   │   ├── openapi/           # Đăng ký Zod schema → tài liệu OpenAPI (/api/v1/openapi.json)
│   │   ├── prisma.ts          # Prisma Client singleton (an toàn với HMR)
│   │   ├── crypto.ts          # Argon2id + so sánh giả chống dò qua thời gian
│   │   ├── rate-limit.ts      # Giới hạn tần suất theo IP (Redis hoặc RAM)
│   │   └── logger.ts          # Log JSON một dòng, tự che trường nhạy cảm
│   ├── schemas/               # Zod schema (nguồn sự thật cho validation)
│   └── services/              # Tầng nghiệp vụ — nơi duy nhất gọi Prisma
├── realtime/                  # Máy chủ WebSocket — TIẾN TRÌNH RIÊNG, ngoài Next
├── worker/                    # Job nền (BullMQ) — TIẾN TRÌNH RIÊNG thứ ba
├── e2e/                       # Playwright — helpers.ts + đăng nhập, đặt sân, chủ sân, phân quyền
├── scripts/                   # deploy-{docker,vps,pm2}.sh, purge-expired.ts, check-db-constraints.ts
├── deploy/                    # systemd unit chotsan*, timer dọn dữ liệu, Caddyfile, runtime-package.mjs
├── ecosystem.config.cjs       # PM2: web + realtime + worker
├── Dockerfile                 # 9 stage: base / deps / builder / migrator / realtime-deps / worker-deps / realtime / worker / runner
└── docker-compose.yml         # postgres + migrate (chạy 1 lần) + web + redis + realtime + worker (+ tools theo profile)
```

---

## Mô hình bảo mật

Đọc phần này trước khi thêm tính năng — nó giải thích vì sao code được viết như vậy.

### Server Action là endpoint công khai

Đây là điểm dễ sai nhất của App Router. Mỗi Server Action là một HTTP endpoint
mà bất kỳ ai cũng POST tới được, **kể cả khi trang chứa nó nằm sau Proxy**.
Proxy chỉ chặn được người chưa đăng nhập; một tài khoản USER hợp lệ vẫn gửi
thẳng request tới action dành cho ADMIN được.

Vì vậy quyền được kiểm ở **nhiều lớp độc lập**:

| Lớp                           | Chặn được gì                         | Ở đâu                              |
| ----------------------------- | ------------------------------------ | ---------------------------------- |
| Proxy (chỉ trang, KHÔNG /api) | Người chưa đăng nhập vào trang       | `src/proxy.ts`                     |
| Trang (`requirePermission`)   | Người đăng nhập nhưng không đủ quyền | `src/app/(admin)/users/page.tsx`   |
| **Server Action (bắt buộc)**  | Request gửi thẳng tới action         | `src/app/(admin)/users/actions.ts` |
| **Route handler (bắt buộc)**  | Mọi request tới REST API             | `src/app/api/**`                   |

Thêm action mới thì **luôn** bọc bằng `defineAction` (hoặc biến thể
`defineAuthedAction`/`definePublicAction`/`defineVenueAction` trong
`src/lib/define-action.ts`) — khai báo quyền là tham số bắt buộc, quên là không
biên dịch được. Ràng buộc này được khoá bằng test trong
`src/app/(admin)/users/actions.test.ts`.

### Những điểm khác

- **Quyền lấy từ database, không lấy từ token.** Cookie web sống
  `SESSION_MAX_AGE_DAYS` (mặc định 7 ngày); trong khoảng đó user có thể bị xoá
  hoặc hạ quyền. `getCurrentUser()` luôn đọc lại DB, `permissionService` tra
  quyền theo `userId` từ DB (có cache).
- **Thu hồi phiên thật sự.** `getSession` (web), `getApiSession` (REST) và
  handshake realtime đều kiểm _security stamp_ của tài khoản
  (`src/services/security-stamp.service.ts`): mốc `passwordChangedAt`, `status`,
  đã xoá chưa — cache tối đa 60 giây, và được xoá ngay trong thao tác làm đổi
  chúng. Đổi/đặt lại mật khẩu, khoá, xoá tài khoản → token cũ bị từ chối dù chữ
  ký còn hợp lệ. `SESSION_STRICT_REVOCATION=0` chỉ tắt phép so mốc mật khẩu;
  khoá/xoá vẫn cắt phiên.
- **`role` không bao giờ đọc từ form.** Nếu đọc, người dùng tự phong ADMIN
  bằng một field ẩn.
- **Thông điệp đăng nhập sai luôn giống nhau** và tốn thời gian như nhau, kể cả
  khi email không tồn tại (`CryptoUtils.fakeCompare`) — không thì đo thời gian
  phản hồi là dò được email đã đăng ký.
- **`?next=` được lọc** (`safeRedirectPath`). Chỉ nhận đường dẫn nội bộ;
  `//evil.com`, `\` và ký tự điều khiển bị chặn.
- **CSP có nonce sinh theo từng request**, dựng trong `src/proxy.ts`.
- **Biến môi trường validate lúc khởi động** — sai thì app không lên, thay vì
  chết ở request đầu tiên chạm tới nó.
- **Rate limit đăng nhập**: 5 lần / 5 phút mỗi IP. **Web và API dùng CHUNG
  bucket** (`RATE_LIMIT_BUCKETS`), nên luân phiên form web và
  `/api/v1/auth/login` không nhân đôi được số lần thử. IP lấy từ
  `X-Forwarded-For`, đếm từ phải qua đúng `TRUSTED_PROXY_HOPS` proxy tin cậy
  (mặc định 1) — không bao giờ tin phần tử đầu do client gửi. Vượt ngưỡng trả
  429 kèm `Retry-After`. Store **cắm được**: có `REDIS_URL` thì đếm trên Redis
  (dùng chung giữa các instance, sống qua deploy), không có thì đếm trong RAM
  tiến trình kèm cảnh báo trong log. Bản RAM đủ cho một container, nhưng từ
  instance thứ hai trở đi mỗi bản đếm riêng nên ngưỡng thực tế bị nhân lên theo
  số instance.
  ⚠️ Redis chết thì rate limit **fail-open** (tạm cho qua) chứ không chặn hết —
  đánh đổi có chủ đích, xem ghi chú trong `src/lib/rate-limit.ts`.

---

## Mật khẩu, quyền hạn và xác thực email

### Băm mật khẩu — Argon2id, tự nâng cấp dần

Dùng `@node-rs/argon2` với tham số OWASP (19 MiB, 2 lượt, 1 luồng). Argon2id
tốn cả CPU lẫn **bộ nhớ**, nên dàn GPU dò offline bị chặn bởi băng thông bộ nhớ
— thứ đắt và khó mở rộng hơn số nhân.

**Không có đường lui về bcrypt** — bcryptjs đã bị gỡ hẳn. Hash bcrypt lọt vào
database (nhập từ hệ thống cũ) chỉ khiến `verifyPassword` trả "sai mật khẩu",
thất bại an toàn. Cách nhận dữ liệu cũ nếu thật sự cần được ghi trong chú thích
đầu `src/lib/crypto.ts`.

Việc băm lại diễn ra ngay lúc đăng nhập thành công — khi mật khẩu còn trong bộ
nhớ — mỗi khi **tham số Argon2 đổi**:

1. `verifyPassword` so tiền tố tham số của chuỗi hash với tham số hiện tại.
2. Đúng mật khẩu + hash sinh bằng tham số cũ → trả về `needsRehash: true`.
3. `AuthService` băm lại bằng tham số mới và ghi đè.

Người dùng không thấy gì khác. Lỗi ở bước ghi đè bị nuốt có chủ đích — họ đã
nhập đúng mật khẩu, một thao tác nền thất bại không được phép chặn đăng nhập.

### Phân quyền — RBAC lai giữa code và database

Ba bảng: `roles`, `permissions`, `role_permissions` (thêm `user_roles` — một
người mang nhiều vai trò — và ngoại lệ theo từng người `UserPermission`). Nhưng
**không phải RBAC thuần database** — phân công như sau:

|                            | Nơi giữ                         | Vì sao                                                                                                                                                           |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Danh mục quyền TỒN TẠI     | Code (`src/lib/permissions.ts`) | Một quyền chỉ có nghĩa khi có mã kiểm tra nó. Cho tạo quyền từ giao diện sẽ sinh ra những dòng không ràng buộc điều gì. TypeScript vẫn bắt lỗi gõ sai tên quyền. |
| Việc GÁN quyền cho vai trò | Database                        | "Kế toán được xem báo cáo nhưng không xoá đơn" là quyết định nghiệp vụ, khác nhau theo khách hàng, và không nên cần deploy.                                      |

```ts
// Trang / layout
await requirePermission("user:read");

// Route handler
await requireApiPermission(request, "user:delete");

// Có xét quyền `:own`
await permissionService.canActOnResource(session.sub, ownerId, {
  any: "user:read",
  own: "profile:read:own",
});

// Quyền trên MỘT SÂN (khu chủ sân) — xem CLAUDE.md
await permissionService.canOnVenue(userId, "booking:update", venueId);
```

**Thêm quyền mới**: khai báo trong `PERMISSIONS`, thêm mô tả vào
`PERMISSION_METADATA`, gán mặc định trong `DEFAULT_ROLE_PERMISSIONS`, rồi
`pnpm db:seed`. Không cần viết migration.

**Thêm vai trò mới**: làm ngay trên giao diện `/roles`, hoặc qua
`POST /api/v1/roles`. Không cần deploy, không cần gõ SQL.

#### Màn hình quản trị `/roles`

Đây là nơi lời hứa "sửa được lúc chạy" trở thành thao tác thật:

- Tạo vai trò mới. Vai trò mới **bắt đầu với bộ quyền rỗng** — vừa tạo đã có
  sẵn quyền là cách nhanh nhất để cấp nhầm.
- Tick/bỏ tick quyền cho từng vai trò. Danh sách gửi lên mang ngữ nghĩa **thay
  thế toàn bộ**, nên bỏ tick thực sự gỡ được quyền.
- Xoá vai trò tự tạo.

Các luật an toàn nằm trong `roleService`, không nằm ở giao diện — nút bị gọi
thẳng vẫn bị chặn:

1. **`key` không đổi được sau khi tạo.** Nó nằm trong mọi JWT đang lưu hành;
   đổi là vô hiệu hoá toàn bộ token còn hiệu lực, trong im lặng.
2. **Vai trò `isSystem` không xoá được.** Xoá nhầm ADMIN là khoá cửa cả hệ
   thống và không còn ai đủ quyền tạo lại.
3. **Vai trò còn người dùng không xoá được.** Khoá ngoại cũng chặn, nhưng bằng
   lỗi ràng buộc thô — chặn sớm để nói được câu người bấm nút hiểu được.
4. **Không leo thang đặc quyền.** Không tạo/sửa vai trò có `level` ≥ bậc cao
   nhất của người thao tác, và chỉ gán được những quyền mình đang có
   (`PermissionNotHeldError`).

Bốn quyền điều khiển màn hình này: `role:read`, `role:create`, `role:update`,
`role:delete`. Tách `role:update` riêng vì nó **tự nâng quyền được** — ai sửa
được bảng phân quyền thì tự cấp cho mình mọi quyền còn lại bằng vài cú tick.

#### Cache — và hai giới hạn phải biết

`permissionService` cache quyền hiệu lực **theo từng người dùng** (không theo
vai trò, vì có ngoại lệ riêng), TTL 60 giây. Không có nó thì mỗi request là một
lần join nhiều bảng chỉ để đọc dữ liệu đổi vài lần một năm.

1. **Không có Redis thì cache theo tiến trình.** Chạy nhiều replica thì lệnh
   xoá cache chỉ xoá bản sao của replica đang xử lý request đó; các replica khác
   tự làm mới sau TTL. Có `REDIS_URL` thì cache dùng chung, xoá là xoá cho mọi
   instance.
2. **Mọi thao tác ghi phân quyền BẮT BUỘC xoá cache**: `invalidateUser(userId)`
   sau khi đổi vai trò/quyền riêng của một người, `invalidateAll()` sau khi sửa
   bảng phân quyền của một vai trò. Quên thì quản trị viên bỏ tick một quyền,
   thử lại ngay, thấy vẫn làm được, và kết luận hệ thống hỏng. `roleService` đã
   gọi `invalidateAll()` ở cả ba đường ghi (create/update/delete); đường ghi mới
   nào cũng phải làm vậy.

Tài khoản không `ACTIVE` không có quyền nào (`load` lọc theo `status`) — lớp thứ
hai phía sau security stamp.

**Seed chỉ THÊM, không ghi đè.** Nếu seed áp lại `DEFAULT_ROLE_PERMISSIONS` thì
mỗi lần deploy sẽ xoá sạch cấu hình khách hàng đã chỉnh — và không ai hiểu vì
sao phân quyền "tự quay về như cũ".

### Danh tính người dùng — email, username, fullName

- `email` — bắt buộc, **luôn hạ về chữ thường** trước khi ghi và trước khi tra.
  Không chuẩn hoá thì `Loi@x.com` và `loi@x.com` thành hai tài khoản.
- `username` — tuỳ chọn, unique, chỉ `[a-z0-9_]{3,32}`. Cấm chữ hoa ngay từ
  đầu vào thay vì tự hạ xuống, để người dùng biết chính xác tên họ sẽ là gì.
- `fullName` — tên hiển thị. Tách bạch với `username`: một cái để người khác
  đọc, một cái để đăng nhập.

Đăng nhập nhận **cả hai** qua một trường `identifier`. Có ký tự `@` thì tra theo
email, không thì tra theo username — `usernameSchema` cấm `@` nên không nhập
nhằng.

⚠️ **Phá vỡ tương thích**: trường đăng nhập đổi từ `email` sang `identifier`.
Client mobile đang chạy phải cập nhật theo.

### Xác thực email và đặt lại mật khẩu

Token dùng một lần, lưu trong bảng `verification_tokens`:

- **Chỉ lưu SHA-256**, không lưu token gốc — rò database không mất tài khoản.
- **Dùng một lần thật sự**: đánh dấu bằng `updateMany` có điều kiện `usedAt:
null` rồi kiểm tra số dòng. Đọc-trước-ghi-sau sẽ để hai request song song
  dùng được cùng một token.
- **Cấp mới thì huỷ token cũ cùng loại**, trong cùng transaction.
- **Hạn khác nhau theo loại**: xác thực email 24 giờ, đặt lại mật khẩu 60 phút.
  Link đặt lại mật khẩu bị lộ là mất tài khoản, nên phải ngắn hơn.
- **Đổi/đặt lại mật khẩu thu hồi toàn bộ refresh token** và đặt
  `passwordChangedAt` — access token/cookie đang cầm cũng bị cắt qua security
  stamp. Luồng này thường xuất phát từ nghi ngờ bị chiếm tài khoản; để phiên cũ
  sống thì việc đổi gần như vô nghĩa. Phiên đang thao tác đổi mật khẩu được cấp
  lại cookie/token mới.

`/api/v1/auth/forgot-password` **luôn trả 200**, kể cả khi email không tồn tại và
kể cả khi gửi thư thất bại. Bất kỳ khác biệt nào — mã lỗi, thời gian phản hồi —
đều biến nó thành công cụ dò danh sách người dùng. Lỗi thật vẫn vào log.

#### Trang web cho các luồng này

Link trong email trỏ tới đường dẫn của **web**, không phải REST API. Các trang
tương ứng nằm trong `src/app/(auth)/`:

| Trang                   | Vai trò                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `/forgot-password`      | Nhập email, luôn hiện cùng một thông điệp dù có tài khoản hay không |
| `/reset-password`       | Đọc `?token=` từ link, đặt mật khẩu mới rồi xoá cookie phiên        |
| `/verify-email`         | Đọc `?token=` từ link, xác thực khi người dùng BẤM NÚT              |
| `/confirm-email-change` | Xác nhận đổi email bằng link gửi tới địa chỉ MỚI                    |

⚠️ `/verify-email` **không tự xác thực lúc mở trang**, và đó là điều cố ý. Token
chỉ dùng được một lần, mà bộ quét link của Gmail/Outlook tự mở mọi URL trong
thư để kiểm tra an toàn — tiêu thụ token ngay lúc GET là để nó bị đốt trước khi
người dùng kịp bấm, rồi họ nhận "liên kết đã hết hạn" cho một thư vừa gửi xong.

#### Dọn token định kỳ

`verification_tokens` và `refresh_tokens` là hai bảng **chỉ tăng**: mỗi lần
đăng nhập trên điện thoại là một dòng, mỗi lần bấm "quên mật khẩu" là một dòng —
kể cả khi người dùng không bao giờ mở email.

Lịch `maintenance-purge-expired` (`CRON_PURGE_EXPIRED`, mặc định 03:00 giờ VN) đã
dọn mỗi ngày — xem mục "Lịch job" bên dưới. Chạy tay:

```bash
pnpm db:purge
```

Trên VPS có thêm systemd timer làm **lưới dự phòng** cho cấu hình không ai chạy
lịch (`make vps-files` in ra lệnh cụ thể):

```bash
sudo cp deploy/chotsan-purge.service deploy/chotsan-purge.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now chotsan-purge.timer
```

### Gửi email

`src/lib/mailer.ts` chỉ định nghĩa interface. Bộ khung **cố tình không chọn nhà
cung cấp**: mỗi dự án bị ràng buộc khác nhau (SMTP nội bộ của khách, Resend,
SES…), cắm cứng một cái chỉ tạo ra việc phải gỡ ra.

- **Dev**: nội dung email ghi ra log — lấy link trong đó mà test.
- **Production**: bản mặc định **ném lỗi**, buộc phải cấu hình thật. Im lặng
  nuốt email nguy hiểm hơn nhiều: người dùng bấm "quên mật khẩu", hệ thống báo
  thành công, thư không bao giờ tới.

```ts
setMailer({
  async send({ to, subject, text }) {
    /* gọi nhà cung cấp */
  },
});
```

Link tuyệt đối trong email, callback OAuth và rpID/origin của WebAuthn đều dựng
từ **`appBaseUrl()`** (`src/lib/env.ts`) = `APP_URL`, thiếu thì
`NEXT_PUBLIC_APP_URL`. Thiếu cả hai thì việc gửi ném lỗi ngay, thay vì gửi đi
một email chứa link localhost mà không rút lại được.

---

## Các lệnh

```bash
# Phát triển
pnpm dev              # dev server (Turbopack)
pnpm build            # build production
pnpm start            # chạy bản build

# Chất lượng — `pnpm check` = typecheck + lint + format:check + test:coverage
pnpm typecheck
pnpm lint             # thêm :fix để tự sửa
pnpm format           # thêm :check để chỉ kiểm tra
pnpm test             # thêm :watch hoặc :coverage
pnpm test:e2e         # Playwright — tự build production rồi chạy trên trình duyệt thật
pnpm check

# Database
pnpm db:migrate:diff  # in SQL chênh lệch giữa database và schema.prisma (KHÔNG ghi gì)
pnpm db:deploy        # áp migration đã commit (dev lẫn production)
pnpm db:generate
pnpm db:studio
pnpm db:seed          # quyền/vai trò + dữ liệu mẫu
pnpm db:seed:prod     # chỉ dữ liệu nền + tài khoản ADMIN_EMAIL
pnpm db:purge         # dọn token/nhật ký đã hết hạn
pnpm db:check-conflict  # thao tác ĐỒNG THỜI thật trên DB thật: chống trùng chỗ + trùng tiền

# Tiến trình phụ
pnpm realtime:dev
pnpm worker:dev
```

⚠️ `pnpm test:e2e` cần database đã chạy `pnpm db:seed`: bộ test đăng nhập
bằng tài khoản mẫu `@dev.local` của bộ seed đó.

`make help` liệt kê các lệnh tương đương.

### Tạo migration mới — KHÔNG dùng `prisma migrate dev`

Các script `db:migrate`, `db:migrate:create`, `db:push`, `db:reset` **đã bị gỡ**:
migration có ràng buộc viết tay mà Prisma không biết (`EXCLUDE USING gist`
chống trùng lượt đặt, khoá ngoại hai cột, sequence số hoá đơn…), và
`migrate dev`/`db push` sẽ đòi xoá chúng — xem `docs/GOTCHAS.md` #11. Quy trình:

1. Sửa `prisma/schema.prisma`.
2. `pnpm db:migrate:diff` → **đọc kỹ** SQL in ra, **xoá mọi câu DROP đụng tới
   ràng buộc/index/sequence viết tay**.
3. Lưu vào `prisma/migrations/<timestamp>_<english_name>/migration.sql`
   (vd `20260917160000_integrity_invoice_numbering`).
4. `pnpm db:deploy`
5. `pnpm db:generate`
6. `pnpm db:check-conflict` — xác nhận lưới chống trùng vẫn còn.

### Git hook (Husky)

- **pre-commit**: `lint-staged` — lint + format chỉ các tệp đang commit.
- **pre-push**: `pnpm typecheck && pnpm test`.

Gate đầy đủ vẫn là `pnpm check`; coverage, e2e và build để CI lo.

---

## Lịch job

Job theo lịch định nghĩa ở **một nơi**: `src/jobs/schedules.ts` (cron diễn giải
theo giờ `Asia/Ho_Chi_Minh`, ghi đè bằng biến `CRON_*`). Chế độ chạy hiện ở
`/api/health` → `features.schedules`:

| Chế độ       | Khi nào                            | Ai chạy lịch                                                 |
| ------------ | ---------------------------------- | ------------------------------------------------------------ |
| `worker`     | `QUEUE_ENABLED=1` + có `REDIS_URL` | `worker/` đăng ký job scheduler BullMQ                       |
| `in-process` | `QUEUE_ENABLED=0`                  | Chính tiến trình web (`src/instrumentation.ts`)              |
| `off`        | `QUEUE_ENABLED=1` mà thiếu Redis   | Không ai — production log lỗi; dev cố ý tắt để Neon được ngủ |

Mọi handler phải idempotent: chạy nhiều instance web với `QUEUE_ENABLED=0` là
chạy trùng mỗi mốc.

---

## Deploy

📘 **Hướng dẫn từng bước đầy đủ: [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md)** — chuẩn bị
máy chủ, file môi trường, các cách deploy, danh sách kiểm tra sau khi lên, sao
lưu và rollback. Mục dưới đây chỉ tóm tắt.

Hỗ trợ hai cách, chọn một (VPS trực tiếp có thêm biến thể PM2 —
`ecosystem.config.cjs`, `scripts/deploy-pm2.sh`):

|              | **Docker**                            | **VPS trực tiếp**                |
| ------------ | ------------------------------------- | -------------------------------- |
| Hợp khi      | máy chưa có gì, muốn dựng nhanh       | VPS đã có sẵn Postgres, muốn nhẹ |
| Postgres     | container kèm theo                    | tự cài trên máy                  |
| RAM tiêu tốn | nhiều hơn                             | ít hơn                           |
| Migration    | service `migrate` tự chạy trước `web` | `scripts/deploy-vps.sh` chạy     |

Cả hai đường đều chạy **ba tiến trình**: web, realtime, worker. Tắt tiến trình
không dùng bằng `REALTIME_ENABLED=0` / `QUEUE_ENABLED=0` (chỉ nhận `1`/`0`).

### Cách 1 — Docker

```bash
# Lần đầu
docker compose up -d          # postgres + redis → migrate (1 lần) → web, realtime, worker

# Mỗi lần deploy sau đó
./scripts/deploy-docker.sh    # pull → build → up → health check → dọn image cũ
```

Bước dọn image ở cuối **không phải tuỳ chọn**. Mỗi lần build, image cũ mất tag
và thành `<none>` nhưng vẫn chiếm đĩa; VPS 20–40GB deploy vài chục lần là đầy,
và Docker hỏng khi hết chỗ chứ không báo trước. Script chỉ dọn **sau khi** đã
xác nhận service khoẻ — deploy hỏng thì image cũ chính là đường lùi.

`web` chỉ khởi động sau khi service `migrate` kết thúc thành công, nên schema
luôn được áp trước request đầu tiên. Image runtime chạy bằng user không phải
root và có healthcheck gọi `/api/health`. Image `realtime`/`worker` chỉ mang
`node_modules` tối thiểu (`deploy/runtime-package.mjs`). Mọi cổng công bố đều
bind `127.0.0.1:` — `ufw` không chặn được cổng do Docker mở.

Cần `.env` có `SESSION_SECRET` — không có thì container dừng ngay kèm thông báo
rõ ràng, đó là chủ ý.

### Cách 2 — VPS trực tiếp (systemd + Caddy)

```bash
# --- một lần trên máy chủ (mã nguồn ở /var/www/chotsan) ---
sudo mkdir -p /etc/chotsan
sudo cp .env.example /etc/chotsan/env   # rồi điền giá trị thật
sudo chmod 600 /etc/chotsan/env         # file này chứa SESSION_SECRET

sudo cp deploy/chotsan.service deploy/chotsan-realtime.service deploy/chotsan-worker.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now chotsan chotsan-realtime chotsan-worker

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile   # đổi example.com
sudo systemctl reload caddy

# --- mỗi lần deploy ---
./scripts/deploy-vps.sh     # pull → install → migrate → build (web, realtime, worker) → restart → health check
```

`deploy-vps.sh` tự `disable` unit của tiến trình bị tắt bằng cờ, và không bật lại
unit bạn đã disable tay.

**Vì sao Caddy chứ không phải nginx.** Caddy tự xin và tự gia hạn chứng chỉ
Let's Encrypt ngay trong tiến trình của nó — không certbot, không cron. Cert
hết hạn lúc 3 giờ sáng là nguyên nhân downtime phổ biến nhất của deploy thủ
công, và Caddy xoá hẳn nguyên nhân đó. Cấu hình cũng ngắn hơn khoảng 4 lần.

Repo cố tình chỉ có **một** file reverse proxy. Giữ sẵn thêm một file nginx
"phòng khi cần" nghe hợp lý, nhưng file thứ hai không ai chạy là file không ai
kiểm chứng — nó sẽ âm thầm sai theo thời gian.

Nếu VPS đã chạy nginx cho dự án khác (thêm Caddy sẽ tranh cổng 80/443), viết
một server block nginx trỏ tới `127.0.0.1:3000` (và `/socket.io/` sang
`127.0.0.1:3002`) là xong. Chỉ cần nhớ đúng một điều bên dưới.

> **Bẫy chung cho mọi reverse proxy:** IP dùng cho rate limit đếm từ **phải**
> của `X-Forwarded-For` theo `TRUSTED_PROXY_HOPS` (mặc định 1 = một proxy đứng
> trước app). Đặt số này đúng với số proxy thật; Caddyfile kèm theo ghi đè
> header bằng `{remote_host}`. Khai thiếu/thừa hop là client tự gửi header giả
> để né rate limit, hoặc mọi người bị dồn chung một xô.

#### Vài điểm dễ vấp

- **`pnpm build` tự chép `public/` và `.next/static/` vào `.next/standalone/`**
  ([scripts/prepare-standalone.mjs](scripts/prepare-standalone.mjs)). Next.js
  cố tình không làm bước này. Quên nó thì server vẫn trả HTML 200 nhưng toàn bộ
  CSS/JS trả 404 — trang hiện ra trần trụi mà không có lỗi nào báo.
- **File env nằm ở `/etc/chotsan/env`, không phải `.env` trong mã nguồn.**
  `server.js` của bản standalone tự `process.chdir()` vào thư mục của nó nên
  `.env` ở gốc dự án không bao giờ được nạp trên production. systemd truyền
  biến vào qua `EnvironmentFile`.
- **App, realtime và `/health` của worker chỉ lắng nghe `127.0.0.1`** (biến
  `HOST`). Reverse proxy là cửa duy nhất ra Internet; bind `0.0.0.0` là để lộ
  cổng, đi vòng qua cả TLS lẫn rate limit.
- Yêu cầu **Node 24** (`engines: 24.x`).

---

## Realtime (WebSocket)

Tiến trình **riêng**, không nằm trong Next.js — xem [realtime/](realtime/).

```bash
pnpm realtime:dev      # cổng 3002
pnpm realtime:build    # gói thành một file bằng esbuild
pnpm realtime:start    # chạy bản đã build
```

**Vì sao phải tách khỏi Next.** App Router là mô hình request/response, không
giữ được kết nối WebSocket lâu dài. Nhét socket vào Next bằng custom server thì
phá `output: "standalone"`, và **mỗi lần deploy web là rớt sạch kết nối đang
mở** — với app chat thì đó là lỗi nghiêm trọng.

**Vì sao KHÔNG dùng NestJS.** Tiến trình này chỉ làm một việc và nó dùng lại
`verifySession` cùng tầng service của app chính, nên web, mobile và socket chung
đúng một token, một tầng nghiệp vụ. Cân nhắc framework có DI khi nó phình ra
nhiều gateway, queue consumer và cron — không phải chỉ vì có socket.

**Vì sao `realtime/` nằm ngoài `src/`.** `src/` là ứng dụng Next; mọi thứ trong
đó nằm trong đồ thị module của Next. Để bên ngoài thì việc lỡ import một thứ chỉ
chạy được trong Next (`next/headers`, `server-only`) sẽ lộ ngay lúc bundle, thay
vì build xanh rồi chết lúc chạy.

### Điểm cần biết

- **Xác thực ở handshake**, không phải sau khi đã nối. Cho nối trước rồi mới
  kiểm tra nghĩa là kẻ tấn công vẫn giữ được kết nối mở và tiêu tài nguyên.
  Handshake cũng kiểm security stamp, nên realtime **cần `DATABASE_URL`**.
- **`REDIS_URL` bắt buộc từ instance thứ hai trở đi.** Thiếu nó thì client nối
  vào máy A không nhận được tin phát từ máy B — im lặng, không lỗi nào.
- **`connectionStateRecovery`** bật sẵn: mạng rớt rồi quay lại trong 2 phút thì
  nối tiếp phiên cũ. Quan trọng với mobile. Đặt `skipMiddlewares: false` — mặc
  định socket.io bỏ qua middleware xác thực khi phục hồi phiên.
- **`ack` callback** là cách client phân biệt "đã gửi" với "mất mạng".

### Ba thứ quyết định app chat sống hay chết — chưa có trong khung này

Đây là khung kết nối, không phải app chat hoàn chỉnh. Trước khi làm chat thật:

1. **Push notification.** Socket chết ngay khi người dùng thoát app; mỗi tin
   nhắn phải đi hai đường — socket cho người online, FCM/APNs cho người offline.
2. **ULID do client sinh** làm khoá idempotent, để gửi lại khi mất mạng không
   tạo tin nhắn trùng.
3. **Sequence number theo từng hội thoại** để sắp xếp — đừng tin đồng hồ máy
   client.

Chọn sai framework thì sửa được; thiếu ba thứ trên thì phải làm lại từ đầu.

---

## REST API cho mobile (Flutter)

Web và mobile dùng chung tầng service; chỉ khác cách mang danh tính:
**web dùng cookie, mobile dùng `Authorization: Bearer`**. Cùng một endpoint
phục vụ được cả hai — `getApiSession()` đọc header trước, không có thì fallback
cookie.

Quan trọng: **Proxy cố tình không chạy trên `/api`** ([src/proxy.ts](src/proxy.ts)).
Proxy nói chuyện bằng redirect và HTML, còn client mobile cần JSON kèm đúng
status code. Hệ quả: route handler là lớp kiểm quyền **duy nhất** của API, nên
mọi handler phải gọi `requireApiUser()`, `requireApiPermission()` hoặc
`requireVenuePermission()` (`src/lib/api/auth.ts`).

⚠️ API hiện chỉ phủ tài khoản, phân quyền và hạ tầng; đặt sân/thanh toán cho
mobile **chưa có** endpoint REST.

### Các endpoint có sẵn

⚠️ Toàn bộ endpoint client (mobile) nằm dưới **`/api/v1`** — versioning thêm
sớm có chủ đích, xem mục "Vì sao có `/v1`" bên dưới. Riêng `/api/health` không
versioned vì đó là healthcheck hạ tầng (Docker/deploy script đọc trực tiếp),
không phải hợp đồng dữ liệu cho client.

| Method                | Đường dẫn                                         | Quyền                                                                                          |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST`                | `/api/v1/auth/register`                           | công khai                                                                                      |
| `POST`                | `/api/v1/auth/login`                              | công khai                                                                                      |
| `POST`                | `/api/v1/auth/refresh`                            | refresh token                                                                                  |
| `POST`                | `/api/v1/auth/logout`                             | đã đăng nhập                                                                                   |
| `GET`                 | `/api/v1/auth/me`                                 | đã đăng nhập                                                                                   |
| `POST`                | `/api/v1/auth/forgot-password`                    | công khai                                                                                      |
| `POST`                | `/api/v1/auth/reset-password`                     | token trong email                                                                              |
| `POST`                | `/api/v1/auth/verify-email`                       | token trong email                                                                              |
| `POST`                | `/api/v1/auth/verify-email/request`               | đã đăng nhập                                                                                   |
| `GET`                 | `/api/v1/auth/sessions`                           | đã đăng nhập — chỉ phiên của chính mình                                                        |
| `DELETE`              | `/api/v1/auth/sessions/{id}`                      | đã đăng nhập — chỉ phiên của chính mình                                                        |
| `DELETE`              | `/api/v1/auth/sessions`                           | đăng xuất MỌI thiết bị khác, giữ phiên hiện tại                                                |
| `POST`                | `/api/v1/auth/change-password`                    | đã đăng nhập                                                                                   |
| `GET`                 | `/api/v1/auth/oauth/{provider}/start`             | công khai (redirect)                                                                           |
| `GET`\*               | `/api/v1/auth/oauth/{provider}/callback`          | công khai (redirect)                                                                           |
| `GET`                 | `/api/v1/auth/oauth/providers`                    | công khai — provider đã cấu hình                                                               |
| `GET`                 | `/api/v1/auth/oauth/linked`                       | tài khoản đã liên kết                                                                          |
| `DELETE`              | `/api/v1/auth/oauth/{provider}`                   | gỡ liên kết                                                                                    |
| `GET`/`DELETE`        | `/api/v1/auth/2fa`                                | trạng thái 2FA / tắt 2FA                                                                       |
| `POST`                | `/api/v1/auth/2fa/{setup,enable,recovery-codes}`  | bật 2FA ba bước                                                                                |
| `POST`                | `/api/v1/auth/2fa/verify`                         | công khai — đổi vé 2FA + mã lấy token                                                          |
| `GET`                 | `/api/v1/auth/passkeys`                           | danh sách passkey                                                                              |
| `POST`                | `/api/v1/auth/passkeys/register/{options,verify}` | thêm passkey                                                                                   |
| `POST`                | `/api/v1/auth/passkeys/login/{options,verify}`    | công khai — đăng nhập bằng passkey                                                             |
| `PATCH`/`DELETE`      | `/api/v1/auth/passkeys/{id}`                      | đổi tên / xoá passkey                                                                          |
| `POST`                | `/api/v1/auth/change-email`                       | xin đổi email (gửi link tới địa chỉ MỚI)                                                       |
| `POST`                | `/api/v1/auth/change-email/confirm`               | công khai — xác nhận bằng token trong link                                                     |
| `POST`                | `/api/v1/auth/phone/{request-otp,verify}`         | ⚠️ mặc định TẮT — SMS tốn tiền                                                                 |
| `GET`                 | `/api/v1/users`                                   | quyền `user:read`                                                                              |
| `POST`                | `/api/v1/users`                                   | quyền `user:create`                                                                            |
| `GET`                 | `/api/v1/users/{id}`                              | `user:read`, hoặc `profile:read:own` với chính mình                                            |
| `PATCH`               | `/api/v1/users/{id}`                              | `user:update`, hoặc `profile:update:own` với chính mình — ⚠️ `roleKeys` LUÔN đòi `user:update` |
| `DELETE`              | `/api/v1/users/{id}`                              | quyền `user:delete`                                                                            |
| `PATCH`               | `/api/v1/users/{id}/status`                       | quyền `user:update`                                                                            |
| `POST`                | `/api/v1/users/{id}/unlock`                       | quyền `user:update`                                                                            |
| `PUT`                 | `/api/v1/users/{id}/roles`                        | quyền `user:update` — THAY toàn bộ danh sách vai trò                                           |
| `GET`/`PUT`           | `/api/v1/users/{id}/permissions`                  | ngoại lệ quyền cho từng người (`user:read` / `user:update`)                                    |
| `DELETE`              | `/api/v1/users/{id}/permissions/{permissionKey}`  | gỡ ngoại lệ (`user:update`)                                                                    |
| `GET`                 | `/api/v1/roles`                                   | quyền `role:read`                                                                              |
| `POST`                | `/api/v1/roles`                                   | quyền `role:create`                                                                            |
| `GET`                 | `/api/v1/roles/{key}`                             | quyền `role:read`                                                                              |
| `PATCH`               | `/api/v1/roles/{key}`                             | quyền `role:update`                                                                            |
| `DELETE`              | `/api/v1/roles/{key}`                             | quyền `role:delete`                                                                            |
| `GET`                 | `/api/v1/permissions`                             | quyền `role:read` — danh mục quyền (đến từ code, không phải DB)                                |
| `GET`/`POST`          | `/api/v1/notifications`                           | hộp thư của mình / gửi (`notification:send`)                                                   |
| `GET`                 | `/api/v1/notifications/unread-count`              | số chưa đọc                                                                                    |
| `POST`                | `/api/v1/notifications/{id}/read`, `/read-all`    | đánh dấu đã đọc (`id` là `recipientId`, gọi lại vẫn an toàn)                                   |
| `GET`/`POST`/`DELETE` | `/api/v1/devices`                                 | thiết bị nhận push                                                                             |
| `GET`                 | `/api/v1/audit-logs`                              | quyền `audit:read` — chỉ ĐỌC                                                                   |
| `POST`                | `/api/v1/files`                                   | quyền `file:upload` — kiểm magic bytes; 503 khi chưa cắm storage                               |
| `GET`                 | `/api/v1/openapi.json`                            | công khai                                                                                      |
| `GET`                 | `/api/health`                                     | công khai (unversioned)                                                                        |

\* Apple bắt buộc `POST` cho endpoint callback — xem `src/lib/oauth/`.

**Tài liệu tương tác**: `/api/v1/openapi.json` sinh tự động từ Zod schema thật
(`src/lib/openapi/registry.ts`), xem ngay tại `/docs` — hoặc dán URL vào
editor.swagger.io/Postman ("Import từ link") để có docs luôn khớp code, không
lệch tay.

### Vì sao có `/v1`

Mobile không deploy tức thời như web — app đã lên store không thể ép user
update ngay. Đổi hợp đồng API breaking mà không versioning sẽ làm bản cũ hỏng
ngay lập tức, không cách nào cứu. Thêm `/v1` từ đầu, trước khi có user thật,
để việc này không bao giờ phải làm trong hoảng loạn sau này.

### Định dạng response

Thành công `{ "data": ... }`, thất bại `{ "error": { "code", "message", "fields"? } }`.

Client nên switch-case theo **`code`**, không theo `message` — message là lời
văn hiển thị cho người dùng và có thể đổi bất cứ lúc nào.

`VALIDATION_ERROR` (422) · `UNAUTHENTICATED` (401) · `FORBIDDEN` (403) ·
`NOT_FOUND` (404) · `CONFLICT` (409) · `RATE_LIMITED` (429, kèm `Retry-After`) ·
`ACCOUNT_BANNED` (403) · `ACCOUNT_LOCKED` (423) · `INTERNAL_ERROR` (500)

### Mô hình token

`login`/`register` trả về:

```json
{
  "data": {
    "user": { "id": "...", "email": "...", "roles": ["USER"] },
    "accessToken": "eyJ...",
    "expiresIn": 900,
    "tokenType": "Bearer",
    "refreshToken": "hZ8...",
    "refreshExpiresAt": "2026-09-02T06:49:58.739Z",
    "sessionId": "5b0c…"
  }
}
```

Tài khoản bật 2FA thì `login` trả hình dạng **khác hẳn**:
`{ "twoFactorRequired": true, "challengeToken", "expiresIn" }` — client buộc phải
rẽ nhánh rồi gọi `/api/v1/auth/2fa/verify`.

- **Access token** — JWT, mặc định 15 phút (`ACCESS_TOKEN_TTL_MINUTES`). Hạn
  ngắn giới hạn thiệt hại khi bị lộ; khoá/xoá tài khoản hay đổi mật khẩu vẫn cắt
  được nó qua security stamp (trễ tối đa 60 giây giữa các tiến trình không Redis).
- **Refresh token** — chuỗi ngẫu nhiên, mặc định 30 ngày, **chỉ lưu SHA-256
  trong database**. Rò database không đồng nghĩa với rò phiên đăng nhập.
- **`sessionId`** là `familyId` của phiên — **không đổi qua các lần refresh**,
  khớp `id` trong `GET /api/v1/auth/sessions`. Lưu một lần để nhận ra "thiết bị
  này".
- **Xoay vòng mỗi lần refresh.** Token cũ bị thu hồi ngay khi cấp token mới.
- **Phát hiện dùng lại.** Nếu một token đã thu hồi lại được dùng, **cả họ
  (family) phiên đó** bị huỷ — kể cả token mới vừa cấp — và ghi audit
  `REFRESH_TOKEN_REUSED`. Các phiên khác của tài khoản (thiết bị khác) giữ
  nguyên. Kẻ trộm và thiết bị thật dùng chung một họ, không phân biệt được bên
  nào là kẻ trộm nên đá cả hai ra là phản ứng đúng.

Phía Flutter: lưu cả hai bằng `flutter_secure_storage`, gắn interceptor để khi
gặp 401 thì gọi `/api/v1/auth/refresh` rồi thử lại request. **Không cần CORS** vì
app native không phải trình duyệt.

### Thêm endpoint mới

```ts
// src/app/api/v1/posts/route.ts
import { requireApiPermission } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { createPostSchema } from "@/schemas/post.schema";
import { postService } from "@/services/post.service";

export async function POST(request: Request) {
  try {
    await requireApiPermission(request, "post:create"); // BẮT BUỘC — proxy không bảo vệ /api
    const body = await parseJsonBody(request, createPostSchema);
    return apiOk({ post: await postService.create(body) }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/posts", request });
  }
}
```

`handleApiError` tự ánh xạ lỗi có kiểu ở tầng service sang status tương ứng
(`UserAlreadyExistsError` → 409, `UserNotFoundError` → 404…), và nuốt mọi lỗi
lạ thành 500 mà không để lộ nội dung ra ngoài. Nhớ khai endpoint mới trong
`src/lib/openapi/registry.ts` — `registry.test.ts` so khớp hai chiều và sẽ đỏ.

---

## Việc còn để ngỏ

- **Error tracking** (Sentry/OpenTelemetry): điểm nối đã có sẵn trong
  `src/lib/observability.ts` (`logger.error()` tự đẩy sang `captureException`).
  Mã định danh request đã có (`src/lib/request-id.ts`, header `X-Request-Id`)
  nên chỉ còn việc cắm nhà cung cấp.
- **REST API cho sân/đặt sân/thanh toán** phục vụ mobile — web đã có, API chưa.
- **Form chưa chạy khi tắt JavaScript.** Next 16 không nhúng `$ACTION_ID` cho
  form dùng `useActionState`, nên submit cần JS. Không ảnh hưởng người dùng
  bình thường.
