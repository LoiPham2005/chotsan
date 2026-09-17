# Tiến độ ChốtSân

Cập nhật: **17/09/2026**. Kế hoạch đầy đủ ở [KE_HOACH_REFACTOR.md](KE_HOACH_REFACTOR.md); tệp này
chỉ nói **đã làm được gì, còn gì**, để mở ra là biết đứng ở đâu.

Số liệu hiện tại: **1216 unit test / 103 tệp** (`pnpm check` có coverage) — xanh; e2e Playwright
(`e2e/*.spec.ts`) xanh; `pnpm db:check-conflict` **26/26** trên database dev (Neon). Bảng tổng và
các mục "GĐ…" bên dưới là ảnh chụp ngày 04/09, giữ để biết lịch sử — trạng thái mới nhất nằm ở mục
đợt sửa 17/09 ngay dưới.

## Đợt sửa lỗi lớn 17/09/2026

Rà toàn bộ dự án theo 5 nhóm, sửa, rồi gộp vào repo. Migration mới:
`20260917160000_integrity_invoice_numbering` (đã áp trên database dev). Bẫy mới ghi ở
[GOTCHAS](GOTCHAS.md) #20–#31.

### 1. Hạ tầng và công cụ

- Next **16.3.1 → 16.3.5** (vá hai lỗ RCE mức critical). Thêm `ioredis` (BullMQ 6 nạp lười — thiếu
  là worker chết) và `cron-parser`.
- **Gỡ script** `db:migrate`, `db:migrate:create`, `db:push`, `db:reset` — chúng xoá ràng buộc viết
  tay hoặc reset database dùng chung. `Makefile` sửa theo (`setup` = `db:deploy` + `db:seed`; thêm
  `e2e`, `check-conflict`, `worker`).
- `pnpm check` = typecheck + lint + format:check + **test:coverage**. Husky bật: pre-commit chạy
  `lint-staged`, pre-push chạy `typecheck` + `test`.
- CI: Postgres 17 (khớp Neon), job `db:check-conflict`, `audit` đỏ khi có lỗ high, báo cáo HTML của
  Playwright, build + chạy thử cả 3 image, e2e gửi mail qua mailpit.
- Dockerfile 9 stage; image realtime/worker chỉ mang `node_modules` tối thiểu. systemd/PM2 đổi tên
  `nextjs-base*` → `chotsan*`, env ở `/etc/chotsan/env`, mã ở `/var/www/chotsan`.
- **Lịch job định nghĩa MỘT nơi** (`src/jobs/schedules.ts`), cron theo giờ Việt Nam, ba chế độ
  (`/api/health` → `features.schedules`): `worker`, `in-process` (`QUEUE_ENABLED=0`, web tự chạy
  lịch), `off`. Hoá đơn hoa hồng chạy mỗi ngày 02:30 và tự bù 3 tháng đã kết thúc.
- `/health` của worker và realtime chỉ nghe `127.0.0.1`; realtime validate + giới hạn `ping:user`.
- e2e đổi sang tên tiếng Anh (`helpers.ts`, `guest-booking`, `venue-owner`, `permissions`), luật
  ESLint khu quản lý sân nhắm đúng `src/app/(manage)/manage/[venueId]/**`.

### 2. Xác thực và phân quyền

- **Thu hồi phiên thật sự**: web, API và realtime kiểm "mốc bảo mật" (mốc đổi mật khẩu, trạng thái,
  đã xoá) cache 60 giây. Đổi/đặt lại mật khẩu, khoá, xoá tài khoản → phiên cũ bị cắt.
- Hàm ghi user/vai trò/thành viên **bắt buộc `actorId`**; chốt `Role.level` không còn bị bỏ qua (ADMIN
  không tạo/gán/sửa vai trò bậc ≥ 50, chỉ gán được quyền mình đang có).
- OAuth không liên kết vào email chưa xác thực, và đi qua 2FA nếu tài khoản bật. Đặt lại mật khẩu
  xác thực luôn email (gỡ passkey/2FA cũ nếu email chưa từng xác thực — chống chiếm trước).
- Khoá tạm kiểm trước khi so mật khẩu; `safeRedirectPath` chặn `/\evil.com`; JWT bắt buộc `typ`;
  vé 2FA/passkey dùng một lần; chống phát lại TOTP; rate limit lấy IP theo `TRUSTED_PROXY_HOPS`, web
  và API chung bucket, 429 có `Retry-After`.
- `member:manage` không tự sửa/gỡ mình; nhân viên chỉ cấp được quyền mình có. Audit log đủ các
  đường đăng nhập, đổi mật khẩu, dùng lại refresh token, thu hồi phiên.
- `/security` có đổi mật khẩu, gửi lại email xác thực, đổi email. Xoá mã chết (`requireAdmin`,
  `requireApiAdmin`, `canAny`, `canAll`, `venuesWithPermission`…).

### 3. Đặt sân và thanh toán

- Lịch trống: ô **chưa có giá = không bán** (`NOT_FOR_SALE`), ô quá giờ là `PAST` ở mọi ngày, chỉ
  cơ sở `ACTIVE` mới đặt được.
- Giữ chỗ kiểm phút tròn, giờ đã qua, tổng tiền > 0, và **khoá dòng sân con** trong transaction (lịch
  đóng sân không có ràng buộc database). Giữ chỗ xong mở giao dịch luôn; trang thanh toán chỉ đọc.
- `/bookings/<mã>` bắt đăng nhập, chỉ người đặt hoặc người có `booking:read` ở sân đó xem được.
- Huỷ bắt buộc nói ai huỷ (`CUSTOMER`/`VENUE`); khách không tự huỷ lượt đang chờ duyệt tiền; tiền hoàn
  tính trên tiền đã nhận. Webhook lệch tiền → giao dịch `FAILED` (không ném); tiền về cho lượt đã hết
  hạn → ghi nhận + yêu cầu hoàn `PENDING`.
- Thứ tự luật giá chốt rõ (`priceForSlot`); trang sân đang bảo trì/tạm ngừng vẫn mở, kèm băng thông
  báo; lọc theo tỉnh (`?tinh=`).
- Giao diện: thông báo thành công không mất khi dòng rời danh sách (`ActionNoticeProvider`), xác
  nhận hai bước (`ConfirmButton`), nút sao chép chạy được qua HTTP LAN, đồng hồ giữ chỗ bù lệch giờ.
- `db:check-conflict` thêm kịch bản hoàn tiền đồng thời, tiền về lượt hết hạn, khoá ngoại lệch
  sân, trần 3 hồ sơ đồng thời, hai đánh giá đồng thời; dọn dữ liệu trong `finally`.

### 4. Cơ sở, hoá đơn, đánh giá, schema

- Migration toàn vẹn: `bookings(court_id, venue_id)` và luật giá phải khớp sân con của đúng cơ sở
  (khoá ngoại hai cột), khoá ngoại còn thiếu cho voucher/đè giá/khiếu nại, `payments.received_by` mặc
  định `VENUE`, **số hoá đơn từ SEQUENCE viết tay** `platform_invoice_number_seq`
  (`CS-YYYYMM-000042`) — đã thêm vào danh sách ràng buộc không được mất (GOTCHAS #11).
- Trạng thái cơ sở đổi theo **đồ thị chuyển trạng thái** (`VenueStatusTransitionError`); điều kiện
  sẵn sàng gồm giờ mở cửa, sân con, bảng giá **và tài khoản nhận tiền**.
- Sân con: mọi hàm bắt buộc `venueId`; đóng sân từ chối khi chồng lượt còn sống; luật giá chồng
  nhau cùng mức ưu tiên bị từ chối; cảnh báo khung mở cửa chưa có giá. Giờ mở cửa chưa khai = đóng.
- Hoá đơn: `generateMissing` idempotent; `markPaid`/`waive` so-rồi-đổi; số ngày quá hạn theo ngày VN.
- Đánh giá: điểm nguyên 1–5, khoá dòng cơ sở khi cập nhật điểm trung bình.

### 5. Giao diện

- Header điện thoại **2 hàng** (hàng mục cuộn ngang, dính mép trên) — không menu ba gạch; không tràn
  ngang từ 320 tới 1920px. Nav quản trị: dải ngang trên điện thoại, cột trái từ `lg`.
- Nút/ô nhập cao 44px; nút `sm` nhìn 36px nhưng vùng chạm nới bằng `after:`. **Cam chỉ dùng cho giờ
  vàng**; "Chờ thanh toán" đỏ; "Chờ duyệt" xám viền đứt.
- Token mới (`--primary-text`, `--danger-text`, `--rating-color`, `--admin-nav`, `--sport-*`…); bỏ
  bóng thẻ tĩnh, gradient trang trí, màu Tailwind thẳng; xoá hết `@layer components` cũ.
- Làm lại khu `(auth)`, `/security`, `/sessions`, `/users`, `/roles`, trang lỗi. Favicon/manifest
  mới. Form giữ dữ liệu sau khi báo lỗi (không bao giờ trả lại mật khẩu/OTP), câu lỗi cụ thể theo ô.

### Luồng đăng ký cơ sở (mới)

1. Nút **"Đăng ký chủ sân"** → `/manage/new` — form ngắn (tên, môn, địa chỉ). Mỗi người tối đa **3 hồ
   sơ chưa duyệt** (`DRAFT`/`PENDING`, `MAX_UNAPPROVED_VENUES`, lỗi `VenueDraftLimitError`); phép đếm
   chạy sau khi khoá dòng người tạo.
2. Tạo xong vào `/manage/<id>/settings`: **checklist** giờ mở cửa · sân con · bảng giá · tài khoản
   nhận tiền, nút **"Gửi duyệt"** (`submitForReviewAction`, `DRAFT → PENDING`), và lý do nếu hồ sơ
   từng bị trả.
3. Quản trị ở `/venue-approvals`: duyệt (`PENDING → ACTIVE`) hoặc **trả hồ sơ** (`PENDING → DRAFT`
   kèm lý do) — chủ sân sửa rồi gửi lại.
4. `/manage` có đúng một cơ sở thì vào thẳng cơ sở đó, trừ khi `?all=1`.

### Quyết định đã chốt trong đợt

| Quyết định                                                                               | Vì sao                                                                                                                           |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Từ chối hồ sơ = **trả về `DRAFT` kèm lý do**, không dùng `ADMIN_LOCKED`                  | "Chưa đạt" khác "bị khoá vì vi phạm"; gộp lại thì chủ sân bị từ chối lần đầu trông như bị phạt và không tự sửa rồi gửi lại được  |
| `ADMIN_LOCKED` chỉ admin gỡ                                                              | Gộp với `SUSPENDED` thì chủ sân tự bấm "Mở bán lại" là hết hình phạt (bài học bản cũ)                                            |
| **Cam chỉ nói "giờ vàng, giá cao hơn"**; "Chờ thanh toán" đỏ, "Chờ duyệt" xám viền đứt   | Một màu một nghĩa — xem skill `chotsan-thiet-ke`                                                                                 |
| **Máy dev không có Redis thì không chạy lịch**                                           | Lịch mỗi phút giữ Neon thức 24/7; ở dev không lịch nào bắt buộc (GOTCHAS #24)                                                    |
| Web tự chạy lịch khi `QUEUE_ENABLED=0`                                                   | Trước đây tắt hàng đợi là không lịch nào chạy, không một dòng log                                                                |
| Hoá đơn hoa hồng chạy **mỗi ngày**, tự bù tháng còn thiếu, thay cho "một lần mùng 1"     | Lần chạy mùng 1 hỏng (database chập chờn, worker đang deploy) là mất hẳn hoá đơn tháng đó; chạy lại không xuất trùng             |
| Ô chưa có luật giá = **không bán** (`NOT_FOR_SALE`)                                      | Không luật giá nào phủ = giá 0đ = chủ sân chưa mở bán giờ đó                                                                     |
| Đè giá gối giờ **cùng phạm vi** bị từ chối; khác phạm vi được phép (riêng sân con thắng) | Đè giá không có priority — cùng phạm vi gối nhau thì không ai biết khách trả giá nào; khác phạm vi là cách làm ngày lễ + sân VIP |
| Webhook lệch tiền → giao dịch `FAILED`, service **không ném lỗi**                        | Lỗi sau khi đã ghi sự kiện làm cổng gửi lại và lần sau bị coi là trùng; ghi `FAILED` để người xem thấy trên giao dịch            |
| Đổi email **không** cắt cookie web (chỉ thu hồi refresh token)                           | Giữ như hiện tại; đổi/đặt lại mật khẩu, khoá, xoá mới cắt phiên                                                                  |
| `SESSION_STRICT_REVOCATION=0` chỉ tắt so mốc đổi mật khẩu                                | Khoá/xoá mềm LUÔN cắt phiên — quyết định hành chính, không cờ nào tắt được                                                       |

### Tính năng còn mở (không phải lỗi)

- REST API mobile cho sân, đặt sân, thanh toán; route webhook cổng thanh toán tự động; OAuth cho
  mobile.
- Đặt tại quầy, thanh toán tiền mặt, giao diện hoàn tiền, voucher, khiếu nại, yêu thích, cấu hình
  `Setting`.
- Luồng lời mời nhân viên (`INVITED`); quản lý liên kết OAuth trên web; OTP số điện thoại trên web;
  nhà cung cấp SMS; adapter S3.
- Tự ghi `COMPLETED`/`NO_SHOW`; ẩn đánh giá; tự khoá sân khi hoá đơn quá hạn.
- Webhook báo thành công cho giao dịch đã `CANCELLED`/`FAILED` mới chỉ dừng, chưa tạo yêu cầu hoàn.
- Câu hỏi thiết kế chưa chốt: `--text-subtle` tương phản thấp (~2,6:1); chữ trắng trên nút xanh
  (~2,5:1) — xem skill `chotsan-thiet-ke`.

## Bảng tổng

| Giai đoạn                       | Trạng thái       | Còn lại                                           |
| ------------------------------- | ---------------- | ------------------------------------------------- |
| GĐ1 — Khung + schema            | ✅ Xong          |                                                   |
| GĐ2 — Phân quyền theo sân       | ✅ Xong          |                                                   |
| GĐ3 — Giao diện (36 màn)        | 🟡 Mới có bản vẽ | 36 màn                                            |
| GĐ4 — Nghiệp vụ theo miền       | 🟡 3/7 đợt       | sports/venues/courts, invoices, reviews, admin    |
| GĐ5 — Nối UI vào service        | ⬜ Chưa          | Toàn bộ                                           |
| GĐ6 — Cron ra worker + realtime | ⬜ Chưa          | `expireHolds`, `expirePending` còn chưa có ai gọi |
| GĐ7 — Flutter                   | ⬜ Chưa          | Toàn bộ                                           |
| GĐ8 — E2E + cắt chuyển          | ⬜ Chưa          | Toàn bộ                                           |

## Đã có, chạy được, có test

### Nền móng (GĐ1–2)

| Thứ                                  | Tệp                                  | Test    |
| ------------------------------------ | ------------------------------------ | ------- |
| 38 model (≈22 bảng nghiệp vụ) + auth | `prisma/schema.prisma`               | —       |
| `EXCLUDE USING gist` chống trùng chỗ | migration `chong_trung_booking`      | DB thật |
| 38 quyền, 3 vai trò nền tảng         | `src/lib/permissions.ts`             | ✅      |
| `canOnVenue` / `venuePermissions`    | `src/services/permission.service.ts` | ✅      |
| `defineVenueAction`                  | `src/lib/define-action.ts`           | ✅      |
| `requireVenuePermission` (trả 404)   | `src/lib/api/auth.ts`                | ✅      |

### Nghiệp vụ (GĐ4)

| Miền              | Tệp                                    | Test                |
| ----------------- | -------------------------------------- | ------------------- |
| Khung giờ 30 phút | `src/lib/slots.ts`                     | 23                  |
| Bảng giá          | `src/lib/pricing.ts`                   | 12                  |
| VietQR (EMVCo)    | `src/lib/vietqr.ts`                    | 10                  |
| Lỗi Prisma 7      | `src/lib/prisma-errors.ts`             | 11 (lỗi thật từ DB) |
| Lịch trống        | `src/services/availability.service.ts` | 17                  |
| **Đặt sân**       | `src/services/booking.service.ts`      | 37 + DB thật        |
| **Thanh toán**    | `src/services/payment.service.ts`      | 40 + DB thật        |

### Giao diện (GĐ3, mới bắt đầu)

| Thứ                                  | Tệp                                    |
| ------------------------------------ | -------------------------------------- |
| Bản vẽ 6 màn                         | `design/chotsan-giao-dien.html`        |
| Quy ước màu/chữ/khoảng cách          | `.claude/skills/chotsan-thiet-ke/`     |
| Lưới sân × khung giờ + dải tổng quan | `src/components/booking/slot-grid.tsx` |

## Ảnh sân

Thẻ sân (trang chủ, tìm sân), băng ảnh ở trang chi tiết (máy tính: 1 ảnh bìa + 3 ảnh nhỏ; điện
thoại: vuốt ngang) và ảnh bìa nhỏ ở khu quản lý đều đọc `VenueImage` — ảnh đầu (`isPrimary`) là
ảnh bìa. Chưa có ảnh thì thẻ giữ khối màu + biểu tượng môn, trang chi tiết không dựng băng ảnh.

Dữ liệu dev có **12 ảnh mẫu** (4 ảnh × 3 sân) ở `public/demo/venues/`, gắn bằng
`prisma/seeds/seed-venue-images.ts`. Tất cả là **CC0** (tìm qua Openverse), nguồn từng tệp ghi
trong seed. Seed không bao giờ ghi đè sân đã có ảnh.

Ảnh nội bộ đi qua `next/image` (trình duyệt nhận WebP đúng cỡ); ảnh ở host ngoài dùng `<img>`
thường cho tới khi khai `images.remotePatterns` — xem `VenuePhoto`. CSP không phải nới gì.

## Các chốt chặn tiền đã chứng minh trên database thật

Chạy `pnpm db:check-conflict` — script tự tạo sân riêng, chạy thao tác **đồng thời thật**, rồi tự
xoá. Unit test dùng mock chỉ kiểm ĐƯỜNG XỬ LÝ khi lỗi bắn ra; script này kiểm rằng lỗi **thật sự**
bắn ra.

1. Hai người bấm đặt cùng một khung trong cùng một giây → đúng một người thắng.
2. Khách bấm "Thanh toán" hai lần → đúng một giao dịch, không mở được hai trang thanh toán.
3. Webhook cổng thanh toán gửi lại → không xác nhận lần hai.
4. Cổng báo về số tiền lệch → dừng, không xác nhận, dù webhook nói "thành công".
5. Hai lần đặt nhiều sân tranh cùng một dãy → bên thua **không để lại nửa lần đặt** (transaction
   cuộn lại cả lượt đã giữ).
6. Chỗ giữ quá hạn mà cron chưa nhả → **không chặn** người đặt sau.
7. Khách đã báo chuyển khoản → cron **không nhả** chỗ của họ trong lúc chờ chủ sân đối chiếu.
8. Duyệt một lần cho cả lần đặt nhiều sân; **sân khác không duyệt được** tiền của sân này.

Script này **đã bắt được hai lỗi mà 440 unit test không thấy** — xem
[GOTCHAS #10](GOTCHAS.md#10-prisma-7--driver-adapter-errormetatarget-không-còn-tên-ràng-buộc-chỉ-nằm-trong-meta).

## Việc tiếp theo, theo thứ tự

1. **36 màn giao diện** (GĐ3) — vẫn dùng dữ liệu giả, theo thứ tự: khách đặt sân → chủ sân →
   quản trị.
2. **Nối UI vào service** (GĐ5).
3. **Realtime** (GĐ6) — đẩy trạng thái khung giờ khi có người đặt, để hai người cùng xem một sân
   thấy ngay. Cron đã xong.

## Đã học được gì từ bản cũ

So `prisma/schema.prisma` với `../sports_booking/backend/prisma/schema.prisma` (bản cũ, 46 bảng)
tìm ra sáu chỗ bản cũ làm đúng mà bản này làm sai hoặc bỏ sót. Đã sửa hết trong migration
`20260904140000_hoc_tu_ban_cu`:

| Học được                             | Bản này trước đó                                         |
| ------------------------------------ | -------------------------------------------------------- |
| Địa chỉ hai cấp phường/xã → tỉnh     | Bắt buộc `district` — cấp đã bỏ từ 01/07/2025            |
| Tách `ADMIN_LOCKED` khỏi `SUSPENDED` | Chủ sân bị khoá tự bấm "Mở bán" là gỡ được hình phạt     |
| `pg_trgm` khai trong schema          | Index trgm bị `prisma migrate dev` xoá → `Seq Scan`      |
| `VenueImage.storageKey`              | Xoá dòng xong file vẫn nằm trên S3, vẫn tính tiền        |
| `cancelPolicyJson` theo từng sân     | `freeCancelHours` là hằng số 2 nằm cứng trong hàm        |
| `indoor` tách khỏi `surface`         | Enum gộp hai chiều, không tả nổi "cỏ nhân tạo trong nhà" |
| `recurringGroupId`                   | Không có chỗ nhóm lịch đặt cố định hàng tuần             |

Kèm 3 ràng buộc database mới mà **cả hai bản đều thiếu**: một chủ cho mỗi cơ sở
(`venue_members_mot_chu_cho_moi_co_so`), 7 ràng buộc `CHECK` (điểm sao 1–5, tiền không âm, giờ
không ngược), và index `pg_trgm` cho tìm kiếm.

**Không bê về, dù bản cũ có:** `declaredAmount` (mã QR đã ghim số tiền; chủ sân vẫn phải mở app
ngân hàng đối chiếu nên lời khai của khách không giúp gì), `wardCode`/`provinceCode` (hai nguồn
sự thật song song với `province`/`ward` — danh mục hành chính thuộc về code, giống
`src/lib/permissions.ts`), và `recurringGroupId` (chưa có tính năng đặt cố định; index trên bảng
nóng nhất cho một cột toàn NULL). Cả ba thêm lại sau bằng một migration, gần như không tốn gì.

**Còn nợ, chưa làm** (cần quyết định sản phẩm, không phải lỗi):

- **`PlatformInvoice`** — bản cũ giải bài toán dòng tiền bằng cách cho tiền đi thẳng vào tài
  khoản sân rồi nền tảng xuất hoá đơn hoa hồng cuối tháng. Đây chính là câu trả lời cho câu hỏi
  còn treo bên dưới.
- **Đặt sân cố định hàng tuần** — nhóm khách sộp nhất của cầu lông/bóng đá. Chưa có gì.
- **`NotificationPreference`** — tắt/bật từng loại thông báo theo kênh.
- **`AppVersionConfig`** — chặn phiên bản app cũ, cần trước khi phát hành Flutter (GĐ7).
- **Danh mục tiện ích** — hiện là `String[]` tự do; bản cũ có bảng `Amenity` (có icon, lọc chuẩn).

## Mô hình dòng tiền — ĐÃ CHỐT

**Tiền đi thẳng vào tài khoản của sân. Nền tảng xuất hoá đơn hoa hồng hàng tháng.**

Chọn thế vì nền tảng không giữ tiền của người khác — giữ hộ tiền là bước vào phạm vi trung gian
thanh toán, kèm ràng buộc pháp lý và vốn. Đổi lại phải đi ĐÒI hoa hồng, nhưng có sẵn đòn bẩy: quá
hạn thì khoá sân. Đây cũng là cách bản cũ (`PlatformInvoice`) đã làm.

### Đích sau khi đăng nhập — theo VAI, không phải một đích chung

| Vai                 | Về đâu             | Vì sao                                                  |
| ------------------- | ------------------ | ------------------------------------------------------- |
| Quản trị nền tảng   | `/venue-approvals` | Chủ sân nộp hồ sơ đang chờ; đây là việc gấp nhất        |
| Chủ sân · nhân viên | `/manage`          | Một sân thì vào thẳng lịch hôm nay, không phải bấm thêm |
| Khách               | `/`                | Đúng là trang họ cần                                    |

`?next=` **luôn thắng**: bấm vào một link cụ thể rồi bị chặn ở cửa thì phải quay lại đúng chỗ đó.

Xem `src/lib/landing.ts`. Cố ý KHÔNG gọi hàm này trong `src/proxy.ts` — proxy chạy trước mọi
request trang, còn hàm đó hỏi database bốn lần.

### Đặt sân BẮT BUỘC đăng nhập

Bản đầu cho khách vãng lai đặt không cần tài khoản. Đó là luồng làm dở: lượt đặt ấy mang
`userId: null` nên **không bao giờ hiện ở "Lượt đặt của tôi" và khách không tự huỷ được** — mất
cái link chứa mã là mất đường vào chính lượt đặt của mình.

Nay chưa đăng nhập thì nút chuyển thành "Đăng nhập để đặt sân", kèm `?next=` giữ nguyên sân và
ngày đang xem. Đã đăng nhập thì KHÔNG hỏi lại tên; số điện thoại chỉ hỏi khi hồ sơ chưa có.

**Các ô đã chọn đi theo qua bước đăng nhập / đăng ký.** Đường quay lại mang thêm
`&chon=<courtId>~<phút>,…` (`encodeSelection` trong `src/lib/slots.ts`). Về tới trang sân:

1. Lưới dựng lại đúng các ô đó — chỉ những ô **còn trống**; ô bị người khác đặt mất trong lúc
   đăng nhập thì rơi ra và có dòng báo (`keepFreeSlots`).
2. Báo "Đã giữ nguyên N khung bạn chọn", cuộn thẳng tới nút đặt.
3. Gỡ `chon` khỏi thanh địa chỉ, để đặt xong bấm Quay lại không "hồi sinh" các ô vừa đặt.

**Không tự bấm đặt thay khách**: giữ chỗ là bắt đầu đếm ngược 10 phút thanh toán, và giá có thể đã
đổi trong lúc họ đăng nhập. Trang đưa họ về sát nút đặt; bấm là quyết định của họ.

Đặt hộ tại quầy vẫn giữ tên + số rời (`source: COUNTER`) — luồng khác, do nhân viên sân thao tác.

### Đặt nhiều sân một lần = MỘT lần thanh toán

Chọn Sân 1 lúc 13:00 và Sân 8 lúc 14:00 là **hai lượt đặt** ở database (mỗi lượt một sân + một dãy
giờ liền — ràng buộc chống trùng tính trên từng lượt), nhưng với khách đó là **một lần đặt**.

Trước đây nhiều lượt thì bị đá sang "Lượt đặt của tôi": không mã QR, phải thanh toán từng lượt.
v1 cũng hổng đúng chỗ này — nó chỉ tính tiền lượt đầu, phần còn lại ghi `TODO`.

| Tầng        | Làm gì                                                                                  |
| ----------- | --------------------------------------------------------------------------------------- |
| Database    | `bookings.checkout_code` = mã của lượt đầu, chung cho cả lần đặt; `NULL` = đứng riêng   |
| Giữ chỗ     | `BookingService.holdCheckout` — MỘT transaction: giữ được hết hoặc không giữ gì         |
| Thanh toán  | Mỗi lượt vẫn một `Payment`, nhưng chung nội dung `CS <mã lần đặt>`; QR = tổng tiền      |
| Màn khách   | `/bookings/<mã>` — liệt kê từng sân + giờ, một QR, một nút "Tôi đã chuyển khoản"        |
| Màn chủ sân | Hàng chờ gộp theo lần đặt: một thẻ, tổng tiền, một nút "Đã nhận đủ tiền" cho cả lần đặt |

Giữ **một `Payment` cho mỗi lượt** thay vì một giao dịch cho cả nhóm: huỷ một lượt, hoàn tiền một
lượt, doanh thu theo sân vẫn chạy nguyên như cũ, và chỉ số "một giao dịch sống cho mỗi lượt" vẫn
đúng nghĩa.

### Hạn giữ chỗ — ba luật

1. **Quá hạn thì không chiếm chỗ, dù cron chưa nhả.** Lịch tự tính (`occupyingBookingWhere`), và
   giữ chỗ mới nhả luôn chỗ quá hạn gối lên ngay trong transaction. Trước đây mọi `HOLDING` đều
   chiếm chỗ tới khi worker nhả — máy dev không chạy worker thì khoá sân **vĩnh viễn**.
2. **Khách báo chuyển khoản thì hạn bị xoá** (`holdExpiresAt = null`). Trước đây chỉ xoá hạn của
   giao dịch: chủ sân đối chiếu chậm hơn 10 phút là cron nhả chỗ của khách đã trả tiền.
3. **Chủ sân từ chối thì cấp hạn mới** — đủ để khách đọc lý do, sửa và báo lại.

Màn thanh toán của lần đặt đã quá hạn **không hiện QR**; thay bằng nút "Đặt lại các khung này" với
đúng các ô cũ được chọn sẵn (`?chon=`).

### Thao tác theo sân: id từ form phải thuộc đúng sân

`defineVenueAction` kiểm quyền trên `venueId` của URL — nhưng id lượt đặt, giao dịch, sân con thì
lấy từ **form**. Trước đây không ai kiểm id đó có thuộc sân kia không: nhân viên sân A gửi id của
sân B là **duyệt được tiền, huỷ được lượt, tắt được sân con của sân B**. Đã khoá cả năm chỗ
(duyệt tiền, từ chối tiền, nhận sân, huỷ, bật/tắt sân con) và bảng giá không nhận sân con của cơ
sở khác. Lệch sân thì báo **không tìm thấy**.

**Đã làm xong**: bảng `PlatformInvoice` (`@@unique([venueId, periodStart])` chống xuất trùng),
`InvoiceService`, cron xuất hoá đơn (từ 17/09: mỗi ngày 02:30, tự bù 3 tháng đã kết thúc) và đánh
dấu quá hạn 04:00 mỗi ngày,
màn đối soát `/invoices`, màn doanh thu của chủ sân.

Quyền `invoice:manage` TÁCH RIÊNG khỏi `payout:approve`: một bên là tiền THU VÀO từ chủ sân, một
bên là tiền CHI RA cho chủ sân. Dùng chung một quyền là mở đường chi tiền cho người chỉ được giao
việc đi thu.

## (cũ) Một quyết định còn chờ

**Tiền chuyển khoản tay vào tài khoản nào?** `Payment.receivedBy` đã có hai giá trị
(`PLATFORM` / `VENUE`) nên code chạy được cả hai đường, nhưng phải chọn một để làm màn đối soát:

- **Vào tài khoản nền tảng** — trừ hoa hồng tự động, nhưng nền tảng đang giữ tiền của người khác
  (có ràng buộc pháp lý).
- **Vào tài khoản sân** — đơn giản hơn nhiều, nhưng hoa hồng thành khoản nợ phải đi đòi.
