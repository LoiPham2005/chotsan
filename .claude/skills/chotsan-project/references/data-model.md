# Mô hình dữ liệu, ràng buộc và migration

Nguồn sự thật: `prisma/schema.prisma` (971 dòng) + `prisma/migrations/*/migration.sql`. Prisma 7:
`datasource` KHÔNG có `url` — `prisma.config.ts` cấp `DIRECT_DATABASE_URL ?? DATABASE_URL` cho CLI,
runtime dùng `DATABASE_URL` (pooler Neon) qua `@prisma/adapter-pg`. Extension bắt buộc: `pg_trgm`,
`btree_gist`.

**38 model, 20 enum**: 16 bảng xác thực/phân quyền thừa hưởng bộ khung + 22 bảng nghiệp vụ.
(CLAUDE.md và chú thích đầu `schema.prisma` còn ghi "21 bảng" — lỗi thời.)

(Cập nhật sau migration `20260917160000_integrity_invoice_numbering`, 17/09/2026.)

---

## 1. Quy ước

- Model/field **camelCase** trong Prisma, bảng/cột **snake_case** qua `@@map`/`@map`. Không còn ngoại lệ
  (`platform_invoices."createdAt"/"updatedAt"` đã RENAME thành `created_at`/`updated_at`).
- Id `String @id @default(cuid())`. Thời gian `DateTime @db.Timestamptz(3)`; cột chỉ-ngày `@db.Date`
  (lưu nửa đêm UTC của ngày VN).
- Tiền là `Int` (VNĐ, không số lẻ). Phần trăm `Decimal(5,2)` hoặc `Int`.
- Xoá mềm: `deletedAt @map("deleted_at")`. `Venue` và `Court` BẮT BUỘC xoá mềm (booking trỏ tới bằng
  `Restrict`). `User` xoá mềm qua `userService.softDelete()` (email đổi thành `deleted_<id>@deleted.invalid`).
- Unique trên cột có xoá mềm là **unique một phần viết tay** `WHERE deleted_at IS NULL` → tra user theo
  email phải dùng `findFirst`, không `findUnique`.
- Ràng buộc viết tay đặt tên `<bảng>_<mô_tả_không_dấu>` (vd `bookings_khong_trung_khung_gio`). Mã tham
  chiếu theo TÊN (`SLOT_CONFLICT_CONSTRAINT` trong `booking.service.ts`, `LIVE_PAYMENT_CONSTRAINT` trong
  `payment.service.ts`, `PERIOD_UNIQUE` trong `invoice.service.ts`, `REQUIRED_CONSTRAINTS` trong
  `scripts/check-db-constraints.ts`) → **không đổi tên**.
- Thư mục migration: `YYYYMMDDHHMMSS_<english_snake_name>` (các migration cũ tên tiếng Việt — giữ nguyên, đã áp).
- Luôn ghi rõ `onDelete` khi thêm quan hệ.
- **Sân con phải thuộc đúng cơ sở — DB ép bằng khoá ngoại HAI CỘT** `(court_id, venue_id) → courts(id, venue_id)`
  (đích là `courts_id_venue_id_key`, `@@unique([id, venueId])` trên `Court`). `court_id` NULL (= cả cơ sở) thì
  Postgres bỏ qua phép kiểm. Thêm bảng mới có cả `courtId` lẫn `venueId` → dùng cùng khuôn.

---

## 2. Bảng nghiệp vụ

| Model → bảng                            | Cột quan trọng                                                                                                                                                                                                                                                                                                                                                                                                                  | Quan hệ (onDelete)                                                                                                             | Index / ràng buộc                                                                                                                                                                                | Dùng chưa                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `Sport` → `sports`                      | `key` unique, `name`, `sortOrder`, `isActive`                                                                                                                                                                                                                                                                                                                                                                                   | venues/courts trỏ tới (Restrict)                                                                                               | —                                                                                                                                                                                                | có (7 môn seed: badminton, football, pickleball, tennis, basketball, volleyball, table-tennis) |
| `Venue` → `venues`                      | `slug` unique; `status` (mặc định DRAFT); `address`/`ward`/`province` (địa chỉ 2 cấp từ 01/07/2025); `inactiveNote` (lý do đóng/trả hồ sơ/khoá); `lat`/`lng`; `amenities[]`; `phone`; `bankName` (khoá của `BANK_BINS`)/`bankAccountNumber`/`bankAccountName` = tài khoản NHẬN TIỀN; `commissionRate Decimal(5,2)?`; `holdMinutes?`; `freeCancelHours?`; `cancelFeePercent?`; `ratingAvg`/`ratingCount` (dẫn xuất); `deletedAt` | sport Restrict; cascade sang images, hours, members, courts, priceRules, priceOverrides, reviews, favorites; vouchers Restrict | (status, province, ward), (sport_id, status), (lat, lng); GIN trigram `name`/`address`; CHECK phí huỷ 0–100                                                                                      | có                                                                                             |
| `VenueImage` → `venue_images`           | `url`, `storageKey?` (để xoá file thật), `isPrimary` (ảnh bìa), `sortOrder`                                                                                                                                                                                                                                                                                                                                                     | venue Cascade                                                                                                                  | (venue_id, sort_order); KHÔNG ràng buộc "một ảnh bìa"                                                                                                                                            | seed ghi; chưa có luồng tải ảnh                                                                |
| `VenueHour` → `venue_hours`             | `weekday` (0 = CN), `openMinute`, `closeMinute`, `isClosed`                                                                                                                                                                                                                                                                                                                                                                     | venue Cascade                                                                                                                  | unique (venue_id, weekday); CHECK đóng sau mở                                                                                                                                                    | có                                                                                             |
| `VenueMember` → `venue_members`         | `role` (`VenueRole`: OWNER/STAFF), `status` (INVITED/ACTIVE/DISABLED), `permissions[]` (quyền tick thêm), `invitedBy`                                                                                                                                                                                                                                                                                                           | venue, user Cascade                                                                                                            | unique (venue_id, user_id); unique một phần "một OWNER mỗi cơ sở"                                                                                                                                | có                                                                                             |
| `Court` → `courts`                      | `name`, `surface?` (`CourtSurface`, null = chưa khai), `isIndoor`, `note`, `isActive`, `sortOrder`, `deletedAt`                                                                                                                                                                                                                                                                                                                 | venue Cascade, sport Restrict                                                                                                  | (venue_id, sort_order); **unique (id, venue_id)** = `courts_id_venue_id_key` (đích khoá ngoại hai cột)                                                                                           | có                                                                                             |
| `CourtClosure` → `court_closures`       | `startAt`, `endAt`, `reason`, `createdBy`                                                                                                                                                                                                                                                                                                                                                                                       | court Cascade                                                                                                                  | (court_id, start_at); không CHECK; EXCLUDE bookings KHÔNG biết bảng này (chặn ở tầng ứng dụng bằng `FOR UPDATE OF c`)                                                                            | service có, chưa màn nào gọi                                                                   |
| `PriceRule` → `price_rules`             | `courtId?` (null = cả cơ sở), `weekdays[]` (rỗng = mọi ngày), `startMinute`/`endMinute`, `pricePerSlot` (VNĐ / khung 30'), `isPeak`, `priority`, `createdAt`                                                                                                                                                                                                                                                                    | venue Cascade; **court (court_id, venue_id) Cascade**                                                                          | (venue_id, priority); CHECK khung hợp lệ + giá ≥ 0; FK `price_rules_court_id_venue_id_fkey`                                                                                                      | có                                                                                             |
| `PriceOverride` → `price_overrides`     | `venueId`, `courtId?`, `date @db.Date`, start/end, giá, `isPeak`, `reason`, `createdAt`                                                                                                                                                                                                                                                                                                                                         | **venue Cascade** (FK mới); **court (court_id, venue_id) Cascade**                                                             | (venue_id, date); FK `price_overrides_venue_id_fkey`, `price_overrides_court_id_venue_id_fkey`                                                                                                   | service có, chưa màn nào gọi                                                                   |
| `Booking` → `bookings`                  | `code` unique (6 ký tự); `customerName`/`customerPhone`/`customerNote`; `startAt`/`endAt`; `slotCount`; `status` (mặc định HOLDING); `source` (WEB/MOBILE/COUNTER); `subtotal`/`discountTotal`/`total`; `holdExpiresAt?`; **`checkoutCode?`** (= mã lượt đầu của lần đặt nhiều lượt; null = đứng riêng); `checkedInAt`, `cancelledAt`/`cancelReason`/`cancelledBy`, `createdBy`                                                 | venue Restrict; **court (court_id, venue_id) Restrict, onUpdate Restrict**; user SetNull                                       | (venue_id, start_at), (court_id, start_at), (user_id, start_at), (status, hold_expires_at), (checkout_code); **EXCLUDE**; index một phần lịch sân; 2 CHECK; FK `bookings_court_id_venue_id_fkey` | có                                                                                             |
| `Payment` → `payments`                  | `provider`, `status`, `amount`, `merchantRef` unique, `requestId`/`providerTxnId`/`checkoutUrl`/`qrCodeUrl`/`deeplink`, `transferNote`, `expiresAt`, `refundedAmount`, `receivedBy` (mặc định **VENUE** — tiền đặt sân về thẳng sân; dòng cũ không sửa), `declaredAt`/`declaredNote`/`proofImageUrl`, `reviewedBy`/`reviewedAt`/`rejectReason`, `paidAt`/`failedAt`/`failReason`                                                | booking Restrict                                                                                                               | booking_id, (status, created_at), (provider, provider_txn_id), (status, expires_at), (status, declared_at); **unique một phần "một giao dịch sống"**; CHECK tiền                                 | có                                                                                             |
| `PaymentEvent` → `payment_events`       | `provider`, `externalEventId`, `payload`, `verified`, `processedAt`                                                                                                                                                                                                                                                                                                                                                             | payment? SetNull                                                                                                               | **unique (provider, external_event_id)**                                                                                                                                                         | service có, chưa có route webhook                                                              |
| `Refund` → `refunds`                    | `amount`, `reason`, `status`, `merchantRef` unique, `providerRefundId`, `requestedBy`/`approvedBy`, `refundedAt`                                                                                                                                                                                                                                                                                                                | payment Restrict                                                                                                               | payment_id, (status, created_at)                                                                                                                                                                 | webhook tạo khi tiền về cho lượt đã hết hạn/huỷ; chưa có UI                                    |
| `PlatformInvoice` → `platform_invoices` | `number` unique (**`CS-YYYYMM-000042`**, đuôi lấy từ SEQUENCE `platform_invoice_number_seq`); `periodStart`/`periodEnd`/`dueDate` (Date); `bookingCount`; `grossRevenue`; `commissionRate`; `commissionAmount`; `status` (`InvoiceStatus`); `paidAt`; `waivedBy`/`waiveReason`; `note`; `created_at`/`updated_at`                                                                                                               | venue Restrict                                                                                                                 | **unique (venue_id, period_start)** = `platform_invoices_venue_id_period_start_key`, (status, due_date)                                                                                          | có                                                                                             |
| `Review` → `reviews`                    | `rating` (CHECK 1–5), `comment`, `ownerReply`/`ownerRepliedAt`, `isHidden`                                                                                                                                                                                                                                                                                                                                                      | venue Cascade, booking unique Restrict, user Restrict                                                                          | (venue_id, is_hidden, created_at)                                                                                                                                                                | có                                                                                             |
| `Voucher`, `VoucherRedemption`          | mã giảm giá (`VoucherType` PERCENT/FIXED); `venueId?` (null = mã nền tảng)                                                                                                                                                                                                                                                                                                                                                      | **voucher → venue Restrict** (FK mới; KHÔNG SetNull — SetNull biến mã riêng thành mã mọi sân)                                  | code unique, unique booking_id                                                                                                                                                                   | **chưa dùng** (`discountTotal` luôn 0)                                                         |
| `OwnerEarning`, `Payout`                | chia tiền/chi trả (mô hình GIỮ HỘ tiền cũ, không dùng với dòng tiền hiện tại)                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                              | —                                                                                                                                                                                                | **chưa dùng**                                                                                  |
| `Favorite`, `Dispute`, `Setting`        | yêu thích; khiếu nại; cấu hình key-value                                                                                                                                                                                                                                                                                                                                                                                        | **dispute → user Restrict** (FK mới, như `Review.user`)                                                                        | —                                                                                                                                                                                                | **chưa dùng** (mặc định nền tảng — giữ chỗ 10', huỷ miễn phí 2h, phí 100% — nằm cứng trong mã) |

**Bảng xác thực/phân quyền** (chi tiết ở `auth-rbac.md`): `User`, `UserProfile`, `Role` (`level`,
`isSystem`), `Permission`, `RolePermission`, `UserRole`, `UserPermission` (`isGranted`, `expiresAt`),
`RecoveryCode`, `WebAuthnCredential`, `OAuthAccount`, `RefreshToken`, `VerificationToken`, `UserDevice`,
`Notification`, `NotificationRecipient`, `AuditLog` (`actorId` cố ý KHÔNG có FK). FK tới users đều
Cascade, trừ Booking (SetNull), Review và Dispute (Restrict).

**Enum nghiệp vụ**

| Enum                              | Giá trị                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VenueStatus`                     | DRAFT (mới tạo, và **hồ sơ bị trả** — kèm `inactiveNote`), PENDING (chờ duyệt), ACTIVE, SUSPENDED (chủ tự nghỉ), UNDER_MAINTENANCE, ADMIN_LOCKED (khoá vì vi phạm, chỉ admin gỡ — KHÔNG dùng khi từ chối hồ sơ nữa). Đồ thị chuyển ở `VenueService.setStatus` (`booking-payment.md` §10) |
| `VenueRole` / `VenueMemberStatus` | OWNER, STAFF / INVITED, ACTIVE, DISABLED                                                                                                                                                                                                                                                 |
| `CourtSurface`                    | NATURAL_GRASS, ARTIFICIAL_GRASS, WOOD, RUBBER, CONCRETE, CLAY, EPOXY (trong/ngoài nhà là cột `isIndoor` riêng)                                                                                                                                                                           |
| `BookingStatus`                   | HOLDING, CONFIRMED, CHECKED_IN, COMPLETED, CANCELLED, EXPIRED, NO_SHOW                                                                                                                                                                                                                   |
| `BookingSource`                   | WEB, MOBILE, COUNTER                                                                                                                                                                                                                                                                     |
| `PaymentProvider`                 | VNPAY, MOMO, ZALOPAY, SEPAY (tự động, qua webhook), BANK_TRANSFER (duyệt tay), CASH (chưa có luồng — KHÔNG duyệt qua hàng chờ)                                                                                                                                                           |
| `PaymentStatus`                   | PENDING, AWAITING_CONFIRMATION, SUCCEEDED, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED                                                                                                                                                                                               |
| `PaymentReceiver`                 | PLATFORM, VENUE (mặc định cột)                                                                                                                                                                                                                                                           |
| `RefundStatus`                    | PENDING, SUCCEEDED, FAILED                                                                                                                                                                                                                                                               |
| `InvoiceStatus`                   | DRAFT (không dùng), DUE, PAID, OVERDUE, WAIVED                                                                                                                                                                                                                                           |
| Chưa dùng                         | `VoucherType`, `EarningStatus`, `PayoutStatus`, `DisputeStatus`                                                                                                                                                                                                                          |
| Xác thực                          | `UserStatus` (ACTIVE/INACTIVE/BANNED), `Gender`, `VerificationTokenType`, `DevicePlatform`, `NotificationType`                                                                                                                                                                           |

---

## 3. Ràng buộc viết tay — KHÔNG ĐƯỢC MẤT

Prisma không biết chúng → `migrate diff --from-config-datasource`/`migrate dev` luôn đòi `DROP`. Kiểm còn đủ
bằng `pnpm db:check-conflict` (mảng `REQUIRED_CONSTRAINTS` trong `scripts/check-db-constraints.ts`, **18 tên**
— tra cả `pg_indexes`, `pg_constraint` và `pg_class relkind = 'S'` cho sequence).

| Tên                                                                                | Loại, bảng                               | Điều kiện                                                                                                                    | Chặn điều gì                                                                                                                                       | Migration                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `bookings_khong_trung_khung_gio`                                                   | EXCLUDE gist, bookings                   | `court_id WITH =`, `tstzrange(start_at, end_at, '[)') WITH &&`, `WHERE status IN (HOLDING, CONFIRMED, CHECKED_IN)`           | Hai người đặt cùng khung (khoảng nửa mở: lượt liền kề không bị chặn)                                                                               | `20260904041600_chong_trung_booking`                         |
| `payments_mot_giao_dich_song_cho_moi_booking`                                      | UNIQUE một phần, payments                | `booking_id WHERE status IN (PENDING, AWAITING_CONFIRMATION)`                                                                | Thu tiền hai lần (đã khai chuyển khoản rồi mở thêm VNPay)                                                                                          | `20260904120000_…` (thay bản chỉ-PENDING)                    |
| `venue_members_mot_chu_cho_moi_co_so`                                              | UNIQUE một phần                          | `venue_id WHERE role = 'OWNER'`                                                                                              | Cơ sở hai chủ                                                                                                                                      | `20260904140000_hoc_tu_ban_cu`                               |
| `venues_name_trgm_idx`, `venues_address_trgm_idx`                                  | GIN trigram                              | —                                                                                                                            | Tìm sân thành Seq Scan                                                                                                                             | `hoc_tu_ban_cu`                                              |
| `users_email_active_key`, `users_phone_active_key` (+ `users_username_active_key`) | UNIQUE một phần                          | `WHERE deleted_at IS NULL`                                                                                                   | Trùng email/SĐT giữa tài khoản còn sống                                                                                                            | `20260903000000_init`                                        |
| `reviews_diem_tu_1_den_5`                                                          | CHECK                                    | rating 1–5                                                                                                                   |                                                                                                                                                    | `hoc_tu_ban_cu`                                              |
| `bookings_khoang_thoi_gian_hop_le`                                                 | CHECK                                    | `end_at > start_at AND slot_count > 0`                                                                                       |                                                                                                                                                    | 〃                                                           |
| `bookings_tien_khong_am`                                                           | CHECK                                    | subtotal, discount_total, total ≥ 0                                                                                          |                                                                                                                                                    | 〃                                                           |
| `payments_tien_hop_le`                                                             | CHECK                                    | `amount > 0 AND 0 ≤ refunded_amount ≤ amount`                                                                                | (hệ quả: lượt 0đ không mở được giao dịch — service đã chặn trước)                                                                                  | 〃                                                           |
| `venue_hours_gio_dong_sau_gio_mo`                                                  | CHECK                                    | `is_closed OR close_minute > open_minute`                                                                                    |                                                                                                                                                    | 〃                                                           |
| `price_rules_khung_gio_hop_le`                                                     | CHECK                                    | `end_minute > start_minute AND price_per_slot ≥ 0`                                                                           |                                                                                                                                                    | 〃                                                           |
| `venues_phi_huy_tu_0_den_100`                                                      | CHECK                                    | `cancel_fee_percent` NULL hoặc 0–100                                                                                         |                                                                                                                                                    | 〃                                                           |
| **`platform_invoice_number_seq`**                                                  | SEQUENCE `AS BIGINT MINVALUE 1 NO CYCLE` | `InvoiceService` gọi `nextval()` trong transaction xuất từng hoá đơn; `setval` lúc tạo đẩy qua mọi số cũ có đuôi toàn chữ số | Số hoá đơn trùng (số cũ `<6 ký tự cuối venueId>` trùng giữa hai sân → hoá đơn sân thứ hai bị bỏ IM LẶNG). Mất sequence = mọi lần xuất hoá đơn hỏng | `20260917160000_integrity_invoice_numbering`                 |
| `bookings_lich_san_idx`                                                            | index một phần                           | (venue_id, start_at) các trạng thái còn trên lịch                                                                            | Tốc độ màn lịch sân                                                                                                                                | `chong_trung_booking` (chưa có trong `REQUIRED_CONSTRAINTS`) |

**Prisma quản lý nhưng là chốt nghiệp vụ** (có trong `schema.prisma` nên `migrate diff` không đòi xoá; ba cái
đầu nằm trong `REQUIRED_CONSTRAINTS`):

- `courts_id_venue_id_key` (`@@unique([id, venueId])`) + khoá ngoại hai cột `bookings_court_id_venue_id_fkey`
  (RESTRICT/RESTRICT), `price_rules_court_id_venue_id_fkey` (CASCADE), `price_overrides_court_id_venue_id_fkey`
  (CASCADE) — lượt đặt/luật giá/đè giá không trỏ được sân con của CƠ SỞ KHÁC. Không có chúng thì doanh thu, hoá
  đơn và hàng chờ duyệt tiền tính nhầm cơ sở.
- `payment_events (provider, external_event_id)` (webhook), `platform_invoices_venue_id_period_start_key`
  (hoá đơn — service so đúng tên này), `bookings.code`, `payments.merchant_ref`, `reviews.booking_id`.

⚠️ Ba index trigram của users (`users_email_trgm_idx`, `users_username_trgm_idx`,
`user_profiles_full_name_trgm_idx`) đã bị `migrate dev` xoá ở `20260904041510_chotsan_nghiep_vu` và
**chưa tạo lại** — tìm người dùng ở `/users` đang quét toàn bảng.

---

## 4. Quy trình migration — bắt buộc

Các script nguy hiểm **đã bị GỠ khỏi `package.json`**: `db:migrate` (`migrate dev` — xoá ràng buộc viết tay),
`db:migrate:create`, `db:push`, `db:reset` (reset cả Neon). Còn lại: `db:generate`, `db:migrate:diff`
(`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`), `db:deploy`,
`db:studio`, `db:seed`, `db:seed:prod`, `db:purge`, `db:check-conflict`. CLAUDE.md và vài tài liệu trong
`docs/` có thể còn nhắc `pnpm db:migrate` — lỗi thời, đừng làm theo.

```bash
# 1. Sửa prisma/schema.prisma (field camelCase + @map snake_case, ghi rõ onDelete)
# 2. Sinh SQL — KHÔNG áp. Hai cách:
mkdir -p prisma/migrations/<YYYYMMDDHHMMSS>_<english_snake_name>
#   a) So với DB đang nối (DB phải ở migration mới nhất):
pnpm db:migrate:diff > prisma/migrations/<…>/migration.sql
#   b) So schema-với-schema (không đụng DB, không sinh DROP trigram) — cách đã dùng cho integrity_invoice_numbering:
git show HEAD:prisma/schema.prisma > /tmp/schema-head.prisma
pnpm exec prisma migrate diff --from-schema /tmp/schema-head.prisma --to-schema prisma/schema.prisma --script \
  > prisma/migrations/<…>/migration.sql
# 3. ĐỌC tệp:
#    - Cách (a): xoá mọi DROP INDEX/DROP CONSTRAINT đụng ràng buộc viết tay (lần nào cũng có
#      DROP venues_name_trgm_idx / venues_address_trgm_idx).
#    - Đổi tên cột: thay DROP + ADD bằng ALTER TABLE … RENAME COLUMN (không mất dữ liệu; ADD cột NOT NULL
#      không mặc định còn hỏng ngay trên bảng có dữ liệu).
#    - Thêm khoá ngoại/unique mới: chạy câu kiểm dòng mồ côi/lệch TRƯỚC khi áp — một dòng vi phạm làm hỏng cả migration.
#    - Thứ tự: tạo index đích (vd courts_id_venue_id_key) TRƯỚC khi gỡ khoá ngoại cũ.
#    - Đầu tệp viết chú thích tiếng Việt "VÌ SAO" + ghi rõ những chỗ SỬA TAY.
# 4. Áp
pnpm db:deploy                          # = prisma migrate deploy (có thể dính advisory lock → thử lại)
pnpm db:generate
# 5. Kiểm: diff so với DB phải CHỈ còn các DROP trigram (tức DB khớp schema)
pnpm db:migrate:diff
pnpm db:check-conflict
# 6. Khởi động lại pnpm dev (và worker:dev) — Prisma Client cũ vẫn nằm trong bộ nhớ (GOTCHAS #18)
```

Ràng buộc/sequence viết tay mới → thêm vào `REQUIRED_CONSTRAINTS` của `scripts/check-db-constraints.ts` + bảng
GOTCHAS #11 + bảng §3 ở trên. Script đó dọn dữ liệu thử trong `finally`, có kịch bản đồng thời thật (17 hoàn tiền
đồng thời, 18 tiền về lượt hết hạn, 19 khoá ngoại lệch sân, 20 trần 3 hồ sơ đồng thời, 21 hai đánh giá đồng thời…);
CI chạy nó trên Postgres 17.

Ví dụ ràng buộc viết tay kèm migration:

```sql
-- VÌ SAO: <luật nghiệp vụ và hậu quả nếu thiếu>
-- ⚠️ migrate diff sinh kèm DROP INDEX venues_name_trgm_idx / venues_address_trgm_idx — đã bỏ.
ALTER TABLE "venues" ADD COLUMN "max_advance_days" INTEGER;
ALTER TABLE "venues" ADD CONSTRAINT "venues_so_ngay_dat_truoc_hop_le"
  CHECK ("max_advance_days" IS NULL OR "max_advance_days" BETWEEN 1 AND 365);
```

Lịch sử migration (14): `init` (auth + unique một phần users) → `search_index` (trigram users, sau
bị xoá) → `chotsan_nghiep_vu` (21 bảng nghiệp vụ) → `chong_trung_booking` (EXCLUDE) →
`mot_thanh_toan_cho_moi_booking` → `thanh_toan_day_du` (PaymentReceiver, BANK_TRANSFER, 18 cột
payments) → `mot_giao_dich_song_cho_moi_booking` → `hoc_tu_ban_cu` (học từ v1: trạng thái sân, địa chỉ,
chính sách huỷ, trigram venues, một chủ, 7 CHECK) → `bo_cot_chua_dung` → `dong_bo_ten_cot_snake_case`
(116 RENAME COLUMN) → `dong_bo_ten_rang_buoc` (16 FK + 33 index) → `hoa_don_hoa_hong` →
`20260917090000_booking_checkout_code` → **`20260917160000_integrity_invoice_numbering`**.

**`20260917160000_integrity_invoice_numbering`** (sinh schema-với-schema, sửa tay 3 chỗ):

1. `CREATE UNIQUE INDEX courts_id_venue_id_key ON courts(id, venue_id)` — tạo TRƯỚC khi gỡ khoá ngoại cũ.
2. Gỡ `price_overrides_court_id_fkey`, `bookings_court_id_fkey` (một cột); thêm khoá ngoại hai cột
   `bookings_court_id_venue_id_fkey` (ON DELETE RESTRICT ON UPDATE RESTRICT), `price_rules_court_id_venue_id_fkey`
   và `price_overrides_court_id_venue_id_fkey` (CASCADE/CASCADE).
3. Khoá ngoại còn thiếu: `price_overrides_venue_id_fkey` (CASCADE), `vouchers_venue_id_fkey` (RESTRICT),
   `disputes_user_id_fkey` (RESTRICT).
4. `payments.received_by SET DEFAULT 'VENUE'` (không sửa dòng cũ).
5. `platform_invoices RENAME COLUMN "createdAt" TO created_at`, `"updatedAt" TO updated_at` (thay DROP + ADD).
6. `CREATE SEQUENCE platform_invoice_number_seq AS BIGINT MINVALUE 1 NO CYCLE` + `setval` qua số cũ có đuôi
   toàn chữ số (viết tay — Prisma không biết sequence).

---

## 5. Seed

`pnpm db:seed` = `tsx prisma/seed.ts` — tự dựng `PrismaClient` + `PrismaPg` từ `DIRECT_DATABASE_URL ??
DATABASE_URL` (không dùng `src/lib/prisma.ts` vì `server-only`). Các bước ở `prisma/seeds/*.ts`. Thứ tự:
`seedRbac` → `seedSports` → `seedAdmin` (từ `ADMIN_EMAIL`/`ADMIN_PASSWORD`, thiếu thì bỏ qua) → (ngoài production)
`seedDev` → `seedVenues` → `seedVenueImages`. Chạy lại an toàn: `upsert … update: {}` hoặc "có rồi thì bỏ qua"
(theo slug; cơ sở đã có ảnh thì không thêm ảnh). `pnpm db:seed:prod` chỉ chạy RBAC, môn, admin.

- `seedRbac` đồng bộ danh mục quyền, nhưng **không thêm lại quyền mặc định đã bị gỡ**: chỉ gắn quyền mặc định cho
  vai trò VỪA tạo trong lần chạy, hoặc khoá quyền CHƯA TỪNG có trong DB; riêng vai trò `"*"` (SUPER_ADMIN) luôn
  được bù đủ.
- `seedSports` cập nhật tên + thứ tự, không đụng `isActive`.

| Tài khoản (`matkhau123`) | Vai trò                                       |
| ------------------------ | --------------------------------------------- |
| `admin@dev.local`        | ADMIN nền tảng                                |
| `chusan@dev.local`       | OWNER cả 3 cơ sở                              |
| `nhanvien@dev.local`     | STAFF cả 3 cơ sở, tick thêm `payment:confirm` |
| `user@dev.local`         | USER                                          |

(e2e dùng các tài khoản này qua `ACCOUNTS.{admin,owner,staff,customer}` trong `e2e/helpers.ts`.)

3 cơ sở mẫu — chung: ACTIVE; SĐT 0987654321; VCB 1234567890 NGUYEN VAN A; hoa hồng 8% (cơ sở tự đăng ký qua
`/manage/new` KHÔNG có hoa hồng); mở 05:30–23:00 cả tuần; **sân con cuối tắt sẵn**; luật giá: thường cả ngày
(priority 0), thứ 2–6 17:00–22:00 giờ vàng (priority 10), thứ 7–CN cả ngày giờ vàng (priority 5) — không luật nào
chồng cùng priority nên qua được kiểm của `setPriceRules`; 4 ảnh CC0 `/demo/venues/<môn>-{1..4}.jpg` (ảnh 1 là bìa).

| slug                  | Môn, địa chỉ                                         | Sân con          | Mặt sân          | Thường / vàng | Giữ chỗ | Huỷ miễn phí / phí trễ |
| --------------------- | ---------------------------------------------------- | ---------------- | ---------------- | ------------- | ------- | ---------------------- |
| `cau-long-thanh-cong` | Cầu lông, 168 Thái Hà, P. Láng Hạ, Hà Nội            | 10 (`Sân 1..10`) | WOOD, trong nhà  | 70k / 110k    | 10'     | 2h / 100%              |
| `san-bong-my-dinh`    | Bóng đá, Lô C2 Khu liên hợp, P. Mỹ Đình, Hà Nội      | 4 (`Sân A..D`)   | ARTIFICIAL_GRASS | 250k / 400k   | 15'     | 12h / 50%              |
| `pickleball-quan-7`   | Pickleball, 25 Nguyễn Lương Bằng, P. Tân Phú, TP.HCM | 6 (`Sân 1..6`)   | RUBBER           | 120k / 180k   | 10'     | 3h / 50%               |
