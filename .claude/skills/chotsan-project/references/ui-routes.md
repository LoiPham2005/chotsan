# Giao diện, route và hệ thiết kế

Đọc kèm skill `.claude/skills/chotsan-thiet-ke/SKILL.md` (màu, chữ, lưới, responsive) trước khi viết
giao diện. Tệp này mô tả MÃ THẬT đang chạy — chỗ nào mã lệch skill thiết kế đã ghi ở mục 11.

---

## 1. Khung ứng dụng

- `src/app/layout.tsx`: font **Be Vietnam Pro** (`next/font/google`, 400–800, latin + vietnamese, biến
  `--font-be-vietnam-pro`), `<html lang="vi">`, metadata title `"%s · ChốtSân"` + `robots` noindex (còn bật,
  kèm `public/robots.txt` Disallow — mở site công khai phải bỏ cả hai), `themeColor #10b981`. Cấu trúc:
  `<Suspense fallback={null}><TopProgressBar/></Suspense>` + `Header` + `div.flex-1` + `Footer`.
  Không có `<main>` ở root (chỉ khu admin có).
- **`Header`** (`src/components/layout/header.tsx`, async Server Component): `getCurrentUser()`; nếu đăng
  nhập thì `Promise.all` 3 lần `permissionService.can(user.id, …)` (`user:read`, `role:read`,
  `venue:approve` — **truyền USER ID**, không truyền vai trò) + `venueService.listForUser`. Nav: "Tìm sân"
  (`/venues`), "Quản lý sân" (`/manage`, khi có sân), "Lượt đặt" (`/account/bookings`), "Quản trị" (trang
  ĐẦU TIÊN vào được: `/venue-approvals` → `/users` → `/roles`; chưa có `/invoices`). Phải: tên người dùng →
  `/sessions`, `<form action={logoutAction}>` "Đăng xuất"; khách: "Đăng nhập" / "Đăng ký".
  `sticky top-0 z-40 bg-canvas/85 backdrop-blur-md h-16 max-w-6xl`.
- **`logoutAction`** (`src/app/logout-action.ts`): `destroySession()` → `redirect("/")`. KHÔNG gọi
  `/api/v1/auth/logout` (endpoint mobile, đòi body JSON — GOTCHAS #14).
- **`Footer`**: logo nhỏ, "© năm ChốtSân…", link `/privacy`, `/terms` (hai route CHƯA tồn tại).
- **`Logo`**: SVG `ChotSanMark` trong ô `bg-brand`; cỡ sm/md/lg; chữ "ChốtSân" ẩn dưới 360px.
- **`TopProgressBar`** (`src/components/layout/top-progress-bar.tsx`) — thay `loading.tsx` (nó thay cả trang
  bằng khối đang tải). Bắt đầu: listener `click` pha capture trên `<a>` nội bộ (bỏ qua phím bổ trợ, tab mới,
  `download`, `#`, khác origin, trùng URL) + vá `history.pushState` gọi **`setTimeout(start, 0)`** (React gọi
  pushState trong `useInsertionEffect`; setState ở đó huỷ điều hướng — GOTCHAS #12). Chạy chậm dần tới ~90%
  rồi chờ; kết thúc khi `usePathname`/`useSearchParams` đổi (đặt 100% ở `requestAnimationFrame`, tắt sau
  320ms). `fixed top-0 h-0.5 z-[60] aria-hidden`. Luôn bọc `Suspense` (không thì `useSearchParams` đẩy cả
  trang sang dựng lúc chạy).
- CSP/nonce và chặn trang ở `src/proxy.ts` — xem `architecture.md` §3.

---

## 2. Bản đồ route

Ký hiệu wrapper: **DA** `defineAction(permission)`, **DAu** `defineAuthedAction`, **DP**
`definePublicAction(lyDo, {key, limit, windowSeconds})`, **DV** `defineVenueAction(permission)` (tham số
đầu là `venueId`, gắn bằng `.bind(null, venueId)`).

| URL                                                                                                                              | Tệp                                               | Ai vào                                                                                                                                  | Dữ liệu                                                                                                                          | Action · trường form                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                                                              | `app/page.tsx`                                    | Công khai                                                                                                                               | `sportService.listActive()`, `venueService.search({limit:6})`                                                                    | Form GET → `/venues`: `q`, `mon`                                                                                                                                                                                                      |
| `/venues`                                                                                                                        | `(public)/venues/page.tsx`                        | Công khai                                                                                                                               | `venueService.search({q, sportKey: mon, province: tinh, page, limit:12})`                                                        | Form GET `q`, `mon`; phân trang giữ param, thay `page`                                                                                                                                                                                |
| `/venues/[slug]`                                                                                                                 | `(public)/venues/[slug]/page.tsx`                 | Xem công khai; đặt phải đăng nhập                                                                                                       | `publicDetail(slug)` (chỉ ACTIVE, không có → 404), `getCurrentUser()`, `availabilityService.forDay`; param `?date=`, `?chon=`    | `holdBookingAction` (**DAu**): `venueId`, `date`, `slots` (JSON), `customerPhone`, `customerNote` (UI chưa có) → `redirect(/bookings/<mã>)`                                                                                           |
| `/bookings/[code]`                                                                                                               | `(public)/bookings/[code]/page.tsx`               | Ai biết mã                                                                                                                              | `findCheckout(code)`; mỗi lần tải: `paymentService.start` cho từng lượt HOLDING + `transferInstruction`                          | `declareTransferAction` (**DP**, key `khai-chuyen-khoan` 8/60s): `code`, `note` (UI chưa có)                                                                                                                                          |
| `/account/bookings`                                                                                                              | `(account)/account/bookings/page.tsx`             | `requireUser`                                                                                                                           | `listForUser(user.id)` → `{upcoming, past}`                                                                                      | `cancelOwnBookingAction` (**DAu**, sở hữu qua `findOwnedByUser`): `bookingId`. `createReviewAction` (**DAu**, `review-actions.ts`): `bookingId`, `rating` 1–5, `comment` ≤ 1000                                                       |
| `/manage`                                                                                                                        | `(manage)/manage/{layout,page}.tsx`               | `requireUser`                                                                                                                           | `venueService.listForUser`; đúng 1 sân → `redirect(/manage/<id>)`                                                                | —                                                                                                                                                                                                                                     |
| `/manage/[venueId]`                                                                                                              | `manage/[venueId]/page.tsx`                       | `requireVenueAccess(venueId, "booking:read")` (thiếu → 404)                                                                             | `forManage`, `listForVenueDay(venueId, date)`, `courtService.listForVenue`, `canOnVenue("payment:confirm")` → `pendingApprovals` | `checkInAction` (**DV** `booking:checkin`): `bookingId`. `cancelBookingAction` (**DV** `booking:cancel`): `bookingId` (+`reason`, UI chưa gửi)                                                                                        |
| `/manage/[venueId]/payments`                                                                                                     | `payments/page.tsx`                               | `payment:confirm`                                                                                                                       | `forManage`, `pendingApprovals` (gộp theo lần đặt)                                                                               | `approvePaymentAction` / `rejectPaymentAction` (**DV** `payment:confirm`): nhiều ô `paymentId` (+ `reason` 4–300)                                                                                                                     |
| `/manage/[venueId]/courts`                                                                                                       | `courts/page.tsx`                                 | `court:read`                                                                                                                            | `forManage`, `listForVenue`, `listPriceRules`                                                                                    | `createCourtAction` (**DV** `court:update`): `name`, `surface`, `isIndoor`. `toggleCourtAction` (`court:update`): `courtId`, `isActive`. `savePriceRulesAction` (`pricing:update`): `rules` (JSON ≤ 50)                               |
| `/manage/[venueId]/revenue`                                                                                                      | `revenue/page.tsx`                                | `report:read`                                                                                                                           | `reportService.venueSummary`, `dailyRevenue`, `listForVenue`; `?range=7/30/90`                                                   | —                                                                                                                                                                                                                                     |
| `/manage/[venueId]/settings`                                                                                                     | `settings/page.tsx`                               | `venue:update`                                                                                                                          | `forManage`, `Object.keys(BANK_BINS)`                                                                                            | **DV** `venue:update`: `updateVenueAction` (hồ sơ + `holdMinutes` 5–120, `freeCancelHours` 0–168, `cancelFeePercent` 0–100, `amenities` phẩy), `updateBankAction` (đủ 3 ô hoặc trống cả 3), `updateHoursAction` (`hours` JSON 7 dòng) |
| `/manage/[venueId]/staff`                                                                                                        | `staff/page.tsx`                                  | `member:manage`                                                                                                                         | `forManage`, `memberService.listForVenue`, `VENUE_STAFF_GRANTABLE`                                                               | **DV** `member:manage`: `inviteStaffAction` (`email`, phải có tài khoản sẵn), `setStaffPermissionsAction` (`memberId`, nhiều `permissions`), `removeStaffAction` (`memberId`)                                                         |
| `/venue-approvals`                                                                                                               | `(admin)/layout.tsx` + `venue-approvals/page.tsx` | Layout: có ≥ 1 trong `user:read`/`role:read`/`venue:approve`/`invoice:manage` (không → 404); trang `requirePermission("venue:approve")` | `listPendingApproval()`                                                                                                          | `decideVenueAction` (**DA** `venue:approve`): `venueId`, `decision` ACTIVE/ADMIN_LOCKED, `note` (bắt buộc khi từ chối)                                                                                                                |
| `/invoices`                                                                                                                      | `(admin)/invoices/page.tsx`                       | `invoice:manage`                                                                                                                        | `invoiceService.listByStatus(status)`; `?status=` OVERDUE (mặc định)/DUE/PAID/WAIVED                                             | **DA** `invoice:manage`: `markInvoicePaidAction` (`invoiceId`), `waiveInvoiceAction` (`invoiceId`, `reason` ≥ 4)                                                                                                                      |
| `/users`, `/roles`                                                                                                               | `(admin)/users`, `(admin)/roles`                  | `user:read` / `role:read`                                                                                                               | trang bộ khung (style cũ)                                                                                                        | xem `auth-rbac.md`                                                                                                                                                                                                                    |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/confirm-email-change`, `/security`, `/sessions` | `(auth)/*`, `security/`, `sessions/`              | —                                                                                                                                       | trang bộ khung                                                                                                                   | xem `auth-rbac.md`                                                                                                                                                                                                                    |

Proxy CHỈ chặn `/users`, `/roles`, `/sessions`, `/security` (chưa đăng nhập) và `/login`, `/register` (đã
đăng nhập). `/manage`, `/account`, `/venue-approvals`, `/invoices` tự chặn ở layout/page. Layout KHÔNG phải
ranh giới bảo mật — mỗi page tự kiểm quyền, mỗi action tự kiểm lại.

---

## 3. Khuôn Server Action + form

**Action**: `safeParse(Object.fromEntries(formData))` (ô trùng tên dùng `formData.getAll(...)`) → gọi service
trong `try`, bắt `DomainError` trả `{ error: message }`, lỗi khác ném tiếp (không lộ Prisma) →
`revalidatePath(...)` → trả `{ ok: "Đã …" }`. `redirect()` luôn NGOÀI `try`. Lỗi ở trường ẨN trả một câu
chung hiện ra được. State chỉ gồm trường tuỳ chọn (`{ error?, ok? }` hoặc `{ error?, fields? }`). Wrapper từ
chối thì trả `{ error }` đúng kiểu state ("Bạn cần đăng nhập…", "Bạn không có quyền… trên sân này.",
"Bạn thao tác hơi nhanh…").

```ts
"use server";
export type XyzState = { error?: string; ok?: string };

export const saveXyzAction = defineVenueAction(
  "court:update",
  async (ctx, _prev: XyzState, formData: FormData): Promise<XyzState> => {
    const parsed = z
      .object({ name: z.string().trim().min(1, "Đặt tên cho sân") })
      .safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return {
        error:
          z.flattenError(parsed.error).fieldErrors.name?.[0] ?? "Kiểm tra lại tên sân giúp bạn",
      };
    }
    try {
      await fooService.save(ctx.venueId, parsed.data); // service lọc theo ctx.venueId (GOTCHAS #19)
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }
    revalidatePath(`/manage/${ctx.venueId}/xyz`);
    return { ok: "Đã lưu" };
  },
);
```

**Client**:

```tsx
"use client";
export function XyzEditor({ venueId }: { venueId: string }) {
  const [state, save] = useActionState<XyzState, FormData>(saveXyzAction.bind(null, venueId), {});
  return (
    <form
      action={save}
      className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1"
    >
      <Input id="xyz-name" name="name" required />
      {state.error && (
        <p role="alert" className="alert alert-danger mt-3">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mt-3 text-sm font-medium text-brand-hover">
          {state.ok}
        </p>
      )}
      <SaveButton />
    </form>
  );
}

// useFormStatus CHỈ đọc được khi nằm TRONG <form> → nút submit luôn là component con
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Đang lưu…" : "Lưu"}
    </Button>
  );
}
```

- Lỗi cả form: `role="alert"` + `alert alert-danger`; lỗi nhỏ: `text-xs text-danger`; lỗi theo trường:
  `state.fields?.x` + `aria-describedby`; thành công: `role="status"` `text-brand-hover`.
- `BookingRow` lấy `venueId` qua context `useVenueId()` thay vì bind.
- ⚠️ React 19 tự reset form uncontrolled sau khi action trả về, KỂ CẢ khi trả lỗi (nghi, xem §12).

**Page khuôn trong khu sân**:

```tsx
export const metadata: Metadata = { title: "…", robots: { index: false } };

export default async function XyzPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "court:read"); // quyền của TRANG
  const [venue, rows] = await Promise.all([
    venueService.forManage(venueId),
    fooService.list(venueId),
  ]);
  if (!venue) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="text-sm font-medium text-muted hover:text-content"
        >
          ← {venue.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-content sm:text-3xl">Tiêu đề</h1>
      </header>
      <div className="mt-4 border-b border-line pb-2">
        <ManageNav venueId={venueId} userId={user.id} active="courts" />
      </div>
      <XyzEditor
        venueId={venueId}
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      />
    </div>
  );
}
```

Thêm trang trong sân → thêm mục vào `ManageNav` (`src/components/manage/manage-nav.tsx`) với ĐÚNG quyền của
trang (không thì hiện link dẫn tới 404).

---

## 4. Màn đặt sân

**Trang `/venues/[slug]`**: header (icon môn, H1, địa chỉ, sao) → `VenueGallery` → alert `inactiveNote` →
grid `lg:grid-cols-[minmax(0,1fr)_20rem]`: trái (section `min-w-0`) "Chọn khung giờ" + `DateStrip` +
`SelectAndBook key={dateKey}`; phải (`lg:sticky lg:top-20`) Giới thiệu, Tiện ích, Giờ mở cửa (T2→CN, "Nghỉ"),
Chính sách huỷ, Liên hệ (`tel:`).

**`SlotGrid`** (`src/components/booking/slot-grid.tsx`, client):

- Props: `day: DayAvailability`, `selected: Set<slotKey>`, `onToggle?` (không truyền = chỉ xem), `axis`,
  `onAxisChange`. `slotKey = "${courtId}__${minute}"`.
- Hàm thuần có test: `keepFreeSlots(day, slots)` (giữ ô FREE kèm giá — dùng cho cả bấm ô lẫn lựa chọn mang về
  sau đăng nhập), `firstBookableMinute(day)`, `visibleMinutes(day)` (chỉ cắt dải ĐẦU ngày mà mọi sân PAST).
- `GridAxis`: `"court-rows"` (mặc định; hàng = sân, cột = khung, cuộn ngang) / `"time-rows"` (hàng = giờ, cột
  = sân, `max-h-[68vh]` cuộn dọc); nút "Theo sân"/"Theo giờ" (`aria-pressed`).
- **Thước giờ**: nhãn nằm TRÊN ranh giới giữa hai ô (`absolute left-0 -translate-x-1/2` + chấm nhỏ), cột đệm
  `w-7` chừa chỗ nhãn đầu, nhãn giờ đóng cửa ở cuối; mọi nhãn `text-xs font-semibold` (giờ vàng chỉ đổi màu).
- **Ô**: `button h-11 rounded-xl text-[13px] tabular-nums`, `data-minute`, `aria-pressed`, `aria-label="{sân}
HH:MM–HH:MM — {trạng thái}[, giá]"`. Đang chọn: ✓ `bg-brand text-white shadow-chon`; TAKEN "Đã đặt"
  `bg-taken text-subtle`; CLOSED "Bảo trì" nền sọc; PAST trống `bg-elevated/40`; FREE giờ vàng: giá rút gọn
  `bg-peak-tint text-peak-text ring-peak-line`; FREE thường `bg-surface ring-line` hover `bg-brand-tint`.
- Tự cuộn tới `firstBookableMinute` (đo `getBoundingClientRect`, không `offsetLeft`; chỉ khi lệch > 24px;
  gán `scrollLeft` trực tiếp, không setState). Tên sân `sticky left-0`. Chú giải + trạng thái rỗng.
- Năm luật của lưới: **không kẻ vạch; nhãn giờ ở ranh giới; nhãn cùng cỡ; chỉ ẩn khung đã qua ở đầu ngày;
  ô nói bằng chữ.** Khung ngoài và vùng cuộn đều `min-w-0`.

**`SelectAndBook`** (`src/components/booking/select-and-book.tsx`, client): chọn tự do nhiều sân/khung;
`list` sắp theo sân rồi phút; `total` là giá TẠM; `ranges = slotsToRanges(list)`. Giữ lựa chọn qua đăng nhập
(`?chon=`, `keepFreeSlots`, gỡ `chon` bằng `history.replaceState`, cuộn tới form, không tự đặt — chi tiết ở
`booking-payment.md` §5). Form `#dat-san` (`scroll-mt-24`): hidden `venueId`/`date`/`slots`; banner "Đã giữ
nguyên N khung", banner "N khung không còn trống…"; khối "Đã chọn (N khung · M lượt đặt)" với chip bỏ từng ô
và "Bỏ chọn tất cả"; "Tạm tính"; khách: nút "Đăng nhập để đặt sân" + "Chưa có tài khoản? Đăng ký" (cả hai
mang `?next=` kèm `chon`); đã đăng nhập: ô SĐT (chỉ khi hồ sơ chưa có số), nút "Đặt sân và thanh toán" /
"Chọn ít nhất 1 ô để đặt sân" / "Đang giữ chỗ…". Điện thoại: thanh dính đáy (`sm:hidden fixed bottom-0 z-30`)
"{n} khung · tổng" + "Tiếp tục ↓" và khoảng đệm `h-16`.

**`DateStrip`** (server): 14 ngày từ hôm nay, mỗi ngày là `Link ?date=` (`scroll={false}`,
`aria-current="date"`), cuộn ngang `-mx-4 px-4 snap-x` trên điện thoại. `basePath` là `/venues/<slug>` (từng
trỏ nhầm `/venue/` → 404).

---

## 5. Màn thanh toán `/bookings/[code]`

Thứ tự nhánh và nghiệp vụ ở `booking-payment.md` §8. Thành phần: `CheckoutSummary` (tên sân, ngày nếu mọi
lượt cùng ngày, "Mã …", từng lượt sân · giờ · mã lượt · tiền, badge `BOOKING_STATUS` khi `showStatus`, "Người
đặt", "Cần thanh toán (n lượt)"/"Tổng tiền"); `TransferPanel` (QR + Ngân hàng / Số tài khoản có nút chép /
Chủ tài khoản / Số tiền; khung viền đứt nội dung chuyển khoản chữ mono lớn + nút chép); `DeclareTransfer`
("Tôi đã chuyển khoản" / "Đang gửi…"); `HoldCountdown` (nhận ISO từ server, lần đầu "--:--" tránh lệch
hydration, ≤ 120s đổi `text-danger` + `aria-live`, về 0 thì `window.location.reload()`); `QrCode`
(`import("qrcode")` động → canvas 220px, `role="img"`); `CopyButton` (`navigator.clipboard?.writeText`, "Đã
chép ✓" 2s); `HoldExpired` (hộp "Đã hết thời gian giữ chỗ" + "Đặt lại các khung này", KHÔNG QR);
`CheckoutOutcome` (icon tròn, tiêu đề theo trạng thái, "Xem sân này" + "Đặt lại"/"Đặt sân khác").

---

## 6. Khu khách, chủ sân, quản trị

- **`/account/bookings`**: "Sắp tới (n)" (`canCancel` khi HOLDING/CONFIRMED) và "Đã qua" (`canReview` khi
  CHECKED_IN/COMPLETED chưa đánh giá). `BookingCard`: badge, tên sân (link), địa chỉ, ngày + giờ + sân, "Mã đặt
  sân" mono lớn, tiền, "Thanh toán" → `/bookings/<checkoutCode ?? code>`, "Huỷ lượt đặt" (không hộp xác nhận),
  `ReviewForm` (5 nút sao `aria-pressed`, textarea, "Thôi").
- **`/manage`**: một sân → redirect thẳng; nhiều sân → thẻ có ảnh bìa nhỏ (`VenuePhoto`) hoặc ô môn, tên,
  "phường, tỉnh", badge trạng thái. `ManageNav` (5 lần `canOnVenue`) chỉ hiện mục có quyền, tab đang mở
  `bg-brand-tint text-brand-hover`, cuộn ngang.
- **Lịch sân `/manage/[venueId]`**: banner "N khách báo đã chuyển khoản…" (khi có `payment:confirm`),
  `DateStrip`, dòng "{n} lượt · {chưa trả} · {tổng}", danh sách (huỷ/hết hạn xuống cuối); `BookingRow`: giờ,
  chip sân, khách + `tel:`, mã, "tại quầy" khi COUNTER, tiền, badge, "Khách tới" (CONFIRMED), "Huỷ"
  (HOLDING/CONFIRMED). Lịch dạng DANH SÁCH (có chú thích giải thích vì sao không dạng lưới).
- **`/payments`**: "N khoản · tổng"; `ApprovalCard` = MỘT lần chuyển khoản: nội dung CK mono lớn + tổng tiền,
  từng lượt (sân · giờ, ngày · mã, tiền từng lượt khi nhiều lượt), khách, "Khách báo lúc", ghi chú, ảnh chứng
  từ, nhắc "Lời khai của khách không phải bằng chứng", "Đã nhận đủ tiền" (gửi mọi `paymentId`), "Không thấy
  tiền" → lý do "khách sẽ đọc câu này" → "Báo cho khách".
- **`/courts`**: `CourtManager` ("x/y đang mở bán", "+ Thêm sân" — tên, mặt sân 7 loại, "Trong nhà"; từng
  sân "Tắt sân"/"Mở lại"; KHÔNG có nút xoá — tắt chứ không xoá để giữ lịch sử/doanh thu). `PriceRuleEditor`
  (state cục bộ, lưu CẢ BẢNG một lần: Áp cho cả cơ sở/riêng sân, Từ/Đến bước 30', Giá/30 phút, nút T2…CN,
  Giờ vàng, Ưu tiên, "Xoá luật", "Lưu bảng giá").
- **`/revenue`**: nút 7/30/90 ngày, 4 ô số (Doanh thu, Số lượt đã chốt, Trung bình mỗi lượt, Hoa hồng nợ x%),
  `RevenueChart` vẽ bằng div (không thư viện, kèm bảng `sr-only`), "Theo sân con".
- **`/settings`** (`VenueSettings`, 3 khối mỗi khối một nút "Lưu"): Hồ sơ sân (+ giữ chỗ/huỷ miễn phí/phí
  trễ), Giờ mở cửa (T2→CN, "Mở cửa", 2 select, JSON), Tài khoản nhận tiền (cảnh báo "Sai một số là tiền vào
  tài khoản người khác", mã ngân hàng, số TK, chủ TK viết hoa).
- **`/staff`** (`StaffManager`): mời theo email; danh sách; nhân viên có "Quyền (n)" → tick thêm quyền trong
  `VENUE_STAFF_GRANTABLE` (9 quyền, KHÔNG có ô cho `payout:manage`/`venue:delete`/`venue:transfer`) → "Lưu
  quyền"; "Gỡ". Chủ sân: "luôn có mọi quyền".
- **`(admin)/layout.tsx`**: hỏi 4 quyền, không có quyền nào → 404; sidebar chỉ hiện khi ≥ 2 mục (Duyệt cơ sở,
  Hoá đơn hoa hồng, Người dùng, Vai trò & phân quyền); `<main className="min-w-0 flex-1">`.
- **`/venue-approvals`**: `ApprovalRow` — thông tin sân + chủ, ba con số (sân con bật, luật giá, ngày mở cửa;
  0 thì đỏ), hồ sơ chưa đủ → khoá "Duyệt, cho mở bán"; "Từ chối" → lý do → "Từ chối hồ sơ".
- **`/invoices`**: tab `?status=`, "N hoá đơn · tổng"; `InvoiceRow` — hoa hồng cỡ lớn, "x% của doanh thu gốc",
  kỳ, số lượt, hạn, "Quá hạn n ngày — tới ngưỡng khoá sân", "Đã thu được tiền", "Miễn hoá đơn" → lý do. Ngày
  format sẵn ở server.

---

## 7. Hệ thiết kế — token (`src/app/globals.css`, Tailwind v4)

Chỉ có giao diện SÁNG (không dark mode, không dùng `dark:`). Biến `:root` → `@theme inline` → lớp Tailwind.

| Lớp Tailwind                                             | Giá trị                               | Dùng cho                                             |
| -------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `bg-canvas`                                              | #f8fafc                               | Nền trang, header, footer                            |
| `bg-surface`                                             | #fff                                  | Thẻ, hộp, bảng                                       |
| `bg-elevated`                                            | #f1f5f9                               | Hover, chip, nền phụ                                 |
| `border-line` / `ring-line` / `divide-line`              | #e2e8f0                               | Viền thường                                          |
| `line-strong`                                            | #cbd5e1                               | Chấm thước giờ, thanh cuộn                           |
| `text-content` / `text-muted` / `text-subtle`            | #0f172a / #64748b / #94a3b8           | Chữ chính / phụ / mờ                                 |
| `bg-brand` / `brand-hover` / `brand-tint` / `brand-line` | #10b981 / #059669 / #ecfdf5 / #a7f3d0 | Hành động chính VÀ còn trống/đang chọn; hộp tích cực |
| `peak-tint` / `peak-line` / `peak-text`                  | #fff7ed / #fdba74 / #c2410c           | CHỈ giờ vàng (giá cao hơn)                           |
| `bg-taken`                                               | #f1f5f9                               | Ô đã có người — XÁM, không đỏ                        |
| `text-danger` / `bg-danger`                              | #ef4444                               | Lỗi, thao tác nguy hiểm, đếm ngược sắp hết           |
| `rounded-token-sm/md/lg/xl`                              | 6/10/14/20px                          | Bo góc                                               |
| `shadow-nang-1/2/3`                                      | 2 lớp, tăng dần                       | Nổi thẻ (hover lên 2/3)                              |
| `shadow-chon`                                            | bóng xanh                             | CHỈ thứ đang được CHỌN hoặc CTA chính                |
| `font-sans`                                              | Be Vietnam Pro                        | —                                                    |

CSS thủ công BẮT BUỘC nằm trong `@layer` (base/components/utilities) — CSS trần ngoài layer thắng mọi
utility (lỗi thật: `* {margin:0;padding:0}` trần đã xoá sạch `p-*`, `mx-auto`). Lớp `components` còn lại từ
bộ khung: `.container`, `.card`, `.page-title`, `.badge*`, `.alert*`, `.form-grid`, `.user-*`, `.permission-*`,
`.spinner`, `.site-header*` (không dùng), `.sr-only`. Utility riêng: `.scrollbar-thin`.

**`<Button>`** (`src/components/ui/button.tsx`, cva + Radix Slot `asChild`): variant `default` (`bg-brand`),
`destructive` (`bg-danger`), `outline`, `secondary`, `ghost`, `link`; size `default` h-10, `sm` h-8, `lg` h-11,
`icon`, `icon-sm`. **`<Input>`** (`ui/input.tsx`): h-10, `border-line bg-canvas/60`, focus `border-brand ring-brand/25`;
prop `error`/`hint` tự nối aria (cần `id`). Nút và ô nhập LUÔN dùng hai component này.

**`sportStyle(key)`** (`src/components/venue/sport-icon.tsx`) → `{ mau (màu chữ), nen (gradient), ve (path
SVG) }`: badminton sky, football indigo, pickleball violet, tennis lime, basketball orange-700, volleyball
rose, table-tennis cyan, mặc định slate. `SportIcon` SVG 24px nét 1.7, `aria-hidden`.

**Ảnh sân**: `VenueCard` (điện thoại nằm ngang ảnh `w-28`, từ `sm` dọc `h-44`; chưa có ảnh → gradient môn +
icon; chip môn góc trên; tên → địa chỉ → "từ 70k /30 phút" → sao; hover `-translate-y-0.5 shadow-nang-3`).
`VenuePhoto` (src bắt đầu `/` → `next/image fill sizes preload`; host ngoài → `<img>` vì chưa khai
`images.remotePatterns`). `VenueGallery` (MỘT danh sách: điện thoại vuốt ngang `w-[86%] aspect-[16/10]`; từ
`sm` lưới `h-72`/`lg:h-80`, ảnh bìa 2×2 + 3 ô; chỉ preload ảnh bìa — Next 16 dùng `preload` thay `priority`).

---

## 8. Ranh giới server → client

- `Date` KHÔNG qua được: page `.toISOString()`, client `new Date(iso)` rồi format bằng `timeOfDay`/
  `fullDateLabel` (timeZone cố định VN → server và trình duyệt ra cùng chuỗi). Hạn giữ chỗ truyền ISO.
- `Decimal` đổi `Number()` ngay ở page (`ratingAvg`, `commissionRate`). `DayAvailability` vốn JSON thuần.
- Hằng số dùng chung server + client (`BOOKING_STATUS`) đặt ở module thường (`src/lib/booking-status.ts`) —
  import hằng số từ tệp `"use client"` vào Server Component chỉ nhận tham chiếu rỗng.
- Không đọc `Date.now()`/`new Date()` khi render — tính ở service (`findCheckout().holdExpired`,
  `listByStatus().overdueDays`).

---

## 9. Giọng văn, responsive, a11y

- **Giọng văn**: xưng "bạn", hay kết "giúp bạn nhé"; câu lỗi nói BƯỚC TIẾP THEO ("Ghi rõ lý do để khách biết
  phải làm gì"); nhãn nút nói KẾT QUẢ ("Đặt sân và thanh toán", "Tôi đã chuyển khoản", "Đã nhận đủ tiền",
  "Không thấy tiền", "Khách tới", "Tắt sân", "Đặt lại các khung này"); huỷ thao tác là "Thôi"; đang chạy
  "Đang …"; xong "Đã …". Chính tả "huỷ, hoá, khoá". Tiền `formatVnd` "180.000đ", ô hẹp `formatVndShort`
  "70k"/"1.2tr". Ngày "Thứ 6, 04/09/2026". Mã hiện chữ mono.
- **Responsive**: khung `mx-auto max-w-* px-4 sm:px-6 lg:px-8`; `min-w-0` ở CẢ khung cuộn lẫn mọi cha
  flex/grid; dải cuộn tràn mép `-mx-4 px-4`; nav `overflow-x-auto`; thanh dính đáy kèm khoảng đệm; header
  gap/padding nhỏ, logo ẩn chữ < 360px. Kiểm `document.documentElement.scrollWidth <= innerWidth` ở
  320/360/390/430/768/1024/1280/1920.
- **A11y**: `aria-pressed` (ô lưới, nút đổi kiểu xem, nút thứ, nút sao); `aria-label` (ô lưới, chip bỏ chọn,
  nút chép, QR); `role="alert"`/`role="status"`; `aria-live` (đếm ngược); `aria-current="page"`/`"date"`;
  section `aria-labelledby`; SVG trang trí `aria-hidden`; fieldset/legend cho sao và quyền; biểu đồ kèm bảng `sr-only`.
- Tìm kiếm, lọc, chọn ngày là GET/`Link` (URL chia sẻ được, Back đúng, chạy khi JS chưa tải).

---

## 10. Bản vẽ `design/`

Mở `design/chotsan-giao-dien.html` trong trình duyệt (tự chứa 6 artboard; các `.dc.html` lẻ cần
`support.js` không có trong repo): **Main** (hệ thiết kế), **TimSan** (tìm sân desktop: cột lọc, badge "còn N
khung tối nay", bản đồ), **DatSan** (đặt sân desktop: dải tổng quan cả ngày, lưới không chữ giá ở tiêu đề cột,
hoá đơn dính phải "Chốt sân · 360.000đ", mã giảm giá), **LichSan** (lịch chủ sân dạng lưới khối liền, sidebar
tối), **Tablet 834**, **Mobile 390** (tìm sân + tab bar đáy, chọn giờ, lịch nhân viên). Mã hiện CHƯA làm: dải
tổng quan (`summary` chưa dùng), nhóm nửa giờ, nút mang số tiền, lịch chủ sân dạng lưới, sidebar tối, chip lọc/
bản đồ/khoảng cách/"còn N khung", đặt tại quầy, mã giảm giá, tab bar đáy, "Theo giờ" mặc định trên điện thoại.

---

## 11. Luật giao diện (bất biến)

1. CSS thủ công trong `@layer`; dùng token theo vai trò, không mã màu thẳng.
2. Mỗi màu một nghĩa: **cam CHỈ giờ vàng**; xanh = bấm được/đặt được; đã đặt = xám. Màu môn tránh xanh và cam.
3. Không `dark:`.
4. `min-w-0` cho khung cuộn và mọi cha flex/grid.
5. Năm luật của lưới (§4). Bước 30 phút toàn hệ thống. Cuộn thay vì chia trang.
6. Lựa chọn đi qua `keepFreeSlots`; `SelectAndBook` có `key` theo ngày; gỡ `chon`; không tự đặt hộ.
7. Form không gửi giá; lỗi trường ẩn hiện thành một câu.
8. Màn thanh toán: một URL mỗi lần đặt; hết hạn không hiện QR; khai chuyển khoản cho MỌI lượt đang giữ;
   nội dung chuyển khoản to, cạnh nút chép; QR vẽ trong trình duyệt.
9. `redirect()` ngoài `try`; lỗi không phải `DomainError` ném tiếp.
10. Mọi Server Action bọc `define*`; page tự kiểm quyền; thiếu quyền → 404; layout không phải ranh giới bảo mật.
11. `useFormStatus` chỉ trong component con của `<form>`.
12. Chỉ hiện mục người dùng vào được (`ManageNav`, header, sidebar); `permissionService.can` nhận USER ID.
13. Ba quyền nguy hiểm không có ô tick.
14. Đăng xuất web là Server Action.
15. TopProgressBar: `setTimeout` không `queueMicrotask`, không `loading.tsx`, dừng ~90%, bọc Suspense.
16. Cấu hình gửi CẢ bảng (giá, giờ, quyền); tắt sân con chứ không xoá; thao tác từ chối/miễn bắt buộc lý do.
17. Không truyền `Date`/`Decimal` qua ranh giới; ngày giờ qua `lib/date`.
18. Nút/ô nhập dùng `<Button>`/`<Input>`; không viết tên class cũ trong chú thích (bộ quét Tailwind đọc cả comment).
19. Ảnh host ngoài dùng `<img>` tới khi khai `remotePatterns` (VÀ nới `img-src` trong proxy). Gallery một danh sách.
20. Biểu đồ không kéo thư viện, luôn kèm bảng `sr-only`.

---

## 12. Nghi lỗi, lệch skill, phần bộ khung chưa làm lại (ĐÃ BIẾT — chưa sửa)

**Lỗi chức năng/UI** (kiểm lại trước khi sửa):

1. `src/app/page.tsx` dùng `shadow-selection` — KHÔNG có token này (chỉ có `shadow-chon`, di chứng regex
   "chon"→"selection") → nút "Tìm sân" và số bước mất bóng. Id `selection-gio` ở trang chi tiết cũng lai.
2. Footer link `/privacy`, `/terms` không tồn tại (404; với `typedRoutes` có thể lỗi typecheck).
3. `CopyButton` im lặng khi không có `navigator.clipboard` — mà mở qua **HTTP IP LAN** (cách người dùng test)
   thì không có clipboard → nút "Chép" không phản hồi gì.
4. Nhân viên thấy điều khiển không có quyền: STAFF có `court:read` nên thấy form thêm sân/bật tắt/sửa bảng giá
   (bấm lưu mới báo không có quyền); `BookingRow` hiện "Huỷ" dù thiếu `booking:cancel`; "Lịch sân" luôn hiện dù
   trang đòi `booking:read`.
5. Header điện thoại của chủ sân/quản trị: 4 mục nav + "Đăng xuất", không `overflow-x-auto` → nghi tràn ngang ở 390px.
6. Thông báo sau huỷ/duyệt biến mất trước khi đọc được: item đổi nhóm/rời danh sách sau `revalidatePath` nên
   component bị gỡ (khách huỷ, chủ sân huỷ, `ApprovalRow`, `InvoiceRow`).
7. `InvoiceRow` hiện "Đã thu được tiền"/"Miễn hoá đơn" ở mọi tab (tab PAID bấm lại vẫn báo "đã ghi nhận").
8. `HoldCountdown` có thể reload liên tục nếu đồng hồ máy khách nhanh hơn server.
9. `RevenueChart` nghi không hiện cột (`height: X%` trong cha không có chiều cao xác định).
10. Giờ mở cửa: chữ nói "ngày chưa khai = đóng cửa" nhưng mặc định state cho ngày chưa khai là mở 06–22 → lưu
    bất kỳ thay đổi nào là mở luôn các ngày đó.
11. `JSON.parse` nằm ngoài `try` trong `courts/actions.ts`, `settings/actions.ts` → JSON hỏng ra error boundary.
12. React 19 tự reset form uncontrolled sau action kể cả khi lỗi → ô SĐT, hồ sơ sân, ngân hàng, lý do từ chối,
    email mời bị xoá sau khi báo lỗi (nghi).
13. "Chỗ được giữ 10 phút" viết cứng (thật là `holdMinutes` theo sân); "× 30 phút" viết cứng thay `SLOT_MINUTES`.
14. `(admin)/layout.tsx` gọi `requireUser("/users")` → vào `/venue-approvals`/`/invoices` khi chưa đăng nhập,
    đăng nhập xong bị đưa tới `/users` (404 với người không có `user:read`); header không có lối vào cho người chỉ
    có `invoice:manage`; đệm trang admin bị chồng.
15. Phân trang `/venues`: `Button asChild disabled` trên `<a>` vẫn bấm được bằng bàn phím → trang rỗng.
16. Chủ sân một sân: link "← Sân của bạn" về `/manage` rồi bị redirect ngược về lịch sân.
17. Lịch chủ sân không lùi xem ngày cũ; tổng tiền cộng cả lượt HOLDING chưa trả.
18. "Hôm nay đã hết giờ đặt" hiện cả khi xem ngày quá khứ; `aria-label` ô giá 0 đọc ", 0".
19. Trang thanh toán công khai: ai biết mã thấy tên + SĐT khách; chú thích `definePublicAction` vẫn viện "khách
    vãng lai" dù đặt sân đã bắt buộc đăng nhập.
20. Trường schema có mà UI không có: `note` khai chuyển khoản, `customerNote`, `reason` khi chủ sân huỷ. Không
    có hộp xác nhận cho "Huỷ lượt đặt", "Huỷ", "Gỡ" nhân viên.
21. Nhãn trạng thái lượt đặt có HAI bộ: `BookingRow.STATUS` ("Chờ trả tiền", "Đã trả tiền", "Xong", "Hết hạn giữ")
    khác `BOOKING_STATUS` ("Chờ thanh toán", "Đã xác nhận", "Hoàn tất", "Hết hạn giữ chỗ").
22. `twMerge` không nhận token tuỳ biến → `rounded-md` chồng `rounded-token-md`, `shadow-sm` chồng `shadow-chon`
    (bên thắng tuỳ thứ tự CSS); `text-content` + `text-brand` cùng lúc ở ô Doanh thu.
23. Header gọi quyền 3 lần + `listForUser` mỗi request; `ManageNav` 5 lần `canOnVenue`. Trang chi tiết gọi
    `publicDetail` hai lần (metadata + page) và chạy tuần tự dù chú thích nói song song.
24. `prefers-reduced-motion` không tắt `animate-ping` và cuộn smooth. Tương phản `.alert-*`/`.badge-*` nghi dưới AA.
25. `inactiveNote` gần như không bao giờ hiện (trang chỉ trả sân ACTIVE, duyệt ACTIVE thì xoá note).
26. PWA/SEO: `manifest.webmanifest` trỏ icon không tồn tại và không được link; chưa có favicon; `logo*.svg` trong
    `public/` không ai dùng. Nút "Đăng ký chủ sân" dẫn tới đăng ký người dùng thường, chưa có luồng tạo cơ sở mới.
    `?tinh=` được đọc nhưng không có ô lọc.

**Mã lệch skill thiết kế `chotsan-thiet-ke`**: cam đang dùng cho nhiều thứ ngoài giờ vàng (HOLDING "Chờ thanh
toán", PENDING/UNDER_MAINTENANCE, hộp hết hạn, banner, hoá đơn trễ, hover link, bóng rổ orange-700); Button/Input
cao 40px thay vì 44px, `--tap-target` không dùng; thẻ thường có `shadow-nang-1` dù skill cấm bóng thẻ thường;
gradient trang trí; màu Tailwind viết thẳng (`emerald-*`, `amber-400`, `red-*`…). Skill tự mâu thuẫn: "giá ở tiêu
đề cột, ô không chữ" vs "ô trống ghi giá 70k" — mã theo luật SAU. Câu lỗi còn chung chung ("Dữ liệu không hợp
lệ", "Bảng giá không hợp lệ").

**Phần bộ khung chưa làm lại**: `error.tsx`, `not-found.tsx` (`.container .card .badge` + style inline, `badge-primary`
màu chàm), `global-error.tsx` (nền tối, nút #6366f1), các trang `(auth)/*`, `/sessions`, `/security`,
`(admin)/users`, `(admin)/roles`. `<main>` lồng nhau trong khu admin; các khu public/account/manage không có
`<main>`. CSS thừa: `.site-header*`, `.user-item` kiểu nền tối, `.page-title`, `.spinner`. `next.config.mjs` còn
nói CSP ở `src/middleware.ts`.

**Đặt tên lệch quy ước mã tiếng Anh**: prop `court` của `VenueCard` (thật là CƠ SỞ); biến/prop `mon`,
`nguoiDung`, `duongDanHienTai`, `lich`, `nguoiDat`, `soDienThoai`, `truoc`, `chuoi`; setter lai `setConLai`,
`setLoi`, `setDaChep`; component/field `Nut`, `Dong`, `chep`, `tieuDe/mo/vui`, `HowToStep so/tieuDe/mo`,
`InfoCard tieuDe`, `MON`, `MAC_DINH`, `mau/nen/ve`; id/key `sap-toi`, `da-qua`, `#dat-san`, `loi-sdt`,
`khai-chuyen-khoan`; param URL `?mon=`, `?tinh=`, `?chon=` (ngoại lệ đã tồn tại — đừng đẻ thêm). Đổi tên thì sửa
TỪNG tệp hoặc rename của IDE, không regex.
