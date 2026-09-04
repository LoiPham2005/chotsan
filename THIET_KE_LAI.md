# sports_booking — Thiết kế lại: vai trò, bảng, màn hình

> Viết ngày 2026-09-04, dựa trên đọc thật `../sports_booking` (46 model, 78 trang, 18.185 dòng backend).
> Mục tiêu: cắt độ phức tạp xuống mức **một người làm được và nuôi được**.

---

## 1. Chẩn đoán — vì sao đang thấy quá phức tạp

| | Thiết kế gốc (`docs/FRONTEND.md`) | Đã dựng | Chênh |
|---|---|---|---|
| Màn hình | ~35 | **78** | **2,2×** |

Dự án phình gấp đôi so với **chính bản thiết kế của nó**. Đây không phải cảm giác — đây là số đo.

Ba nguồn phức tạp, theo đúng thứ tự nặng nhẹ:

### 1.1. Vai trò chồng chéo — `STAFF` nằm trong CẢ HAI enum

```
enum Role            { CUSTOMER, OWNER, STAFF, ADMIN, SUPER_ADMIN }   ← cấp nền tảng
enum VenueMemberRole { MANAGER, STAFF }                                ← cấp sân
```

`STAFF` xuất hiện hai lần với hai nghĩa khác nhau. Mỗi lần viết code phân quyền phải tự hỏi
"staff nào?" — và 27/29 service đã trả lời sai bằng cách không hỏi gì cả (không kiểm sân).

Sai lầm gốc: **`OWNER` bị đặt làm vai trò NỀN TẢNG.** Nhưng "chủ sân" vốn dĩ gắn với *một sân
cụ thể*. Một người sở hữu sân A và làm nhân viên sân B là chuyện bình thường — mô hình hiện tại
không diễn đạt nổi.

### 1.2. Bảng: 46, trong đó nhiều bảng chưa từng được dùng

Đếm số lần mỗi model được gọi trong 18k dòng backend:

| Số lần dùng | Model |
|---|---|
| **0** | `Amenity`, `VenueAmenity`, `VoucherRedemption` |
| 2–4 | `CourtClosure`, `MediaAsset`, `Payout`, `Sport`, `BroadcastLog`, `AiFeatureFlag`, `RevenueStreamFlag` |

Và **5 bảng cấu hình riêng biệt** làm cùng một việc: `SystemSetting`, `FeatureFlag`,
`AiFeatureFlag`, `RevenueStreamFlag`, `AppVersionConfig`.

### 1.3. Khu `owner` và `staff` là hai bản sao của nhau

19 màn owner + 9 màn staff = **28 màn**, nhưng nội dung trùng nhau gần hết: lịch sân, danh sách
booking, chi tiết booking, doanh thu, thông báo, phiên đăng nhập.

Chúng khác nhau ở **quyền nhìn thấy gì**, không phải ở màn hình. Tách đôi là nhân đôi công sức
bảo trì mãi mãi.

---

## 2. Vai trò nên có: 3 nền tảng + 2 theo sân

### Cấp nền tảng — 3

| Vai trò | `level` | Là ai | Làm được gì |
|---|---:|---|---|
| `USER` | 0 | Mọi người đăng ký | Đặt sân, xem lịch sử của mình, đánh giá, lưu sân yêu thích |
| `ADMIN` | 50 | Người được thuê vận hành | Duyệt/từ chối sân · xử lý khiếu nại, hoàn tiền trong hạn mức · khoá tài khoản gian lận · xem báo cáo |
| `SUPER_ADMIN` | 100 | Chủ nền tảng | Mọi quyền của ADMIN, **cộng** những thứ không hoàn tác được (bên dưới) |

#### Chỉ `SUPER_ADMIN` — những thứ không hoàn tác được

```
setting:update      đổi tỉ lệ hoa hồng, chính sách huỷ
payment:configure   khoá bí mật cổng thanh toán (VNPay/SePay)
payout:approve      DUYỆT CHI TRẢ TIỀN cho chủ sân
user:assign-role    gán/gỡ vai trò ADMIN cho người khác
data:delete         xoá dữ liệu
```

#### Vì sao cần cả hai, chứ không chỉ `Role.level`

Đây là hai cơ chế trả lời **hai câu hỏi khác nhau**, không thay thế nhau được:

| | Trả lời câu gì |
|---|---|
| **Quyền** (`permissions`) | Làm được **việc gì** |
| **`Role.level`** | Làm được lên **ai** |

`level` chặn ADMIN sửa/xoá SUPER_ADMIN (`assertCanActOn`). Nhưng nó không ngăn ADMIN đổi hoa hồng
hay duyệt chi trả — đó là chuyện của quyền. Chỉ có một vai trò `ADMIN` thì vai trò đó có tất cả,
và không còn ai đứng trên.

Và không sợ sinh ra `if (role === 'ADMIN' || role === 'SUPER_ADMIN')` rải khắp code — trong kiến
trúc này **luôn kiểm theo quyền**, `can(userId, "setting:update")`, không bao giờ theo tên vai trò.

nextjs_base **đã seed sẵn cả hai**: `SUPER_ADMIN` level 100 với `permissions: "*"` (tự có mọi
quyền thêm mới sau này), `ADMIN` level 50 với danh sách cụ thể. Xoá đi mới là việc phải làm thêm,
và là gỡ mất một lưới an toàn.

> Hôm nay ông là người duy nhất nên khác biệt này chưa dùng tới. Nhưng ngày thuê người trực đầu
> tiên, ông sẽ **không** muốn đưa họ nút chi trả tiền — và lúc đó không phải thiết kế lại gì.

### Cấp sân — 2, gắn qua `VenueMember`

| Vai trò | Quyền trên **sân được gán** |
|---|---|
| `OWNER` | Toàn quyền, kể cả rút tiền, xoá sân, chuyển quyền sở hữu |
| `STAFF` | Bộ quyền mặc định để trực sân + những quyền chủ sân **tick thêm** |

**Không có `MANAGER`.** Đó là một cái khuôn cứng, mà thực tế mỗi sân định nghĩa "quản lý" một
kiểu — sân này cho quản lý hoàn tiền, sân kia thì không. Nhét tất cả vào một enum là ép 100 sân
theo hình dạng của một sân.

Thay bằng cơ chế mềm hơn: **vai trò cho mặc định, tick cho ngoại lệ.**

#### STAFF mặc định có sẵn — dùng được từ ngày đầu, không cần tick gì

```
venue:read        xem thông tin sân
booking:read      xem lịch và danh sách booking
booking:checkin   check-in khách tới sân
booking:create    tạo booking tại quầy (khách vãng lai)
```

⚠️ **Đây là phần bắt buộc phải làm đúng.** Nếu STAFF mặc định trống rỗng thì mỗi lần tuyển người
là chủ sân phải ngồi tick 12 ô, quên một ô là nhân viên không làm việc được. Vai trò sinh ra
chính là để tránh chuyện đó.

#### Chủ sân tick thêm khi cần

```
booking:cancel      huỷ booking
booking:reschedule  đổi giờ
payment:refund      ⚠️ hoàn tiền
pricing:update      ⚠️ sửa bảng giá
court:update        sửa sân con
venue:update        sửa thông tin sân
report:read         ⚠️ xem doanh thu
member:manage       ⚠️ mời/gỡ nhân viên khác
```

#### KHÔNG BAO GIỜ tick được — chỉ `OWNER`

```
payout:manage    rút tiền về tài khoản ngân hàng
venue:delete     xoá sân
venue:transfer   chuyển quyền sở hữu
```

Ba thứ này là **tiền rời khỏi hệ thống** và **mất sân**. Cho tick được thì một cú bấm nhầm là
mất trắng, và chủ sân sẽ không hiểu mình vừa làm gì. Giao diện phải không có ô để tick, không
phải chỉ hiện cảnh báo.

#### Hình dạng dữ liệu

```prisma
model VenueMember {
  venueId     String
  userId      String
  role        VenueRole    // OWNER | STAFF
  status      MemberStatus // ACTIVE | INVITED | DISABLED
  permissions String[]     // quyền tick thêm, NGOÀI mặc định của role
  @@unique([venueId, userId])
}
```

`String[]` ngay trên `VenueMember` chứ không tách bảng riêng: danh sách tối đa ~8 phần tử, và
tra quyền chỉ cần một lần đọc. Giá trị được đối chiếu với danh mục quyền trong code
(`src/lib/permissions.ts`) — chuỗi lạ bị từ chối lúc ghi.

```ts
canOnVenue(userId, permission, venueId):
  OWNER  → true
  STAFF  → permission ∈ MẶC_ĐỊNH_STAFF ∪ member.permissions
  (và permission ∉ CHỈ_OWNER)
```

### Vì sao mô hình này đúng hơn

**"Chủ sân" không còn là vai trò nền tảng.** Nó là *một dòng trong `VenueMember`*. Hệ quả:

- Một người sở hữu sân A, làm nhân viên sân B — diễn đạt được, tự nhiên
- Không cần màn "become-owner" đổi vai trò tài khoản; tạo sân đầu tiên là có dòng
  `VenueMember(role=OWNER)`
- Câu hỏi phân quyền luôn có dạng **"user X có quyền P trên sân V không?"** — một câu hỏi duy
  nhất, một hàm duy nhất, không còn chỗ để quên
- `STAFF` chỉ còn một nghĩa. Hết mơ hồ.

**Đây là thay đổi quan trọng nhất của toàn bộ thiết kế lại.** Nó vừa cắt vai trò từ **7 xuống 5**,
vừa bịt lỗ hổng bảo mật đang mở (27/29 service không kiểm phạm vi sân), vừa linh hoạt hơn bản cũ
— vì thứ bị bỏ (`MANAGER`) được thay bằng cơ chế mềm hơn nó.

---

## 3. Bảng dữ liệu: 46 → 21 bảng tự viết

nextjs_base đã có sẵn ~16 bảng auth/RBAC (`User`, `Role`, `UserRole`, `Permission`,
`UserPermission`, `RefreshToken`, `WebAuthnCredential`, `RecoveryCode`, `VerificationToken`,
`UserDevice`, `Notification`, `AuditLog`, `OAuthAccount`, `UserProfile`…). **Không viết lại.**

### Bảng nghiệp vụ cần tự viết — 21

**Sân bãi (7)**
| Bảng | Ghi chú |
|---|---|
| `Sport` | Danh mục môn |
| `Venue` | Cơ sở. `amenities String[]` thay cho 2 bảng `Amenity` + `VenueAmenity` |
| `VenueImage` | Ảnh sân. Gộp luôn `MediaAsset` |
| `VenueHour` | Giờ mở cửa theo thứ |
| `VenueMember` | **Gắn người với sân + vai trò** — trục của toàn bộ phân quyền |
| `Court` | Sân con trong cơ sở |
| `CourtClosure` | Đóng sân bảo trì |

**Giá và đặt sân (5)**
| Bảng | Ghi chú |
|---|---|
| `PriceRule` | Giá theo môn/khung giờ/thứ |
| `PriceOverride` | Đè giá ngày cụ thể (lễ, sự kiện) |
| `Booking` | ⚠️ Giữ `EXCLUDE USING gist` chống trùng — **không đụng vào** |
| `Voucher` | Mã giảm giá |
| `VoucherRedemption` | Đã dùng. Gộp luôn `VoucherClaim` |

**Tiền (5)**
| Bảng | Ghi chú |
|---|---|
| `Payment` | Giao dịch |
| `PaymentEvent` | ⚠️ Giữ `@@unique([provider, externalEventId])` — chặn ghi nhận tiền hai lần |
| `Refund` | Hoàn tiền |
| `OwnerEarning` | Chia hoa hồng nền tảng ↔ chủ sân |
| `Payout` | Chi trả cho chủ sân. Gộp `BankAccount` thành cột trên `Venue` |

**Còn lại (4)**
| Bảng | Ghi chú |
|---|---|
| `Review` | Đánh giá |
| `Favorite` | Sân yêu thích |
| `Setting` | **Một bảng key-value duy nhất** thay cho 5 bảng: `SystemSetting`, `FeatureFlag`, `AiFeatureFlag`, `RevenueStreamFlag`, `AppVersionConfig` |
| `Dispute` | Khiếu nại (hiện đang lẫn trong `Booking`) |

### 25 bảng bị cắt, và cắt đi đâu

| Bảng | Xử lý |
|---|---|
| `Amenity`, `VenueAmenity` | → `Venue.amenities String[]`. Đang **0 lần dùng** |
| `MediaAsset` | → gộp `VenueImage` |
| `BankAccount`, `PlatformBankAccount` | → cột trên `Venue` / một dòng trong `Setting` |
| `VoucherClaim` | → gộp `VoucherRedemption` |
| `SystemSetting`, `FeatureFlag`, `AiFeatureFlag`, `RevenueStreamFlag`, `AppVersionConfig` | → **một bảng `Setting`** |
| `RefreshToken`, `Device`, `OtpCode`, `Permission`, `RolePermission`, `Notification`, `NotificationPreference`, `AuditLog` | → nextjs_base đã có |
| `BroadcastLog` | → dùng `AuditLog` |
| `BoostPurchase`, `OwnerSubscription`, `PlatformInvoice`, `AffiliateBanner`, `AffiliateRevenue` | → **hoãn sang Mức 2** (xem §5) |
| `ShiftReport` | → **hoãn sang Mức 2** |

**46 → 21.** Và 21 bảng đó là thứ thật sự cần để đặt được một sân và nhận được tiền.

---

## 4. Màn hình: 78 → 41

### Nguyên tắc cắt lớn nhất: gộp `owner` + `staff` thành MỘT khu

28 màn → **11 màn**. Cùng một màn, hiển thị theo quyền:

```
/venue/[id]/schedule    STAFF thấy lịch + check-in
                        STAFF được tick booking:cancel thấy thêm nút huỷ
                        OWNER thấy thêm doanh thu ngày
```

Không phải ba màn. Là một màn hiện theo quyền — đúng như bản chất của nó.

---

### 4.1. Khu công khai — 5 màn (từ 10)

| Màn | Chức năng |
|---|---|
| `/` | Hero + ô tìm (môn, thành phố, ngày) · lưới môn thể thao · 6 sân nổi bật · 3 bước hoạt động · footer |
| `/venues` | Lọc (môn, quận, ngày, khung giờ, giá, tiện ích, rating) · sắp xếp · danh sách/bản đồ (Leaflet, pin theo môn) |
| `/venues/[id]` | Gallery · tab Tổng quan/Sân&Giá/Đánh giá/Vị trí · **widget đặt sân** (chọn sân con → ngày → khung giờ → giá) · nút yêu thích |
| `/vouchers` | Voucher đang mở · nút lưu về ví |
| `/info/[slug]` | **Một trang động** thay 6 trang tĩnh (giới thiệu, liên hệ, trợ giúp, 3 chính sách). Nội dung trong `Setting` |

### 4.2. Xác thực — 3 màn (nextjs_base cấp sẵn 6)

`/login` · `/register` · `/forgot-password`
Có sẵn thêm, không phải viết: `/reset-password`, `/verify-email`, `/confirm-email-change`, `/security` (2FA + passkey), `/sessions`.

### 4.3. Đặt sân — 3 màn

| Màn | Chức năng |
|---|---|
| `/booking/new` | Nhiều bước: xác nhận khung giờ → áp voucher → chọn cổng thanh toán → giữ chỗ Redis 10 phút (đếm ngược) |
| `/booking/[id]/pay` | Chuyển khoản ngân hàng: QR + nội dung chuyển khoản + chờ webhook SePay xác nhận |
| `/booking/result` | Thành công/thất bại · mã đặt sân · nút thêm vào lịch · đường dẫn chỉ đường |

### 4.4. Tài khoản người dùng — 5 màn (từ 10)

| Màn | Chức năng |
|---|---|
| `/account/bookings` | Danh sách: sắp tới / đã qua / đã huỷ · lọc theo sân, ngày |
| `/account/bookings/[id]` | Chi tiết · QR check-in · huỷ (theo chính sách) · yêu cầu hoàn tiền · đánh giá sau khi chơi |
| `/account/favorites` | Sân đã lưu · đặt nhanh |
| `/account/vouchers` | Ví voucher · đã dùng/còn hạn |
| `/account/profile` | Hồ sơ + cài đặt thông báo **gộp một màn** (đang tách 2) |

Bỏ: `/account/notifications` (đưa vào chuông trên header), `/account/sessions` (nextjs_base có
`/sessions`), `/account/become-owner` ×2 (trùng nhau — thay bằng nút "Đăng sân của bạn" ở header).

### 4.5. Khu quản lý sân — 11 màn (từ 28)

Một khu duy nhất cho OWNER và STAFF. Nội dung hiện theo `canOnVenue()`.

| Màn | Chức năng | Ai thấy |
|---|---|---|
| `/venue` | Chọn sân đang quản (bỏ qua nếu chỉ có 1) | cả hai |
| `/venue/[id]` | Bảng điều khiển: booking hôm nay, tỉ lệ lấp đầy, doanh thu ngày | STAFF chỉ thấy tiền nếu được tick |
| `/venue/[id]/schedule` | **Lịch sân theo ngày** — trục sân × khung giờ · kéo thả · click ô trống → tạo booking tại quầy | cả hai |
| `/venue/[id]/bookings` | Danh sách + lọc · check-in · huỷ · đổi giờ | cả hai, quyền khác nhau |
| `/venue/[id]/bookings/[bid]` | Chi tiết · lịch sử trạng thái · liên hệ khách · hoàn tiền | STAFF nếu được tick |
| `/venue/[id]/courts` | Sân con: thêm/sửa/xoá · đóng bảo trì | STAFF nếu được tick |
| `/venue/[id]/pricing` | Bảng giá theo khung giờ/thứ · đè giá ngày lễ | STAFF nếu được tick |
| `/venue/[id]/info` | Thông tin, ảnh, giờ mở cửa, tiện ích, vị trí bản đồ | STAFF nếu được tick |
| `/venue/[id]/staff` | Mời/gỡ nhân viên · **tick quyền cho từng người** · xem quyền hiện có | OWNER |
| `/venue/[id]/reports` | Doanh thu theo ngày/tuần/tháng · tỉ lệ lấp đầy · khách quen · xuất CSV | OWNER, hoặc STAFF được tick |
| `/venue/[id]/payout` | Tài khoản nhận tiền · số dư · lịch sử chi trả | OWNER |

Bỏ hẳn: `/owner/invoices` ×2, `/owner/subscription`, `/owner/venues/[id]/boost`,
`/owner/shift-reports` ×2, `/staff/revenue`, `/staff/team`, `/staff/shift-report`,
`/owner/sessions`, `/staff/sessions`, `/owner/notifications`, `/staff/notifications`.

### 4.6. Khu quản trị — 9 màn (từ 23)

| Màn | Chức năng |
|---|---|
| `/admin` | KPI: GMV, số booking, sân hoạt động, tỉ lệ huỷ, top sân |
| `/admin/venues` | **Hàng chờ duyệt sân** · duyệt/từ chối kèm lý do · tạm ngưng sân |
| `/admin/users` | Tìm · xem chi tiết · khoá/mở · gán vai trò nền tảng · cấp quyền ngoại lệ có hạn |
| `/admin/bookings` | Tra cứu toàn nền tảng · can thiệp thủ công |
| `/admin/disputes` | Khiếu nại · hoàn tiền thủ công · ghi chú xử lý |
| `/admin/payments` | Đối soát: giao dịch treo, IPN không tới, chênh lệch |
| `/admin/vouchers` | Voucher toàn nền tảng |
| `/admin/audit` | Nhật ký thao tác (chỉ đọc) |
| `/admin/settings` | **Một màn** cho toàn bộ cấu hình: hoa hồng %, chính sách huỷ, lịch chi trả, cờ bật/tắt, nội dung trang tĩnh, phiên bản app tối thiểu |

Bỏ: `ai-features`, `affiliate`, `boost`, `invoices`, `invoice-payments`, `revenue-controls`,
`subscriptions`, `system/app-version`, `system/feature-flags`, `system/permissions`,
`system/roles`, `sessions`, `inbox`, `notifications`, `reports` (gộp vào `/admin`).

---

### Tổng kết màn hình

| Khu | Cũ | Mới |
|---|---:|---:|
| Công khai | 10 | 5 |
| Xác thực | 3 | 3 |
| Đặt sân | 3 | 3 |
| Tài khoản | 10 | 5 |
| Quản lý sân (owner+staff) | 28 | 11 |
| Quản trị | 23 | 9 |
| Trang chủ | 1 | (đã tính) |
| **Tổng** | **78** | **36** |

Cộng 5 màn nextjs_base cấp sẵn (bảo mật, phiên, đặt lại mật khẩu, xác thực email, đổi email) →
**41 màn**, trong đó **chỉ 36 màn phải tự viết**.

---

## 5. Cái gì hoãn, và khi nào mở lại

Không xoá vĩnh viễn — hoãn tới khi có lý do thật:

| Tính năng | Mở lại khi |
|---|---|
| **Đẩy sân trả phí** (`BoostPurchase`) | Có ≥100 sân hoạt động và chủ sân **tự hỏi** cách được hiển thị trước |
| **Gói thuê bao chủ sân** (`OwnerSubscription`, `PlatformInvoice`) | Doanh thu hoa hồng đã ổn định và có người muốn trả phí cố định để giảm % |
| **Affiliate** (`AffiliateBanner`, `AffiliateRevenue`) | Có đối tác thật hỏi hợp tác |
| **Báo cáo ca trực** (`ShiftReport`) | Có sân ≥5 nhân viên phàn nàn không biết ai trực ca nào |
| **Cờ tính năng AI** | Khi có tính năng AI chạy thật, không phải cờ chờ sẵn |

**Luật**: mỗi thứ trên chỉ mở lại khi có **một người dùng thật hỏi**, không phải khi ta đoán họ
sẽ hỏi. Đây chính là cách 35 màn thành 78.

---

## 6. Ba thứ tuyệt đối không đụng vào

Đây là phần bản cũ làm đúng, và làm đúng ở chỗ khó:

1. **`EXCLUDE USING gist` trên `Booking`** — chặn trùng khung giờ ở tầng database. Hai request
   đồng thời không thể cùng thắng, kể cả khi code sai. Bê nguyên `000_init_extensions.sql`.
2. **`@@unique([provider, externalEventId])` trên `PaymentEvent`** — idempotency webhook bằng
   ràng buộc DB, không bằng `if`. Cổng thanh toán **luôn** gửi lại.
3. **Argon2id cho mật khẩu** — nextjs_base cũng dùng đúng thứ này.

---

## 7. Việc tiếp theo

1. Duyệt tài liệu này — đặc biệt §2 (vai trò) và §5 (hoãn gì). Đây là hai quyết định khó rút lại.
2. Chốt xong thì tôi viết `schema.prisma` 21 bảng + migration, theo [KE_HOACH_REFACTOR.md](KE_HOACH_REFACTOR.md) Giai đoạn 1–2.
3. Port UI: 36 màn mới lấy từ 78 màn cũ — phần lớn là **xoá và gộp**, không phải vẽ lại.
