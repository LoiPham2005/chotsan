# Nghiệp vụ: lịch trống, giá, giữ chỗ, thanh toán, hoá đơn

Tệp chính: `src/lib/slots.ts`, `date.ts`, `pricing.ts`, `vietqr.ts`, `booking-status.ts`, `errors.ts`;
`src/services/availability.service.ts`, `booking.service.ts`, `payment.service.ts`,
`venue.service.ts`, `court.service.ts`, `review.service.ts`, `report.service.ts`, `invoice.service.ts`;
lịch job ở `src/jobs/schedules.ts` + `src/jobs/handlers.ts`.

(Cập nhật sau đợt sửa lỗi 17/09/2026.)

---

## 1. Toàn cảnh một lượt đặt

```
Khách: /venues (?mon=, ?tinh=) → /venues/[slug]?date=YYYY-MM-DD → bấm ô (nhiều sân/nhiều khung)
  → (chưa đăng nhập) /login?next=/venues/[slug]?date=…&chon=<courtId~minute,…>  → quay về, ô còn nguyên
  → holdBookingAction (POST) → BookingService.holdCheckout  ⇒ các Booking HOLDING, chung checkoutCode
       → ngay trong POST: PaymentService.start cho TỪNG lượt (BANK_TRANSFER, receivedBy VENUE)
  → redirect /bookings/<mã lượt đầu>  (màn thanh toán của CẢ lần đặt — BẮT đăng nhập, chỉ ĐỌC)
       → thiếu giao dịch thì nút "Tạo mã chuyển khoản" (openTransferAction)
  → "Tôi đã chuyển khoản" → declareTransferAction  ⇒ Payment AWAITING_CONFIRMATION, Booking.holdExpiresAt = null
Chủ sân/nhân viên (payment:confirm): /manage/[venueId]/payments → một thẻ mỗi lần chuyển khoản
  → "Đã nhận đủ tiền" → approveManual  ⇒ Payment SUCCEEDED + Booking CONFIRMED  (hoặc rejectManual ⇒ FAILED + cấp hạn mới)
Tại sân: checkIn (CONFIRMED → CHECKED_IN)
Hằng ngày 02:30 (cron): InvoiceService.generateMissing ⇒ PlatformInvoice cho 3 tháng đã kết thúc (hoa hồng chủ sân NỢ nền tảng)
```

---

## 2. Khung giờ và múi giờ

- `SLOT_MINUTES = 30` toàn hệ thống. Giờ mở cửa, luật giá, lựa chọn trên lưới dùng **phút-trong-ngày**
  (0–1440, `MINUTES_PER_DAY`); `Booking`/`CourtClosure` dùng mốc tuyệt đối `timestamptz`.
- `slots.ts`: `slotRange(from, to)` (nửa mở), `overlaps(aStart, aEnd, bStart, bEnd)` (`aStart < bEnd && bStart < aEnd`
  — liền kề KHÔNG trùng), `countSlots`, `isSlotAligned`, `parseHhMm`/`formatHhMm`, `groupConsecutive`,
  **`slotsToRanges(slots)`** (gom theo sân rồi gộp khung liền → mỗi `{courtId, startMinute, endMinute}` là
  MỘT lượt đặt), `encodeSelection`/`decodeSelection` (`?chon=`, `courtId~minute` nối dấu phẩy; decode
  nhận `unknown`, bỏ phần tử sai, tối đa 48), `minuteOfDayInVN`, `weekdayInVN` (0 = CN),
  **`atMinuteVN(dateOnly, minute)`** (ngày VN + `+07:00` viết cứng; phút 1440 = nửa đêm hôm sau),
  `formatVnd`, `formatVndShort`.
- `date.ts`: `TIME_ZONE`, `dateKey(date)` (`YYYY-MM-DD` giờ VN), `parseDateKey(value)` (rác → hôm nay),
  `fromDateKey(key)` (12:00 VN — giữa trưa để cộng trừ không lệch ngày), `addDays`, `dayLabel`,
  `fullDateLabel`, `timeRangeLabel`, `timeOfDay`. `availability.service` và `invoice.service` đều đi qua
  `date.ts` (không còn tự dựng `Intl.DateTimeFormat`).
- **CẤM** `getHours()`/`getDate()`/`toLocaleDateString()` không có `timeZone` — container chạy UTC lệch 7 tiếng.
  SQL gom theo ngày dùng `AT TIME ZONE 'Asia/Ho_Chi_Minh'`.
- ⚠️ `new Date("2026-02-31")` lặng lẽ cuộn sang 03/03. Kiểm ngày có thật bằng `dateKey(fromDateKey(v)) === v`
  (action giữ chỗ) hoặc so `dateKey` của `<key>T00:00:00Z` với chính `key` (`setPriceOverride`).

---

## 3. Tính giá — `priceForSlot` (`src/lib/pricing.ts`)

Thuần tuý, không chạm DB. Ba tầng, tầng trên thắng:

1. **`PriceOverride`** (nơi gọi đã lọc theo ngày): lọc `courtId` null hoặc đúng sân + gối khung; **không xét
   priority**. Chồng nhau → sắp `specificFirstThenNewest`: đè **riêng sân con** thắng đè cả cơ sở → **mới
   hơn** (`createdAt`) → `id` nhỏ hơn.
2. **`PriceRule`**: lọc sân (null = cả cơ sở, hoặc đúng sân), thứ (`weekdays` rỗng = mọi ngày), gối khung;
   sắp **`priority` giảm dần** → luật **riêng sân con** → **mới hơn** → `id`. Thứ tự chốt TRONG hàm nên
   không phụ thuộc thứ tự DB trả về (bản cũ không `orderBy` → lưới 70k mà giữ chỗ 110k).
3. `basePrice` (`isPeak: false`). `AvailabilityService` truyền `basePrice = 0` → khung không luật nào phủ có
   giá 0 → ô **`NOT_FOR_SALE`** (xem §4), không bao giờ bán 0đ.

Đầu vào `PriceRuleInput`/`PriceOverrideInput` BẮT BUỘC có `id` + `createdAt` (để phân định hoà).
Giá lưu **theo khung 30 phút** (không theo giờ) để khỏi lệch tròn số. `totalForSlots` cộng các khung.
Giá LUÔN do service tính; form không bao giờ gửi tiền.

---

## 4. Lịch trống — `AvailabilityService`

**`occupyingBookingWhere(now)`** (export, dùng chung với `CourtService.close`): lượt chiếm chỗ khi
`CONFIRMED`/`CHECKED_IN`, hoặc `HOLDING` với `holdExpiresAt` **null** (đã khai chuyển khoản) hoặc **> now**.
Chỗ giữ quá hạn KHÔNG chiếm chỗ dù cron chưa nhả.

**`forDay(venueId, date, { now, excludeBookingId })`** — 7 truy vấn song song (venue **`status: ACTIVE`** +
chưa xoá, `VenueHour` theo thứ, courts bật + chưa xoá theo `sortOrder`, bookings chiếm chỗ trong ngày,
closures, priceRules, priceOverrides của ngày — hai bảng giá chọn kèm `id`, `createdAt`) →
`DayAvailability { venueId, date, timing, minutes[], courts[{courtId, courtName, slots[{minute, status,
price, isPeak}]}], summary[] (số sân FREE mỗi khung), isClosed }`.

- Cơ sở không ACTIVE (DRAFT/PENDING/SUSPENDED/UNDER_MAINTENANCE/ADMIN_LOCKED) → lưới rỗng `isClosed: true`,
  kể cả khi gọi thẳng bằng `venueId` tự chế.
- Chưa khai giờ cho thứ đó = **đóng cửa** (không đoán khung mặc định).
- `timing: "PAST" | "TODAY" | "FUTURE"` — so `dateKey(date)` với `dateKey(now)`; giao diện nói "ngày này đã
  qua" khác "hôm nay đã hết giờ".
- Trạng thái ô, ưu tiên: **CLOSED** (bảo trì) > **TAKEN** > **PAST** > **NOT_FOR_SALE** (giá ≤ 0) > **FREE**.
  PAST = giờ BẮT ĐẦU khung ≤ `now` theo mốc tuyệt đối → áp cho **mọi ngày** (ngày đã qua toàn PAST), khớp
  đúng điều kiện `holdCheckout` từ chối.

**`quoteFromDay(day, range)`** (export, thuần) → `RangeQuote { courtId, startMinute, endMinute, courtName,
available, reason, slotCount, total }`. `reason: RangeUnavailableReason | null`:
`DAY_CLOSED` (nghỉ cả ngày/cơ sở không mở bán) → `COURT` (sân con không thuộc lưới) → `OUTSIDE_HOURS`
(thiếu khung so với `floor((end−start)/30)`) → khung chặn đầu tiên theo `BLOCKING_ORDER = PAST, CLOSED,
TAKEN, NOT_FOR_SALE`. Không available thì `slotCount = total = 0`.
**`quote(...)`** trả `null` nếu dãy không available — không bao giờ báo giá một phần.
**`quoteMany({venueId, date, ranges, now})`** đọc lịch MỘT lần cho mọi dãy (dùng khi giữ chỗ).

**Trang sân** `/venues/[slug]`: `venueService.publicDetail(slug)` trả cả UNDER_MAINTENANCE/SUSPENDED kèm
`bookable` (= ACTIVE). Không bookable → KHÔNG gọi `forDay`, hiện băng thông báo + `inactiveNote`.
Trang `/venues` có ô lọc tỉnh `?tinh=` lấy từ `venueService.listActiveProvinces()` (distinct, sắp `localeCompare("vi")`).

---

## 5. Từ lưới tới giữ chỗ — `holdBookingAction`

`src/app/(public)/venues/[slug]/actions.ts`, bọc `defineAuthedAction` (bắt đăng nhập):

- Form (`src/components/booking/select-and-book.tsx`, id `dat-san`) gửi `venueId`, `date` (`YYYY-MM-DD`),
  `slots` (JSON `[{courtId, minute}]`), `customerPhone` (chỉ khi hồ sơ chưa có số), `customerNote`.
- Zod: ngày phải có thật (chặn 31/02); phút 0–1439 tròn 30, **tối đa 48 ô** (`MAX_SLOTS`); ngày < hôm nay
  (giờ VN) → một câu "Ngày này đã qua"; sau `slotsToRanges` **tối đa 6 lượt** (`MAX_RANGES`).
  Lỗi ở trường ẩn trả MỘT câu hiện ra được (không trả `{fields}` mà giao diện không vẽ).
- Tên/số lấy từ hồ sơ (`fullName ?? email`, `phone ?? customerPhone`); `source: "WEB"`.
- Gọi `bookingService.holdCheckout(...)`; `DomainError` → `{ error: message }` (câu đã ghi rõ sân + giờ + lý
  do); lỗi khác ném lên (không lộ thông điệp Prisma).
- Giữ xong → `Promise.allSettled` mở giao dịch `paymentService.start` (BANK_TRANSFER,
  `receivedBy: "VENUE"`) cho từng lượt NGAY TRONG POST (hỏng không phải `DomainError` thì `logger.error`, không chặn) →
  `redirect(/bookings/<mã lượt đầu>)` NGOÀI try.
- Giao diện: `key={dateKey}` để đổi ngày là chọn lại từ đầu; chưa đăng nhập → link
  `/login?next=<đường dẫn + &chon=…>`; quay về thì `keepFreeSlots` dựng lại các ô còn trống, báo
  "Đã giữ nguyên N khung", gỡ `chon` khỏi URL (`history.replaceState`), cuộn tới nút đặt — KHÔNG tự bấm đặt.
- ⚠️ React 19 reset form sau MỌI lần action chạy xong, kể cả khi lỗi: dùng ô có kiểm soát hoặc trả `values`
  làm `defaultValue` (`<select>` cần `key` để nhận lại giá trị).

---

## 6. Giữ chỗ — `BookingService.holdCheckout` (`hold()` là trường hợp một dãy)

Kiểm TRƯỚC transaction, theo thứ tự:

1. Không có dãy → `SlotUnavailableError`; `date` NaN → `BookingValidationError`.
2. `assertRangeShape` từng dãy: phút nguyên trong 0–1440, **tròn 30**, bắt đầu < kết thúc →
   `BookingValidationError`.
3. Hai dãy **chồng nhau trên cùng sân trong cùng lần đặt** → `BookingValidationError` (không còn báo nhầm
   "vừa có người đặt mất").
4. Có dãy mà giờ bắt đầu (`atMinuteVN`) ≤ `now` → `SlotUnavailableError("… đã qua giờ")`.
5. Cơ sở không tồn tại/xoá hoặc `status !== "ACTIVE"` → **`VenueNotBookableError`**.
6. `quoteMany` một lần; dãy nào không `available` → `SlotUnavailableError(unavailableMessage(label, reason))`
   — câu riêng cho DAY_CLOSED/COURT/OUTSIDE_HOURS/PAST/CLOSED/NOT_FOR_SALE/TAKEN.
7. Dãy nào `total ≤ 0` → `SlotUnavailableError` (câu NOT_FOR_SALE) — chốt cuối, không bao giờ giữ lượt 0đ.

Rồi `holdExpiresAt = now + (venue.holdMinutes ?? DEFAULT_HOLD_MINUTES = 10)` phút, thử tối đa 3 lần:

- Sinh mã 6 ký tự bằng `crypto.randomInt` từ `23456789ACDEFGHJKMNPQRTUVWXY`. `checkoutCode = codes[0]` nếu
  ≥ 2 dãy, ngược lại `null`.
- **MỘT `$transaction`** (`maxWait: 10_000`, `timeout: 20_000` — mặc định 5s không đủ qua Neon):
  1. **`lockCourts(tx, venueId, courtIds)`**: một câu SQL thô `SELECT c.id FROM courts c JOIN venues v`
     lọc `c.id IN (…)`, `c.venue_id = venueId`, `c.is_active`, `c.deleted_at IS NULL`, `v.status = 'ACTIVE'`,
     `v.deleted_at IS NULL`, `ORDER BY c.id FOR UPDATE OF c`. Thiếu dòng → `SlotUnavailableError` ("Sân vừa
     tạm ngừng nhận đặt hoặc sân con vừa được tắt…"). Khoá theo `id` sắp sẵn → không deadlock.
  2. **`assertNoClosure`** — kiểm lại `CourtClosure` SAU khi có khoá → `SlotUnavailableError`
     ("… vừa được sân đóng để bảo trì").
  3. Mỗi dãy: **`releaseStaleHolds`** → `tx.booking.create` HOLDING (`subtotal = total = quote.total`,
     tên/số/ghi chú trim).
- 23P01 (`bookings_khong_trung_khung_gio`) → `SlotTakenError("<Sân> HH:MM–HH:MM vừa có người đặt mất…")` →
  Postgres cuộn lại CẢ lần đặt.
- Trùng mã (`isUniqueViolation(error, "code")`) → cuộn lại, sinh bộ mã mới, thử lại CẢ transaction. Trùng
  khung thì KHÔNG thử lại.

**Vì sao khoá `FOR UPDATE OF c`**: EXCLUDE chỉ biết lượt đặt, không biết `CourtClosure`. INSERT
`court_closures` lấy `FOR KEY SHARE` trên dòng `courts` (kiểm khoá ngoại) — xung đột với `FOR UPDATE` → giữ
chỗ và tạo lịch đóng xếp hàng. (`FOR NO KEY UPDATE` thì KHÔNG chặn phép kiểm khoá ngoại — đừng đổi.) Câu khoá
cũng là chốt "sân con thuộc đúng cơ sở + cơ sở còn mở bán" ngay trong transaction.

**`releaseStaleHolds(tx, courtId, startAt, endAt, now)`**: `updateMany` lượt cùng sân, `HOLDING`,
`holdExpiresAt ≤ now`, gối khoảng mới → `EXPIRED` + xoá hạn. Cần vì EXCLUDE vẫn tính mọi HOLDING. Lượt có hạn
`null` (đã khai chuyển khoản) không bị đụng (`lte` không khớp `null`).

---

## 7. Vòng đời lượt đặt

```
(tạo) → HOLDING ──approveManual / handleWebhook / confirm──→ CONFIRMED ──checkIn──→ CHECKED_IN
            │                                                   │
            ├──cron expireHolds / releaseStaleHolds──→ EXPIRED  │
            └──cancel──→ CANCELLED ←──cancel────────────────────┘
COMPLETED, NO_SHOW: CHƯA có mã nào ghi.
```

`isHoldExpired(booking, now)` (`src/lib/booking-status.ts`): HOLDING + `holdExpiresAt` ≠ null và ≤ now.
Cùng tệp có `BOOKING_STATUS` (nhãn + màu dùng chung khách/chủ sân; "Chờ thanh toán" đỏ nhạt, không cam).

| Hàm                                                                                       | Hành vi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirm(id)`                                                                             | Idempotent; HOLDING → CONFIRMED + xoá hạn. Không lọc theo sân. Chưa nơi nào gọi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `checkIn(id, { venueId, now })`                                                           | Đã CHECKED_IN → trả luôn; HOLDING → "Lượt đặt này chưa thanh toán"; chỉ CONFIRMED nhận sân                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `cancel(id, { actor, reason, cancelledBy, freeCancelHours, venueId, now })`               | **`actor: "CUSTOMER" \| "VENUE"` bắt buộc**. Chỉ HOLDING/CONFIRMED huỷ được (CHECKED_IN/COMPLETED → "đã diễn ra"; NO_SHOW/CANCELLED/EXPIRED → câu trạng thái). Chính sách: `freeCancelHours = options ?? venue ?? 2`, `refundable = now ≤ startAt − freeCancelHours`, `feePercent = refundable ? 0 : (cancelFeePercent ?? 100)`. MỘT transaction: `updateMany` **có điều kiện** `status IN (HOLDING, CONFIRMED)` (+ `venueId`) — lệch → `BookingStateError("vừa đổi trạng thái")`; đọc payments SAU khi giữ khoá dòng; có AWAITING mà actor CUSTOMER → `BookingStateError` (cuộn lại); PENDING → CANCELLED; AWAITING (actor VENUE) → CANCELLED + `failReason "Sân huỷ lượt đặt: …"`, `reviewedBy/At`. Trả `{ booking, refundable, freeUntil, freeCancelHours, feePercent, paidAmount (SUCCEEDED/PARTIALLY_REFUNDED − đã hoàn), refundableAmount = round(paidAmount × (100 − phí) / 100), awaitingAmount }`. **Không tự hoàn** |
| `reschedule({ bookingId, venueId, courtId, date, startMinute, endMinute, actorId, now })` | **`venueId` bắt buộc** (GOTCHAS #19). `assertRangeShape`; chỉ HOLDING/CONFIRMED, HOLDING quá hạn → lỗi; `quote` với `excludeBookingId`, `null`/0đ → `SlotUnavailableError`. **Khác giá chỉ khi HOLDING** (CONFIRMED khác giá → `BookingStateError`). `total = max(0, quote.total − discountTotal)`. Transaction: `lockCourts` + `assertNoClosure` → nhả khung cũ bằng `updateMany` có điều kiện (`cancelledAt: now`) → khác giá mà đã có tiền (AWAITING/SUCCEEDED/…REFUNDED) → lỗi, còn PENDING thì sửa `amount` (hoặc huỷ nếu 0) → `releaseStaleHolds` → ghi lại trạng thái cũ + sân/giờ mới. Chưa nơi nào gọi                                                                                                                                                                                                                                                                                                               |
| `expireHolds({ now, venueId })`                                                           | MỘT câu `updateMany` HOLDING quá hạn → EXPIRED (an toàn khi nhiều worker). `venueId` chỉ dùng cho script kiểm tra                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `findByCode(code)`                                                                        | Tra một lượt theo mã, KHÔNG kiểm quyền (nơi gọi tự kiểm). Chưa nơi nào gọi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `findCheckout(code, { now })`                                                             | Tra bằng mã của BẤT KỲ lượt nào → cả lần đặt (`checkoutCode ?? code`): `code`, **`userId`** (người đặt), `venue` (kèm `id`), `customerName/Phone`, `bookings[]` (kèm `startMinute`/`endMinute`, `payments`), `holding`, `holdingTotal`, `holdExpiresAt` (sớm nhất; null nếu có lượt không mang hạn), `holdExpired`, `rejectReason`, `now` (cho đồng hồ bù lệch). KHÔNG kiểm quyền xem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `listForUser(userId, { now, limit })`                                                     | `upcoming`: `endAt ≥ now` và (không HOLDING/CANCELLED/EXPIRED **hoặc** HOLDING còn hạn/hạn null) — viết khẳng định, không `NOT` (NULL). `past` (≤ 30): đã kết thúc, CANCELLED/EXPIRED, **hoặc HOLDING quá hạn**. Mỗi dòng mang `holdExpired`, `checkoutCode`, `review`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `findOwnedByUser(id, userId)`                                                             | Quyền sở hữu nằm trong `where`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `listForVenueDay(venueId, date, { now })`                                                 | Lịch chủ sân, kèm phút-trong-ngày + **`holdExpired`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Khoá theo sân**: `requireBooking(id, venueId?)` — `venueId` có mà lệch → `BookingNotFoundError`. Đây là lọc
phạm vi, không khoá dòng. Chống đua trong `BookingService` dựa vào `lockCourts` (holdCheckout/reschedule) và
`updateMany` có điều kiện trạng thái (cancel/reschedule).

**Huỷ ở giao diện**: khách `cancelOwnBookingAction` (`(account)/account/bookings/actions.ts`,
`findOwnedByUser` rồi `actor: "CUSTOMER"`); sân `cancelBookingAction` (`defineVenueAction("booking:cancel")`,
`actor: "VENUE"`, `venueId: ctx.venueId`, lý do tối đa 300). Câu trả về tính theo tiền ĐÃ NHẬN/ĐÃ KHAI
(`refundSentence`/`ownerRefundSentence`), không theo giá lượt. Nút huỷ dùng `ConfirmButton` (xác nhận hai bước).

**Lịch chủ sân** `/manage/[venueId]` (`booking:read`): xem được **mọi ngày kể cả ngày đã qua** (`?date=`,
form GET chọn ngày + `DateStrip`). Tiền của ngày chỉ cộng lượt đã chốt (CONFIRMED/CHECKED_IN/COMPLETED);
"chờ thanh toán" đứng riêng và chỉ tính HOLDING **chưa** quá hạn; CANCELLED/EXPIRED/quá hạn xếp cuối, mờ.
Cơ sở DRAFT/PENDING hiện băng chỉ sang trang Cài đặt. Thông báo sau thao tác dùng `ActionNoticeProvider`
(dính đáy, không mất khi dòng rời danh sách).

---

## 8. Thanh toán — `PaymentService`

Hằng số: `AUTO_PROVIDERS` = VNPAY/MOMO/ZALOPAY/SEPAY (chỉ webhook xác nhận); **`MANUAL_TRANSFER_PROVIDER =
"BANK_TRANSFER"`** (export — CASH KHÔNG duyệt qua hàng chờ); `LIVE_STATUSES` = PENDING/AWAITING_CONFIRMATION;
`merchantRef = <mã>-<8 hex>`. Mọi transaction `maxWait 10s / timeout 20s`.

| Hàm                                                                                                  | Hành vi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `start({ bookingId, provider, receivedBy, now })`                                                    | **Chỉ HOLDING còn hạn** (CONFIRMED → "đã được xác nhận"; khác → "không còn nhận thanh toán"; quá hạn → `BookingStateError`); `total ≤ 0` → `BookingStateError`. Đọc trước: có giao dịch sống **cùng provider** → trả về; khác provider mà AWAITING → `BookingStateError`; khác provider mà PENDING → huỷ nó (có điều kiện) rồi tạo mới. Tạo PENDING: `amount = total`, `transferNote = "CS " + (checkoutCode ?? code)` (chỉ BANK_TRANSFER), `expiresAt = holdExpiresAt ?? now + 15'`. Thua cuộc đua (unique một phần) → đọc lại, cùng provider thì trả, khác thì `PaymentStateError`                                                                                                                                     |
| `transferInstruction(paymentIds[])`                                                                  | Thiếu id → `PaymentNotFoundError`; lẫn nhiều sân → `PaymentStateError`; sân thiếu ngân hàng → `VenueBankAccountMissingError`; tiền = TỔNG, nội dung chung; `qrPayload` null nếu ngân hàng không có trong `BANK_BINS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `declareTransfer({ paymentIds, note, proofImageUrl, now })`                                          | **Mọi dòng phải là BANK_TRANSFER** (không → `PaymentStateError`) và đang sống; không còn PENDING → `{count: 0}`. MỘT transaction: booking HOLDING → `holdExpiresAt = null` (lệch số dòng = lượt đã bị nhả → `BookingStateError`) + payment PENDING → AWAITING (`declaredAt`, `declaredNote`, xoá `expiresAt`, lệch số dòng → `PaymentStateError`). **KHÔNG xác nhận lượt đặt**                                                                                                                                                                                                                                                                                                                                           |
| `approveManual({ paymentIds, venueId, reviewerId, now })`                                            | Lọc `booking.venueId` NGAY trong truy vấn; thiếu/lệch → NotFound CẢ LÔ. Provider tự động → `ManualApprovalNotAllowedError`; khác BANK_TRANSFER → `PaymentStateError`. Dòng không sống và không SUCCEEDED → `PaymentStateError`; không còn dòng sống → `{count: 0}`. **Booking không còn HOLDING → `BookingStateError`** ("hãy từ chối và hoàn tiền nếu đã nhận"). Transaction: booking `updateMany` HOLDING → CONFIRMED (lệch → lỗi, cuộn lại) + payment → SUCCEEDED (`paidAt`, `reviewedBy/At`)                                                                                                                                                                                                                         |
| `rejectManual({ paymentIds, venueId, reviewerId, reason, now })`                                     | Lọc theo sân; **chỉ BANK_TRANSFER**; mọi dòng phải sống. Transaction: booking HOLDING có hạn `null` → **cấp hạn mới** `now + holdMinutes`; payment → FAILED + `failReason`/`rejectReason` (lệch số dòng → `PaymentStateError`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `handleWebhook({ provider, externalEventId, merchantRef, succeeded, amount, payload, verified, … })` | Tìm payment theo `merchantRef` (ngoài transaction), rồi **MỘT transaction**: ghi `PaymentEvent` TRƯỚC → chữ ký sai / không có payment / đã SUCCEEDED / không sống (CANCELLED, FAILED…) → dừng, trả `{handled: false, reason}` (không ném) → cổng báo thất bại → FAILED → **lệch tiền → FAILED + `amountMismatch`, KHÔNG ném** → thành công: booking `updateMany` HOLDING → CONFIRMED + payment SUCCEEDED; booking **không còn HOLDING** (hết hạn/huỷ) → vẫn SUCCEEDED (tiền đã về thật) + **tạo `Refund` PENDING** toàn số tiền, trả `refundId` và `logger.error`. Trùng `(provider, externalEventId)` → "Sự kiện đã xử lý rồi". Lỗi giữa chừng cuộn lại cả event → cổng gửi lại được. `verified` do nơi gọi kiểm chữ ký |
| `expirePending({ now })`                                                                             | PENDING quá hạn → CANCELLED. **Không bao giờ đụng AWAITING** (tiền khách đã chuyển thật)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pendingApprovals(venueId)`                                                                          | Các AWAITING của sân, **gộp theo `checkoutCode ?? code`**: `{ checkoutCode, transferNote, amount (tổng), declaredAt, declaredNote, proofImageUrl, customerName/Phone, items[{paymentId, bookingCode, courtName, startAt, endAt, amount}] }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `requestRefund({ paymentId, amount, reason, requestedBy })`                                          | Transaction + `SELECT … FROM payments … FOR UPDATE`. Chỉ SUCCEEDED/PARTIALLY_REFUNDED; `remaining = amount − refundedAmount − Σ refund PENDING`; số tiền nguyên trong `(0, remaining]` (sai → `RefundAmountError(remaining)`); tạo Refund PENDING. Chưa nơi nào gọi                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `settleRefund({ refundId, approvedBy, now })`                                                        | Transaction: `updateMany` refund **có điều kiện** PENDING → SUCCEEDED; chỉ khi khớp mới `increment refundedAmount` và đặt REFUNDED/PARTIALLY_REFUNDED (gọi lại = idempotent); refund đã FAILED → `PaymentStateError`. Chưa nơi nào gọi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Trạng thái giao dịch: PENDING → AWAITING_CONFIRMATION → SUCCEEDED / FAILED; PENDING → CANCELLED (cron, huỷ lượt,
đổi provider); AWAITING → CANCELLED (sân huỷ lượt); SUCCEEDED → PARTIALLY_REFUNDED / REFUNDED.

**Màn thanh toán** `/bookings/[code]` (`src/app/(public)/bookings/[code]/page.tsx`):

- **BẮT đăng nhập** (`requireUser("/bookings/<code>")`). Chỉ **người đặt** (`checkout.userId === user.id`) hoặc
  người có **`booking:read` trên sân** (`permissionService.canOnVenue`) xem được; còn lại `notFound()` (không
  xác nhận mã tồn tại).
- Mã lượt con → `redirect` về mã lần đặt; không còn lượt HOLDING → màn kết quả; `holdExpired` → màn "Hết thời
  gian giữ chỗ" (KHÔNG hiện QR, nút "Đặt lại các khung này" với `?chon=`).
- Trang **CHỈ ĐỌC**, không gọi `start` khi GET. Lượt 0đ → hộp "chưa thanh toán online được, gọi sân"; người
  của sân (không phải người đặt) → chỉ xem, không có nút; lượt nào thiếu giao dịch BANK_TRANSFER sống → nút
  **"Tạo mã chuyển khoản"** (`OpenTransfer` → `openTransferAction`); sân thiếu ngân hàng (nuốt đúng
  `VenueBankAccountMissingError`) → câu gọi sân; còn lại QR + `DeclareTransfer` (ô ghi chú). Tất cả AWAITING →
  "Đã gửi cho sân". `rejectReason` hiện ở `<Notice tone="danger">`. `HoldCountdown` nhận `serverNowIso` để bù
  lệch đồng hồ máy khách.

`src/app/(public)/bookings/[code]/actions.ts` — cả hai là **`defineAuthedAction`** và chỉ **người đặt** thao tác
(`findOwnCheckout`: không có hoặc không phải của mình → cùng câu "Không tìm thấy lượt đặt này"):

- **`declareTransferAction`**: `code` + `note` (≤ 300); mọi lượt holding phải có giao dịch BANK_TRANSFER sống,
  rồi `declareTransfer` cho cả nhóm.
- **`openTransferAction`**: quá hạn → lỗi; `start({ provider: BANK_TRANSFER, receivedBy: "VENUE" })` TUẦN TỰ cho
  lượt thiếu giao dịch (sau khi sân từ chối lần khai trước, cron huỷ PENDING, hoặc mở giao dịch lúc giữ chỗ hỏng).

Duyệt/từ chối ở `src/app/(manage)/manage/[venueId]/actions.ts` (`defineVenueAction("payment:confirm")`):
form gửi nhiều `paymentId` cùng tên → `formData.getAll("paymentId")` (1–50) → service kèm `ctx.venueId`.

**VietQR** (`src/lib/vietqr.ts`): `BANK_BINS` 16 ngân hàng (VCB 970436, TCB, MB, ACB, VPB, BIDV, VTB, TPB,
SCB, STB, HDB, OCB, MSB, SHB, EIB, AGB). `buildVietQrPayload` trả `null` nếu BIN ≠ 6 số, số tài khoản
ngoài 4–19 số, hoặc tiền không nguyên dương. TLV EMVCo: `00=01`, `01=12` (có tiền), `38={A000000727, {BIN,
STK}, QRIBFTTA}`, `53=704`, `54=tiền`, `58=VN`, `62={08 nội dung}`, `6304` + CRC-16/CCITT-FALSE tính trên
chuỗi ĐÃ gồm "6304". `sanitizeTransferNote`: bỏ dấu, `đ→d`, chỉ `[A-Za-z0-9 ]`, tối đa 25 ký tự;
`transferNoteForBooking(code)`. QR dựng ở máy chủ, trình duyệt tự vẽ (`qrcode` → canvas). `CopyButton` có
fallback `execCommand`/bôi chọn cho HTTP qua IP LAN.

---

## 9. Dòng tiền và hoá đơn hoa hồng

Tiền đặt sân vào **thẳng tài khoản của sân** (`payments.received_by` mặc định VENUE); nền tảng không giữ hộ.
Mỗi tháng xuất **hoá đơn hoa hồng** = khoản chủ sân NỢ nền tảng; quá hạn thì có đòn bẩy khoá sân (tự khoá CHƯA làm).

`InvoiceService.generateForMonth(anyDayOfMonth, { now })`:

1. Kỳ = tháng theo giờ VN (`periodOf`). Tháng **chưa kết thúc** (`period.end > now`) → `InvoicePeriodOpenError`.
2. `groupBy venueId` các booking có `startAt` trong kỳ và trạng thái đã bán (CONFIRMED/CHECKED_IN/COMPLETED);
   bỏ doanh thu ≤ 0.
3. Đọc trước hoá đơn đã có của kỳ (không tốn số sequence khi chạy lại); bỏ qua `commissionRate` null/≤ 0 (chỉ
   seed ghi tỉ lệ → cơ sở mới đăng ký KHÔNG bao giờ bị lập hoá đơn cho tới khi có màn đặt tỉ lệ).
4. Mỗi cơ sở MỘT transaction: `SELECT nextval('platform_invoice_number_seq')` → `number = CS-YYYYMM-000042`
   (`padStart(6, "0")`, quá 999999 thì dài thêm, không quay vòng; có thể hở số), `periodStart`/`periodEnd` (Date
   VN), `dueDate = ngày cuối kỳ + 15 ngày`, `commissionAmount = round(gross × rate / 100)`, `status = DUE`.
5. Trùng **đúng** ràng buộc `platform_invoices_venue_id_period_start_key` → `skipped` (lần chạy khác vừa xuất).
   Lỗi khác → gom vào `failed[]`, chạy tiếp cơ sở sau. Trả `{ period, created, skipped, failed }`.

**`generateMissing({ now, months = 3 })`**: gọi `generateForMonth` cho **3 tháng đã kết thúc gần nhất**
(`INVOICE_BACKFILL_MONTHS`), idempotent — chạy hằng ngày tự bù tháng bị lỡ. Trả `{ periods, created, skipped, failed }`.

Khác: `listByStatus(status, { limit, now })` (tính sẵn **`overdueDays`** theo ngày VN — page không đọc đồng
hồ), `listForVenue`, **`markPaid(id, now)`** và **`waive({ invoiceId, by, reason })`** kiểu so-rồi-đổi
(`updateMany` chỉ khi DRAFT/DUE/OVERDUE; không khớp thì đọc lại: markPaid gặp WAIVED → `InvoiceWaivedError`,
PAID → `{alreadyPaid: true}`; waive gặp PAID → `InvoicePaidError`, WAIVED → `{alreadyWaived: true}`; không có →
`InvoiceNotFoundError`), `markOverdue(now)` (một `updateMany` DUE có `dueDate` < hôm nay VN). Màn `/invoices`
cần `invoice:manage`; `InvoiceRow` (`src/components/admin/invoice-row.tsx`) hiện nút theo trạng thái.
`ReportService.venueSummary` cũng trả `commissionOwed`.

**Lịch job** — định nghĩa MỘT nơi `src/jobs/schedules.ts` (`buildSchedules`, cron theo giờ VN
`Asia/Ho_Chi_Minh`, kiểm bằng `cron-parser`), handler ở `src/jobs/handlers.ts`. Ba chế độ
(`schedulingMode`, thấy ở `/api/health` → `features.schedules`): `worker` (QUEUE_ENABLED=1 + REDIS_URL →
BullMQ `upsertJobScheduler`), `in-process` (QUEUE_ENABLED=0 → web tự chạy lịch qua `src/instrumentation.ts`,
`startInProcessScheduler`, hẹn giờ tối đa 60s/lần), `off` (bật cờ mà thiếu Redis — production log lỗi; dev cố ý
off để Neon được ngủ).

| Job                         | Biến / mặc định                       | Thử lại            | Làm gì                                                                                      |
| --------------------------- | ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| `booking:expire-holds`      | `CRON_EXPIRE_HOLDS` = `* * * * *`     | 1 lần              | `expireHolds()` — chỉ để dọn; lịch vẫn đúng khi job không chạy                              |
| `payment:expire-pending`    | dùng chung `CRON_EXPIRE_HOLDS`        | 1 lần              | `expirePending()`                                                                           |
| `invoice:generate-monthly`  | `CRON_INVOICE_MONTHLY` = `30 2 * * *` | 3 lần, backoff 60s | `generateMissing()` — **mỗi ngày**, tự bù 3 tháng; còn `failed` thì NÉM để job được thử lại |
| `invoice:mark-overdue`      | `CRON_INVOICE_OVERDUE` = `0 4 * * *`  | 3 lần, backoff 60s | `markOverdue()`                                                                             |
| `maintenance:purge-expired` | `CRON_PURGE_EXPIRED` = `0 3 * * *`    | 1 lần              | dọn token/nhật ký/thiết bị cũ                                                               |

Job không chạy: lịch trống vẫn đúng (chỗ giữ quá hạn không chiếm chỗ), nhưng PENDING không bị huỷ, hoá đơn
không được xuất/đánh dấu quá hạn (sẽ tự bù khi chạy lại trong vòng 3 tháng).

---

## 10. Cơ sở và sân con

**Trạng thái cơ sở** (`VenueStatus`): DRAFT (mặc định khi tạo) → PENDING (chờ duyệt) → ACTIVE.
SUSPENDED = chủ tự nghỉ (`softDelete` cũng đặt giá trị này), UNDER_MAINTENANCE = bảo trì,
ADMIN_LOCKED = nền tảng khoá vì vi phạm, chỉ admin vào/gỡ. **Từ chối hồ sơ = trả về DRAFT kèm lý do**, không
dùng ADMIN_LOCKED. Chỉ ACTIVE đặt được (`bookable`).

**Đồ thị chuyển trạng thái** (`STATUS_TRANSITIONS`, ai được làm):

| Từ                | Sang được                                                               |
| ----------------- | ----------------------------------------------------------------------- |
| DRAFT             | PENDING (owner), ADMIN_LOCKED (admin)                                   |
| PENDING           | ACTIVE (admin, duyệt), DRAFT (admin, "Trả hồ sơ"), ADMIN_LOCKED (admin) |
| ACTIVE            | UNDER_MAINTENANCE (owner), SUSPENDED (owner), ADMIN_LOCKED (admin)      |
| UNDER_MAINTENANCE | ACTIVE (owner), SUSPENDED (owner), ADMIN_LOCKED (admin)                 |
| SUSPENDED         | ACTIVE (owner), UNDER_MAINTENANCE (owner), ADMIN_LOCKED (admin)         |
| ADMIN_LOCKED      | ACTIVE (admin)                                                          |

**Luồng đăng ký cơ sở**:

1. `/manage/new` (nút "Đăng ký chủ sân" ở trang chủ và "Đăng ký cơ sở mới" ở `/manage` trỏ tới đây) —
   `createVenueAction` = `defineAuthedAction` (ai đăng nhập cũng mở được; form trả `values` khi lỗi) →
   `venueService.create` → `redirect(/manage/<id>/settings)`.
2. `/manage/<id>/settings` — cơ sở DRAFT hiện **checklist** từ `venueService.readiness()` (giờ mở cửa, ≥ 1 sân
   con bật, bảng giá, tài khoản nhận tiền), **lý do bị trả** (`inactiveNote`) và nút **"Gửi duyệt"**
   (`submitForReviewAction` = `defineVenueAction("venue:update")` → `setStatus(…, "PENDING", { actor: "owner" })`).
3. Admin `/venue-approvals` — `decideVenueAction` = `defineAction("venue:approve")`, `decision`
   ∈ ACTIVE/DRAFT; DRAFT bắt buộc lý do ≤ 300 (trả `note` khi lỗi để ô không bị xoá).

`/manage` có đúng một cơ sở thì tự chuyển vào cơ sở đó, TRỪ khi `?all=1` (link "← Sân của bạn" dùng nó).

`VenueService`:

- `create({ name, sportId, address, ward, province, ownerId, phone, description, holdMinutes })`: môn phải tồn
  tại + bật (`VenueConfigError`); slug không dấu, thử `-2`…`-20`. Transaction: khoá dòng
  user `FOR NO KEY UPDATE` (xếp hàng theo người tạo) → đếm cơ sở chưa xoá DRAFT/PENDING mà người đó là OWNER ≥
  **`MAX_UNAPPROVED_VENUES = 3`** → `VenueDraftLimitError`; tạo venue DRAFT + VenueMember OWNER ACTIVE. Đua trùng
  slug (`venues_slug_key`) → `VenueConfigError("bấm lại")`.
- `readiness(venueId)` → `{ status, inactiveNote, items[{key: hours|courts|pricing|bank, label, done}], ready }`.
- `setStatus(venueId, status, { actor: "owner" | "admin", inactiveNote })`: cùng trạng thái → trả luôn; vào/ra
  ADMIN_LOCKED mà actor ≠ admin → `VenueAdminLockedError`; cạnh không có trong đồ thị →
  **`VenueStatusTransitionError`**; sai người → `ForbiddenError`; DRAFT (trả hồ sơ) hoặc ADMIN_LOCKED thiếu lý do →
  `VenueConfigError`; sang PENDING/ACTIVE thiếu mục readiness (gồm cả **tài khoản ngân hàng**) →
  `VenueNotReadyError(missing, "gửi duyệt" | "mở bán")`. Sang ACTIVE/PENDING xoá `inactiveNote`. Ghi bằng
  `updateMany` có điều kiện `status` cũ — người khác vừa đổi → `VenueStatusTransitionError`.
- `update(venueId, input)` — cố ý KHÔNG nhận `status`/`inactiveNote` (chỉ đổi qua `setStatus`). Action kiểm
  `holdMinutes` 5–120, `freeCancelHours` 0–168, `cancelFeePercent` 0–100, `bankName ∈ BANK_BINS`.
- `setHours` (thứ 0–6 không lặp, giờ tròn 30, mở < đóng ≤ 1440; thay CẢ TUẦN trong transaction). Giờ chưa khai
  = đóng cửa.
- `search({ q, sportKey, province, ward, maxPricePerSlot, page, limit ≤ 50 })`: ACTIVE, chưa xoá; `q` ILIKE trên
  name/address (trigram); sắp rating; `findMany` + `count` bằng `Promise.all` — **cố ý không transaction**.
  `imageUrl` = ảnh `isPrimary`, `fromPricePerSlot` = luật giá > 0 rẻ nhất.
- `publicDetail(slug)`: ACTIVE/UNDER_MAINTENANCE/SUSPENDED, trả `status`, `inactiveNote`, images, hours, courts
  bật, **`bookable`**. `listActiveProvinces()`. `forManage(venueId)` (mọi trạng thái). `listPendingApproval`
  (kèm `_count` và `hasBankAccount`). `listForUser(userId)`. `softDelete`.

`CourtService` — **mọi hàm thao tác theo id đều bắt buộc `venueId`** và lọc trong truy vấn (`requireCourt(courtId,
venueId)` → `CourtNotFoundError`):

- `create({ venueId, … })` (môn theo cơ sở), `update(courtId, input, { venueId })`, `reorder(venueId, courtIds)`
  (phải khớp đúng các sân), `softDelete(courtId, { venueId, now })`.
- **`close({ venueId, courtId, startAt, endAt, reason, createdBy, now })`**: kết thúc sau bắt đầu, ≤ 365 ngày;
  transaction `SELECT … FROM courts … FOR UPDATE` rồi tìm lượt **còn sống** (`occupyingBookingWhere`) chồng
  khoảng → **`CourtClosureConflictError(codes, message)`** (liệt kê tối đa 3 mã). Không còn chuyện đóng sân đè
  lên lượt đã bán. `reopen(closureId, { venueId })` → `CourtClosureNotFoundError`.
- **`setPriceRules(venueId, rules)`**: `courtId` phải thuộc cơ sở (không → `VenueConfigError`); khung tròn 30;
  giá nguyên ≥ 0; thứ 0–6; priority nguyên; **từ chối hai luật cùng priority + cùng phạm vi (`courtId`) + có
  chung thứ + gối giờ** ("Luật i và luật j chồng nhau…"). Kiểm TOÀN BỘ rồi mới xoá + tạo lại trong transaction.
  Giao diện (`price-rule-editor.tsx`) cho luật mới **priority = cao nhất + 10**.
- **`setPriceOverride({ venueId, dateKey, courtId, … })`**: ngày có thật; sân con thuộc cơ sở; **từ chối gối giờ
  với đè giá CÙNG phạm vi cùng ngày** (khác phạm vi được phép — riêng sân con thắng). `removePriceOverride`
  (`id` + `venueId`) → `PriceOverrideNotFoundError`.
- `listPriceRules`, `listForVenue(venueId, { from })` (kèm lịch đóng chưa kết thúc), **`pricingGaps(venueId)`**
  (dùng hàm thuần `findPricingGaps`: khung mở cửa của sân con bật mà không luật nào phủ, gộp theo thứ; `courtNames`
  null = cả cơ sở) — trang Sân & giá hiện cảnh báo. Trang chỉ-xem khi thiếu `court:update`/`pricing:update`.

---

## 11. Đánh giá và doanh thu

- `ReviewService.create({ bookingId, userId, rating, comment, now })`: điểm **nguyên 1–5** kiểm TRƯỚC, không làm
  tròn (`ReviewRatingError`); lượt của CHÍNH người đó (`findFirst({id, userId})` → `BookingNotFoundError`), chưa
  đánh giá, đã kết thúc (`endAt ≤ now`), CHECKED_IN/COMPLETED (`BookingStateError`). Transaction: khoá dòng
  venue **`FOR NO KEY UPDATE`** (hai review đồng thời của cùng sân xếp hàng) → tạo review → TÍNH LẠI
  `ratingAvg`/`ratingCount` bằng `aggregate` review không ẩn.
- `reply({ reviewId, venueId, reply, now })` lọc theo sân → **`ReviewNotFoundError`**. `listForVenue` chỉ review
  không ẩn.
- `ReportService`: doanh thu từ `bookings.total` trạng thái đã bán (không từ payments). `venueSummary(venueId,
{ from, to }, { now })` → `revenue`, `discountTotal`, `cancelledCount` (CANCELLED + NO_SHOW), **`holdingCount`
  (chỉ chỗ giữ còn sống: còn hạn hoặc hạn null)**, `commissionRate`, `commissionOwed`, `byCourt`. `dailyRevenue`
  → SQL thô `to_char(start_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`, đổi `bigint` → `number`.
  `RevenueChart`: cột `height: %` trong flex `items-end` từng ra 0px — đã sửa.

---

## 12. Lỗi nghiệp vụ (`src/lib/errors.ts`)

Mọi lỗi kế thừa `DomainError` với `code` là hợp đồng với client; HTTP qua `DOMAIN_STATUS`
(`src/lib/api/response.ts`): VALIDATION_ERROR 422, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404,
CONFLICT 409, ACCOUNT_BANNED 403, ACCOUNT_LOCKED 423, RATE_LIMITED 429, PROVIDER_ERROR 502,
TWO_FACTOR_REQUIRED 401. Action bắt `DomainError` → `{ error: message }`; lỗi khác ném lên.
Mọi lớp dưới đây đều nằm trong `errors.ts` (review/invoice không còn khai lỗi riêng trong service).

| Lớp                                                                | Mã                           | Khi nào                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SlotTakenError(msg?)`                                             | CONFLICT                     | 23P01 trong `holdCheckout`/`reschedule`                                                                                                          |
| `SlotUnavailableError(msg?)`                                       | CONFLICT                     | không có dãy; khung đã qua; báo giá hỏng (kèm lý do); 0đ; sân con vừa tắt/đóng bảo trì trong transaction                                         |
| `BookingValidationError(msg)`                                      | VALIDATION_ERROR             | ngày NaN; dãy không tròn 30/ngoài ngày/bắt đầu ≥ kết thúc; hai dãy chồng nhau cùng sân trong một lần đặt                                         |
| `VenueNotBookableError(msg?)`                                      | CONFLICT                     | giữ chỗ ở cơ sở không tồn tại hoặc không ACTIVE                                                                                                  |
| `BookingNotFoundError`                                             | NOT_FOUND                    | không tồn tại / lệch sân / review cho lượt không phải của mình                                                                                   |
| `BookingStateError(msg)`                                           | CONFLICT                     | sai trạng thái; hết hạn giữ chỗ; khai khi lượt đã bị nhả; khách huỷ lượt đã khai; duyệt lượt không còn HOLDING; điều kiện đánh giá               |
| `CancelWindowPassedError`                                          | CONFLICT                     | khai báo nhưng không nơi nào ném                                                                                                                 |
| `PaymentNotFoundError`                                             | NOT_FOUND                    | thiếu id, lệch sân, danh sách rỗng, refund không tồn tại                                                                                         |
| `PaymentStateError(msg)`                                           | CONFLICT                     | QR gộp nhiều sân; khai/duyệt/từ chối sai trạng thái hoặc không phải BANK_TRANSFER; đổi trạng thái đồng thời; hoàn tiền giao dịch chưa thành công |
| `ManualApprovalNotAllowedError(provider)`                          | CONFLICT                     | duyệt tay giao dịch cổng tự động                                                                                                                 |
| `VenueBankAccountMissingError`                                     | CONFLICT                     | sân chưa khai ngân hàng khi dựng QR                                                                                                              |
| `RefundAmountError(remaining)`                                     | CONFLICT                     | số tiền hoàn ≤ 0, không nguyên, hoặc vượt số còn lại (đã trừ refund PENDING)                                                                     |
| `VenueNotFoundError` / `CourtNotFoundError`                        | NOT_FOUND                    | không tồn tại, đã xoá, lệch cơ sở                                                                                                                |
| `VenueConfigError(msg)`                                            | VALIDATION_ERROR             | giờ/giá/đè giá/sắp xếp/khoảng đóng sai; luật giá chồng nhau; đè giá gối cùng phạm vi; thiếu lý do trả/khoá; môn sai                              |
| `VenueAdminLockedError`                                            | FORBIDDEN                    | vào/ra ADMIN_LOCKED mà actor không phải admin                                                                                                    |
| `VenueNotReadyError(missing, action)`                              | CONFLICT                     | gửi duyệt/mở bán khi thiếu giờ/sân con/bảng giá/tài khoản ngân hàng                                                                              |
| **`VenueStatusTransitionError(msg)`**                              | CONFLICT                     | cạnh không có trong đồ thị trạng thái; trạng thái vừa bị người khác đổi                                                                          |
| **`VenueDraftLimitError(limit)`**                                  | CONFLICT                     | đã có 3 hồ sơ DRAFT/PENDING                                                                                                                      |
| **`CourtClosureConflictError(codes, msg)`**                        | CONFLICT                     | đóng sân chồng lượt còn sống                                                                                                                     |
| **`CourtClosureNotFoundError`**                                    | NOT_FOUND                    | mở lại lịch đóng không có/khác cơ sở                                                                                                             |
| **`PriceOverrideNotFoundError`**                                   | NOT_FOUND                    | xoá đè giá không có/khác cơ sở                                                                                                                   |
| `InvoiceNotFoundError` / `InvoicePaidError` / `InvoiceWaivedError` | NOT_FOUND / CONFLICT         | markPaid/waive                                                                                                                                   |
| **`InvoicePeriodOpenError(period)`**                               | CONFLICT                     | xuất hoá đơn cho tháng chưa kết thúc                                                                                                             |
| **`ReviewNotFoundError`** / `ReviewRatingError`                    | NOT_FOUND / VALIDATION_ERROR | trả lời review khác sân/không có; điểm không nguyên 1–5                                                                                          |

Lỗi mới cùng đợt nhưng thuộc xác thực: `PasskeyNotFoundError` (NOT_FOUND), `PermissionNotHeldError` (FORBIDDEN).
`PaymentAmountMismatchError` **đã bị xoá** (webhook lệch tiền không còn ném).

---

## 13. Chưa làm (tính năng, không phải lỗi)

- REST API mobile cho sân/đặt sân/thanh toán; **route webhook cổng tự động** → `handleWebhook` chưa nối; đặt
  tại quầy (COUNTER); tiền mặt; **UI hoàn tiền** (`requestRefund`/`settleRefund` chưa nơi nào gọi).
- Voucher, khiếu nại, yêu thích, cấu hình `Setting`; luồng lời mời nhân viên (INVITED); tải/quản lý ảnh; màn
  đặt tỉ lệ hoa hồng; tự khoá sân khi hoá đơn OVERDUE; ẩn review; ghi COMPLETED/NO_SHOW tự động.
- Hàm service có mà chưa nơi nào gọi: `confirm`, `reschedule`, `findByCode`, `CourtService.softDelete`/`close`/
  `reopen`/`setPriceOverride`/`removePriceOverride`, `requestRefund`/`settleRefund`, `handleWebhook`,
  `ReviewService.reply`.

---

## 14. Nghi lỗi ĐÃ BIẾT (chưa sửa — kiểm lại trong mã trước khi sửa, sửa xong xoá dòng)

1. **Webhook báo thành công cho giao dịch đã CANCELLED/FAILED** (vd. PENDING bị cron huỷ, rồi tiền mới về) chỉ
   dừng với `handled: false` — chưa tạo `Refund`, tiền về thật mà không ai được báo ngoài log.
2. **Cơ sở tự đăng ký không có `commissionRate`** (`create` không ghi, chưa có màn đặt) → `generateForMonth` bỏ
   qua im lặng (`skipped`), nền tảng không thu hoa hồng của cơ sở mới.
3. Hoá đơn là ảnh chụp: lượt xác nhận/huỷ/hoàn tiền SAU khi xuất không điều chỉnh; tỉ lệ lấy theo
   `commissionRate` HIỆN TẠI của cơ sở lúc chạy, không phải tỉ lệ trong kỳ.
4. `PaymentService.start` mặc định `receivedBy: params.receivedBy ?? "PLATFORM"` — trái mặc định DB (VENUE); nơi
   gọi hiện tại đều truyền `"VENUE"`, nơi gọi mới quên truyền là ghi sai.
5. `setPriceOverride` kiểm gối giờ rồi mới `create`, không khoá/không transaction → hai lần thêm đồng thời vẫn
   lọt hai đè giá gối nhau cùng phạm vi (giá vẫn xác định nhờ `priceForSlot`, chỉ là dữ liệu bẩn). Hiện chưa màn
   nào gọi.
6. `confirm(id)` không nhận `venueId` (vi phạm GOTCHAS #19 khi được nối vào một action theo sân).
