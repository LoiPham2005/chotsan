# Giao diện, route và hệ thiết kế

Đọc kèm skill `.claude/skills/chotsan-thiet-ke/SKILL.md` (màu, chữ, lưới, responsive) trước khi viết
giao diện. Tệp này mô tả MÃ THẬT đang chạy (cập nhật sau đợt sửa 17/09/2026) — chỗ còn lệch skill hoặc còn
nghi lỗi ghi ở mục 12.

---

## 1. Khung ứng dụng

- `src/app/layout.tsx`: font **Be Vietnam Pro** (`next/font/google`, 400–800, latin + vietnamese, biến
  `--font-be-vietnam-pro`), `<html lang="vi">`, metadata title `"%s · ChốtSân"` + `robots` noindex (còn bật,
  kèm `public/robots.txt` Disallow — mở site công khai phải bỏ cả hai), `themeColor #10b981`. Cấu trúc:
  `<Suspense fallback={null}><TopProgressBar/></Suspense>` + `Header` + **`<main className="flex-1">`** +
  `Footer`. `<main>` ĐÚNG MỘT LẦN ở layout gốc — trang và layout con (kể cả `(admin)`) KHÔNG tự đặt `<main>`.
- **Favicon/PWA** theo quy ước file của Next: `src/app/icon.svg`, `src/app/apple-icon.png` (180×180),
  `src/app/manifest.ts` (Next tự gắn `<link rel="manifest">`). Đã xoá `public/logo*.svg`,
  `public/manifest.webmanifest`.
- **`Header`** (`src/components/layout/header.tsx`, async Server Component): `getCurrentUser()`; đã đăng nhập
  thì `Promise.all` **một** lần `permissionService.permissionsFor(user.id)` (tập quyền, có cache — truyền
  USER ID) + `venueService.listForUser`. Nav: "Tìm sân" (`/venues`, mọi khổ màn), "Quản lý sân" (`/manage`,
  khi có sân), "Lượt đặt" (`/account/bookings`), "Quản trị" (trang ĐẦU TIÊN vào được theo `ADMIN_ENTRIES`:
  `/venue-approvals` → `/invoices` → `/users` → `/roles`). Phải: tên người dùng → `/sessions` (ẩn ở khổ
  `md`–`lg`), `<form action={logoutAction}>` `<Button size="sm" variant="outline">Đăng xuất`; khách: "Đăng
  nhập" (ghost) / "Đăng ký".
  - **Điện thoại (dưới `md`) khi đã đăng nhập: HAI HÀNG, KHÔNG menu ba gạch.** Hàng 1 logo + tên + "Đăng
    xuất"; hàng 2 các mục nav (`order-last`, tràn mép `-mx-4 px-4`, `overflow-x-auto scrollbar-thin`, cuộn
    ngang khi hẹp). Header `sticky -top-14 md:top-0`: cuộn xuống thì hàng 1 trôi đi, hàng mục DÍNH mép trên.
    Khách: một hàng. Từ `md`: một hàng `h-16`. `NavLink` `min-h-11`. Không tab bar đáy.
- **`logoutAction`** (`src/app/logout-action.ts`): `destroySession()` → `redirect("/")`. KHÔNG gọi
  `/api/v1/auth/logout` (endpoint mobile, đòi body JSON — GOTCHAS #14).
- **`Footer`**: logo nhỏ + "© năm ChốtSân. Đặt sân thể thao nhanh, rõ giá." — KHÔNG còn link `/privacy`,
  `/terms` (hai trang chưa có; thêm lại link cùng lúc với trang).
- **`Logo`**: SVG `ChotSanMark` trong ô `bg-brand`; cỡ sm/md/lg; prop `textFrom` 360 (mặc định) | 400 — chữ
  "ChốtSân" ẩn dưới mốc đó (header của khách dùng 400).
- **`TopProgressBar`** (`src/components/layout/top-progress-bar.tsx`) — thay `loading.tsx` (nó thay cả trang
  bằng khối đang tải). Bắt đầu: listener `click` pha capture trên `<a>` nội bộ (bỏ qua phím bổ trợ, tab mới,
  `download`, `#`, khác origin, trùng URL) + vá `history.pushState` gọi **`setTimeout(start, 0)`** (React gọi
  pushState trong `useInsertionEffect`; setState ở đó huỷ điều hướng — GOTCHAS #12). Chạy chậm dần tới ~90%
  rồi chờ; kết thúc khi `usePathname`/`useSearchParams` đổi (đặt 100% ở `requestAnimationFrame`, tắt sau
  320ms). `fixed top-0 h-0.5 z-[60] aria-hidden`. Luôn bọc `Suspense` (không thì `useSearchParams` đẩy cả
  trang sang dựng lúc chạy).
- **Trang lỗi**: `app/error.tsx` (client, trong layout gốc, nút "Thử lại" gọi prop **`retry`** của Next
  16.3 — `reset()` chỉ dựng lại với dữ liệu cũ), `app/not-found.tsx` (`<Button>` "Về trang chủ" + "Tìm sân";
  `(admin)/not-found.tsx` re-export bản gốc), `app/global-error.tsx` (tự render `<html>/<body>`, style inline
  theo bảng màu sáng vì `globals.css` có thể chưa nạp, cũng dùng `retry`).
- CSP/nonce và chặn trang ở `src/proxy.ts` — xem `architecture.md` §3.

---

## 2. Bản đồ route

Ký hiệu wrapper: **DA** `defineAction(permission)`, **DAu** `defineAuthedAction`, **DP**
`definePublicAction(lyDo, {key, limit, windowSeconds})` (hiện không Server Action giao diện nào dùng), **DV**
`defineVenueAction(permission)` (tham số đầu là `venueId`, gắn bằng `.bind(null, venueId)`).

| URL                                                                                                    | Tệp                                                 | Ai vào                                                                                                                                                                         | Dữ liệu                                                                                                                                                                                         | Action · trường form                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                                    | `app/page.tsx`                                      | Công khai                                                                                                                                                                      | `sportService.listActive()`, `venueService.search({limit:6})`                                                                                                                                   | Form GET → `/venues`: `q`, `mon`. Nút "Đăng ký chủ sân" → `/manage/new`                                                                                                                                                                                                                                                       |
| `/venues`                                                                                              | `(public)/venues/page.tsx`                          | Công khai                                                                                                                                                                      | `venueService.search({q, sportKey: mon, province: tinh, page, limit:12})`, `venueService.listActiveProvinces()`                                                                                 | Form GET `q`, `mon`, **`tinh`** (select tỉnh); phân trang giữ param, thay `page`; nút tắt là `<span aria-disabled>` (không phải `<a>`)                                                                                                                                                                                        |
| `/venues/[slug]`                                                                                       | `(public)/venues/[slug]/page.tsx`                   | Xem công khai; đặt phải đăng nhập                                                                                                                                              | `publicDetail(slug)` bọc `cache()` (trả cả UNDER_MAINTENANCE/SUSPENDED kèm `bookable`, không có → 404), `getCurrentUser()`, `availabilityService.forDay` chỉ khi `bookable`; `?date=`, `?chon=` | `holdBookingAction` (**DAu**): `venueId`, `date`, `slots` (JSON), `customerPhone`, `customerNote` ≤ 300 → giữ chỗ + mở giao dịch trong cùng POST → `redirect(/bookings/<mã>)`                                                                                                                                                 |
| `/bookings/[code]`                                                                                     | `(public)/bookings/[code]/page.tsx`                 | **`requireUser`**; chỉ NGƯỜI ĐẶT hoặc người có `booking:read` trên sân đó (khác → 404)                                                                                         | `findCheckout(code)` — trang CHỈ ĐỌC, không ghi DB; mã lượt con → redirect về mã lần đặt; `transferInstruction` khi mọi lượt đã có giao dịch                                                    | `declareTransferAction` (**DAu**, chỉ người đặt): `code`, `note` ≤ 300. `openTransferAction` (**DAu**, nút "Tạo mã chuyển khoản" khi lượt thiếu giao dịch): `code`                                                                                                                                                            |
| `/account/bookings`                                                                                    | `(account)/account/bookings/page.tsx`               | `requireUser`                                                                                                                                                                  | `listForUser(user.id)` → `{upcoming, past}` (chỗ giữ quá hạn xếp vào "Đã qua", có `holdExpired`)                                                                                                | `cancelOwnBookingAction` (**DAu**, sở hữu qua `findOwnedByUser`): `bookingId`. `createReviewAction` (**DAu**, `review-actions.ts`): `bookingId`, `rating` nguyên 1–5, `comment` ≤ 1000                                                                                                                                        |
| `/manage`                                                                                              | `(manage)/manage/page.tsx` (KHÔNG còn `layout.tsx`) | `requireUser` (trang tự gọi)                                                                                                                                                   | `venueService.listForUser`; đúng 1 sân và KHÔNG có `?all=1` → redirect; cơ sở DRAFT/PENDING mà người đó có `venue:update` → vào `/manage/<id>/settings`, còn lại `/manage/<id>`                 | — (nút "Đăng ký cơ sở mới" → `/manage/new`)                                                                                                                                                                                                                                                                                   |
| `/manage/new`                                                                                          | `(manage)/manage/new/{page,actions,new-venue-form}` | `requireUser("/manage/new")`                                                                                                                                                   | `sportService.listActive()`                                                                                                                                                                     | `createVenueAction` (**DAu**, chủ = `ctx.actorId`; tối đa 3 hồ sơ DRAFT/PENDING — `VenueDraftLimitError`): `name`, `sportId`, `address`, `ward`, `province`, `phone`, `description`; lỗi trả kèm `values` → `redirect(/manage/<id>/settings)`                                                                                 |
| `/manage/[venueId]`                                                                                    | `manage/[venueId]/page.tsx`                         | `requireVenueAccess(venueId, "booking:read")` (thiếu → 404)                                                                                                                    | `forManage`, `listForVenueDay(venueId, date)` (có `holdExpired`), `courtService.listForVenue`, `canOnVenue` × 3 (`payment:confirm`, `booking:cancel`, `booking:checkin`) → `pendingApprovals`   | Form GET `date` (`type="date"`, xem được ngày cũ). `checkInAction` (**DV** `booking:checkin`): `bookingId`. `cancelBookingAction` (**DV** `booking:cancel`): `bookingId`, `reason` ≤ 300 (ô trong `ConfirmButton`)                                                                                                            |
| `/manage/[venueId]/payments`                                                                           | `payments/page.tsx`                                 | `payment:confirm`                                                                                                                                                              | `forManage`, `pendingApprovals` (gộp theo lần đặt)                                                                                                                                              | `approvePaymentAction` / `rejectPaymentAction` (**DV** `payment:confirm`): nhiều ô `paymentId` (+ `reason` 4–300)                                                                                                                                                                                                             |
| `/manage/[venueId]/courts`                                                                             | `courts/page.tsx`                                   | `court:read` (thiếu `court:update`/`pricing:update` → chỉ xem)                                                                                                                 | `forManage`, `listForVenue`, `listPriceRules`, `pricingGaps` (khung mở cửa chưa có giá), `canOnVenue` × 2                                                                                       | `createCourtAction` (**DV** `court:update`): `name`, `surface`, `isIndoor`. `toggleCourtAction` (`court:update`): `courtId`, `isActive`. `savePriceRulesAction` (`pricing:update`): `rules` (JSON ≤ 50)                                                                                                                       |
| `/manage/[venueId]/revenue`                                                                            | `revenue/page.tsx`                                  | `report:read`                                                                                                                                                                  | `reportService.venueSummary`, `dailyRevenue`, `listForVenue`; `?range=7/30/90`                                                                                                                  | —                                                                                                                                                                                                                                                                                                                             |
| `/manage/[venueId]/settings`                                                                           | `settings/page.tsx`                                 | `venue:update`                                                                                                                                                                 | `forManage`, `Object.keys(BANK_BINS)`, `venueService.readiness(venueId)` (chỉ khi DRAFT)                                                                                                        | **DV** `venue:update`: `updateVenueAction` (hồ sơ + `holdMinutes` 5–120, `freeCancelHours` 0–168, `cancelFeePercent` 0–100, `amenities` phẩy), `updateBankAction` (đủ 3 ô hoặc trống cả 3), `updateHoursAction` (`hours` JSON 7 dòng), **`submitForReviewAction`** (không trường; DRAFT → PENDING, service kiểm lại đủ hồ sơ) |
| `/manage/[venueId]/staff`                                                                              | `staff/page.tsx`                                    | `member:manage`                                                                                                                                                                | `forManage`, `memberService.listForVenue`, `VENUE_STAFF_GRANTABLE`                                                                                                                              | **DV** `member:manage`: `inviteStaffAction` (`email`, phải có tài khoản sẵn), `setStaffPermissionsAction` (`memberId`, nhiều `permissions`), `removeStaffAction` (`memberId`, qua `ConfirmButton`)                                                                                                                            |
| `/venue-approvals`                                                                                     | `(admin)/layout.tsx` + `venue-approvals/page.tsx`   | Layout: `requireUser()` (quay về đúng trang) + có ≥ 1 trong `user:read`/`role:read`/`venue:approve`/`invoice:manage` (không → 404); trang `requirePermission("venue:approve")` | `listPendingApproval()`                                                                                                                                                                         | `decideVenueAction` (**DA** `venue:approve`): `venueId`, `decision` **ACTIVE / DRAFT** ("Trả hồ sơ" — không còn ADMIN_LOCKED), `note` ≤ 300 (bắt buộc khi DRAFT)                                                                                                                                                              |
| `/invoices`                                                                                            | `(admin)/invoices/page.tsx`                         | `invoice:manage`                                                                                                                                                               | `invoiceService.listByStatus(status)`; `?status=` OVERDUE (mặc định)/DUE/PAID/WAIVED                                                                                                            | **DA** `invoice:manage`: `markInvoicePaidAction` (`invoiceId`), `waiveInvoiceAction` (`invoiceId`, `reason` ≥ 4) — chỉ hiện ở hoá đơn DUE/OVERDUE                                                                                                                                                                             |
| `/users`, `/roles`                                                                                     | `(admin)/users`, `(admin)/roles`                    | `requirePermission("user:read" / "role:read", path)`                                                                                                                           | đã làm lại theo token                                                                                                                                                                           | users: `createUserAction`, `setUserStatusAction`, `unlockUserAction`, `deleteUserAction`; roles: `createRoleAction`, `updateRolePermissionsAction`, `deleteRoleAction` (**DA**; xoá/khoá qua `ConfirmButton`) — nghiệp vụ ở `auth-rbac.md`                                                                                    |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/confirm-email-change` | `(auth)/*`                                          | Công khai; `/login`, `/register` tự đưa người đã đăng nhập đi (`getSession()` → `safeRedirectPath(next)`)                                                                      | `/login`: `?next=`, `?oauthError=`, `?twoFactor=1`, `?quickLogin=failed\|2fa`, `?reset=`                                                                                                        | xem `auth-rbac.md`. Khung `(auth)/layout.tsx` + `AuthHeader`/`AuthFields` (`(auth)/auth-form.tsx`) + `<Notice>`; đăng nhập nhanh demo: `login/quick-login.tsx` (`QuickLogin`)                                                                                                                                                 |
| `/security`                                                                                            | `security/{page,actions,account-forms,…}`           | `requireUser("/security")` (proxy cũng chặn)                                                                                                                                   | `twoFactorService.status`, `webauthnService.list`, `authService.accountSecurity`                                                                                                                | **DAu**: `changePasswordAction`, `resendVerificationEmailAction`, `requestEmailChangeAction` (trả `values.newEmail`), `beginTwoFactorSetupAction`, `enableTwoFactorAction`, `disableTwoFactorAction`, `regenerateRecoveryCodesAction`, `removePasskeyAction` (`ConfirmButton`)                                                |
| `/sessions`                                                                                            | `sessions/{page,actions,session-revoke-button}`     | `requireUser("/sessions")`                                                                                                                                                     | `tokenService.listActive(user.id)`                                                                                                                                                              | `revokeSessionAction` (**DAu**, `ConfirmButton`)                                                                                                                                                                                                                                                                              |

Proxy CHỈ chặn `/users`, `/roles`, `/sessions`, `/security` khi chưa đăng nhập (gắn `x-pathname` để
`requireUser()` không tham số quay về đúng trang kèm query). Proxy **KHÔNG** còn đá người đã đăng nhập khỏi
`/login`, `/register` — trang tự làm. `/manage/**`, `/account`, `/bookings/[code]`, `/venue-approvals`,
`/invoices` tự chặn ở page/layout. Layout KHÔNG phải ranh giới bảo mật — mỗi page tự kiểm quyền, mỗi action tự
kiểm lại.

**Luồng đăng ký cơ sở**: nút "Đăng ký chủ sân" (trang chủ) / "Đăng ký cơ sở mới" (`/manage`) → `/manage/new`
(tạo DRAFT) → `/manage/<id>/settings`: `VenueReviewPanel` (`components/manage/venue-settings.tsx`) hiện danh
sách việc từ `readiness()` (giờ mở cửa, ≥ 1 sân con, bảng giá, tài khoản nhận tiền), lý do bị trả hồ sơ
(`inactiveNote`), nút "Gửi duyệt" (khoá với nhãn "Làm xong các mục trên để gửi duyệt"); PENDING: "Hồ sơ đang
chờ duyệt", vẫn sửa được; ADMIN_LOCKED: báo bị khoá + lý do. Link "← Sân của bạn" trỏ `/manage?all=1` (không
bị redirect ngược).

---

## 3. Khuôn Server Action + form

**Action**: `safeParse(Object.fromEntries(formData), { error: formErrorMap(LABELS) })` (ô trùng tên dùng
`formData.getAll(...)`) → gọi service trong `try`, bắt `DomainError` trả `{ error: message }`, lỗi khác ném
tiếp (không lộ Prisma) → `revalidatePath(...)` → trả `{ ok: "Đã …" }`. `redirect()` luôn NGOÀI `try`. Lỗi ở
trường ẨN trả một câu chung hiện ra được. Trường JSON đọc qua hàm bọc `try` (`readJson`) — không `JSON.parse`
trần. State chỉ gồm trường tuỳ chọn (`{ error?, ok?, values? }` hoặc `{ error?, fields? }`). Wrapper từ chối
thì trả `{ error }` đúng kiểu state ("Bạn cần đăng nhập…", "Bạn không có quyền… trên sân này.", "Bạn thao tác
hơi nhanh…").

**`src/lib/form-errors.ts`**: `formErrorMap(labels)` dịch lỗi mặc định (tiếng Anh) của Zod thành câu tiếng Việt
nói Ô NÀO sai và sửa thế nào ("Giữ chỗ (phút) phải là một con số") — chỉ lấp luật không tự khai câu;
`firstIssueMessage(error, fallback)` lấy câu của lỗi đầu tiên. Không còn câu chung "Dữ liệu không hợp lệ".

**Form giữ dữ liệu sau lỗi** — React 19 tự reset form uncontrolled sau MỌI lần action chạy xong, KỂ CẢ khi trả
lỗi. Hai cách: (1) action trả `values` (chữ vừa gõ) kèm lỗi, ô dùng `defaultValue={state.values?.x ?? saved}`
— `<select>` cần `key` đổi theo giá trị để dựng lại; (2) ô có kiểm soát (`useState`). KHÔNG BAO GIỜ trả lại
mật khẩu/OTP. Đã áp: `/manage/new`, `VenueSettings` (hồ sơ, ngân hàng), mời nhân viên, lý do trả hồ sơ, đổi
email, ghi chú khai chuyển khoản, lý do huỷ.

```ts
"use server";
export type XyzState = { error?: string; ok?: string; values?: Record<string, string> };

const LABELS = { name: "Tên sân" } as const;

export const saveXyzAction = defineVenueAction(
  "court:update",
  async (ctx, _prev: XyzState, formData: FormData): Promise<XyzState> => {
    const values = { name: String(formData.get("name") ?? "") };
    const parsed = z
      .object({ name: z.string().trim().min(1, "Đặt tên cho sân").max(50) })
      .safeParse(values, { error: formErrorMap(LABELS) });
    if (!parsed.success) {
      return { error: firstIssueMessage(parsed.error, "Kiểm tra lại tên sân giúp bạn"), values };
    }
    try {
      await fooService.save(ctx.venueId, parsed.data); // service lọc theo ctx.venueId (GOTCHAS #19)
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message, values };
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
export function XyzEditor({ venueId, saved }: { venueId: string; saved: string }) {
  const [state, save] = useActionState<XyzState, FormData>(saveXyzAction.bind(null, venueId), {});
  return (
    <form action={save} className="rounded-token-lg border border-line bg-surface p-4">
      <Input id="xyz-name" name="name" defaultValue={state.values?.name ?? saved} required />
      {state.error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {state.error}
        </Notice>
      )}
      {state.ok && (
        <p role="status" className="mt-3 text-sm font-medium text-brand-text">
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

- Lỗi cả form: `<Notice tone="danger" role="alert">`; lỗi nhỏ/theo trường: `text-xs text-danger-text` (hoặc
  prop `error` của `<Input>`, tự nối `aria-describedby`); thành công: `role="status"` `text-brand-text` hoặc
  `<Notice tone="success">`; lời nhắc/đang chờ: `<Notice tone="neutral">`.
- **Thao tác không lấy lại được** (huỷ lượt, gỡ nhân viên, xoá passkey, đăng xuất thiết bị, khoá/xoá user, xoá
  vai trò): `ConfirmButton` (`src/components/ui/confirm-button.tsx`) — bấm lần 1 mở bước xác nhận tại chỗ (nói
  hậu quả, chứa được ô lý do), lần 2 mới submit; Esc/"Thôi" đóng và trả focus. PHẢI nằm trong `<form>`. Không
  dùng `window.confirm`.
- **Thông báo sau thao tác trên DÒNG của danh sách** (dòng đổi nhóm/rời danh sách sau `revalidatePath`):
  bọc trang trong `ActionNoticeProvider` (`src/components/booking/action-notice.tsx`), dòng gọi
  `useActionNotice()(message)` — thông báo dính đáy màn, không tự tắt, có nút "Đóng". Lỗi vẫn hiện tại dòng.
  Đang dùng ở `/account/bookings`, lịch sân, `/payments`.
- `BookingRow` lấy `venueId`, `canCancel`, `canCheckIn` qua context `BookingRowsProvider` (trang tính quyền
  bằng `canOnVenue` rồi đưa xuống) thay vì bind từng dòng.

**Page khuôn trong khu sân**:

```tsx
export const metadata: Metadata = { title: "…", robots: { index: false } };

export default async function XyzPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  const user = await requireVenueAccess(venueId, "court:read"); // quyền của TRANG
  const [venue, rows, canEdit] = await Promise.all([
    venueService.forManage(venueId),
    fooService.list(venueId),
    permissionService.canOnVenue(user.id, "court:update", venueId), // thiếu → chỉ xem
  ]);
  if (!venue) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <header>
        <Link
          href={`/manage/${venueId}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-content"
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
        canEdit={canEdit}
        rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
      />
    </div>
  );
}
```

Thêm trang trong sân → thêm mục vào `ManageNav` (`src/components/manage/manage-nav.tsx`, đọc quyền MỘT lần qua
`permissionService.venuePermissions(userId, venueId)`) với ĐÚNG quyền của trang (không thì hiện link dẫn tới
404). Nút/điều khiển mà người xem thiếu quyền thì KHÔNG render (chỉ xem), đừng để bấm rồi mới báo.

---

## 4. Màn đặt sân

**Trang `/venues/[slug]`**: header (icon môn, H1, địa chỉ, sao) → `VenueGallery` → băng thông báo khi
`!bookable` (`inactiveNote` hoặc câu mặc định; không có lưới) / `inactiveNote` khi có → grid
`lg:grid-cols-[minmax(0,1fr)_20rem]`: trái (section `min-w-0`) "Chọn khung giờ" + `DateStrip` +
`SelectAndBook key={dateKey}`; phải (`lg:sticky lg:top-20`) Giới thiệu, Tiện ích, Giờ mở cửa (T2→CN, "Nghỉ"),
Chính sách huỷ, Liên hệ (`tel:`).

**`SlotGrid`** (`src/components/booking/slot-grid.tsx`, client):

- Props: `day: DayAvailability`, `selected: Set<slotKey>`, `onToggle?` (không truyền = chỉ xem), `axis`,
  `onAxisChange`. `slotKey = "${courtId}__${minute}"`.
- Hàm thuần có test: `keepFreeSlots(day, slots)` (giữ ô FREE kèm giá — dùng cho cả bấm ô lẫn lựa chọn mang về
  sau đăng nhập), `firstBookableMinute(day)`, `visibleMinutes(day)` (chỉ cắt dải ĐẦU ngày mà mọi sân PAST),
  `slotAriaLabel` (giá 0 không đọc ", 0").
- Trạng thái rỗng theo thứ tự: `day.timing === "PAST"` → "Ngày này đã qua"; đóng cửa/không sân → "Sân không mở
  cửa ngày này"; hết khung → "Hôm nay đã hết giờ đặt".
- `GridAxis`: `"court-rows"` (mặc định; hàng = sân, cột = khung, cuộn ngang) / `"time-rows"` (hàng = giờ, cột
  = sân, `max-h-[68vh]` cuộn dọc); nút viên thuốc "Theo sân"/"Theo giờ" (`aria-pressed`, nhìn 24px, vùng chạm
  44px bằng `after:absolute after:-inset-y-2.5`).
- **Thước giờ**: nhãn nằm TRÊN ranh giới giữa hai ô (`absolute left-0 -translate-x-1/2` + chấm nhỏ), cột đệm
  `w-7` chừa chỗ nhãn đầu, nhãn giờ đóng cửa ở cuối; mọi nhãn `text-xs font-semibold` (giờ vàng chỉ đổi màu
  `text-peak-text`).
- **Ô**: `button h-11 rounded-xl text-[13px] tabular-nums`, `data-minute`, `aria-pressed`, `aria-label="{sân}
HH:MM–HH:MM — {trạng thái}[, giá]"`. Đang chọn: ✓ `bg-brand text-white shadow-chon`; TAKEN "Đã đặt"
  `bg-taken text-subtle`; CLOSED "Bảo trì" nền sọc; PAST trống `bg-elevated/40`; NOT_FOR_SALE "—"
  `bg-elevated/40 text-subtle` (chú giải "Chưa mở bán"); FREE giờ vàng: giá rút gọn
  `bg-peak-tint text-peak-text ring-peak-line`; FREE thường: giá rút gọn `bg-surface text-content ring-line`,
  hover `bg-brand-tint text-brand-text`.
- Tự cuộn tới `firstBookableMinute` (đo `getBoundingClientRect`, không `offsetLeft`; chỉ khi lệch > 24px;
  gán `scrollLeft` trực tiếp, không setState). Tên sân `sticky left-0` (mép bóng `shadow-sticky-edge`). Chú
  giải + trạng thái rỗng.
- Năm luật của lưới: **không kẻ vạch; nhãn giờ ở ranh giới; nhãn cùng cỡ; chỉ ẩn khung đã qua ở đầu ngày;
  ô nói bằng chữ (ô trống ghi giá).** Khung ngoài và vùng cuộn đều `min-w-0`. Khung lưới viền 1px, không bóng.

**`SelectAndBook`** (`src/components/booking/select-and-book.tsx`, client): chọn tự do nhiều sân/khung;
`list` sắp theo sân rồi phút; `total` là giá TẠM; `ranges = slotsToRanges(list)`. Giữ lựa chọn qua đăng nhập
(`?chon=`, `keepFreeSlots`, gỡ `chon` bằng `history.replaceState`, cuộn tới form, không tự đặt — chi tiết ở
`booking-payment.md` §5). Form `#dat-san` (`scroll-mt-24`): hidden `venueId`/`date`/`slots`; banner "Đã giữ
nguyên N khung", banner "N khung không còn trống…"; khối "Đã chọn (N khung · M lượt đặt)" với chip bỏ từng ô
và "Bỏ chọn tất cả"; "Tạm tính"; khách: nút "Đăng nhập để đặt sân" + "Chưa có tài khoản? Đăng ký" (cả hai
mang `?next=` kèm `chon`); đã đăng nhập: ô SĐT (chỉ khi hồ sơ chưa có số), ô ghi chú `customerNote`, câu "Chỗ
được giữ {holdMinutes} phút" (theo sân), nút "Đặt sân và thanh toán" / "Chọn ít nhất 1 ô để đặt sân" / "Đang
giữ chỗ…". Điện thoại: thanh dính đáy `data-booking-bar` (`fixed bottom-0 z-30 shadow-dock sm:hidden`) "{n}
khung · tổng" + "Tiếp tục ↓"; `globals.css` chừa `padding-bottom` cho `body:has([data-booking-bar])`.

**`DateStrip`** (server): 14 ngày từ hôm nay, mỗi ngày là `Link ?date=` (`scroll={false}`,
`aria-current="date"`), cuộn ngang `-mx-4 px-4 snap-x` trên điện thoại. `basePath` là `/venues/<slug>` (từng
trỏ nhầm `/venue/` → 404).

---

## 5. Màn thanh toán `/bookings/[code]`

Thứ tự nhánh và nghiệp vụ ở `booking-payment.md` §8. Trang chỉ đọc. Thành phần: `CheckoutSummary` (tên sân,
ngày nếu mọi lượt cùng ngày, "Mã …", từng lượt sân · giờ · mã lượt · tiền, badge `BOOKING_STATUS` khi
`showStatus`, "Người đặt", "Cần thanh toán (n lượt)"/"Tổng tiền"); `Notice danger` lý do sân từ chối lần khai
trước; `OpenTransfer` ("Tạo mã chuyển khoản" khi lượt thiếu giao dịch sống); `TransferPanel` (QR + Ngân hàng /
Số tài khoản có nút chép / Chủ tài khoản / Số tiền; khung viền đứt nội dung chuyển khoản chữ mono lớn + nút
chép); `DeclareTransfer` (ô ghi chú có kiểm soát + "Tôi đã chuyển khoản" / "Đang gửi…"); `HoldCountdown`
(nhận ISO hết hạn + `serverNowIso`, đo lệch đồng hồ MỘT lần; lần đầu "--:--" tránh lệch hydration; ≤ 120s đổi
`text-danger-text` + `aria-live`; về 0 thì tải lại TỐI ĐA một lần cho mỗi mốc); `QrCode` (`import("qrcode")`
động → canvas 220px, `role="img"`); `CopyButton` (`copyText`: Clipboard API → textarea ẩn + `execCommand` →
bôi chọn dòng chữ và bảo khách tự chép; mọi nhánh có phản hồi — chạy được qua HTTP IP LAN); `HoldExpired` (hộp
"Đã hết thời gian giữ chỗ" + "Đặt lại các khung này", KHÔNG QR); `CheckoutOutcome` (icon tròn, tiêu đề theo
trạng thái, "Xem sân này" + "Đặt lại"/"Đặt sân khác").

---

## 6. Khu khách, chủ sân, quản trị

- **`/account/bookings`** (trong `ActionNoticeProvider`): "Sắp tới (n)" (huỷ được khi HOLDING/CONFIRMED và
  chưa quá hạn giữ) và "Đã qua" (`canReview` khi CHECKED_IN/COMPLETED chưa đánh giá). `BookingCard`: badge,
  tên sân (link), địa chỉ, ngày + giờ + sân, "Mã đặt sân" mono lớn, tiền, "Thanh toán" →
  `/bookings/<checkoutCode ?? code>`, "Huỷ lượt đặt" qua `ConfirmButton`, `ReviewForm` (5 nút sao
  `aria-pressed`, textarea, "Thôi").
- **`/manage`**: một sân → redirect thẳng (trừ `?all=1`); nhiều sân → thẻ có ảnh bìa nhỏ (`VenuePhoto`) hoặc ô
  môn, tên, "phường, tỉnh", nhãn trạng thái (`STATUS_LABEL` trong page: "Đang nhận đặt" xanh nhạt, "Bản nháp"
  xám, **"Chờ duyệt" nền trắng viền ĐỨT xám**, "Tạm nghỉ"/"Đang sửa" xám, "Bị khoá" đỏ nhạt — không cam) + nút
  "+ Đăng ký cơ sở mới". `ManageNav` (một lần `venuePermissions`) chỉ hiện mục có quyền (Lịch sân `booking:read`,
  Chờ duyệt tiền `payment:confirm`, Sân & giá `court:read`, Doanh thu `report:read`, Nhân sự `member:manage`, Cài
  đặt sân `venue:update`), cuộn ngang.
- **Lịch sân `/manage/[venueId]`** (trong `ActionNoticeProvider`): banner "N khách báo đã chuyển khoản…" (khi
  có `payment:confirm`), `DateStrip` + form GET chọn ngày bất kỳ (kể cả ngày cũ), dòng tổng: tiền CHỈ cộng lượt
  CONFIRMED/CHECKED_IN/COMPLETED, "chờ thanh toán" đứng riêng, chỗ giữ quá hạn không tính; danh sách (huỷ/hết
  hạn xuống cuối); `BookingRow`: giờ, chip sân, khách + `tel:`, mã, "tại quầy" khi COUNTER, tiền, badge
  `bookingStatusBadge(status, holdExpired)`, "Khách tới" (CONFIRMED, cần `booking:checkin`), "Huỷ" (cần
  `booking:cancel`, `ConfirmButton` + ô lý do). Lịch dạng DANH SÁCH (có chú thích vì sao không dạng lưới).
- **Nhãn trạng thái lượt đặt — MỘT bộ** `BOOKING_STATUS` (`src/lib/booking-status.ts`): "Chờ thanh toán" **đỏ
  nhạt** (`bg-danger-tint text-danger-text`), "Đã xác nhận" xanh nhạt, "Đã tới sân" trắng viền xanh, "Hoàn tất"
  trắng viền xám, "Đã huỷ"/"Hết hạn giữ chỗ" xám, "Không tới" đỏ nhạt. `className` chỉ mang màu, nơi dùng tự
  thêm `ring-1`. `isHoldExpired(booking, now)`.
- **`/payments`** (trong `ActionNoticeProvider`): "N khoản · tổng"; `ApprovalCard` = MỘT lần chuyển khoản: nội
  dung CK mono lớn + tổng tiền, từng lượt (sân · giờ, ngày · mã, tiền từng lượt khi nhiều lượt), khách, "Khách
  báo lúc", ghi chú, ảnh chứng từ, nhắc "Lời khai của khách không phải bằng chứng", "Đã nhận đủ tiền" (gửi mọi
  `paymentId`), "Không thấy tiền" → lý do "khách sẽ đọc câu này" → "Báo cho khách".
- **`/courts`**: `CourtManager` ("x/y đang mở bán", "+ Thêm sân" — tên, mặt sân 7 loại, "Trong nhà"; từng
  sân "Tắt sân"/"Mở lại"; KHÔNG có nút xoá — tắt chứ không xoá để giữ lịch sử/doanh thu). `PriceRuleEditor`
  (`canEdit`; state cục bộ, lưu CẢ BẢNG một lần: Áp cho cả cơ sở/riêng sân, Từ/Đến bước 30', Giá/30 phút, nút
  T2…CN, Giờ vàng, Ưu tiên, "Xoá luật", "Lưu bảng giá"). Thiếu quyền sửa → chỉ xem, không ô nhập, không nút. Cảnh
  báo `pricingGaps`.
- **`/revenue`**: nút 7/30/90 ngày, 4 ô số (Doanh thu, Số lượt đã chốt, Trung bình mỗi lượt, Hoa hồng nợ x%),
  `RevenueChart` vẽ bằng div (cột `h-full flex-col justify-end`, thanh `height: X%` tính trên khung `h-40` xác
  định; không thư viện, kèm bảng `sr-only`), "Theo sân con".
- **`/settings`**: `VenueReviewPanel` (DRAFT/PENDING/ADMIN_LOCKED — §2) + `VenueSettings` (3 khối mỗi khối một
  nút "Lưu", giữ chữ sau lỗi qua `state.values`): Hồ sơ sân (+ giữ chỗ/huỷ miễn phí/phí trễ), Giờ mở cửa (T2→CN,
  "Mở cửa", 2 select, JSON; ngày chưa khai mặc định ĐÓNG), Tài khoản nhận tiền (cảnh báo "Sai một số là tiền vào
  tài khoản người khác", mã ngân hàng, số TK, chủ TK viết hoa).
- **`/staff`** (`StaffManager`): mời theo email (giữ email sau lỗi); danh sách; nhân viên có "Quyền (n)" → tick
  thêm quyền trong `VENUE_STAFF_GRANTABLE` (9 quyền, KHÔNG có ô cho `payout:manage`/`venue:delete`/
  `venue:transfer`) → "Lưu quyền"; "Gỡ" qua `ConfirmButton`. Chủ sân: "luôn có mọi quyền".
- **`(admin)/layout.tsx`**: `requireUser()` không tham số, đọc `permissionsFor` một lần, không có quyền nào → 404;
  khung trang (`mx-auto max-w-6xl px-4 py-6 … lg:flex-row`) đặt MỘT lần ở layout — trang con không tự bọc đệm;
  không `<main>`. **`AdminNav`** (`(admin)/admin-nav.tsx`, client để đọc `usePathname`): chỉ dựng khi ≥ 2 mục
  (Duyệt cơ sở, Hoá đơn hoa hồng, Người dùng, Vai trò & phân quyền); nền `bg-admin-nav` (tối); điện thoại là dải
  cuộn ngang (tự kéo mục đang mở vào giữa bằng `scrollLeft`), từ `lg` là cột trái `lg:w-56`; mục `min-h-11`,
  đang mở `bg-surface text-content` + `aria-current="page"`.
- **`/venue-approvals`**: `ApprovalRow` — thông tin sân + chủ, ba con số (sân con bật, luật giá, ngày mở cửa;
  0 thì đỏ) + tài khoản ngân hàng, hồ sơ chưa đủ → khoá "Duyệt, cho mở bán"; "Trả hồ sơ" → lý do (giữ chữ sau lỗi).
- **`/invoices`**: tab `?status=`, "N hoá đơn · tổng"; `InvoiceRow` — hoa hồng cỡ lớn, "x% của doanh thu gốc",
  kỳ, số lượt, hạn, "Quá hạn n ngày — tới ngưỡng khoá sân"; nút "Đã thu được tiền"/"Miễn hoá đơn" (→ lý do) CHỈ ở
  DUE/OVERDUE, PAID/WAIVED hiện nhãn "Đã thu tiền"/"Đã miễn". Số hoá đơn `CS-YYYYMM-000042`. Ngày format sẵn ở
  server.
- **`(auth)/*`**: `(auth)/layout.tsx` một thẻ hẹp `max-w-md` viền 1px không bóng; `AuthHeader` (tiêu đề + mô tả),
  `AuthFields`, `<Notice>` cho lỗi/kết quả. `/security` (các `Section`): Email (`ResendVerificationButton`,
  `ChangeEmailForm`), Mật khẩu (`ChangePasswordForm`), Xác thực hai lớp (`TwoFactorManager`), Passkey
  (`PasskeyManager`), Thiết bị đang đăng nhập (lối sang `/sessions`). `/sessions`: danh sách thiết bị +
  `SessionRevokeButton`.

---

## 7. Hệ thiết kế — token (`src/app/globals.css`, Tailwind v4)

Chỉ có giao diện SÁNG (không dark mode, không dùng `dark:`). Biến `:root` → `@theme inline` → lớp Tailwind.
Thêm token vào `@theme` thì PHẢI thêm tên vào `src/lib/cn.ts`.

| Lớp Tailwind                                              | Biến `:root` · giá trị                              | Dùng cho                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bg-canvas`                                               | `--bg-color` #f8fafc                                | Nền trang, header, footer                                                                           |
| `bg-surface`                                              | `--surface-color` #fff                              | Thẻ, hộp, bảng, ô nhập, ô lưới còn trống                                                            |
| `bg-elevated`                                             | `--surface-hover` #f1f5f9                           | Hover, chip, nền phụ, `Notice neutral`                                                              |
| `border-line` / `ring-line` / `divide-line`               | `--border-color` #e2e8f0                            | Viền thường                                                                                         |
| `line-strong`                                             | `--border-strong` #cbd5e1                           | Viền ô nhập, nút viền, chấm thước giờ, thanh cuộn                                                   |
| `text-content` / `text-muted` / `text-subtle`             | #0f172a / #64748b / #94a3b8                         | Chữ chính / phụ / mờ (`subtle` chỉ ~2,6:1 — §12)                                                    |
| `bg-brand` / `brand-hover` / `brand-tint` / `brand-line`  | `--primary-*` #10b981 / #059669 / #ecfdf5 / #a7f3d0 | NỀN hành động chính, ô đang chọn, hộp tích cực                                                      |
| **`text-brand-text`**                                     | **`--primary-text` #047857**                        | MỌI chữ xanh trên nền sáng (link `a:not([class])`, "Đã lưu", nhãn trạng thái)                       |
| `peak` / `peak-tint` / `peak-line` / `peak-text`          | `--accent-*` #f97316 / #fff7ed / #fdba74 / #c2410c  | CHỈ giờ vàng (ô lưới, nhãn thước, luật "Giờ vàng" trong bảng giá)                                   |
| `bg-taken` / `taken-line`                                 | #f1f5f9 / #e2e8f0                                   | Ô đã có người — XÁM, không đỏ                                                                       |
| `danger` / `danger-hover` / `danger-tint` / `danger-line` | `--danger-*` #ef4444 / #dc2626 / #fef2f2 / #fca5a5  | Viền/nền lỗi, nút nguy hiểm (viền), ô nhập lỗi                                                      |
| **`text-danger-text`**                                    | **`--danger-text` #b91c1c**                         | MỌI chữ đỏ (câu lỗi 12px, "Chờ thanh toán", "Không tới", đếm ngược sắp hết)                         |
| `text-rating` / `fill-rating`                             | `--rating-color` #f59e0b                            | CHỈ sao đánh giá                                                                                    |
| `bg-admin-nav`                                            | `--admin-nav` #0f172a                               | CHỈ thanh điều hướng khu quản trị                                                                   |
| `text-sport-{môn}` / `bg-sport-{môn}-tint`                | `--sport-*` (bậc 700 / 100)                         | Nhận diện môn: badminton, football, pickleball, tennis, basketball, volleyball, table-tennis, other |
| `rounded-token-sm/md/lg/xl` · `rounded-token-control`     | 6/10/14/20px · `--radius-control` 8px               | Bo góc · nút và ô nhập                                                                              |
| `shadow-nang-1/2/3`                                       | 2 lớp, tăng dần                                     | CHỈ thứ NỔI (thông báo nổi dùng `nang-3`) — thẻ/hộp/bảng KHÔNG bóng                                 |
| `shadow-chon`                                             | bóng xanh                                           | CHỈ thứ đang được CHỌN                                                                              |
| `shadow-dock`                                             | `--shadow-dock` bóng hắt lên                        | Thanh dính đáy điện thoại                                                                           |
| `shadow-sticky-edge`                                      | `--shadow-sticky-edge` vệt mảnh bên phải            | Mép cột tên sân đứng yên của lưới                                                                   |
| `font-sans`                                               | Be Vietnam Pro                                      | —                                                                                                   |

`--tap-target: 44px` có khai nhưng component dùng thẳng `min-h-11`/`h-11`.

**`globals.css` chỉ còn**: bảng token, `@theme inline`, `@layer base` (reset `*`, `body`, `a:not([class])` chữ
`--primary-text` gạch chân khi hover — không đổi màu, `:focus-visible`, padding cho thanh dính đáy,
**`prefers-reduced-motion`** tắt animation/transition/cuộn smooth), `@layer utilities` `.scrollbar-thin`. **Đã xoá
toàn bộ `@layer components` cũ** (`.card`, `.badge*`, `.alert*`, `.form-grid`, `.page-title`, `.container`,
`.user-*`, `.permission-*`, `.spinner`, `.site-header*`) — đừng viết lại; kiểu dáng dùng lại viết thành component
React. CSS thủ công BẮT BUỘC nằm trong `@layer` (CSS trần ngoài layer thắng mọi utility — lỗi thật:
`* {margin:0;padding:0}` trần đã xoá sạch `p-*`, `mx-auto`). Không viết màu Tailwind thẳng (`emerald-*`,
`red-*`…), không gradient trang trí (chỉ còn nền sọc `repeating-linear-gradient` của ô "Bảo trì").

**`cn()`** (`src/lib/cn.ts`): `extendTailwindMerge` khai `COLOR_TOKENS`, radius `token-*`, shadow `nang-*`/`chon`/
`dock`/`sticky-edge` — gộp `rounded-md` với `rounded-token-md` giữ đúng lớp viết sau.

**`<Button>`** (`src/components/ui/button.tsx`, cva + Radix Slot `asChild`, `relative rounded-token-control`):
variant `default` (`bg-brand` chữ trắng đậm; disabled `bg-line text-subtle`), `destructive` (**viền**
`border-danger-line bg-surface text-danger-text` — không đặc đỏ), `outline` (viền 1.5px `line-strong`),
`secondary`, `ghost`, `link` (`text-brand-text`); size `default` **`min-h-11`**, `sm` **`min-h-9` + vùng chạm
nới bằng `after:absolute after:inset-x-0 after:-inset-y-1.5`** (45–48px), `lg` `min-h-12`, `icon` 44px, `icon-sm`
36px + `after:-inset-1.5`. Chiều cao là `min-h` để nhãn dài xuống dòng thay vì tràn ngang.
**`<Input>`** (`ui/input.tsx`): `h-11`, `fieldClassName` dùng chung cho `<select>`/`<textarea>` (viền 1.5px
`line-strong`, `bg-surface`, `rounded-token-control`, chữ `text-base sm:text-sm` — dưới 16px Safari iOS tự phóng
to), focus `border-brand ring-brand/25`; prop `error` (chữ `text-danger-text`) / `hint` tự nối aria (cần `id`).
**`<Notice tone="danger|success|neutral" as?>`** (`ui/notice.tsx`): hộp một câu; KHÔNG có giọng vàng/cam.
**`ConfirmButton`** (`ui/confirm-button.tsx`) — §3. Nút, ô nhập, hộp báo LUÔN dùng các component này.

Chữ nhỏ bấm được ngoài `<Button>` (link "Bỏ chọn tất cả", nút chép, nút "Đóng" thông báo, viên thuốc kiểu xem)
cũng nới vùng chạm bằng `relative` + `after:absolute after:-inset-*`.

**`sportStyle(key)`** (`src/components/venue/sport-icon.tsx`) → `{ text, tint, glyph }`: `text` = class
`text-sport-{môn}`, `tint` = `bg-sport-{môn}-tint` (MỘT màu nhạt, không gradient), `glyph` = path SVG 24×24. Class
viết đủ chữ (không ghép chuỗi). Màu môn tránh xanh emerald và cam (bóng rổ là tím hồng `#a21caf`). `SportIcon` SVG
nét 1.7, `aria-hidden`.

**Ảnh sân**: `VenueCard` (điện thoại nằm ngang ảnh `w-28`, từ `sm` dọc `h-44`; chưa có ảnh → nền `sport.tint` +
icon; tên → địa chỉ → "từ 70k /30 phút" → sao; viền 1px, hover đổi `border-brand-line` + tên `text-brand-text` +
ảnh phóng nhẹ — không bóng, không nhấc thẻ). `VenuePhoto` (src bắt đầu `/` → `next/image fill sizes preload`; host
ngoài → `<img>` vì chưa khai `images.remotePatterns`). `VenueGallery` (MỘT danh sách: điện thoại vuốt ngang
`w-[86%] aspect-[16/10]`; từ `sm` lưới `h-72`/`lg:h-80`, ảnh bìa 2×2 + 3 ô; chỉ preload ảnh bìa — Next 16 dùng
`preload` thay `priority`).

---

## 8. Ranh giới server → client

- `Date` KHÔNG qua được: page `.toISOString()`, client `new Date(iso)` rồi format bằng `timeOfDay`/
  `fullDateLabel` (timeZone cố định VN → server và trình duyệt ra cùng chuỗi). Hạn giữ chỗ truyền ISO (kèm
  `serverNowIso` cho `HoldCountdown`). `formatDate/formatDateTime` cũng theo giờ VN.
- `Decimal` đổi `Number()` ngay ở page (`ratingAvg`, `commissionRate`). `DayAvailability` vốn JSON thuần.
- Hằng số dùng chung server + client (`BOOKING_STATUS`) đặt ở module thường (`src/lib/booking-status.ts`) —
  import hằng số từ tệp `"use client"` vào Server Component chỉ nhận tham chiếu rỗng.
- Không đọc `Date.now()`/`new Date()` khi render — tính ở service (`findCheckout().holdExpired`,
  `listForVenueDay(…, {now}).holdExpired`, `listByStatus().overdueDays`).

---

## 9. Giọng văn, responsive, a11y

- **Giọng văn**: xưng "bạn", hay kết "giúp bạn nhé"; câu lỗi nói Ô NÀO sai và BƯỚC TIẾP THEO ("Ghi lý do trả hồ
  sơ để chủ sân biết phải sửa gì", `formErrorMap`); nhãn nút nói KẾT QUẢ ("Đặt sân và thanh toán", "Tôi đã chuyển
  khoản", "Đã nhận đủ tiền", "Không thấy tiền", "Khách tới", "Tắt sân", "Gửi duyệt", "Đặt lại các khung này"); huỷ
  thao tác là "Thôi"; đang chạy "Đang …"; xong "Đã …". Chính tả "huỷ, hoá, khoá". Tiền `formatVnd` "180.000đ", ô
  hẹp `formatVndShort` "70k"/"1.2tr". Ngày "Thứ 6, 04/09/2026". Mã hiện chữ mono.
- **Responsive**: khung `mx-auto max-w-* px-4 sm:px-6 lg:px-8`; `min-w-0` ở CẢ khung cuộn lẫn mọi cha
  flex/grid; dải cuộn tràn mép `-mx-4 px-4`; nav `overflow-x-auto`; header điện thoại hai hàng (§1); thanh dính
  đáy kèm khoảng đệm; logo ẩn chữ < 360/400px. Đã đo 0px tràn ngang ở 320–1920px. Kiểm
  `document.documentElement.scrollWidth <= innerWidth` ở 320/360/390/430/768/1024/1280/1920.
- **Vùng chạm**: mọi thứ bấm được ≥ 44px — `min-h-11` hoặc nhìn nhỏ + `after:` nới vùng chạm (đo bằng
  `elementFromPoint`/`getBoundingClientRect`, lớp giả tính từ mép TRONG viền).
- **A11y**: `aria-pressed` (ô lưới, nút đổi kiểu xem, nút thứ, nút sao); `aria-label` (ô lưới, chip bỏ chọn,
  nút chép, QR); `role="alert"`/`role="status"`; `aria-live` (đếm ngược); `aria-current="page"`/`"date"`;
  section `aria-labelledby`; SVG trang trí `aria-hidden`; fieldset/legend cho sao và quyền; biểu đồ kèm bảng
  `sr-only`; `ConfirmButton` quản lý focus; `prefers-reduced-motion` (globals.css + `scrollIntoView` tự kiểm
  `matchMedia`).
- Tìm kiếm, lọc, chọn ngày là GET/`Link` (URL chia sẻ được, Back đúng, chạy khi JS chưa tải).

---

## 10. Bản vẽ `design/`

Mở `design/chotsan-giao-dien.html` trong trình duyệt (tự chứa 6 artboard; các `.dc.html` lẻ cần
`support.js` không có trong repo): **Main** (hệ thiết kế), **TimSan** (tìm sân desktop: cột lọc, badge "còn N
khung tối nay", bản đồ), **DatSan** (đặt sân desktop: dải tổng quan cả ngày, lưới không chữ giá ở tiêu đề cột,
hoá đơn dính phải "Chốt sân · 360.000đ", mã giảm giá), **LichSan** (lịch chủ sân dạng lưới khối liền, sidebar
tối), **Tablet 834**, **Mobile 390** (tìm sân + tab bar đáy, chọn giờ, lịch nhân viên). Mã hiện CHƯA làm: dải
tổng quan (`summary` chưa dùng), nhóm nửa giờ, nút mang số tiền, lịch chủ sân dạng lưới, chip lọc/bản
đồ/khoảng cách/"còn N khung", đặt tại quầy, mã giảm giá, "Theo giờ" mặc định trên điện thoại.

**Bản vẽ LỆCH skill — đừng làm theo**: tab bar đáy (skill + mã: header hai hàng, không tab bar); tô cam "còn 1
khung" (cam CHỈ giờ vàng); lưới "giá ở tiêu đề cột, ô không chữ" (mã chốt: ô trống ghi giá).

---

## 11. Luật giao diện (bất biến)

1. CSS thủ công trong `@layer` (chỉ `base`/`utilities`, không `components`); dùng token theo vai trò, không mã
   màu thẳng, không màu Tailwind thẳng.
2. Mỗi màu một nghĩa: **cam CHỈ giờ vàng**; xanh = bấm được/đặt được; đã đặt = xám; "Chờ thanh toán" đỏ; "Chờ
   duyệt" xám viền đứt. Chữ xanh/đỏ trên nền sáng dùng `text-brand-text`/`text-danger-text`, không `text-brand`/
   `text-danger`. Màu môn tránh xanh và cam; `rating` chỉ cho sao.
3. Không `dark:`.
4. `min-w-0` cho khung cuộn và mọi cha flex/grid.
5. Năm luật của lưới (§4). Bước 30 phút toàn hệ thống. Cuộn thay vì chia trang.
6. Lựa chọn đi qua `keepFreeSlots`; `SelectAndBook` có `key` theo ngày; gỡ `chon`; không tự đặt hộ.
7. Form không gửi giá; lỗi trường ẩn hiện thành một câu; form giữ chữ đã gõ sau lỗi (trừ mật khẩu/OTP).
8. Màn thanh toán: một URL mỗi lần đặt; bắt đăng nhập, chỉ người đặt/nhân sự có `booking:read`; mở trang không
   ghi DB; hết hạn không hiện QR; khai chuyển khoản cho MỌI lượt đang giữ; nội dung chuyển khoản to, cạnh nút
   chép; QR vẽ trong trình duyệt.
9. `redirect()` ngoài `try`; lỗi không phải `DomainError` ném tiếp; `JSON.parse` trong `try`.
10. Mọi Server Action bọc `define*`; page tự kiểm quyền; thiếu quyền → 404; layout không phải ranh giới bảo mật.
11. `useFormStatus` chỉ trong component con của `<form>`; `ConfirmButton` nằm trong `<form>`.
12. Chỉ hiện mục/nút người dùng dùng được (`ManageNav`, header, `AdminNav`, nút theo quyền); quyền hỏi theo USER ID,
    một lần mỗi trang (`permissionsFor`/`venuePermissions`).
13. Ba quyền nguy hiểm không có ô tick.
14. Đăng xuất web là Server Action.
15. TopProgressBar: `setTimeout` không `queueMicrotask`, không `loading.tsx`, dừng ~90%, bọc Suspense.
16. Cấu hình gửi CẢ bảng (giá, giờ, quyền); tắt sân con chứ không xoá; từ chối/trả hồ sơ/miễn bắt buộc lý do;
    thao tác không lấy lại được qua `ConfirmButton`.
17. Không truyền `Date`/`Decimal` qua ranh giới; ngày giờ qua `lib/date`.
18. Nút/ô nhập/hộp báo dùng `<Button>`/`<Input>`/`<Notice>`; vùng chạm ≥ 44px (`min-h-11` hoặc `after:`); không
    viết tên class cũ trong chú thích (bộ quét Tailwind đọc cả comment).
19. Ảnh host ngoài dùng `<img>` tới khi khai `remotePatterns` (VÀ nới `img-src` trong proxy). Gallery một danh sách.
20. Biểu đồ không kéo thư viện, luôn kèm bảng `sr-only`.
21. Một `<main>` duy nhất ở layout gốc. Header điện thoại không menu ba gạch, không tab bar đáy.
22. Thông báo thành công của thao tác làm dòng rời danh sách đi qua `ActionNoticeProvider`.

---

## 12. Nghi lỗi, lệch skill còn mở (ĐÃ BIẾT — chưa sửa)

Các mục đã sửa trong đợt 17/09/2026 đã xoá khỏi danh sách (shadow-selection, footer link, CopyButton, điều khiển
thiếu quyền, header tràn, InvoiceRow nút theo trạng thái, HoldCountdown, RevenueChart, giờ mở cửa mặc định, JSON
ngoài try, form reset, chữ viết cứng 10/30 phút, layout admin, phân trang, vòng lặp `/manage`, lịch ngày cũ, trang
thanh toán công khai, trường thiếu UI + hộp xác nhận, hai bộ nhãn, twMerge, `ManageNav`/`publicDetail` gọi lặp,
reduced-motion + lớp `.alert/.badge`, `inactiveNote`, favicon/manifest/đăng ký chủ sân/lọc tỉnh, bộ khung chưa
làm lại, `<main>` lồng, CSS thừa, chú thích `middleware.ts`, phần lớn tên biến tiếng Việt). Kiểm lại mã trước khi
sửa các mục còn dưới đây.

**Lỗi chức năng/UI (nghi)**:

1. `ApprovalRow` (`/venue-approvals`) và `InvoiceRow` (`/invoices`) vẫn hiện câu thành công NGAY TRONG dòng
   (`if (state.ok) return <li>…`) và các trang admin KHÔNG bọc `ActionNoticeProvider` — duyệt/trả hồ sơ làm cơ sở
   rời hàng chờ, thu/miễn làm hoá đơn rời tab OVERDUE/DUE sau `revalidatePath` → dòng bị gỡ, câu thành công nghi
   vẫn biến mất trước khi đọc được.
2. `Header` vẫn gọi `venueService.listForUser` (không cache) ở MỌI request của người đã đăng nhập, chỉ để quyết
   hiện mục "Quản lý sân" (tập quyền thì đã có cache).

**Lệch skill thiết kế / câu hỏi thiết kế chưa chốt** (ghi ở `chotsan-thiet-ke` §8):

3. `--text-subtle` #94a3b8 trên trắng ~2,6:1 — dưới AA, vẫn dùng cho chữ ô "Đã đặt"/"Bảo trì", nút mờ, mục
   `AdminNav` chưa chọn (trên nền tối). Chưa đổi.
4. Chữ trắng trên nút xanh `bg-brand` #10b981 ~2,5:1 — dưới AA cho chữ 14px đậm. Chưa đổi.
5. `--tap-target` khai trong `globals.css` nhưng không component nào đọc (dùng thẳng `min-h-11`).
6. Bản vẽ `design/` lệch skill (tab bar đáy, cam "còn 1 khung", giá ở tiêu đề cột) — mã theo skill, §10.

**Đặt tên lệch quy ước mã tiếng Anh còn lại**: param URL `?mon=`, `?tinh=`, `?chon=` và `name="mon"`/`"tinh"`
của form (ngoại lệ cố ý giữ vì link đã chia sẻ — đừng đẻ thêm); tên token `shadow-nang-*`, `shadow-chon`. Đổi tên
thì sửa TỪNG tệp hoặc rename của IDE, không regex.
