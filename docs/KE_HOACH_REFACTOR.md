# Kế hoạch viết lại sports_booking

> Viết ngày 2026-09-03, dựa trên audit thật của `../sports_booking`.
> **Phạm vi**: viết lại **toàn bộ** từ đầu — backend, giao diện web, và lớp mạng của app Flutter.
> Giữ lại: 114k dòng UI Flutter, hình dạng schema, hai ràng buộc database.
> Bản gốc không bị đụng tới cho tới Giai đoạn 8.
>
> Đi kèm: [THIET_KE_LAI.md](THIET_KE_LAI.md) (vai trò, bảng, màn hình) ·
> [design/chotsan-giao-dien.html](design/chotsan-giao-dien.html) (hệ thiết kế + màn mẫu).
> Tên sản phẩm: **ChốtSân**.

---

## 0. Chốt trước khi làm

### Bộ khung đích: `nextjs_base`

Backend viết lại từ đầu nên lập luận "giữ 18k dòng NestJS" không còn. Với dự án mới thì
`nextjs_base` thắng rõ:

- Vòng lặp dev **nhanh gấp 4** (typecheck 1,7s so với 6,9s) — nhân với 29 miền nghiệp vụ và
  nhiều tháng làm việc, đây là khác biệt lớn nhất
- **5 package.json** thay vì 13 — ít chỗ lệch phiên bản
- **Một deploy** thay vì ba
- Dashboard chủ sân là màn nhiều truy vấn nhất → Server Component gọi thẳng service, **không có
  chặng HTTP** (đo được: 1,25 ms so với 2,26 ms mỗi lần gọi)
- Trang sân công khai cần SEO → render sẵn HTML
- Có `worker/` cho cron, `realtime/` cho lịch sân cập nhật trực tiếp, `/api/v1` Bearer cho Flutter
- Ranh giới tầng đã được ép bằng ESLint (`no-restricted-imports` chặn Prisma ngoài `src/services/`)

### Giao diện dựng mới, không port bản cũ

Quyết định đổi so với bản kế hoạch đầu: **thiết kế lại toàn bộ giao diện** thay vì nâng cấp 40k
dòng UI Next 14. Hệ quả — mọi lập luận từng níu về `base_template` đều biến mất:

| Lập luận cho base_template         | Còn không                                   |
| ---------------------------------- | ------------------------------------------- |
| Giữ 18.185 dòng NestJS đã viết     | Không — viết lại backend từ đầu             |
| Tránh nâng cấp 40k dòng UI Next 14 | Không — thiết kế lại giao diện              |
| API phục vụ client bên ngoài       | Không — Flutter là app của chính mình       |
| Job nặng cần máy riêng             | Không — hai cron rất nhẹ, `worker/` lo được |

Và bộ thiết kế mới chạy trên **Tailwind 4 / React 19 / Next 16** — đúng stack gốc của nextjs_base,
không phải stack phải nâng cấp lên.

Số màn giảm từ **78 xuống 36** (xem [THIET_KE_LAI.md](THIET_KE_LAI.md) §4), nên "dựng mới" không
đắt hơn "port cũ" nhiều như nghe tưởng.

### ⚠️ Điều nguy hiểm nhất của việc viết lại từ đầu

**Backend cũ là bản đặc tả duy nhất, và nó không có test nào.**

18.185 dòng xử lý tiền — chia hoa hồng, đối soát 3 cổng thanh toán, tính giá theo khung giờ,
chống trùng booking — chỉ tồn tại dưới dạng code. Không tài liệu nào mô tả đủ (`docs/STATUS.md`
còn ghi "11 module" trong khi thực tế có **29**).

Vì vậy luật xuyên suốt kế hoạch này:

> **Không viết một service mới nào từ trí nhớ.** Mỗi miền: đọc code cũ → viết test chốt hành vi
> → viết code mới cho test xanh. Bản cũ phải khởi động được suốt quá trình để đối chiếu.

---

## 1. Audit: giữ gì, bỏ gì

### Bắt buộc bê nguyên sang (đừng thiết kế lại)

| Thứ                                      | Ở đâu                                       | Vì sao                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `EXCLUDE USING gist` chống trùng booking | `prisma/migrations/000_init_extensions.sql` | Ràng buộc ở tầng **database**. Hai request đồng thời không thể cùng đặt một khung giờ, kể cả khi code sai. Thiết kế đúng, hiếm người làm. |
| `@@unique([provider, externalEventId])`  | `schema.prisma:649`                         | Idempotency thanh toán bằng ràng buộc DB, không bằng `if`. Cổng thanh toán **luôn** gửi lại webhook.                                      |
| 46 model Prisma                          | `schema.prisma`                             | UI web và Flutter đã dựng quanh hình dạng dữ liệu này. Đổi schema là đổi luôn 154k dòng UI.                                               |

### Có sẵn trong nextjs_base — đừng viết lại

Argon2id, refresh token rotation + phát hiện dùng lại, 2FA TOTP, passkey, OAuth, khoá tạm khi sai
mật khẩu, RBAC đa vai trò + `Role.level` + ngoại lệ theo từng người, rate limit, audit log, hàng
đợi, lưu trữ file. **Toàn bộ `modules/auth` cũ bỏ đi.**

### Hai lỗ hổng của bản cũ — thiết kế đúng ngay từ đầu, không phải vá sau

**🔴 Phân quyền theo sân chỉ được kiểm ở 2/29 service.**
Manager/Staff gắn với sân qua `VenueMember`, nhưng không có guard chung nào ép điều đó — 27
service đang không kiểm. Nhân viên sân A thao tác được lên sân B nếu tìm đúng endpoint.

**🔴 Cron chạy trong tiến trình API.**
`booking-expiry` (mỗi phút) và `reconcile-payments` (30 phút) nằm trong API. Chạy 2 instance là
huỷ booking hai lần, đối soát thanh toán hai lần.

Cả hai được giải trong Giai đoạn 2 và 6 dưới đây, **trước** khi viết nghiệp vụ.

---

## 2. Tám giai đoạn

### GĐ 1 — Khung + schema (3 ngày)

1. `cp -r nextjs_base/* sports_booking_v2/`, đổi tên gói, xoá trang demo, **giữ** bộ auth.
2. Viết **21 bảng** theo [THIET_KE_LAI.md](THIET_KE_LAI.md) §3 vào `prisma/schema.prisma`. Gộp với model auth của nextjs_base
   (`User`, `Role`, `UserPermission`, `RefreshToken`, `WebAuthnCredential`…) — bỏ model `User`
   cũ, giữ các model nghiệp vụ.
3. **Bê nguyên** `000_init_extensions.sql`: `btree_gist` + `EXCLUDE`.
4. `pnpm db:migrate` trên database rỗng, `pnpm db:seed`.
5. Seed **3** vai trò nền tảng: `USER` (0), `ADMIN` (50), `SUPER_ADMIN` (100). `OWNER`/`STAFF` là
   enum trên `VenueMember`, **không seed dòng nào** — xem [THIET_KE_LAI.md](THIET_KE_LAI.md) §2.

**Xong khi**: `pnpm check` xanh, `/api/health` trả `database: up`.

---

### GĐ 2 — Phân quyền theo sân, làm TRƯỚC mọi nghiệp vụ (3 ngày)

Đây là nền móng. Làm sau thì 29 miền phải sửa lại.

`permissionService` hiện trả lời _"có quyền `booking:update` không"_. Cần trả lời _"có quyền
`booking:update` **trên sân X** không"_:

```ts
// src/services/permission.service.ts
async canOnVenue(userId: string, permission: Permission, venueId: string): Promise<boolean>
```

Luật: quyền toàn cục **HOẶC** quyền từ `VenueMember` của đúng sân đó. `OWNER` có mọi quyền trên
sân mình sở hữu; `STAFF` có bộ mặc định cộng những quyền chủ sân tick thêm
(`VenueMember.permissions`), và `status = ACTIVE`. Ba quyền **không bao giờ tick được**:
`payout:manage`, `venue:delete`, `venue:transfer`.

Kèm hai lớp ép buộc:

```ts
// Server Action
export const updateBookingAction = defineVenueAction("booking:update", async (ctx, ...) => …)
// Route handler
const session = await requireVenuePermission(request, venueId, "booking:update");
```

Và một luật ESLint chặn `defineAction`/`requireApiPermission` **trần** trong các thư mục thuộc
nhóm venue-scoped — quên là không qua được CI, không phải "nhớ thì kiểm".

**Xong khi**: có test chứng minh STAFF sân A nhận 403 trên sân B, cho ≥5 endpoint đại diện.

---

### GĐ 3 — Dựng giao diện mới (15–20 ngày)

Theo [design/chotsan-giao-dien.html](design/chotsan-giao-dien.html). Thứ tự:

1. **Hệ thiết kế trước**: token màu/chữ/khoảng cách vào `globals.css` (`@theme` của Tailwind 4),
   rồi các thành phần dùng lại — nút, ô nhập, thẻ, **ô khung giờ 30 phút**, lưới sân × giờ.
2. **Lưới sân × giờ là thành phần đắt nhất**, dựng và test kỹ trước mọi màn khác: nó xuất hiện ở
   màn khách, màn chủ sân, máy tính bảng và điện thoại — mỗi khổ một cách bày khác nhau.
3. 36 màn theo nhóm: công khai (5) → xác thực (3) → đặt sân (3) → tài khoản (5) →
   quản lý sân (11) → quản trị (9).
4. **Giữ mock data tới hết giai đoạn này.** Mục tiêu là UI chạy được, chưa nối gì.

**Xong khi**: `pnpm build` xanh, mở được cả 36 màn ở ba khổ (1440 / 834 / 390), không lỗi hydration.

> Làm trước backend có chủ đích: UI chạy được là **danh sách đầy đủ những gì backend phải cung
> cấp**. Viết backend trước thì luôn thừa endpoint không ai gọi và thiếu endpoint UI cần.

### GĐ 4 — Viết lại nghiệp vụ theo miền (20–25 ngày)

Mỗi miền một chu trình cố định:

```
1. Đọc service cũ ở ../sports_booking/backend/src/modules/<tên>/
2. Viết test chốt hành vi (mock Prisma) — CHƯA có code mới
3. Viết src/services/<miền>/<tên>.service.ts cho test xanh
4. Viết route /api/v1/** + Server Action
5. pnpm check → commit. Một miền một commit.
```

Thứ tự — dễ trước để quen tay, tiền sau cùng:

| Đợt | Miền                                                                       | Ngày |
| --- | -------------------------------------------------------------------------- | ---- |
| 1   | sports, venues, courts, uploads, search                                    | 4    |
| 2   | pricing (giá theo khung giờ, ngày lễ, override, voucher)                   | 3    |
| 3   | **bookings** — quote → hold Redis 10' → create → cancel → reschedule       | 4    |
| 4   | **payments** — VNPay/MoMo/ZaloPay/SePay, HMAC, idempotency, `OwnerEarning` | 4    |
| 5   | invoices, revenue, subscriptions, affiliate, boost                         | 4    |
| 6   | reviews, notifications, staff, teams, vouchers                             | 3    |
| 7   | admin, fraud, monitor, weather, ai-*, app-version                          | 3    |

**Cắt nhỏ ba service khổng lồ của bản cũ** khi viết lại: `boost` 1.017 dòng, `invoices` 957,
`owner` 705. Chia theo hành vi thật, không theo số dòng.

**Test bắt buộc cho đợt 3 và 4** (không thương lượng):

- Hai request đồng thời cùng khung giờ → đúng một cái thắng (chạy song song thật)
- Webhook thanh toán gửi lại 3 lần → ghi nhận đúng một lần
- IPN không bao giờ tới → cron đối soát bắt được
- Chia hoa hồng đúng tỷ lệ tới từng đồng

---

### GĐ 5 — Nối UI web vào service thật (5–7 ngày)

Thay mock bằng dữ liệu thật, từng màn. Ưu tiên **Server Component gọi thẳng service** — đó là
lý do chọn nextjs_base:

```tsx
// Không fetch("/api/v1/venues") — cùng tiến trình, gọi thẳng
const { items, meta } = await venueService.list({ page, limit });
```

Chỉ dùng `/api/v1` cho phần chạy ở trình duyệt (react-query cho màn lọc/tìm kiếm động).

**Xong khi**: không còn file mock nào trong `src/`.

---

### GĐ 6 — Cron ra worker + realtime (3 ngày)

1. `booking-expiry` và `reconcile-payments` vào `worker/`. **Không** để trong tiến trình web.
2. **Khoá phân tán bằng Redis** quanh mỗi lượt chạy — worker cũng scale được, và ngày đó tới thì
   khoá đã có sẵn chứ không phải nhớ ra.
3. `realtime/`: đẩy trạng thái khung giờ khi có người đặt — hai người cùng xem một sân thấy ngay.
4. `/api/health` báo `worker` và `realtime` để chúng chết không im lặng.

**Xong khi**: 2 instance web + 1 worker, booking hết hạn bị huỷ **đúng một lần**.

---

### GĐ 7 — Nối Flutter (5 ngày)

114k dòng Dart giữ nguyên, chỉ thay lớp mạng.

1. Sinh OpenAPI từ `src/lib/openapi/registry.ts` → sinh client Dart.
   **Không viết tay model ở hai đầu** — lệch nhau là chuyện của thời gian.
2. Thay repository mock bằng client sinh tự động. Riverpod + dio + freezed giữ nguyên.
3. Luồng token: login → lưu access + refresh → interceptor tự refresh khi 401.
   `sessionId` trả về là `familyId`, **ổn định qua mọi lần refresh** — lưu một lần là đủ.
4. Luồng 2FA: login có thể trả vé thay vì token, app phải rẽ nhánh sang màn nhập mã.

**Xong khi**: đặt được một sân từ app thật, thanh toán sandbox thành công.

---

### GĐ 8 — E2E và cắt chuyển (3 ngày)

1. Playwright cho 5 luồng chết người: đăng nhập → tìm sân → đặt → thanh toán → huỷ.
2. Chạy song song bản cũ và mới trên database sao chép, đối chiếu 20 request đại diện.
3. Sao lưu database production.
4. Đổi Caddy trỏ sang v2. **Giữ bản cũ chạy thêm 1 tuần** để lùi lại được.
5. Viết lại `docs/STATUS.md` cho đúng thực tế.

---

## 3. Tổng thời gian

| Giai đoạn              | Ngày                    |
| ---------------------- | ----------------------- |
| 1. Khung + schema      | 3                       |
| 2. Phân quyền theo sân | 3                       |
| 3. Dựng giao diện mới  | 15–20                   |
| 4. Viết lại nghiệp vụ  | 20–25                   |
| 5. Nối UI web          | 5–7                     |
| 6. Cron + realtime     | 3                       |
| 7. Nối Flutter         | 5                       |
| 8. E2E + cắt chuyển    | 3                       |
| **Tổng**               | **57–69 ngày làm việc** |

Làm một mình: **khoảng 12–14 tuần.**

Đắt hơn phương án giữ backend cũ (~4–6 tuần), nhưng đổi lại: codebase có test, hai lỗ hổng P0
được thiết kế đúng từ đầu, giao diện đúng ý, và vòng lặp dev nhanh gấp 4 cho toàn bộ vòng đời còn
lại của dự án.

---

## 4. Nguyên tắc xuyên suốt

1. **Không viết service mới từ trí nhớ.** Đọc code cũ → test → code mới. Bản cũ là đặc tả duy nhất.
2. **Bản cũ luôn khởi động được** cho tới hết GĐ 8. Nó là mốc đối chiếu duy nhất.
3. **Một miền một commit**, `pnpm check` trước khi commit.
4. **Dựng UI đúng theo bản thiết kế đã duyệt.** Muốn đổi thì sửa bản thiết kế trước, rồi mới sửa
   code — sửa thẳng vào code là hai nguồn sự thật, và bản thiết kế thành vô dụng sau một tuần.
5. **Không đụng `EXCLUDE` constraint và `@@unique([provider, externalEventId])`.**
6. **21 bảng theo [THIET_KE_LAI.md](THIET_KE_LAI.md) §3**, không phải 46 bảng cũ. Nhưng giữ
   nguyên hình dạng những bảng mà UI Flutter đã dựng quanh.

---

## 5. Rủi ro

| Rủi ro                                                    | Chặn bằng                                        |
| --------------------------------------------------------- | ------------------------------------------------ |
| Viết lại làm mất luật nghiệp vụ chỉ tồn tại trong code cũ | Nguyên tắc #1 — test viết từ code cũ trước       |
| Sai sót tiền bạc                                          | GĐ4 đợt 3–4 có test bắt buộc, không thương lượng |
| UI trôi khỏi bản thiết kế                                 | Nguyên tắc #4 + dựng hệ thiết kế trước, màn sau  |
| Phân quyền theo sân vá không kín                          | GĐ2 làm TRƯỚC nghiệp vụ + luật ESLint + test 403 |
| Cron chạy trùng sau khi scale                             | Khoá Redis ngay GĐ6, không đợi                   |
| Flutter lệch hợp đồng API                                 | Sinh client từ OpenAPI, không viết tay model     |

---

## 6. Nếu muốn cắt ngắn

Bỏ GĐ 4 đợt 7 (admin, fraud, monitor, weather, ai-*, app-version) sang sau khi chạy thật —
chúng không nằm trên đường tiền đi. Tiết kiệm 3 ngày và không chặn ngày ra mắt.

**Không được bỏ**: GĐ2 (phân quyền theo sân) và test của GĐ4 đợt 3–4.
