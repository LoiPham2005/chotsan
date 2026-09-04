---
name: nextjs-base
description: Kiến trúc, quy tắc bắt buộc và bẫy đã gặp của nextjs_base (một app Next.js 16 App Router duy nhất, Prisma 7, Zod 4, RBAC đa vai trò, 2FA, passkey, REST /api/v1 cho mobile). Đọc TRƯỚC khi sửa bất cứ thứ gì trong repo này — thêm route, Server Action, service, đụng vào schema, phân quyền, xác thực, hàng đợi, hoặc chạy test/deploy.
---

# nextjs_base

Bộ khung **một app Next.js duy nhất**: web (Server Component + Server Action, cookie session) và
REST API cho mobile (`/api/v1`, Bearer token) chạy cùng tiến trình, dùng chung một tầng service.
Thêm hai tiến trình phụ tuỳ chọn: `realtime/` (WebSocket) và `worker/` (job nền).

**Mọi chú thích, thông báo lỗi, tên test đều bằng TIẾNG VIỆT có dấu.** Viết tiếng Anh vào là lạc
lõng với phần còn lại của repo.

> Nếu API là sản phẩm phục vụ nhiều client bên ngoài (mobile của đối tác, tích hợp B2B) và cần
> scale/deploy độc lập với web, dùng `base_template`. Còn lại — kể cả dự án CÓ app mobile của chính
> mình — repo này nhanh hơn hẳn vì không có bước build package trung gian.

---

## 3 dòng phải nhớ trước tiên

1. **Route không bao giờ query Prisma.** Luồng luôn là route/action → `src/services/*.ts` → Prisma.
2. **Server Action là endpoint công khai.** Proxy chặn được người chưa đăng nhập ở đường vào TRANG,
   nhưng KHÔNG chặn được một USER gửi thẳng request tới action của ADMIN.
3. **Mọi đường ghi thẩm quyền phải gọi `permissionService.invalidateUser()`** — quyền được cache 60s.

---

## 1. Bố cục

```
src/app/(auth)/        đăng nhập, đăng ký, quên/đặt lại mật khẩu, xác thực email, đổi email
src/app/(admin)/       /users, /roles — có ranh giới quyền hạn thật
src/app/security/      người dùng tự bật 2FA, quản lý passkey
src/app/sessions/      thiết bị đang đăng nhập
src/app/api/v1/**      REST cho mobile — Bearer token
src/services/*.ts      TOÀN BỘ nghiệp vụ. Nơi DUY NHẤT gọi Prisma
src/schemas/*.ts       Zod schema dùng chung cho cả web lẫn API
src/lib/               hạ tầng: session, tickets, permissions, cache, queue, storage, mailer…
realtime/  worker/     hai tiến trình riêng, tuỳ chọn bằng biến môi trường
```

**Hai bề mặt, MỘT tầng nghiệp vụ.** `getApiSession()` đọc header `Authorization` trước, fallback
cookie — nên cùng logic phục vụ được cả web lẫn mobile. Không có nghiệp vụ nào chỉ tồn tại một phía.

**Server Component gọi THẲNG service**, không đi qua REST API của chính mình: cùng tiến trình, thêm
một vòng HTTP chỉ để tự gọi mình là lãng phí và còn phải tự chuyển tiếp cookie.

---

## 2. Thêm một tính năng: đi theo đúng thứ tự này

Ví dụ thực thể `Booking`:

1. `prisma/schema.prisma` — thêm model. `pnpm db:migrate`.
2. `src/schemas/booking.schema.ts` — Zod cho input/output.
3. `src/services/booking.service.ts` — nghiệp vụ. Mẫu bắt buộc:
   ```ts
   export class BookingService {
     constructor(private readonly db: PrismaClient = prisma) {}
   }
   export const bookingService = new BookingService();
   ```
   Tham số mặc định chứ không import cứng: nơi gọi không phải đổi gì, mà test vẫn tiêm được
   database giả thay vì mock cả module.
4. `src/app/api/v1/bookings/route.ts` (+ `[id]/route.ts`) cho mobile.
5. Server Action cho web — **bắt buộc** bọc `defineAction("booking:create", …)` hoặc
   `defineAuthedAction(…)` nếu là thao tác lên dữ liệu của chính người dùng.
6. `src/lib/permissions.ts` — thêm quyền vào danh mục, rồi `pnpm db:seed`.
7. `src/lib/openapi/registry.ts` — khai endpoint mới.

**Bỏ bước 6** → quyền không tồn tại trong database, mọi request 403.
**Bỏ bước 7** → `registry.test.ts` đỏ ngay (nó so khớp hai chiều thư mục route ↔ tài liệu).

---

## 3. Quy tắc BẮT BUỘC

### Kiểm quyền nhiều lớp, không lớp nào là đủ

```
Proxy (src/proxy.ts, KHÔNG chạy trên /api)  → chỉ chặn trang, thuần UX
Trang (requireUser/requirePermission)        → thuần UX
Server Action / route handler tự kiểm lại    → LỚP BẮT BUỘC
```

`(admin)/layout.tsx` **không phải ranh giới bảo mật** — Server Action không đi qua layout.

- Kiểm theo **QUYỀN**, không theo tên vai trò. `permissionService.can(userId, "user:read")`.
- `defineAction` biến kiểm quyền thành ràng buộc KIỂU: không khai quyền là không biên dịch được.
  Đừng quay lại lối `if (!session) return` thủ công — quên một chỗ thì không có gì báo.
- Sửa hồ sơ chính mình vs người khác: dùng `canActOnResource(actorId, ownerId, { any, own })`.
  **Riêng `roleKeys` LUÔN đòi `user:update`** kể cả khi sửa chính mình — nếu không thì mọi user tự
  phong ADMIN bằng một field trong body.

### Một người mang NHIỀU vai trò

Quyền = **hợp(mọi vai trò) + cấp riêng − tước riêng**. Cấm LUÔN thắng.

`Role.level` chặn leo thang: `assertCanActOn` từ chối khi mục tiêu có `level` ≥ level người thao
tác. Ngoại lệ theo từng người nằm ở `UserPermission` (có `expiresAt`) — đó là cách giải bài "cùng
vai trò nhưng admin cho một người thêm quyền", KHÔNG phải tạo vai trò mới cho một người.

### ⚠️ Cache quyền

`UserService` gọi `permissions.invalidateUser()` ở `create`, `update`, `setUserPermission`,
`clearUserPermission`, `softDelete`. `RoleService` gọi `invalidateAll()` ở mọi đường ghi.

Thêm đường ghi mới mà quên → chiều "cấp thêm" gây khó hiểu, chiều "tước bỏ" là **lỗ hổng thật**.
`user.service.test.ts` có 5 test khoá lại điều này.

### Token: mỗi loại chỉ dùng đúng một việc

`src/lib/session.ts` chỉ nhận `typ: "access"`. `src/lib/tickets.ts` giữ vé ngắn hạn: `2fa`,
`webauthn_reg`, `webauthn_auth`. Cả bốn ký bằng cùng `SESSION_SECRET`, nên chữ ký đúng không chứng
minh token dùng vào việc gì. Thiếu phép kiểm `typ` là 2FA bị bỏ qua sạch.

`sessionId` trả cho client là **`familyId`** — ổn định qua mọi lần refresh, khớp `GET /auth/sessions`.
Trả `id` của bản ghi token là bug: sau lần refresh đầu tiên client không nhận ra phiên của mình nữa.

### Mật khẩu và mã

- Mật khẩu: **Argon2id** (`@node-rs/argon2`). bcryptjs đã gỡ hẳn, đừng thêm lại.
- Mã ngắn (OTP, mã khôi phục): `hashScopedToken(scope, token)` — SHA-256 có tiền tố phạm vi.
- Bí mật TOTP mã hoá AES-256-GCM bằng `ENCRYPTION_KEY`. **Xoay khoá này là mọi bí mật 2FA thành
  rác** — khác `SESSION_SECRET` (xoay được, chỉ tốn việc đăng nhập lại).

### Prisma 7

- `schema.prisma` không còn `url`. Kết nối ở `prisma.config.ts` (CLI) và driver adapter trong
  `src/lib/prisma.ts` (runtime).
- Script ngoài Next (seed, `db:purge`) phải tự dựng `PrismaPg` — `new PrismaClient()` trần ném lỗi
  ngay lúc khởi tạo. Và không import được `src/lib/prisma.ts` vì file đó có `server-only`.
- Sau khi sửa schema: `pnpm db:generate` rồi tin `pnpm typecheck` qua terminal.

### OpenAPI: KHÔNG dùng zod-to-openapi

`src/lib/openapi/registry.ts` dựng tài liệu bằng `z.toJSONSchema()` có sẵn của Zod 4.
**Đừng thêm lại `@asteasolutions/zod-to-openapi`**: nó vá `.openapi()` vào prototype Zod bằng module
side-effect và đòi chạy TRƯỚC mọi schema — Turbopack không giữ thứ tự đó khi gom bundle production.
Hậu quả: `next dev` và `vitest` xanh, `next build` đổ với `t.openapi is not a function`.

### Giao diện

Đã chốt MỘT hệ: **Shadcn-style trong `src/components/ui/`**. Nút và ô nhập luôn dùng
`<Button>`/`<Input>`. Class CSS chỉ còn thứ thuần trình bày: `.card`, `.badge`, `.alert`,
`.container`, `.form-grid`. `.btn*`/`.input-field` đã bị xoá — hai hệ song song từng đẻ ra hai bug
thật (header trắng đè nền tối, nút chữ chàm trên nền chàm).

---

## 4. Lệnh hay dùng

```bash
pnpm dev                 # http://localhost:3000
pnpm check               # typecheck + lint + format + test. Chạy trước khi coi là xong việc
pnpm test src/services/auth.service.test.ts   # một file
pnpm db:migrate          # tạo + áp migration (dev)
pnpm db:seed             # đồng bộ danh mục quyền xuống database
pnpm test:e2e            # Playwright, cần database đã seed
pnpm worker:dev          # job nền — cần REDIS_URL
```

Cờ tiến trình chỉ nhận `1`/`0`, **không** nhận `true`/`false` (docker-compose dùng chính chúng làm
`deploy.replicas`, mà Compose chỉ hiểu số): `QUEUE_ENABLED`, `REALTIME_ENABLED`.

---

## 5. Bẫy đã gặp thật

| Triệu chứng                                             | Nguyên nhân                                              |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `next build` đổ mà `next dev`/`vitest` xanh             | zod-to-openapi vá prototype, Turbopack đảo thứ tự module |
| Cấp quyền xong gọi API vẫn 403                          | quên `permissionService.invalidateUser()`                |
| Sau refresh, màn "thiết bị" không đánh dấu máy hiện tại | trả `refresh.id` thay vì `familyId`                      |
| `PrismaClient was instantiated without any options`     | script ngoài Next thiếu driver adapter                   |
| Quyền mới luôn 403                                      | quên `pnpm db:seed`                                      |
| Type Prisma sai sau khi sửa schema                      | chưa `db:generate`, hoặc IDE cache trễ một nhịp          |

**Đừng dựng QR 2FA bằng dịch vụ online** (`api.qrserver.com`…): chuỗi `otpauth://` chứa chính bí
mật TOTP, nhét vào URL bên thứ ba là gửi thẳng yếu tố thứ hai cho họ. Vẽ bằng `qrcode` trong trình
duyệt — xem `src/app/security/two-factor-manager.tsx`.

**Đừng thêm `arctic`** cho OAuth — tác giả đã deprecate. OAuth tự viết bằng `fetch`/`jose`.

**Đừng dựng sẵn thư mục cho nhu cầu chưa tồn tại.** `src/hooks/`, `src/types/`, `src/features/` đều
đã bị từ chối. Trước khi tạo cấu trúc mới, tự hỏi: đã có ≥2 nơi cần dùng THẬT chưa?
