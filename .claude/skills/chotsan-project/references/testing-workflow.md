# Kiểm thử và quy trình làm một việc

## 1. Thang kiểm tra — chạm vào gì thì chạy gì

| Thay đổi chạm vào                                                                                  | Bắt buộc                                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bất kỳ mã nào                                                                                      | `pnpm check` = `typecheck` → `lint` → `format:check` → **`test:coverage`** (dừng ở bước hỏng đầu). Chưa xanh thì chưa xong.                         |
| `src/services/**`, `src/lib/api/**`                                                                | Ngưỡng coverage đã nằm TRONG `pnpm check` (cùng lệnh với CI) — tụt ngưỡng là đỏ ngay ở máy.                                                         |
| Form, Server Action, route, redirect, proxy/CSP, `next.config.mjs`, luồng đăng nhập/đặt/thanh toán | Thêm/sửa bài e2e rồi `pnpm test:e2e` (hoặc một spec). Lớp DUY NHẤT thấy lỗi tên trường form ↔ schema.                                               |
| Ràng buộc DB, transaction, tiền, giữ chỗ, migration                                                | `pnpm db:check-conflict` (thao tác đồng thời THẬT trên DB thật). Không nằm trong `pnpm check` — CI có chạy (job `validate`), máy dev phải nhớ chạy. |
| `prisma/schema.prisma`                                                                             | Quy trình migration (`data-model.md`) → `pnpm db:generate` → `db:check-conflict` → **khởi động lại `pnpm dev`**                                     |
| Route mới trong `src/app/api/v1/**`                                                                | Khai trong OpenAPI registry — `registry.test.ts` so khớp hai chiều với `route.ts` trên đĩa                                                          |
| Job nền mới                                                                                        | Đăng ký cả loại job lẫn handler — `src/jobs/handlers.test.ts` bắt thiếu; job theo lịch thêm vào `src/jobs/schedules.ts` (`schedules.test.ts`)       |
| Giao diện                                                                                          | Chụp màn hình thật ở 390px và 1280px, kiểm `document.documentElement.scrollWidth` ≤ bề ngang, XEM ảnh chụp                                          |
| Lỗi người dùng báo                                                                                 | Tái hiện trên chính môi trường của họ (mục 6) trước khi kết luận                                                                                    |

Lệnh lẻ:

```bash
pnpm test src/services/booking.service.test.ts   # một tệp (lọc theo chuỗi đường dẫn: `pnpm test booking` chạy mọi tệp có "booking")
pnpm test -t "chỗ giữ quá hạn"                   # theo tên bài (dùng `-t` trực tiếp; `pnpm test -- -t` trong CLAUDE.md chưa chắc chạy đúng)
pnpm test --project node                         # hoặc --project dom
pnpm test:e2e e2e/combined-checkout.spec.ts      # một spec e2e; `-g "Đăng xuất"` theo tên; `pnpm test:e2e:ui` giao diện
pnpm exec playwright show-trace test-results/<…>/trace.zip   # trace chỉ giữ khi hỏng
pnpm exec prettier --write <tệp>                  # format:check đỏ thì format đúng tệp đó
```

---

## 2. Cấu hình

**Vitest 4** (`vitest.config.ts`) — hai project:

| Project | Môi trường | Tệp                                                                   |
| ------- | ---------- | --------------------------------------------------------------------- |
| `node`  | node       | `src/**/*.test.ts`, `realtime/**/*.test.ts`, `worker/**/*.test.ts`    |
| `dom`   | jsdom      | `src/**/*.test.tsx` (setup `vitest.setup.ts`: jest-dom + `cleanup()`) |

- Alias `@` → `src`, `server-only` → `test/stubs/server-only.ts` (stub chỉ ở Vitest, esbuild của
  worker/realtime, `tsconfig.scripts.json` — KHÔNG đưa vào `tsconfig.json` gốc).
- Không bật `globals`: mọi tệp tự `import { describe, it, expect, vi } from "vitest"`.
- `test.env` tự bơm `NODE_ENV=test`, `DATABASE_URL` giả (không kết nối), `SESSION_SECRET`,
  `ENCRYPTION_KEY`, `APP_URL=http://localhost:3000`, `PHONE_VERIFICATION_ENABLED=1`. Không cần
  Postgres/Redis. Đừng export `REDIS_URL`/`QUEUE_ENABLED` trong shell khi chạy test (lọt vào test).
- Coverage v8, ngưỡng theo vùng: `src/services/**` 70/55/70/70, `src/lib/api/**` 80/85/80/80
  (statements/branches/functions/lines). Ý nghĩa "không được tụt" — **đừng hạ ngưỡng để CI xanh**.

**ESLint** (`recommendedTypeChecked`): `no-floating-promises`, `no-misused-promises`,
`consistent-type-imports` (inline), `no-unused-vars` bỏ qua tên bắt đầu `_`. Tệp test tắt
`unbound-method` và `no-unsafe-assignment` nhưng VẪN bật `no-unsafe-member-access/call/argument/return`.
**tsconfig**: `strict`, `noUncheckedIndexedAccess` (dùng `!` sau chỉ số), `noUnusedLocals/Parameters`,
`verbatimModuleSyntax`; typecheck gồm cả test, `e2e/`, `scripts/`.

**Playwright** (`playwright.config.ts`):

| Cấu hình              | Giá trị và lý do                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Máy chủ               | `pnpm build && pnpm start` (standalone) ở cổng **3100**, chờ `/api/health`, 180s — bản PRODUCTION: CSP và React Refresh khác dev                                                                     |
| `reuseExistingServer` | **`false` ở mọi nơi** — trước đây bật ở máy cá nhân nên chạy nhầm bản build cũ. Cổng 3100 bị chiếm thì Playwright báo lỗi ngay: dừng tiến trình cũ (`lsof -nP -iTCP:3100 -sTCP:LISTEN`) rồi chạy lại |
| `webServer.env`       | `PORT`, `NODE_ENV=production`, **`QUEUE_ENABLED=0`** (thắng `.env`) — job chạy ngay trong request, không cần Redis/worker; production bật cờ mà thiếu `REDIS_URL` thì `enqueue()` ném                |
| `workers: 1`          | Rate limit đăng nhập theo IP (5 lần/5 phút, reset khi đúng); mọi bài từ 127.0.0.1                                                                                                                    |
| `timeout` / `expect`  | 60s / 15s (Server Action lần đầu 6–10s). Bài dài tự `test.setTimeout(120_000)`                                                                                                                       |
| Khác                  | chỉ chromium; `trace: retain-on-failure`, `screenshot: only-on-failure` (ra `test-results/`); CI: `retries 1`, `forbidOnly`, reporter `github` + `list` + **`html`** (`playwright-report/`)          |
| Database              | Nạp `.env` → DB DEV DÙNG CHUNG, không reset, e2e ghi dồn dữ liệu (user `e2e-*@example.com`, lượt đặt). Cần `pnpm db:seed` trước                                                                      |

**CI** (`.github/workflows/ci.yml`, push/PR vào `main`/`master`/`dev`):

| Job        | Làm gì                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate` | **Postgres 17** service (cùng major với Neon) → `pnpm install --frozen-lockfile` → `db:generate` → `db:deploy` → **`pnpm check`** (đúng lệnh máy dev) → **`db:check-conflict`** → `build`                                                                                                           |
| `e2e`      | Postgres 17 + **mailpit** (SMTP giả cổng 1025) → env `APP_URL`/`NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100`, **`QUEUE_ENABLED=0`**, `SMTP_*` → `playwright install --with-deps chromium` → `db:deploy` → `db:seed` → `test:e2e` (khi hỏng upload `playwright-report/` + `test-results/`, giữ 7 ngày) |
| `audit`    | `pnpm audit --prod --audit-level high` — **ĐỎ** khi có lỗ hổng high trở lên (bản cũ `\|\| true` để lọt Next RCE critical)                                                                                                                                                                           |
| `docker`   | Build **3 image** `runner`, `realtime`, `worker`. Chạy thử web (poll `/api/health`, mã khác `000` là đạt); realtime `/health` qua `docker exec` phải 200; worker trỏ Redis không tồn tại phải **503** (không treo) và log không có `Cannot find module`                                             |

Không có mail thật mà production thiếu SMTP thì mailer ném — CI không nới chốt đó, mà cho mailpit để luồng gửi
thư chạy thật đầu-cuối.

**Git hook** (husky 9, `prepare: husky || true`):

- `pre-commit`: `pnpm exec lint-staged` — chỉ tệp đang commit: `*.{js,jsx,mjs,cjs,ts,tsx}` → `eslint --fix
--no-warn-ignored` + `prettier --write`; `*.{json,css,md,yml,yaml}` → `prettier --write`.
- `pre-push`: `pnpm typecheck && pnpm test` (~10 giây). Coverage, e2e, build để CI lo.
- Gate đầy đủ vẫn là `pnpm check`. Bỏ qua hook khi thật cần: `--no-verify`.

---

## 3. Unit test — khuôn mẫu của dự án

Hiện có **103 tệp test / 1216 bài** (`pnpm check` 17/09/2026; trước đợt sửa là 615). Test nằm CẠNH mã (`x.service.ts` ↔ `x.service.test.ts`).
Service nhận `db` (và service phụ thuộc) qua constructor → test truyền mock, không `vi.mock` Prisma,
không chạm DB/Redis thật (ngoại lệ có chủ đích: `realtime/server.test.ts` dựng Socket.IO thật ở cổng
34567). Crypto dùng thật (argon2, AES-GCM, otpauth, `signSession`).

**Đặt tên và chú thích**

- `describe("tênHàm — mô tả tiếng Việt")`, vd `"approveManual — chủ sân duyệt"`.
- `it(...)` là một câu tiếng Việt nói HÀNH VI, viết HOA chữ mấu chốt, hay kèm "— vì sao":
  `"KHÔNG thử lại khi trùng khung giờ — thử lại chỉ tốn thêm một lần ghi hụt"`.
- Đầu tệp: khối `/** */` nói loại lỗi đắt nhất ở tầng đó + ngày mốc dùng xuyên suốt (2026-09-04,
  thứ Sáu, giờ VN). Trong bài: `//` nói HẬU QUẢ nếu bài đỏ; lỗi có thật ghi "Lỗi thật trước đây: …".
- Fixture viết HOA (`NOW`, `BOOKING`, `VN_MIDNIGHT`). Thời gian luôn TIÊM vào (`now`), không đọc đồng hồ.
- `beforeEach(() => vi.clearAllMocks())`; store dùng chung dọn bằng `__clearCache()`, `__clearRateLimits()`.

**Khuôn mock Prisma** (xem `booking.service.test.ts`, `payment.service.test.ts`):

```ts
type Options = { booking?: Partial<typeof BOOKING> | null; createErrors?: (Error | null)[] };

function createDb(options: Options = {}) {
  let call = 0;
  const db = {
    booking: {
      // `"booking" in options` thay vì `??`: test cần truyền `null` tường minh
      findUnique: vi.fn().mockResolvedValue("booking" in options ? options.booking : BOOKING),
      // vi.fn CÓ KIỂU tham số → đọc mock.calls[0]![0].data mà lint không kêu "unsafe any"
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const error = options.createErrors?.[call++];
        return error ? Promise.reject(error) : Promise.resolve({ ...BOOKING, ...data });
      }),
      updateMany: vi.fn(
        (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) =>
          Promise.resolve({ count: 1 }),
      ),
    },
    // tx CHÍNH LÀ db mock → mọi lời gọi trong transaction vẫn đếm được
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(db))),
  };
  return { db: db as unknown as PrismaClient, mock: db };
}
```

Biến thể: `$transaction` nhận cả mảng (`typeof arg === "function" ? fn(db) : Promise.all(arg)`,
`court.service.test.ts`); callback nhận `createTx()` riêng để phân biệt trong/ngoài transaction
(`user.service.test.ts`); service phụ thuộc truyền bản giả (`createAvailability() as unknown as AvailabilityService`)
hoặc `vi.spyOn(service, "permissionsFor")`.

**Giả lỗi database**

```ts
function uniqueViolation(field: string): Error {
  // P2002
  return Object.assign(new Error(`Unique constraint failed on the fields: (\`${field}\`)`), {
    code: "P2002",
    meta: { target: [field] },
  });
}
function exclusionViolation(): Error {
  // 23P01 — KHÔNG có mã P2xxx
  return new Error(
    'ERROR: conflicting key value violates exclusion constraint "bookings_khong_trung_khung_gio" (code: 23P01)',
  );
}
```

Hình dạng THẬT của Prisma 7 (`meta.driverAdapterError.cause.{originalCode, originalMessage, constraint}`,
không có `meta.target`) giữ ở `src/lib/prisma-errors.test.ts` — bắt buộc dùng khi test chính
`isUniqueViolation`/`isExclusionViolation`. Luôn có thêm ca "lỗi lạ ném lên nguyên vẹn, không thử lại".

**Luật khi viết test**

- **Thao tác theo sân phải có ca "id của sân khác → NOT_FOUND và không ghi gì"**, chọn một trong hai:
  (A) mock `findMany`/`findFirst` LỌC THẬT theo `where` (vd `booking.venueId`); (B) khẳng định `where`
  chứa `venueId`. Chỉ ép mock trả `null` là KHÔNG đủ. Nếu service so `venueId` sau `findUnique`
  (vd `booking.checkIn`, `court.update`) thì mock tĩnh vẫn có nghĩa.
- Tiền và trạng thái: kiểm cả thứ KHÔNG được gọi, thứ tự gọi (`mock.x.mock.invocationCallOrder`),
  số lần `$transaction`.
- Action/route: `vi.mock("@/lib/auth")`, `vi.mock("next/cache")`, `vi.mock("next/headers")`; mock service
  bằng `importOriginal` để giữ lớp lỗi thật cho `instanceof`; luôn khẳng định **thân action không
  chạy** khi bị chặn và khẳng định đối số thật truyền xuống service.
- Module đọc env lúc import: `vi.stubEnv(...)` + `vi.resetModules()` + `await import(...)`; dọn bằng
  `vi.unstubAllEnvs()`. Sửa `process.env` giữa chừng là "xanh vì lý do sai".
- Component client phức tạp: tách logic thành hàm thuần export rồi test hàm (`slot-grid.test.tsx`);
  ĐỪNG import component kéo Server Action (vd `select-and-book.tsx`) — kéo theo Prisma. Form thì
  test bằng Testing Library theo label/role (`auth-form.test.tsx`).
- Luôn `await expect(...).rejects/resolves`. Tham số không dùng đặt tiền tố `_`. Object thiếu trường ép `as never`.

**Chưa có test**: service `health`/`sport`. (Đã có: `auth.service.test.ts`, `define-action.test.ts` phủ cả
`defineVenueAction`/`definePublicAction`, `audit`/`device`/`notification`/`role`/`security-stamp`,
`worker/worker.test.ts`, `src/jobs/schedules.test.ts`, `realtime/server.test.ts`.)

---

## 4. E2E — luật và danh sách bài

Tài khoản mẫu (`e2e/helpers.ts`, `PASSWORD = "matkhau123"`, khớp `prisma/seeds/seed-dev.ts`):

| `ACCOUNTS.*` | Email                | Vai trò                          | Đích sau đăng nhập |
| ------------ | -------------------- | -------------------------------- | ------------------ |
| `admin`      | `admin@dev.local`    | Quản trị nền tảng (ADMIN)        | `/venue-approvals` |
| `owner`      | `chusan@dev.local`   | Chủ 3 cơ sở mẫu                  | `/manage`          |
| `staff`      | `nhanvien@dev.local` | Nhân viên (có `payment:confirm`) | `/manage`          |
| `customer`   | `user@dev.local`     | Khách                            | `/`                |

Helper: `login(page, email)` (điền `identifier`/`password`, chờ rời `/login`), `openFirstVenue(page)`
(lấy `a[href^="/manage/"]` đầu tiên, trả `venueId` — nếu cần đúng sân thì lọc theo tên như `combined-checkout`).

Luật:

- **Chờ theo điều kiện, không theo đồng hồ** (`waitForURL`, `toBeVisible`, `toHaveCount`, `expect.poll`).
  Đăng xuất thì chờ link "Đăng nhập" hiện (URL `/` đã khớp sẵn).
- Selector: role + name (`exact` hoặc regex neo đầu) → label → `data-*`/ARIA → `name=` của form.
  Ô trống: `button[data-minute][aria-pressed="false"]:not([disabled])`; `table tbody tr` = từng sân con.
  Strict mode: `.filter({ hasText })`, `.first()` khi hỏi "có thấy không", `{ exact: true }` khi câu mô
  tả cũng chứa cụm đó (`getByText` khớp chuỗi con).
- **Kiểm ĐÍCH ĐẾN + NỘI DUNG**, không dừng ở HTTP 200 hay "có header" (bài đăng ký từng xanh giả trên
  trang 404 có header). Tài nguyên cấm kỳ vọng **404**.
- DB dùng chung: dữ liệu mới duy nhất theo lần chạy (`e2e-${Date.now()}@example.com`); bài chịu được
  cả rỗng lẫn có dữ liệu (kiểm theo nhánh, nhánh rỗng cũng phải khẳng định); cần ô trống chắc chắn thì
  đặt cho **ngày mai** giờ VN: `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() + 86_400_000))`.
- Nhiều vai: mỗi vai một `browser.newContext()`, đóng trong `finally`; không `clearCookies` rồi đăng nhập lại cùng trang.
- Không `test.only`, không tăng `workers`, bản production không có nút đăng nhập nhanh.
- Log `[WebServer] ⨯ Error: The destination stream closed early` là nhiễu (GOTCHAS #17). Đừng grep chữ
  `Error` để biết kết quả — đọc `test-results/.last-run.json` (`status`, `failedTests`).

Danh sách (42 bài):

| Spec                        | Bài | Kiểm                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.spec.ts`              | 8   | Đăng nhập nhanh vắng mặt ở production (HTML + endpoint 404); đăng nhập email → đích; sai mật khẩu hiện alert; chưa đăng nhập → `/login?next=`; đăng ký giữ họ tên và về `?next=`; quên mật khẩu luôn cùng thông điệp; `/reset-password` thiếu token                                                                           |
| `permissions.spec.ts`       | 15  | Trang công khai 200; khu cần đăng nhập → `/login`; đích theo 4 vai; `?next=` thắng; đăng xuất xoá cookie; khách không thấy "Quản lý sân", khu quản trị 404; nhân viên vào lịch nhưng `/staff` 404; admin thấy duyệt cơ sở + hoá đơn, không vào `/manage/<id>/settings`                                                        |
| `guest-booking.spec.ts`     | 10  | Trang chủ + tìm; lọc môn giữ trên URL; lưới đủ sân (sân tắt không hiện); ảnh tải được; chưa đăng nhập không hỏi tên/số; đặt → thanh toán QR; chọn ô → đăng nhập → giữ lựa chọn → đặt tiếp; đổi ngày không 404 và không mang ô cũ; mã không tồn tại 404; chưa đăng nhập mở màn thanh toán → `/login`, không lộ thông tin khách |
| `combined-checkout.spec.ts` | 1   | Hai sân → một màn thanh toán (1 QR, "CS <mã>") → khai chuyển khoản → chủ sân thấy MỘT thẻ 2 lượt → duyệt một lần → khách thấy "Đặt sân thành công"                                                                                                                                                                            |
| `venue-owner.spec.ts`       | 8   | Thấy 3 cơ sở; lịch sân kèm nút thao tác; hàng chờ tiền (theo nhánh); sân con bật/tắt; bảng giá sửa tại chỗ; bảng quyền KHÔNG có 3 quyền cấm; cài đặt cảnh báo tài khoản nhận tiền; doanh thu nói rõ "tiền đã chốt"                                                                                                            |

Điểm yếu cần kiểm lại khi sửa bài: bài dùng lưới HÔM NAY của `guest-booking` (chạy khuya giờ VN có thể không
còn ô trống); bài bảng quyền của `venue-owner` có nhánh `return` sớm (xanh giả tiềm ẩn); `newContext()` trong
`permissions` phải đóng trong `finally`.

---

## 5. `pnpm db:check-conflict` — chốt chặn trên database thật

`scripts/check-db-constraints.ts` dùng SERVICE THẬT trên `PrismaClient` + `PrismaPg` (nạp `.env`,
`tsconfig.scripts.json`). Tự tạo cơ sở `kiem-tra-<suffix>` (ACTIVE, 2 sân con, 60.000đ/khung, giờ
06:00–22:00, có tài khoản ngân hàng), đặt cho ngày mai, in `✓/✗` từng dòng. **Dọn trong `finally`**
(`cleanUp` theo thứ tự khoá ngoại: `review` → `paymentEvent` → `refund` → `payment` → `booking` →
`platformInvoice` → `venue`; cả cơ sở phụ của kịch bản 19–20 và user kiểm tra) — kịch bản ném giữa chừng
không còn để lại cơ sở `kiem-tra-*` mở bán; dọn hỏng thì in slug để xoá tay và exit 1. `process.exit` đặt SAU
`finally`. In "✅ ĐẠT" (exit 0) hoặc "❌ HỎNG" (exit 1). CI chạy trên Postgres 17 sạch (script không cần seed).

| #   | Kịch bản                                                                                                                                                                                                                                                                                       | Kỳ vọng                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0   | 18 tên trong `REQUIRED_CONSTRAINTS` (`pg_indexes` ∪ `pg_constraint` ∪ sequence `pg_class relkind='S'`): 14 ràng buộc viết tay + sequence `platform_invoice_number_seq` + `courts_id_venue_id_key` + khoá ngoại hai cột `bookings_court_id_venue_id_fkey`, `price_rules_court_id_venue_id_fkey` | Còn đủ                                                                                       |
| 1   | Hai `hold` ĐỒNG THỜI cùng khung                                                                                                                                                                                                                                                                | Thắng 1, thua 1 (`SlotTakenError`), DB 1 lượt sống                                           |
| 2   | Khung gối đầu                                                                                                                                                                                                                                                                                  | Bị chặn                                                                                      |
| 3   | Huỷ rồi đặt lại                                                                                                                                                                                                                                                                                | Đặt được; huỷ sớm thì `refundable`                                                           |
| 4   | `reschedule` gối lên chính nó                                                                                                                                                                                                                                                                  | Được                                                                                         |
| 5   | `expireHolds({ now: +60', venueId })` — CHỈ trong cơ sở kiểm tra                                                                                                                                                                                                                               | Nhả hết                                                                                      |
| 6   | Hai `start(BANK_TRANSFER)` đồng thời                                                                                                                                                                                                                                                           | Một giao dịch sống                                                                           |
| 7   | Đã khai rồi `start(VNPAY)`                                                                                                                                                                                                                                                                     | Không mở thêm giao dịch VNPay                                                                |
| 8   | `transferInstruction`                                                                                                                                                                                                                                                                          | Có QR, nội dung `CS <mã>`                                                                    |
| 9   | `approveManual`                                                                                                                                                                                                                                                                                | Lượt đặt CONFIRMED, hết hạn giữ chỗ                                                          |
| 10  | Webhook gửi lại cùng `externalEventId`                                                                                                                                                                                                                                                         | Lần 2 không xử lý                                                                            |
| 11  | Webhook báo lệch tiền                                                                                                                                                                                                                                                                          | KHÔNG ném; không xác nhận lượt, giao dịch FAILED kèm lý do, sự kiện đã ghi (một transaction) |
| 12  | `holdCheckout` hai sân                                                                                                                                                                                                                                                                         | Chung `checkoutCode` = mã lượt đầu                                                           |
| 13  | Hai `holdCheckout` đồng thời tranh chung một dãy                                                                                                                                                                                                                                               | Một bên thắng đủ 2 lượt, bên thua KHÔNG để lại nửa lần đặt                                   |
| 14  | Chỗ giữ bị sửa thành quá hạn, người sau đặt gối lên                                                                                                                                                                                                                                            | Đặt được, chỗ cũ EXPIRED                                                                     |
| 15  | Đã khai chuyển khoản                                                                                                                                                                                                                                                                           | Điều kiện cron (chỉ trên lượt đó) không khớp → không bị nhả                                  |
| 16  | Nhóm 2 lượt                                                                                                                                                                                                                                                                                    | QR = tổng, một lần duyệt, `venueId` sân khác → `PaymentNotFoundError`                        |
| 17  | Xin hoàn vượt số còn lại (trừ refund PENDING); hai `settleRefund` đồng thời                                                                                                                                                                                                                    | `RefundAmountError`; không cộng "đã hoàn" hai lần                                            |
| 18  | Cổng báo tiền về cho lượt đã HẾT HẠN                                                                                                                                                                                                                                                           | Ghi tiền (SUCCEEDED), không xác nhận lượt, có Refund PENDING                                 |
| 19  | Lượt đặt mang `venue_id` của cơ sở KHÁC với sân con (ghi thẳng)                                                                                                                                                                                                                                | Khoá ngoại hai cột chặn trong database                                                       |
| 20  | Năm lần đăng ký cơ sở CÙNG LÚC của một người                                                                                                                                                                                                                                                   | Đúng 3 hồ sơ chờ duyệt (trần giữ được nhờ khoá dòng)                                         |
| 21  | Hai đánh giá CÙNG LÚC cho một cơ sở                                                                                                                                                                                                                                                            | Đếm đủ 2, trung bình 3.5 (khoá `FOR NO KEY UPDATE`)                                          |

Tổng 22 kịch bản (0–21). Khi thêm ràng buộc viết tay / sequence (thêm tên vào `REQUIRED_CONSTRAINTS`) hoặc
luồng chạy đua/tiền mới: viết kịch bản chạy đồng thời thật (`Promise.allSettled`), báo bằng
`report(nhãn, điều_kiện, chi_tiết)`, KHÔNG gọi thao tác toàn cục (database dev đang có người dùng), dữ liệu phải
nằm trong phạm vi `cleanUp` (cơ sở phụ đẩy vào `extraVenueIds`). Không bao giờ trỏ script vào production.

---

## 6. Làm việc trên môi trường dev của người dùng

- Người dùng tự chạy `pnpm dev` trong terminal của họ, mở bằng **`http://192.168.1.119:3000`** (cả
  trên điện thoại). Lỗi họ báo thường kèm log terminal — đọc dòng `POST … in Xms` và stack trace
  trước khi đoán.
- **Chỉ dùng `pnpm`** (không `npm`). Thiếu `node_modules` → `pnpm install`.
- Đổi `schema.prisma` hoặc `next.config.mjs` → server đang chạy PHẢI khởi động lại. Kiểm bằng
  `ps -eo pid,lstart,command | grep "next dev"` so với giờ sinh Prisma Client. Nếu tự khởi động lại
  hộ: dừng tiến trình cũ, chạy tách rời
  `( nohup python3 -c 'import os,sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' pnpm dev > .next/dev-server.log 2>&1 < /dev/null & )`,
  rồi nói rõ log ở `.next/dev-server.log` và cách lấy lại vào terminal của họ (`pkill -f "next dev"` rồi `pnpm dev`).
- Đăng nhập nhanh ở dev: `/login` có 4 nút Quản trị / Chủ sân / Nhân viên / Khách (POST
  `/api/dev/quick-login`, 404 trên production).
- Kiểm bằng trình duyệt thật từ thư mục scratchpad: import Playwright bằng đường dẫn tuyệt đối
  `/Users/loipd/personal/sports_booking_v2/node_modules/@playwright/test/index.mjs`, `BASE =
"http://192.168.1.119:3000"`, bắt `pageerror`, chờ ảnh `complete && naturalWidth > 0`, chụp màn hình
  và XEM ảnh.
- Script DB một lần: tạm đặt `scripts/_tmp-*.ts`, bọc trong `async function main()` (tsx build CJS,
  không có top-level await), chạy
  `pnpm exec tsx --env-file-if-exists=.env --tsconfig tsconfig.scripts.json scripts/_tmp-x.ts`, xoá tệp
  sau khi xong. Dữ liệu thử tự tạo thì tự dọn — kiểm kỹ trước khi xoá (không có lượt đặt/tiền thật).
- `pnpm db:seed` chạy lại an toàn (`upsert` với `update: {}` hoặc "có rồi thì bỏ qua"). Admin thật từ
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` (thiếu thì bỏ qua); `NODE_ENV=production` bỏ toàn bộ dữ liệu mẫu.
- **Đã gỡ script** `db:migrate`, `db:migrate:create`, `db:push`, `db:reset` (xoá ràng buộc viết tay / reset
  Neon — GOTCHAS #11). Còn: `db:generate`, `db:migrate:diff` (in SQL — đọc, lọc DROP), `db:deploy`, `db:studio`,
  `db:seed`, `db:seed:prod`, `db:purge`, `db:check-conflict`. CLAUDE.md còn nhắc `pnpm db:migrate` — lệnh đó không
  còn.
- **Makefile** (`make help`): `setup` = `pnpm install` + tạo `.env` + `docker compose up -d postgres` +
  `db:deploy` + `db:seed`; có `e2e`, `check-conflict`, `worker`, `db-migrate-diff`, `db-deploy`, `db-seed-prod`;
  `vps-*` dùng `SERVICE ?= chotsan`. Không có target migrate dev / push / reset.

---

## 7. Kết thúc một việc

1. `pnpm check` xanh; `test:coverage` nếu chạm service/api; e2e / `db:check-conflict` nếu thuộc diện ở mục 1.
2. Cập nhật tài liệu: quyết định/màn mới → `docs/TIEN_DO.md`; bẫy mới có log thật → `docs/GOTCHAS.md`
   (đánh số tiếp); luật bắt buộc → `CLAUDE.md`; kiến thức nền → skill này.
3. Báo cáo cho người dùng **bằng tiếng Việt**: kết quả trước, nguyên nhân kèm bằng chứng (giờ, log,
   số liệu), việc HỌ phải làm nói rõ — việc nào tự làm được thì tự làm.
4. KHÔNG tự `git commit`/push khi người dùng chưa bảo. Họ tự commit (kiểu `feat(payment): …`).
