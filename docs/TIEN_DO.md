# Tiến độ ChốtSân

Cập nhật: **04/09/2026**. Kế hoạch đầy đủ ở [KE_HOACH_REFACTOR.md](KE_HOACH_REFACTOR.md); tệp này
chỉ nói **đã làm được gì, còn gì**, để mở ra là biết đứng ở đâu.

Số liệu hiện tại: **555 unit test / 49 tệp** + **28 bài e2e Playwright** — tất cả xanh, `pnpm check` xanh, `pnpm db:check-conflict` **14/14**
trên database thật.

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

| Thứ                                   | Tệp                                  | Test    |
| ------------------------------------- | ------------------------------------ | ------- |
| 21 bảng nghiệp vụ + model auth        | `prisma/schema.prisma`               | —       |
| `EXCLUDE USING gist` chống trùng chỗ  | migration `chong_trung_booking`      | DB thật |
| 36 quyền, 3 vai trò nền tảng          | `src/lib/permissions.ts`             | ✅      |
| `canOnVenue` / `venuesWithPermission` | `src/services/permission.service.ts` | ✅      |
| `defineVenueAction`                   | `src/lib/define-action.ts`           | ✅      |
| `requireVenuePermission` (trả 404)    | `src/lib/api/auth.ts`                | ✅      |

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

## Bốn chốt chặn tiền đã chứng minh trên database thật

Chạy `pnpm db:check-conflict` — script tự tạo sân riêng, chạy thao tác **đồng thời thật**, rồi tự
xoá. Unit test dùng mock chỉ kiểm ĐƯỜNG XỬ LÝ khi lỗi bắn ra; script này kiểm rằng lỗi **thật sự**
bắn ra.

1. Hai người bấm đặt cùng một khung trong cùng một giây → đúng một người thắng.
2. Khách bấm "Thanh toán" hai lần → đúng một giao dịch, không mở được hai trang thanh toán.
3. Webhook cổng thanh toán gửi lại → không xác nhận lần hai.
4. Cổng báo về số tiền lệch → dừng, không xác nhận, dù webhook nói "thành công".

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

**Đã làm xong**: bảng `PlatformInvoice` (`@@unique([venueId, periodStart])` chống xuất trùng),
`InvoiceService`, cron xuất hoá đơn 02:00 mùng 1 hằng tháng và đánh dấu quá hạn 04:00 mỗi ngày,
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
