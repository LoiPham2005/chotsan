# Nghiệp vụ: lịch trống, giá, giữ chỗ, thanh toán, hoá đơn

Tệp chính: `src/lib/slots.ts`, `date.ts`, `pricing.ts`, `vietqr.ts`, `errors.ts`;
`src/services/availability.service.ts`, `booking.service.ts`, `payment.service.ts`,
`venue.service.ts`, `court.service.ts`, `review.service.ts`, `report.service.ts`, `invoice.service.ts`.

---

## 1. Toàn cảnh một lượt đặt

```
Khách: /venues → /venues/[slug]?date=YYYY-MM-DD → bấm ô (nhiều sân/nhiều khung)
  → (chưa đăng nhập) /login?next=/venues/[slug]?date=…&chon=<courtId~minute,…>  → quay về, ô còn nguyên
  → holdBookingAction → BookingService.holdCheckout  ⇒ các Booking HOLDING, chung checkoutCode
  → redirect /bookings/<mã lượt đầu>  (màn thanh toán của CẢ lần đặt)
  → PaymentService.start (mỗi lượt một Payment PENDING, nội dung "CS <mã lần đặt>") + transferInstruction (1 QR tổng)
  → "Tôi đã chuyển khoản" → declareTransfer  ⇒ Payment AWAITING_CONFIRMATION, Booking.holdExpiresAt = null
Chủ sân/nhân viên (payment:confirm): /manage/[venueId]/payments → một thẻ mỗi lần chuyển khoản
  → "Đã nhận đủ tiền" → approveManual  ⇒ Payment SUCCEEDED + Booking CONFIRMED  (hoặc rejectManual ⇒ FAILED + cấp hạn mới)
Tại sân: checkIn (CONFIRMED → CHECKED_IN)
Cuối tháng (cron): InvoiceService.generateForMonth ⇒ PlatformInvoice (hoa hồng chủ sân NỢ nền tảng)
```

---

## 2. Khung giờ và múi giờ

- `SLOT_MINUTES = 30` toàn hệ thống. Giờ mở cửa, luật giá, lựa chọn trên lưới dùng **phút-trong-ngày**
  (0–1440); `Booking`/`CourtClosure` dùng mốc tuyệt đối `timestamptz`.
- `slots.ts`: `slotRange(from, to)` (nửa mở), `overlaps(aStart, aEnd, bStart, bEnd)` (`aStart < bEnd && bStart < aEnd`
  — liền kề KHÔNG trùng), `countSlots`, `isSlotAligned`, `parseHhMm`/`formatHhMm`, `groupConsecutive`,
  **`slotsToRanges(slots)`** (gom theo sân rồi gộp khung liền → mỗi `{courtId, startMinute, endMinute}` là
  MỘT lượt đặt), `encodeSelection`/`decodeSelection` (`?chon=`, `courtId~minute` nối dấu phẩy; decode
  nhận `unknown`, bỏ phần tử sai, tối đa 48), `minuteOfDayInVN`, `weekdayInVN` (0 = CN),
  **`atMinuteVN(dateOnly, minute)`** (ngày VN + `+07:00` viết cứng; phút 1440 = nửa đêm hôm sau),
  `formatVnd`, `formatVndShort`.
- `date.ts`: `TIME_ZONE`, `dateKey(date)` (`YYYY-MM-DD` giờ VN), `parseDateKey(value)` (rác → hôm nay),
  `fromDateKey(key)` (12:00 VN — giữa trưa để cộng trừ không lệch ngày), `addDays`, `dayLabel`,
  `fullDateLabel`, `timeRangeLabel`, `timeOfDay`.
- **CẤM** `getHours()`/`getDate()`/`toLocaleDateString()` không có `timeZone` — container chạy UTC lệch 7 tiếng.
  SQL gom theo ngày dùng `AT TIME ZONE 'Asia/Ho_Chi_Minh'`.

---

## 3. Tính giá — `priceForSlot` (`src/lib/pricing.ts`)

Ba tầng, theo thứ tự:

1. **`PriceOverride`** đầu tiên khớp (`courtId` null hoặc đúng sân) và gối lên khung (nơi gọi đã lọc
   theo ngày; không xét priority).
2. **`PriceRule`**: lọc sân (null = cả cơ sở, hoặc đúng sân), thứ (`weekdays` rỗng = mọi ngày), gối khung;
   sắp `priority` giảm dần; bằng priority thì luật gắn **đích danh sân con** thắng luật cả cơ sở.
3. `basePrice` (`isPeak: false`). `AvailabilityService` truyền `basePrice = 0` → khung không luật nào phủ có
   giá **0đ** (xem nghi lỗi #3).

Giá lưu **theo khung 30 phút** (không theo giờ) để khỏi lệch tròn số. `totalForSlots` cộng các khung.
Giá LUÔN do service tính; form không bao giờ gửi tiền.

---

## 4. Lịch trống — `AvailabilityService`

**`occupyingBookingWhere(now)`** (export): lượt chiếm chỗ khi `CONFIRMED`/`CHECKED_IN`, hoặc `HOLDING`
với `holdExpiresAt` **null** (đã khai chuyển khoản) hoặc **> now**. Chỗ giữ quá hạn KHÔNG chiếm chỗ dù
cron chưa nhả.

**`forDay(venueId, date, { now, excludeBookingId })`** — 7 truy vấn song song (venue chưa xoá, `VenueHour`
theo thứ, courts bật + chưa xoá theo `sortOrder`, bookings chiếm chỗ trong ngày, closures, priceRules,
priceOverrides của ngày) → `DayAvailability { venueId, date, minutes[], courts[{courtId, courtName,
slots[{minute, status, price, isPeak}]}], summary[] (số sân FREE mỗi khung), isClosed }`.

- Chưa khai giờ cho thứ đó = **đóng cửa** (không đoán khung mặc định).
- Trạng thái ô, ưu tiên: **CLOSED** (bảo trì) > **TAKEN** > **PAST** (khung đã qua trong HÔM NAY giờ VN) > **FREE**.

**`quoteFromDay(day, range)`** (export, thuần) → `RangeQuote { courtId, startMinute, endMinute, courtName,
available, slotCount, total }`; `available` khi sân thuộc lưới, đủ số khung `floor((end−start)/30)` và mọi
khung FREE. **`quote(...)`** trả `null` nếu bất kỳ khung nào hỏng — không bao giờ báo giá một phần.
**`quoteMany({venueId, date, ranges, now})`** đọc lịch MỘT lần cho mọi dãy (dùng khi giữ chỗ).

---

## 5. Từ lưới tới giữ chỗ — `holdBookingAction`

`src/app/(public)/venues/[slug]/actions.ts`, bọc `defineAuthedAction` (bắt đăng nhập):

- Form (`src/components/booking/select-and-book.tsx`, id `dat-san`) gửi `venueId`, `date` (`YYYY-MM-DD`),
  `slots` (JSON `[{courtId, minute}]`), `customerPhone` (chỉ khi hồ sơ chưa có số), `customerNote`.
- Zod: phút 0–1439 tròn 30, **tối đa 48 ô** (`MAX_SLOTS`), sau `slotsToRanges` **tối đa 6 lượt** (`MAX_RANGES`).
  Lỗi ở trường ẩn trả MỘT câu hiện ra được (không trả `{fields}` mà giao diện không vẽ).
- Tên/số lấy từ hồ sơ (`nguoiDat.fullName ?? email`, `phone ?? customerPhone`); `source: "WEB"`.
- Gọi `bookingService.holdCheckout(...)`; `DomainError` → `{ error: message }` (câu đã ghi rõ sân + giờ);
  lỗi khác ném lên (không lộ thông điệp Prisma). Xong → `redirect(/bookings/<mã lượt đầu>)` NGOÀI try.
- Giao diện: `key={dateKey}` để đổi ngày là chọn lại từ đầu; chưa đăng nhập → link
  `/login?next=<đường dẫn + &chon=…>`; quay về thì `keepFreeSlots` dựng lại các ô còn trống, báo
  "Đã giữ nguyên N khung", gỡ `chon` khỏi URL (`history.replaceState`), cuộn tới nút đặt — KHÔNG tự bấm đặt.

---

## 6. Giữ chỗ — `BookingService.holdCheckout` (`hold()` là trường hợp một dãy)

1. Không có dãy → `SlotUnavailableError`.
2. `quoteMany` một lần; dãy nào không `available` → `SlotUnavailableError("<Sân> HH:MM–HH:MM không đặt được…")`
   **trước** transaction.
3. `holdExpiresAt = now + (venue.holdMinutes ?? DEFAULT_HOLD_MINUTES = 10)` phút.
4. Thử tối đa 3 lần:
   - Sinh mã 6 ký tự bằng `crypto.randomInt` từ bảng `23456789ACDEFGHJKMNPQRTUVWXY` (bỏ ký tự dễ lẫn khi đọc qua điện thoại).
   - `checkoutCode = codes[0]` nếu ≥ 2 dãy, ngược lại `null`.
   - **MỘT `$transaction`** (`maxWait: 10_000`, `timeout: 20_000` — mặc định 5s không đủ qua Neon). Mỗi dãy:
     **`releaseStaleHolds`** → `tx.booking.create` HOLDING (`subtotal = total = quote.total`, tên/số trim).
   - `isExclusionViolation` (23P01) → `SlotTakenError("<Sân> HH:MM–HH:MM vừa có người đặt mất…")` →
     Postgres cuộn lại CẢ lần đặt (không để lại nửa lần đặt, không dòng CANCELLED rác).
   - Trùng mã (`isUniqueViolation(error, "code")`) → cuộn lại, sinh bộ mã mới, thử lại CẢ transaction
     (không thử lại được trong cùng transaction — Postgres đã huỷ nó). Trùng khung thì KHÔNG thử lại.

**`releaseStaleHolds(tx, courtId, startAt, endAt, now)`**: `updateMany` lượt cùng sân, `HOLDING`,
`holdExpiresAt ≤ now`, gối khoảng mới → `EXPIRED`. Cần vì EXCLUDE vẫn tính mọi HOLDING (ràng buộc không
biết "bây giờ"). Lượt có hạn `null` (đã khai chuyển khoản) không bị đụng (`lte` không khớp `null`).

---

## 7. Vòng đời lượt đặt

```
(tạo) → HOLDING ──approveManual / handleWebhook / confirm──→ CONFIRMED ──checkIn──→ CHECKED_IN
            │                                                   │
            ├──cron expireHolds / releaseStaleHolds──→ EXPIRED  │
            └──cancel──→ CANCELLED ←──cancel────────────────────┘
COMPLETED, NO_SHOW: CHƯA có mã nào ghi.
```

| Hàm                                                                              | Hành vi                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirm(id)`                                                                    | Idempotent; HOLDING → CONFIRMED + xoá hạn. Chưa nơi nào gọi                                                                                                                                                                                                                                                                                                                   |
| `checkIn(id, { venueId, now })`                                                  | Đã CHECKED_IN → trả luôn; HOLDING → "Lượt đặt này chưa thanh toán"; chỉ CONFIRMED nhận sân                                                                                                                                                                                                                                                                                    |
| `cancel(id, { reason, cancelledBy, freeCancelHours, venueId, now })`             | Chặn CANCELLED/EXPIRED và CHECKED_IN/COMPLETED. `freeCancelHours = options ?? venue.freeCancelHours ?? 2`; `refundable = now ≤ startAt − freeCancelHours`; phí = `refundable ? 0 : (venue.cancelFeePercent ?? 100)`; `refundableAmount = round(total × (100 − phí) / 100)`. **Chỉ TRẢ LỜI** hoàn bao nhiêu — không tự hoàn (hoàn tiền là luồng riêng, quyền `payment:refund`) |
| `reschedule({ bookingId, courtId, date, startMinute, endMinute, actorId, now })` | Chỉ HOLDING/CONFIRMED; `quote` với `excludeBookingId`; một transaction: đặt CANCELLED (nhả khung cũ) → `releaseStaleHolds` → ghi lại trạng thái cũ + sân/giờ mới, `total = quote.total − discountTotal`. Chưa nơi nào gọi                                                                                                                                                     |
| `expireHolds({ now, venueId })`                                                  | MỘT câu `updateMany` HOLDING quá hạn → EXPIRED (an toàn khi nhiều worker). `venueId` chỉ dùng cho script kiểm tra                                                                                                                                                                                                                                                             |
| `findCheckout(code, { now })`                                                    | Tra bằng mã của BẤT KỲ lượt nào → cả lần đặt (`checkoutCode ?? code`): `code`, `venue`, `customerName/Phone`, `bookings[]` (kèm `startMinute`/`endMinute`, `payments`), `holding`, `holdingTotal`, `holdExpiresAt` (sớm nhất; null nếu có lượt không mang hạn), `holdExpired`, `rejectReason`. Tính "đã quá hạn" ở service vì page không được đọc đồng hồ                     |
| `listForUser(userId)`                                                            | `{ upcoming (endAt ≥ now, không CANCELLED/EXPIRED), past (≤ 30) }`, kèm `checkoutCode`                                                                                                                                                                                                                                                                                        |
| `findOwnedByUser(id, userId)`                                                    | Quyền sở hữu nằm trong `where`                                                                                                                                                                                                                                                                                                                                                |
| `listForVenueDay(venueId, date)`                                                 | Lịch chủ sân, kèm phút-trong-ngày                                                                                                                                                                                                                                                                                                                                             |

**Khoá theo sân**: `requireBooking(id, venueId?)` — `venueId` có mà lệch → `BookingNotFoundError`.
Đây là lọc phạm vi, KHÔNG phải khoá dòng (không có `FOR UPDATE`/advisory lock).

---

## 8. Thanh toán — `PaymentService`

Hằng số: `AUTO_PROVIDERS` = VNPAY/MOMO/ZALOPAY/SEPAY (chỉ webhook xác nhận); `LIVE_STATUSES` =
PENDING/AWAITING_CONFIRMATION; lượt trả được = HOLDING/CONFIRMED; `merchantRef = <mã>-<8 hex>`.

| Hàm                                                                                                  | Hành vi                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start({ bookingId, provider, receivedBy, now })`                                                    | Booking tồn tại, trả được, HOLDING chưa quá hạn (quá hạn → `BookingStateError`). **Đọc trước**: đã có giao dịch sống (bất kể provider) → trả về, không INSERT. Chưa có → tạo PENDING: `amount = booking.total`, `transferNote = "CS " + (checkoutCode ?? code)` (BANK_TRANSFER), `expiresAt = holdExpiresAt ?? now + 15'`. Thua cuộc đua (unique một phần) → đọc lại, trả cái đang có                       |
| `transferInstruction(paymentIds[])`                                                                  | Thiếu id → `PaymentNotFoundError`; lẫn nhiều sân → `PaymentStateError`; sân thiếu ngân hàng → `VenueBankAccountMissingError`; tiền = TỔNG, nội dung chung; `qrPayload` null nếu ngân hàng không có trong `BANK_BINS`                                                                                                                                                                                        |
| `declareTransfer({ paymentIds, note, proofImageUrl, now })`                                          | Mọi dòng phải đang sống; không còn PENDING → `{count: 0}` (khai hai lần không hỏng). MỘT transaction: booking HOLDING → `holdExpiresAt = null` (số dòng lệch = có lượt đã bị nhả → `BookingStateError`, cuộn lại) + payment PENDING → AWAITING_CONFIRMATION (`declaredAt`, xoá `expiresAt`). **KHÔNG xác nhận lượt đặt**                                                                                    |
| `approveManual({ paymentIds, venueId, reviewerId, now })`                                            | Lọc `booking.venueId` NGAY trong truy vấn; thiếu/lệch → NotFound CẢ LÔ. Có provider tự động → `ManualApprovalNotAllowedError`. Dòng không sống và không SUCCEEDED → `PaymentStateError`; không còn dòng sống → `{count: 0}`. Transaction: payment → SUCCEEDED (`paidAt`, `reviewedBy`); booking HOLDING → CONFIRMED + xoá hạn                                                                               |
| `rejectManual({ paymentIds, venueId, reviewerId, reason, now })`                                     | Lọc theo sân; mọi dòng phải sống. Transaction: payment → FAILED + `rejectReason`; booking HOLDING có hạn `null` → **cấp hạn mới** `now + holdMinutes` (không cấp = giữ chỗ vĩnh viễn)                                                                                                                                                                                                                       |
| `handleWebhook({ provider, externalEventId, merchantRef, succeeded, amount, payload, verified, … })` | Tìm theo `merchantRef` → **GHI `PaymentEvent` TRƯỚC** (trùng `(provider, externalEventId)` → "Sự kiện đã xử lý rồi") → chữ ký sai hoặc không có payment → dừng, không ném (ném là cổng gửi lại mãi) → đã SUCCEEDED/không sống → dừng → cổng báo thất bại → FAILED → **lệch tiền → `PaymentAmountMismatchError`** → thành công: transaction SUCCEEDED + booking CONFIRMED. `verified` do nơi gọi kiểm chữ ký |
| `expirePending({ now })`                                                                             | PENDING quá hạn → CANCELLED. **Không bao giờ đụng AWAITING** (tiền khách đã chuyển thật)                                                                                                                                                                                                                                                                                                                    |
| `pendingApprovals(venueId)`                                                                          | Các AWAITING của sân, **gộp theo `checkoutCode ?? code`**: `{ checkoutCode, transferNote, amount (tổng), declaredAt, declaredNote, proofImageUrl, customerName/Phone, items[{paymentId, bookingCode, courtName, startAt, endAt, amount}] }`                                                                                                                                                                 |
| `requestRefund` / `settleRefund`                                                                     | Chỉ SUCCEEDED/PARTIALLY_REFUNDED; số tiền trong `(0, amount − refundedAmount]`; tạo Refund PENDING rồi settle trong transaction (cộng `refundedAmount`, đặt REFUNDED/PARTIALLY_REFUNDED). Chưa nơi nào gọi                                                                                                                                                                                                  |

Trạng thái giao dịch: PENDING → AWAITING_CONFIRMATION → SUCCEEDED / FAILED; PENDING → CANCELLED (cron);
SUCCEEDED → PARTIALLY_REFUNDED / REFUNDED.

**Màn thanh toán** `/bookings/[code]` (`src/app/(public)/bookings/[code]/page.tsx`): mã lượt con →
`redirect` về mã lần đặt; không còn lượt HOLDING → màn kết quả; `holdExpired` → màn "Hết thời gian giữ
chỗ" (KHÔNG hiện QR, nút "Đặt lại các khung này" với `?chon=`); còn lại → `start` cho TỪNG lượt (mỗi lần
tải trang, an toàn nhờ đọc-trước + unique một phần) → tất cả AWAITING thì báo "Đã gửi cho sân", ngược lại
QR + `DeclareTransfer`. Chỉ nuốt `VenueBankAccountMissingError` (hiện câu gọi sân), lỗi khác ném lên.

`declareTransferAction` là `definePublicAction` (rate limit 8 lần/60 giây theo IP) — "biết mã" là quyền;
phải có giao dịch sống cho MỌI lượt holding, rồi `declareTransfer` cho cả nhóm.

Duyệt/từ chối ở `src/app/(manage)/manage/[venueId]/actions.ts` (`defineVenueAction("payment:confirm")`):
form gửi nhiều `paymentId` cùng tên → `formData.getAll("paymentId")` (1–50) → service kèm `ctx.venueId`.

**VietQR** (`src/lib/vietqr.ts`): `BANK_BINS` 16 ngân hàng (VCB 970436, TCB, MB, ACB, VPB, BIDV, VTB, TPB,
SCB, STB, HDB, OCB, MSB, SHB, EIB, AGB). `buildVietQrPayload` trả `null` nếu BIN ≠ 6 số, số tài khoản
ngoài 4–19 số, hoặc tiền không nguyên dương. TLV EMVCo: `00=01`, `01=12` (có tiền), `38={A000000727, {BIN,
STK}, QRIBFTTA}`, `53=704`, `54=tiền`, `58=VN`, `62={08 nội dung}`, `6304` + CRC-16/CCITT-FALSE tính trên
chuỗi ĐÃ gồm "6304". `sanitizeTransferNote`: bỏ dấu, `đ→d`, chỉ `[A-Za-z0-9 ]`, tối đa 25 ký tự. QR dựng ở
máy chủ, trình duyệt tự vẽ (`qrcode` → canvas) — không gửi số tài khoản qua dịch vụ ngoài.

---

## 9. Dòng tiền và hoá đơn hoa hồng

Tiền đặt sân vào **thẳng tài khoản của sân**; nền tảng không giữ hộ. Mỗi tháng xuất **hoá đơn hoa hồng**
= khoản chủ sân NỢ nền tảng; quá hạn thì có đòn bẩy khoá sân (tự khoá CHƯA làm).

`InvoiceService.generateForMonth(anyDayOfMonth)`:

1. Kỳ = tháng theo giờ VN.
2. `groupBy venueId` các booking có `startAt` trong kỳ và trạng thái đã bán (CONFIRMED/CHECKED_IN/COMPLETED).
3. Bỏ qua doanh thu ≤ 0 hoặc `venue.commissionRate` null/≤ 0 (chỉ seed ghi `commissionRate` → cơ sở mới
   sẽ không bao giờ bị lập hoá đơn cho tới khi có màn đặt tỉ lệ).
4. `periodStart`/`periodEnd` (ngày VN), `dueDate = periodEnd + 15 ngày`, `number = CS-YYYYMM-<6 ký tự cuối venueId>`,
   `commissionAmount = round(gross × rate / 100)`, `status = DUE`.
5. P2002 → coi là đã xuất (idempotent nhờ unique `(venue_id, period_start)`).

Khác: `listByStatus` (tính sẵn `overdueDays` — page không đọc đồng hồ), `listForVenue`, `markPaid`
(WAIVED → `InvoiceWaivedError`, PAID → trả luôn), `waive({ invoiceId, by, reason })` (PAID → `InvoicePaidError`),
`markOverdue(now)` (một `updateMany` DUE có `dueDate` < hôm nay VN). Màn `/invoices` cần `invoice:manage`.
`ReportService.venueSummary` cũng trả `commissionOwed`.

**Cron** (BullMQ `upsertJobScheduler` trong `worker/worker.ts`, handler ở `src/jobs/handlers.ts`, job
không thử lại):

| Job                         | Biến / mặc định                      | Làm gì                                                      |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------- |
| `booking:expire-holds`      | `CRON_EXPIRE_HOLDS` = `* * * * *`    | `expireHolds()` — chỉ để dọn; lịch vẫn đúng khi worker chết |
| `payment:expire-pending`    | dùng chung `CRON_EXPIRE_HOLDS`       | `expirePending()`                                           |
| `invoice:generate-monthly`  | `CRON_INVOICE_MONTHLY` = `0 2 1 * *` | `generateForMonth(now − 5 ngày)` = chốt THÁNG TRƯỚC         |
| `invoice:mark-overdue`      | `CRON_INVOICE_OVERDUE` = `0 4 * * *` | `markOverdue()`                                             |
| `maintenance:purge-expired` | `CRON_PURGE_EXPIRED` = `0 3 * * *`   | dọn token/nhật ký cũ                                        |

Worker chết: lịch trống vẫn đúng, nhưng PENDING không bị huỷ, hoá đơn không được xuất/đánh dấu quá hạn.

---

## 10. Cơ sở và sân con

**Trạng thái cơ sở**: DRAFT (mặc định khi tạo) → PENDING (chờ duyệt — CHƯA có mã nào ghi, nên hàng
chờ duyệt thực tế luôn rỗng) → ACTIVE. SUSPENDED = chủ tự nghỉ (`softDelete` cũng đặt giá trị này),
UNDER_MAINTENANCE = bảo trì, ADMIN_LOCKED = chỉ admin vào/gỡ.

`VenueService`:

- `setStatus(venueId, status, { byAdmin, inactiveNote })`: vào/ra ADMIN_LOCKED không có `byAdmin` →
  `VenueAdminLockedError`; sang ACTIVE cần ≥ 1 ngày mở cửa, ≥ 1 sân con bật, ≥ 1 luật giá (thiếu →
  `VenueNotReadyError(missing)`) và xoá `inactiveNote`. Nơi gọi duy nhất: `decideVenueAction` (admin,
  `venue:approve`, `decision ∈ {ACTIVE, ADMIN_LOCKED}`, từ chối bắt buộc ghi chú).
- `search({ q, sportKey, province, ward, maxPricePerSlot, page, limit ≤ 50 })`: ACTIVE, chưa xoá; `q` ILIKE
  trên name/address (trigram); sắp theo rating; `findMany` và `count` chạy `Promise.all` — **cố ý không
  transaction** (batch transaction từng hết giờ trên Neon). Trả `imageUrl` = ảnh `isPrimary`,
  `fromPricePerSlot` = luật giá rẻ nhất.
- `publicDetail(slug)` (chỉ ACTIVE; kèm images theo `sortOrder`, hours, courts bật), `forManage(venueId)`
  (mọi trạng thái; giờ, ngân hàng, chính sách), `listPendingApproval`, `listForUser(userId)` (sân người
  đó là thành viên ACTIVE, kèm ảnh bìa), `update` (action kiểm `holdMinutes` 5–120, `freeCancelHours`
  0–168, `cancelFeePercent` 0–100, `bankName ∈ BANK_BINS`), `setHours` (thứ 0–6, giờ tròn 30, mở < đóng ≤
  1440; thay CẢ TUẦN trong transaction), `create` (slug không dấu, thử `-2`…`-20`; venue DRAFT + OWNER —
  chưa nơi nào gọi), `softDelete`.

`CourtService`: `create`, `update(courtId, input, { venueId })` (lệch cơ sở → `CourtNotFoundError`),
`reorder(venueId, courtIds)` (phải khớp đúng các sân), `setPriceRules(venueId, rules)` (mọi `courtId` phải
thuộc cơ sở; khung tròn 30; giá nguyên ≥ 0 — 0đ được phép; thứ 0–6; kiểm TOÀN BỘ rồi mới xoá + tạo lại
trong transaction), `listPriceRules`, `listForVenue`; `close` (≤ 365 ngày, trả `affectedBookings`, KHÔNG
huỷ lượt nào), `reopen`, `softDelete`, `setPriceOverride` (ngày `T00:00Z`), `removePriceOverride` — nhóm
cuối chưa màn nào gọi và CHƯA lọc theo cơ sở.

---

## 11. Đánh giá và doanh thu

- `ReviewService.create({ bookingId, userId, rating, comment, now })`: lượt của CHÍNH người đó
  (`findFirst({id, userId})`), chưa đánh giá, đã kết thúc (`endAt ≤ now`), trạng thái CHECKED_IN/COMPLETED,
  điểm 1–5 (`ReviewRatingError`). Transaction: tạo review + TÍNH LẠI `ratingAvg`/`ratingCount` bằng
  `aggregate` các review không ẩn. `reply({ reviewId, venueId, reply })` lọc theo sân. `listForVenue` chỉ
  lấy review không ẩn.
- `ReportService`: doanh thu từ `bookings.total` trạng thái đã bán (không từ payments — khách thử nhiều
  cách trả sẽ đếm trùng). `venueSummary(venueId, { from, to })` → `revenue`, `discountTotal`,
  `cancelledCount` (CANCELLED + NO_SHOW), `holdingCount`, `commissionOwed`, `byCourt`. `dailyRevenue` →
  SQL thô `to_char(start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`, đổi `bigint` → `number`.

---

## 12. Lỗi nghiệp vụ (`src/lib/errors.ts`)

Mọi lỗi kế thừa `DomainError` với `code` là hợp đồng với client; HTTP qua `DOMAIN_STATUS`
(`src/lib/api/response.ts`): VALIDATION_ERROR 422, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404,
CONFLICT 409, ACCOUNT_BANNED 403, ACCOUNT_LOCKED 423, RATE_LIMITED 429, PROVIDER_ERROR 502,
TWO_FACTOR_REQUIRED 401. Action bắt `DomainError` → `{ error: message }`; lỗi khác ném lên.

| Lớp                                         | Mã               | Khi nào                                                                                                                |
| ------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SlotTakenError(msg?)`                      | CONFLICT         | 23P01 trong `holdCheckout`/`reschedule`                                                                                |
| `SlotUnavailableError(msg?)`                | CONFLICT         | không có dãy; báo giá hỏng; khung mới của `reschedule` không đặt được                                                  |
| `BookingNotFoundError`                      | NOT_FOUND        | không tồn tại / lệch sân / review không phải của mình                                                                  |
| `BookingStateError(msg)`                    | CONFLICT         | sai trạng thái; hết hạn giữ chỗ; khai khi lượt đã bị nhả; điều kiện đánh giá                                           |
| `PaymentNotFoundError`                      | NOT_FOUND        | thiếu id, lệch sân, danh sách rỗng                                                                                     |
| `PaymentStateError(msg)`                    | CONFLICT         | QR gộp nhiều sân; khai/duyệt/từ chối sai trạng thái; hoàn tiền giao dịch chưa thành công                               |
| `ManualApprovalNotAllowedError(provider)`   | CONFLICT         | duyệt tay giao dịch cổng tự động                                                                                       |
| `PaymentAmountMismatchError`                | CONFLICT         | webhook báo thành công nhưng lệch tiền                                                                                 |
| `VenueBankAccountMissingError`              | CONFLICT         | sân chưa khai ngân hàng khi dựng QR                                                                                    |
| `RefundAmountError(remaining)`              | CONFLICT         | số tiền hoàn ≤ 0 hoặc vượt số còn lại                                                                                  |
| `VenueNotFoundError` / `CourtNotFoundError` | NOT_FOUND        | không tồn tại, đã xoá, lệch cơ sở                                                                                      |
| `VenueConfigError(msg)`                     | VALIDATION_ERROR | giờ/giá/đè giá/sắp xếp/khoảng đóng sai; luật giá gắn sân con của cơ sở khác                                            |
| `VenueAdminLockedError`                     | FORBIDDEN        | vào/ra ADMIN_LOCKED không có `byAdmin`                                                                                 |
| `VenueNotReadyError(missing)`               | CONFLICT         | mở bán khi thiếu giờ/sân con/bảng giá                                                                                  |
| `CancelWindowPassedError`                   | CONFLICT         | khai báo nhưng không nơi nào ném                                                                                       |
| Ngoài `errors.ts`                           |                  | `ReviewRatingError` (review.service), `InvoiceNotFoundError`/`InvoicePaidError`/`InvoiceWaivedError` (invoice.service) |

---

## 13. Chưa làm

- Chưa có REST API/route webhook cho sân, đặt sân, thanh toán → `handleWebhook`, cổng tự động, app mobile
  đặt sân đều chưa nối. Chưa có đặt tại quầy (COUNTER), tiền mặt, hoàn tiền.
- Chưa có luồng DRAFT → PENDING (chủ sân nộp hồ sơ), tải/quản lý ảnh, đặt tỉ lệ hoa hồng, tự khoá sân khi
  hoá đơn OVERDUE, ẩn review, ghi COMPLETED/NO_SHOW, voucher, khiếu nại, yêu thích, cấu hình `Setting`.
- Hàm service có mà chưa nơi nào gọi: `confirm`, `reschedule`, `findByCode`, `VenueService.create`/`softDelete`,
  `CourtService.softDelete`/`close`/`reopen`/`setPriceOverride`/`removePriceOverride`, `requestRefund`/`settleRefund`.

---

## 14. Nghi lỗi ĐÃ BIẾT (chưa sửa — kiểm lại trong mã trước khi sửa, sửa xong xoá dòng)

**Đặt sân**

1. **Không kiểm trạng thái cơ sở khi giữ chỗ**: `forDay` và `holdCheckout` chỉ lọc `deletedAt`; request tự
   chế đặt được cơ sở DRAFT/SUSPENDED/ADMIN_LOCKED.
2. **Đặt được ngày đã qua**: ngày khác hôm nay thì `nowMinute = -1` → mọi khung ngày quá khứ FREE; action
   chỉ kiểm định dạng ngày.
3. **Khung 0đ gây 500 ở trang thanh toán**: không luật giá nào phủ → giá 0 (`basePrice: 0`) → lượt `total = 0`
   → `payment.create` vi phạm CHECK `amount > 0` → trang chỉ bắt `BookingStateError`. `setStatus` chỉ đếm số
   luật, không kiểm luật phủ hết giờ mở cửa.
4. Service không tự kiểm phút tròn 30 (action đã chặn bằng zod); hai dãy trùng nhau trong cùng lần đặt báo
   nhầm "vừa có người đặt mất".
5. `reschedule` chưa có tham số `venueId` (vi phạm GOTCHAS #19 khi được nối vào); không điều chỉnh payment;
   `total − discountTotal` có thể âm; `cancelledAt: new Date()` bỏ qua `now`.
6. **`cancel`**: đọc rồi cập nhật không điều kiện (đua với duyệt tiền/webhook); **không huỷ giao dịch đang
   sống** — giao dịch AWAITING của lượt đã huỷ vẫn nằm trong hàng chờ, chủ sân duyệt thì payment SUCCEEDED
   mà booking CANCELLED; `refundableAmount` tính cả cho lượt HOLDING chưa trả tiền nên khách huỷ lượt chưa
   trả vẫn thấy "Sân sẽ hoàn Xđ"; huỷ trễ phí < 100% lại báo "không được hoàn" dù còn tiền hoàn
   (`(account)/account/bookings/actions.ts`); NO_SHOW vẫn huỷ được.
7. "Chỗ giữ quá hạn không chiếm chỗ" mới chỉ có ở lịch: `listForUser`, `listForVenueDay`, `CourtService.close`,
   `ReportService.holdingCount` vẫn coi HOLDING quá hạn là còn sống.

**Thanh toán**

8. `start` nhận cả booking CONFIRMED (tạo PENDING mới cho lượt đã trả — chưa nơi nào gọi kiểu đó) và trả giao
   dịch sống khác provider mà không báo.
9. `declareTransfer`/`rejectManual` không kiểm provider (giao dịch cổng tự động có thể thành AWAITING rồi không
   duyệt tay được).
10. `approveManual`/`handleWebhook` vẫn đặt SUCCEEDED khi booking không còn HOLDING (EXPIRED/CANCELLED) — tiền
    ghi nhận mà không có sân, không cảnh báo, không tạo hoàn tiền.
11. Webhook lệch tiền ném lỗi SAU khi đã ghi event → cổng gửi lại bị coi là trùng, lệch tiền chỉ lộ một lần trong log.
12. `requestRefund` không trừ refund đang PENDING; `settleRefund` đọc ngoài transaction (hai lần settle đồng thời
    có thể mất cập nhật; lưới cuối là CHECK).
13. `Payment.receivedBy` mặc định PLATFORM trái mô hình tiền về sân (trang thanh toán tự truyền VENUE).
14. Trang `/bookings/[code]` mở giao dịch ngay khi GET — bot/trình xem trước link cũng ghi DB (không nhân bản nhờ unique).

**Cơ sở, hoá đơn, đánh giá**

15. Từ chối hồ sơ cơ sở dùng luôn ADMIN_LOCKED (gộp "bị từ chối" với "bị khoá vì vi phạm"); `setStatus` không
    có đồ thị chuyển trạng thái.
16. `publicDetail` chỉ trả ACTIVE nhưng lại chọn `inactiveNote` → khách không bao giờ đọc được lý do đóng.
17. Luật giá/đè giá chồng nhau cùng priority cho giá không xác định (truy vấn không `orderBy`).
18. Thiếu FK: `PriceRule.courtId`, `PriceOverride.venueId`, `Voucher.venueId`, `Dispute.userId`; DB không ép
    `booking.venueId` khớp `court.venueId`; EXCLUDE không biết tới `CourtClosure`.
19. **`isDuplicatePeriod` coi MỌI P2002 là "đã xuất"**: hai sân trùng 6 ký tự cuối id → số hoá đơn trùng →
    hoá đơn sân thứ hai bị bỏ qua IM LẶNG. Hàm tự dò lỗi thay vì dùng `prisma-errors`.
20. Job `invoice:generate-monthly` chạy `attempts: 1` và luôn chốt "tháng trước" → lần chạy mùng 1 hỏng là mất
    hẳn tháng đó. Hoá đơn là ảnh chụp: lượt xác nhận/hoàn tiền về sau không điều chỉnh; dùng tỉ lệ hiện tại.
21. `platform_invoices` còn cột camelCase `"createdAt"`/`"updatedAt"`.
22. Hai review đồng thời cho cùng sân làm lệch điểm trung bình (đua đọc-ghi); `reply` ném `BookingNotFoundError`
    cho review không tồn tại; `Math.round(NaN)` lọt qua kiểm điểm.
23. Múi giờ bị chép lại ở `availability.service.ts` và `invoice.service.ts` thay vì dùng `date.ts`.
