# Gotchas & Solved Issues

> Danh sách các bug/bẫy đã gặp thật trong quá trình làm việc + cách xử lý. **Đọc trước khi debug
> lỗi tương tự** để khỏi mất thời gian lặp lại.

## 1. Form web login/register gửi sai tên field so với schema

`(auth)/actions.ts` gửi `{ email, password }` cho `loginAction` trong khi `loginSchema` đã đổi
sang `{ identifier, password }` từ trước (hỗ trợ đăng nhập bằng username hoặc email). Kết quả:
mọi lần đăng nhập qua web đều rớt vào `fieldErrors.identifier`, nhưng `AuthFields` chỉ biết render
lỗi cho field tên `email` — lỗi hiển thị sai chỗ, trông như form bị "im lặng" không phản hồi gì.
Tương tự `registerAction` gửi `name` trong khi schema dùng `fullName`.

**Nguyên nhân**: schema đổi field name nhưng form web (`login-form.tsx`, `register-form.tsx`,
`auth-form.tsx`) không đổi theo — không có test nào submit thật qua action với đúng tên field từ
UI, test cũ tự dựng `FormData` với tên field đã đúng sẵn nên không bắt được lỗi.

**Fix** (đã làm): đổi field `name: "email"` → `"identifier"` trong `login-form.tsx`, `"name"` →
`"fullName"` trong `register-form.tsx`, đồng bộ lại `actions.ts` và type `Field` trong
`auth-form.tsx`.

**Bài học**: khi đổi tên field trong Zod schema, phải tự tay grep tìm mọi form HTML đang gửi field
đó (`formData.get("...")`), test action không phát hiện được loại lỗi này.

## 2. Prisma 7: IDE báo lỗi type sau khi sửa `schema.prisma`, dù code đúng

Sau khi thêm field/model mới vào `schema.prisma` rồi sửa code dùng field đó ngay, IDE (TS server)
báo hàng loạt lỗi kiểu `"UserStatus" has no exported member`, `Property 'status' does not exist`.

**Nguyên nhân**: `pnpm db:generate` chưa chạy, hoặc IDE cache lại type cũ từ trước khi generate.
Client thật được sinh vào `node_modules/.pnpm/@prisma+client@.../node_modules/.prisma/client/`
(không phải `node_modules/@prisma/client` trực tiếp — chỗ đó chỉ re-export), TS server đôi khi
không tự phát hiện thư mục đó vừa đổi.

**Fix**: chạy `pnpm db:generate` trước, rồi **tin `pnpm typecheck` chạy qua terminal**, không tin
theo dấu gạch đỏ của IDE — `tsc --noEmit` luôn đọc file trên đĩa mới nhất, IDE có thể trễ 1 nhịp.

## 3. Windows Git Bash: đường dẫn `/tmp/...` hay `/c/Users/...` đưa vào `node -e` bị sai

```bash
node -e "require('fs').readFileSync('/tmp/foo.json')"
# → ENOENT: no such file or directory, open 'D:\tmp\foo.json'
```

**Nguyên nhân**: `node.exe` (binary Windows gốc) không tự dịch path kiểu MSYS (`/c/Users/...` →
`C:\Users\...`) như các lệnh POSIX khác chạy trong Git Bash — nó chỉ thêm ổ đĩa hiện tại (`D:`)
vào trước path, biến `/tmp/foo.json` thành `D:\tmp\foo.json` (sai) thay vì `C:\...` hay đường dẫn
đúng.

**Fix**: khi cần Node đọc file trong Git Bash, dùng path Windows đầy đủ có ổ đĩa
(`C:/Users/...` hoặc `D:/...`, dấu `/` vẫn được Node chấp nhận miễn có ổ đĩa ở đầu), đừng dùng
path kiểu `/c/...` hay `/tmp/...` — chỉ bash tự hiểu path đó, Node thì không.

## 4. PowerShell không hỗ trợ set biến môi trường inline như Bash

```bash
DATABASE_URL="..." pnpm db:studio    # ✅ chỉ chạy được trong Bash
```

```powershell
DATABASE_URL="..." pnpm db:studio    # ❌ PowerShell báo lỗi cú pháp
```

**Fix cho PowerShell**: phải tách 2 dòng:

```powershell
$env:DATABASE_URL="..."
pnpm db:studio
```

Biến chỉ tồn tại trong đúng phiên terminal đó — đóng terminal là mất, không cần tự xoá.
⚠️ Nhớ đóng/mở terminal mới sau khi test xong, nếu không các lệnh `pnpm db:*` tiếp theo trong CÙNG
terminal đó vẫn dùng `DATABASE_URL` đã override (xem gotcha #6 — vụ `db:push` đẩy nhầm schema lên
cloud DB test).

## 5. Đừng thêm package `arctic` để làm OAuth — đã bị tác giả deprecate

Ban đầu định dùng `arctic` (thư viện OAuth 2.0 client nhẹ, hay được giới thiệu cùng Lucia) cho
luồng đăng nhập Google/Github/Facebook/Apple. Cài xong thấy npm cảnh báo:
`deprecated arctic@3.7.0: Package no longer supported`.

**Kiểm tra thêm**: tác giả (pilcrowonpaper) deprecate hàng loạt package của mình (Lucia, Oslo,
Arctic) từ 07/2026, khuyên tự viết OAuth bằng `fetch` thay vì phụ thuộc thư viện đã ngừng bảo trì.

**Đã làm**: gỡ `arctic`, tự viết luồng OAuth 2.0 Authorization Code + PKCE bằng `fetch`/`jose` có
sẵn trong `src/lib/oauth/*` — khớp với phong cách hand-rolled auth vốn có của project (JWT session,
Argon2id password, opaque token đều tự viết, không có lý do gì để đây là chỗ duy nhất phụ thuộc
thư viện ngoài, nhất là thư viện vừa mất bảo trì).

**Bài học**: luôn để ý cảnh báo `deprecated` của `pnpm add` — đừng bỏ qua vì "chắc không sao".

## 6. Test kết nối DB cloud (Prisma Postgres) bằng cách set `DATABASE_URL` tạm — quên đổi lại thì `db:push` ghi đè nhầm

Set `$env:DATABASE_URL` trỏ sang DB cloud để thử Prisma Studio web, xong không đóng terminal —
lệnh `db:push` chạy sau đó (tưởng đang thao tác local) thực ra đẩy thẳng schema thật lên DB cloud
đó. May mắn DB cloud đang trống nên vô hại, nhưng nếu đã có data thì `db push` có thể đổi cấu trúc
bảng ngoài ý muốn.

**Bài học**: sau khi test xong với `DATABASE_URL` override, **luôn đóng terminal hoặc chạy
`Remove-Item Env:\DATABASE_URL`** trước khi chạy lệnh `db:*` tiếp theo. Không có cách nào khác để
biết chắc terminal đang trỏ DB nào ngoài tự kiểm tra `echo $env:DATABASE_URL` trước mỗi lệnh nhạy
cảm.

> Cập nhật 17/09/2026: script `db:push`, `db:migrate`, `db:migrate:create`, `db:reset` đã bị gỡ
> khỏi `package.json` (chúng xoá ràng buộc viết tay — xem #11). Bài học về `DATABASE_URL` bị
> override vẫn nguyên giá trị với `db:deploy`, `db:seed`, `db:check-conflict`.

## 7. Xoá mềm (`deletedAt`) + cột `email` là `@unique` — không thể để trống khi xoá

Muốn giải phóng email cho phép đăng ký lại sau khi xoá mềm, nhưng `email` là cột bắt buộc
(`String @unique`, không nullable) — không thể set `null` để "giải phóng" như cách làm với
`username` (nullable, Postgres cho phép nhiều `NULL` trên cột unique).

**Fix** (mã thật, `UserService.softDelete` trong `src/services/user.service.ts`): nối hậu tố
vào giá trị cũ thay vì xoá — `<email>:deleted:<timestamp>` (cùng hậu tố cho `username` và `phone`
nếu có). Chuỗi có `:` không bao giờ là email/username/số điện thoại hợp lệ nên không trùng ai còn
sống, và vẫn đọc được tài khoản đã xoá từng dùng email gì. Cùng transaction đó thu hồi mọi refresh
token; sau đó `invalidateUser` + `securityStamps.invalidate` (xoá cache mốc bảo mật) để phiên web/API đang mở bị cắt ngay.

**Bài học**: trước khi thêm xoá mềm vào 1 bảng, kiểm tra kỹ các cột `@unique` không nullable —
không có công thức chung, mỗi cột phải tự quyết định "giải phóng bằng cách nào" (null hoá nếu
nullable, mangle giá trị nếu bắt buộc).

## 8. `next build` đổ với `t.openapi is not a function`, còn `next dev` và `vitest` thì xanh

`@asteasolutions/zod-to-openapi` gắn `.openapi()` vào `ZodType.prototype` bằng một module chỉ có
side effect (`import "./zod-openapi"`), và đòi module ấy chạy **trước** khi bất kỳ Zod schema nào
được tạo.

Điều kiện đó giữ được trong Node thuần (vitest, `next dev`) nhưng **không** giữ được khi Turbopack
gom bundle production: nó đánh giá `src/schemas/*` trước module vá, nên mọi schema hình thành xong
trước khi `.openapi()` tồn tại. Kết quả là một lỗi chỉ xuất hiện ở bước cuối cùng trước khi deploy.

**Fix**: bỏ hẳn thư viện, dùng `z.toJSONSchema()` có sẵn của Zod 4 —
`src/lib/openapi/registry.ts`. Không cần vá prototype, nên thứ tự nạp module không còn ảnh hưởng
gì, và bớt được một dependency 78KB.

**Bài học**: thư viện nào yêu cầu "import file này TRƯỚC mọi thứ khác" đều là một quả bom hẹn giờ
dưới bundler. Bundler được phép sắp xếp lại thứ tự đánh giá module, và nó sẽ làm vậy khi module đó
được nhiều entry point dùng chung.

## 9. Đừng dựng mã QR 2FA bằng dịch vụ sinh QR online

Chuỗi `otpauth://` chứa **chính bí mật TOTP**. Nhét nó vào URL của
`api.qrserver.com`/`chart.googleapis.com` là gửi thẳng yếu tố thứ hai cho bên thứ ba, và để lại
một bản sao trong log truy cập của họ — vĩnh viễn.

**Fix**: vẽ QR ngay trong trình duyệt (`qrcode` → `<canvas>`), xem
`src/app/security/two-factor-manager.tsx`. Bí mật không đi đâu ngoài đường nó vốn đã đi.

## 10. Prisma 7 + driver adapter: `error.meta.target` KHÔNG còn, tên ràng buộc chỉ nằm trong `meta`

Mọi ví dụ trên mạng (và tài liệu Prisma 6) đều dạy bắt lỗi trùng khoá kiểu này:

```ts
if (error.code === "P2002" && error.meta.target.includes("email")) { ... }   // ❌ Prisma 7
if (error.message.includes("ten_rang_buoc")) { ... }                         // ❌ Prisma 7
```

Hình dạng THẬT của lỗi Prisma 7.9 + `@prisma/adapter-pg`, chép nguyên từ database:

```
error.code    = "P2002"
error.message = "Unique constraint failed on the fields: (`booking_id`)"
error.meta    = {
  modelName: "Payment",
  driverAdapterError: { cause: {
    originalCode: "23505",
    originalMessage: 'duplicate key value violates unique constraint "ten_rang_buoc_that"',
    constraint: { fields: ["booking_id"] },
  } },
}
```

Hai điểm chết người:

- **`meta.target` không tồn tại** — điều kiện đọc nó là `undefined.includes(...)` hoặc luôn sai.
- **TÊN ràng buộc chỉ có trong `meta.driverAdapterError.cause.originalMessage`**, không có trong
  `error.message`. Dò bằng `message.includes("ten_rang_buoc")` không bao giờ khớp.

Và lỗi **im lặng**: nhánh bắt lỗi không chạy, lỗi bung lên thành 500 — chỉ khi có hai người thao
tác đúng cùng lúc. Typecheck không thấy, unit test với lỗi tự bịa cũng không thấy, vì lỗi tự bịa
có đúng hình dạng mà người viết test tưởng tượng ra.

**Fix** (đã làm ở mọi service, gồm `UserService.catchDuplicate` trong
`src/services/user.service.ts` — nay dùng `isUniqueViolation`): đừng bao giờ tự dò. Dùng `isUniqueViolation(error, "ten_rang_buoc_hoac_ten_cot")` và
`isExclusionViolation(error, ...)` trong [`src/lib/prisma-errors.ts`](../src/lib/prisma-errors.ts)
— chúng dò cả `message`, `meta.target` (nếu có) lẫn `meta.driverAdapterError.cause`.
`prisma-errors.test.ts` giữ các lỗi **chép nguyên từ database thật**, không phải bịa.

⚠️ Ràng buộc `EXCLUDE` (mã Postgres **23P01**, dùng để chống trùng khung giờ đặt sân) thì Prisma
**không ánh xạ thành mã P2xxx nào cả** — không có `code`, chỉ có `meta.driverAdapterError.cause.
originalCode = "23P01"`. Đó là lý do có hàm thứ hai.

**Cách phát hiện loại lỗi này**: `pnpm db:check-conflict` — chạy các thao tác đồng thời thật trên
database thật (tự tạo sân riêng rồi tự xoá). Chính lệnh này đã bắt được hai lỗi mà 440 unit test
không thấy.

## 11. `prisma migrate dev` XOÁ mọi index/ràng buộc viết tay mà nó không biết

Prisma sinh migration bằng cách so schema với **trạng thái do chính nó quản lý**. Mọi thứ viết
tay bằng SQL — index GIN/GiST, `EXCLUDE`, partial unique index, `CHECK` — không có trong
`schema.prisma`, nên nó coi là **dư thừa** và thêm `DROP INDEX` vào migration mới.

Đã xảy ra thật ở dự án này: ba index `pg_trgm` tạo ở migration `20260903000001_search_index` bị
xoá sạch ở `20260904041510_chotsan_nghiep_vu` (`DROP INDEX "users_email_trgm_idx"`…). Hậu quả im
lặng hoàn toàn: `pnpm check` xanh, test xanh, chỉ có mọi truy vấn tìm kiếm âm thầm chuyển thành
`Seq Scan`. Phát hiện ra khi so với schema bản cũ — bản cũ khai `extensions = [pg_trgm]` ngay
trong `schema.prisma` nên Prisma biết và không đụng vào.

**Quy trình bắt buộc khi sửa `schema.prisma`:**

```bash
# 1. Sinh SQL nhưng KHÔNG áp
pnpm db:migrate:diff > prisma/migrations/<timestamp>_<english_name>/migration.sql

# 2. ĐỌC file vừa sinh, xoá mọi DROP INDEX / DROP CONSTRAINT / DROP SEQUENCE đụng vào ràng buộc viết tay
# 3. Áp, sinh lại client, kiểm ràng buộc
pnpm db:deploy
pnpm db:generate
pnpm db:check-conflict
# 4. Khởi động lại `pnpm dev` (#18)
```

⚠️ **Đừng dùng `prisma migrate dev`** (hay `db push`, `migrate reset`) trên dự án này — các script
bọc chúng đã bị gỡ khỏi `package.json` và `Makefile`. Nó vừa sinh vừa áp, nên tới lúc nhìn thấy
SQL thì index đã bị xoá rồi.

**Danh sách ràng buộc viết tay phải bảo vệ** (kiểm bằng `pnpm db:check-conflict` sau mỗi lần
migrate):

| Ràng buộc                                          | Chặn điều gì                            |
| -------------------------------------------------- | --------------------------------------- |
| `bookings_khong_trung_khung_gio` (EXCLUDE)         | Hai người đặt cùng một khung            |
| `payments_mot_giao_dich_song_cho_moi_booking`      | Thu tiền hai lần cho một lượt đặt       |
| `venue_members_mot_chu_cho_moi_co_so`              | Cơ sở có hai chủ, hoặc không chủ nào    |
| `venues_name_trgm_idx`, `venues_address_trgm_idx`  | Tìm sân thành quét toàn bảng            |
| `users_email_active_key`, `users_phone_active_key` | Trùng email/sđt giữa tài khoản còn sống |
| 7 ràng buộc `CHECK`                                | Điểm sao ngoài 1–5, tiền âm, giờ ngược  |
| `platform_invoice_number_seq` (SEQUENCE)           | Hai hoá đơn hoa hồng cùng số            |

## 12. Server Action ở dev chạy tới 10 giây — đừng vội kết luận là hỏng

Bấm "Đăng nhập" rồi đợi 3–4 giây thấy nút vẫn ghi "Đang đăng nhập…", trang không nhúc nhích,
console không lỗi. Trông y hệt một luồng RSC bị đứt. **Không phải.** Nó chỉ chưa xong:

```
POST /login 200 in 3.9s
  └─ ƒ loginAction({}, {}) in 3860ms
```

Đo lại với thời gian chờ đủ: điều hướng xong sau **9,7 giây**, cookie đặt đúng, header đổi sang
"Đăng xuất". Thời gian đó là biên dịch trang đích của Turbopack cộng lần mở kết nối đầu tiên tới
Neon — cả hai chỉ có ở dev.

**Bài học cho việc kiểm thử**: `waitForTimeout(3500)` rồi đọc trang là cách chắc chắn để kết luận
sai. Dùng điều kiện, không dùng đồng hồ:

```js
await p.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 25000 });
```

Và khi nghi ngờ, đọc dòng `POST ... in Xms` trong output của `next dev` trước — nó nói thẳng
action mất bao lâu.

⚠️ `browser.close()` khi request còn đang chạy sinh ra `⨯ Error: The destination stream closed
early.` ở máy chủ. Đó là hệ quả của việc đóng trình duyệt sớm, KHÔNG phải nguyên nhân.

**Hai lỗi thật tìm được trong lúc lần theo dấu vết sai này** — cả hai đều đáng giá:

1. **Đích mặc định sau đăng nhập là `/users`** (thừa hưởng từ bộ khung) — màn quản trị cần quyền
   `user:read`, mà gần như không ai trong ChốtSân có. Đăng nhập xong là rơi vào 404. Có ở HAI
   chỗ: `loginAction` và `src/proxy.ts` (nhánh `GUEST_ONLY_PATHS`). Đã đổi cả hai về `/`.

2. **Vá `history.pushState` để bắt điều hướng thì không được `setState` ngay tại đó.** React gọi
   `pushState` từ trong `useInsertionEffect`, nơi cấm đặt lịch cập nhật:
   `useInsertionEffect must not schedule updates` — và React HUỶ luôn lần điều hướng đang chạy.
   Xem `src/components/layout/top-progress-bar.tsx`, phải đẩy sang `setTimeout(start, 0)`.

## 13. Form gửi tên trường KHÁC schema — không lớp nào thấy trừ e2e

Bấm "Đặt sân" và **không có gì xảy ra**. Không lỗi, không điều hướng, nút trở lại như cũ. Máy chủ
ghi:

```
POST /venues/... 200 in 22ms
  └─ ƒ holdBookingAction({}, {}) in 4ms
```

4ms là quá nhanh để chạm database — action đã dừng ở bước kiểm dữ liệu. Nguyên nhân: form gửi
`name="days"` trong khi schema đòi `date` (di chứng của một lần đổi tên hàng loạt, xem GOTCHAS
#11 về regex).

**Vì sao ba lớp kia đều mù:**

| Lớp        | Vì sao không thấy                                                |
| ---------- | ---------------------------------------------------------------- |
| TypeScript | `safeParse` nhận `unknown`; `FormData` không có kiểu theo trường |
| Unit test  | Gọi thẳng service với object đúng chuẩn, không đi qua form       |
| Lint       | Không biết gì về quan hệ giữa `name=` và schema Zod              |

Chỉ có trình duyệt thật gửi đúng `FormData` mà form dựng ra mới lộ. Đây là lý do bộ e2e tồn tại —
giữ nó HẸP nhưng phải phủ đủ mỗi form có Server Action.

**Đã sửa kèm**: lỗi ở TRƯỜNG ẨN (`venueId`, `courtId`, `date`, khung giờ) giờ trả về một câu
hiện ra được, thay vì `{ fields }` mà giao diện không vẽ ô nào. Im lặng là trạng thái tệ nhất —
người dùng bấm lại năm lần rồi bỏ đi.

## 14. Nút đăng xuất của web KHÔNG được gọi `/api/v1/auth/logout`

Bấm "Đăng xuất" và trình duyệt hiện ra một trang JSON thô:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Body phải là JSON hợp lệ" } }
```

— còn người dùng thì **vẫn đang đăng nhập**, chỉ là không biết.

Nguyên nhân: header dùng `<form action={apiPath("/auth/logout")} method="POST">`. Endpoint đó là
của MOBILE — nó nhận Bearer token và một body JSON chứa refresh token cần thu hồi. Form HTML gửi
body rỗng, nên nó từ chối, và trình duyệt đứng lại ở chính response đó.

**Luật chung**: hai bề mặt dùng chung TẦNG NGHIỆP VỤ, không dùng chung endpoint.

|           | Web                      | Mobile                                       |
| --------- | ------------------------ | -------------------------------------------- |
| Giữ phiên | cookie `httpOnly`        | cặp access + refresh token                   |
| Đăng xuất | Server Action xoá cookie | `POST /api/v1/auth/logout` kèm refresh token |

Xem `src/app/logout-action.ts`. Trước khi nối một nút của web vào `/api/v1/**`, hỏi: bề mặt này
giữ phiên bằng gì?

⚠️ **Đây là lỗi im lặng với người dùng đã đăng nhập** — họ tưởng đã thoát, nhất là trên máy dùng
chung. Bộ e2e giờ có bài chặn nó tái diễn (`phan-quyen.spec.ts` → "Đăng xuất").

## 15. Mở bản dev qua IP LAN: trang hiện ra nhưng KHÔNG nút nào bấm được

Mở `http://192.168.1.119:3000` từ trình duyệt (hoặc điện thoại) thì trang dựng đầy đủ từ máy chủ,
nhìn hoàn toàn bình thường — nhưng bấm ô lưới không chọn được, nút đặt sân không phản hồi. Log
của `next dev`:

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/static/chunks/... from "192.168.1.119".
```

Next 16 chặn tải tài nguyên dev (JavaScript) từ host không phải `localhost`. HTML vẫn tới, JS thì
không, nên React không bao giờ gắn vào trang. **Không phải lỗi ứng dụng.**

Đã sửa bằng `allowedDevOrigins` trong `next.config.mjs` (dải LAN, chỉ có tác dụng ở dev).
**Phải khởi động lại `pnpm dev`** — đổi `next.config.mjs` không tự nạp lại.

## 16. Route handler redirect bằng URL TUYỆT ĐỐI: bấm nút "không có hành động gì"

Triệu chứng người dùng gặp: ở `http://192.168.1.119:3000/login?next=…` bấm "Khách" (đăng nhập
nhanh) thì **không có gì xảy ra** — dù máy chủ đã đặt cookie phiên xong.

Nguyên nhân là ba thứ đúng riêng lẻ cộng lại:

1. Nút là `<form method="POST" action="/api/dev/quick-login">` thường, trả `303` kèm `Location`.
2. `Location` dựng bằng `new URL(path, request.url)` — mà ở `next dev`, `request.url` của route
   handler là **`localhost:3000`**, không phải host trình duyệt đang mở.
3. CSP có `form-action 'self'`, và trình duyệt áp nó cho CẢ chuyển hướng sau khi gửi form.
   `localhost` ≠ `192.168.1.119` → chặn, im lặng, không có gì hiện ra.

Sửa: `redirectRelative()` trong `src/lib/api/redirect.ts` — `Location` là đường dẫn tương đối,
trình duyệt tự ghép vào đúng host nó đang đứng. Đã áp cho đăng nhập nhanh và OAuth start/callback.

⚠️ Mở bằng `localhost` thì lỗi này **không bao giờ lộ** — hai host trùng nhau. Route handler nào
chuyển hướng người dùng, dùng `redirectRelative`, đừng dựng URL từ `request.url`.

## 17. Log e2e đầy `The destination stream closed early` — KHÔNG phải lỗi ứng dụng

Chạy `pnpm exec playwright test` thấy hàng chục dòng:

```
[WebServer] ⨯ Error: The destination stream closed early.
[WebServer]   digest: '2218290539'
```

Đã dựng lại để chắc: đây là máy chủ báo **trình duyệt huỷ ngang một request prefetch** đang stream.
Ở production, `<Link>` trong khung nhìn tự prefetch trang đích; test gọi `page.goto` sang trang khác
ngay sau đó thì các request ấy bị huỷ giữa chừng. Mở trang rồi chờ prefetch xong → 0 dòng; mở
trang rồi `goto` ngay → có dòng. Người dùng thật hiếm khi gây ra, và không có gì hỏng.

Đừng mất công "sửa" nó. Lỗi render thật có stack trace trỏ vào mã của mình và làm test đỏ.

## 18. Vừa đổi `schema.prisma`: `pnpm dev` đang chạy báo `Unknown argument` — phải khởi động lại

```
Invalid `prisma.booking.create()` invocation:
  checkoutCode: null,
  ~~~~~~~~~~~~
Unknown argument `checkoutCode`. Available options are marked with ?.
```

Đã xảy ra thật khi thêm cột `bookings.checkout_code`: migration đã áp, `prisma generate` đã chạy,
`pnpm typecheck` xanh, script kiểm tra trên database thật đạt — nhưng bấm đặt sân trên `pnpm dev`
vẫn ra "Đã có sự cố xảy ra".

**Nguyên nhân**: `@prisma/client` là package ngoài (không đi qua bundler). Tiến trình Node của
`next dev` đã nạp client CŨ vào bộ nhớ từ lúc khởi động, và hot reload chỉ nạp lại mã của mình,
không nạp lại package trong `node_modules`. Code mới gửi cột mới, client cũ không biết cột đó.

**Fix**: Ctrl+C rồi `pnpm dev` lại. Mọi lần đổi `schema.prisma` + `prisma generate` đều vậy — kể cả
worker (`pnpm worker:dev`).

Cách biết chắc: so giờ khởi động của server với giờ sinh client.

```bash
ps -eo pid,lstart,command | grep "next dev"                        # server chạy từ lúc nào
ls -la node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/index.d.ts   # client sinh lúc nào
```

Server khởi động TRƯỚC giờ sinh client = đang chạy client cũ. Lần này đúng như vậy: server 10:37,
client 10:47, và lời dặn "khởi động lại" bị bỏ lỡ nên lỗi lặp lại hai lần.

Từ đó `src/instrumentation.ts` tự in lời nhắc ngay dưới lỗi `Unknown argument` trong terminal khi
chạy dev — người gặp lỗi không cần tìm tới tài liệu này mới biết phải làm gì.

## 19. Action theo sân: kiểm quyền trên `venueId` của URL CHƯA ĐỦ

```ts
export const approvePaymentAction = defineVenueAction(
  "payment:confirm",
  async (ctx, _, formData) => {
    await paymentService.approveManual({ paymentId: formData.get("paymentId") }); // ❌
  },
);
```

`defineVenueAction` chứng minh người bấm có quyền trên **sân trong URL**. Nó không nói gì về id
lấy từ **form** — và Server Action là endpoint công khai, ai cũng gửi được form tự chế. Nhân viên
sân A đặt `venueId` = sân A (có quyền) và `paymentId` = giao dịch của sân B → duyệt được tiền của
sân B. Lỗi này từng nằm ở năm action: duyệt tiền, từ chối tiền, nhận sân, huỷ lượt, bật/tắt sân
con.

**Luật**: mọi id đến từ form trong action theo sân phải được lọc theo `ctx.venueId` **ngay trong
câu truy vấn của service** (`where: { id, booking: { venueId } }`), không phải một phép kiểm rời
có thể quên. Lệch sân thì ném lỗi **không tìm thấy**, không phải "không có quyền" — đừng xác nhận
cho người dò rằng id đó tồn tại.

Test cho mỗi thao tác như vậy phải có một ca "id của sân khác → NOT_FOUND" — mock `findMany` phải
LỌC THẬT theo `venueId`, mock trả bừa mọi thứ thì bài test không chứng minh được gì.

## 20. BullMQ 6 cần gói `ioredis` trong `package.json` — thiếu là worker chết lúc chạy

BullMQ 6 chỉ `require("ioredis")` khi dựng kết nối (nạp lười), và không import nào trong mã của dự
án trỏ tới `ioredis`. Nên thiếu gói đó thì typecheck, lint, build đều xanh — còn worker và mọi
`enqueue()` có Redis chết lúc chạy với `BullMQ could not load the optional 'ioredis' package`.

**Fix** (đã làm): thêm `ioredis` vào `dependencies`. `src/lib/queue.test.ts` có ca "BullMQ tìm thấy
`ioredis` từ CHÍNH vị trí của nó" để gỡ nhầm là đỏ.

**Bài học**: phụ thuộc tuỳ chọn được nạp lười không lộ ra ở bước build — phải có một test nạp thử.

## 21. `setTimeout` quá ~24,8 ngày bị Node rút còn 1 ms

`setTimeout` nhận tối đa 2^31−1 ms (~24,8 ngày); quá mức đó Node coi là 1 ms và in cảnh báo. Bộ chạy
lịch trong tiến trình (`startInProcessScheduler`, `src/jobs/schedules.ts`) mà hẹn thẳng tới mốc của
một lịch hằng tháng thì job chạy NGAY rồi chạy liên tục.

**Fix** (đã làm): chờ từng quãng ngắn (`MAX_TIMER_DELAY_MS` = 60 giây) rồi so lại đồng hồ thật —
né được cả đồng hồ máy nhảy (NTP chỉnh, máy ảo ngủ rồi thức). Test:
`schedules.test.ts` "lịch HẰNG THÁNG không chạy ngay".

## 22. `/health` của worker treo vô hạn khi mất Redis

Redis không tới được thì `getJobCounts` KHÔNG ném lỗi — ioredis giữ lệnh lại chờ kết nối lại, mãi
mãi. `curl /health` treo thay vì trả 503, nên Docker/systemd chỉ thấy "hết giờ" (đã gặp khi chạy thử
bundle với Redis tắt).

**Fix** (đã làm): `HEALTH_TIMEOUT_MS = 2_000` trong `worker/worker.ts` — quá 2 giây trả 503, ngắn
hơn `--timeout=5s` của HEALTHCHECK. `/health` của worker và realtime cũng chỉ nghe `127.0.0.1`
(biến `HOST`) vì nó lộ số job trong hàng đợi.

## 23. Payload `null` từ client làm sập cả tiến trình realtime

Handler `ping:user` từng đọc thẳng `payload.toUserId`. Một client đã đăng nhập gửi `null` là ném
`TypeError` trong listener — không ai bắt, tiến trình realtime chết, mọi người đang online rớt kết
nối.

**Fix** (đã làm, `realtime/server.ts`): validate bằng Zod (`toUserId` ≤ 128 ký tự, `text` ≤ 2000),
giới hạn 10 tin / 10 giây mỗi socket (`PING_USER_RATE_LIMIT`).

**Bài học**: mọi thứ đến qua socket là dữ liệu từ client, không tin được — giống body của route.

## 24. `pnpm dev` không có Redis mà chạy lịch mỗi phút làm database Neon không bao giờ ngủ

Lịch nhả chỗ giữ chạy MỖI PHÚT. Compute của Neon chỉ tự ngủ khi vài phút không có truy vấn; để
`pnpm dev` chạy qua đêm mà hỏi database mỗi phút là compute thức 24/7, đốt hết giờ compute của
gói rồi database ngừng phục vụ tới cuối tháng.

**Fix / quyết định** (`schedulingMode` trong `src/jobs/schedules.ts`, gọi từ
`src/instrumentation.ts`): `QUEUE_ENABLED=1` mà thiếu `REDIS_URL` → chế độ `off`. Production thì
log lỗi; **máy dev thì cố ý không chạy lịch**, chỉ log một dòng info. Ở dev không lịch nào là bắt
buộc (lịch trống đã coi chỗ giữ quá hạn là trống — luật "đúng-sai không phụ thuộc worker"). Cần thử
lịch: `pnpm worker:dev` với `REDIS_URL`, hoặc `QUEUE_ENABLED=0` (web tự chạy lịch). Chế độ đang
chạy xem ở `/api/health` → `features.schedules`.

## 25. React 19 xoá trắng form sau khi action chạy — kể cả khi action báo lỗi

Form dùng `<form action={...}>` + `useActionState`: React 19 reset các ô không kiểm soát sau khi
action chạy xong, cả khi action trả lỗi. Người dùng gõ cả form dài, sai một ô, bấm gửi — mọi ô trống
trơn.

**Fix** (đã làm ở các form nhiều ô): action trả kèm `values` (đúng chữ vừa gõ) và form dựng lại bằng
`defaultValue={state.values?.x}`, hoặc dùng ô có kiểm soát. `<select>` cần thêm `key` đổi theo giá
trị trả về, vì `defaultValue` chỉ đọc lúc mount. **Không bao giờ trả lại mật khẩu hay mã OTP.** Câu
lỗi cụ thể theo ô lấy từ `src/lib/form-errors.ts` (`formErrorMap`, `firstIssueMessage`).

## 26. Thông báo thành công nằm trong dòng bị gỡ cùng dòng khi dòng rời danh sách

Khách bấm "Huỷ lượt đặt", chủ sân bấm "Đã nhận đủ tiền": action gọi `revalidatePath`, dòng vừa
bấm đổi nhóm ("Sắp tới" → "Đã qua") hoặc rời hẳn hàng chờ. Component giữ `useActionState` bị gỡ
cùng dòng — câu "Đã huỷ. Sân sẽ hoàn 360.000đ" biến mất trước khi ai kịp đọc.

**Fix** (đã làm): `ActionNoticeProvider` (`src/components/booking/action-notice.tsx`) ở cấp trang,
thông báo thành công dính mép dưới màn hình, không tự tắt. Lỗi vẫn hiện ngay tại dòng (dòng còn
nguyên khi thao tác hỏng).

## 27. `EXCLUDE` không biết lịch đóng sân — kiểm rồi ghi rời nhau là có khe

Ràng buộc chống trùng chỉ so `bookings` với `bookings`. Không có ràng buộc nào giữa `bookings` và
`court_closures`, cũng không có gì bắt sân con còn bật khi lượt đặt được chèn. Giữ chỗ đọc "sân mở"
rồi ghi, trong khi chủ sân đóng sân giữa hai bước → lượt đặt rơi vào giờ đóng.

**Fix** (đã làm): `holdCheckout` khoá dòng sân con trong transaction (`lockCourts`,
`SELECT … FOR UPDATE OF c`, lọc `is_active`, cùng cơ sở, cơ sở `ACTIVE`) rồi mới kiểm lịch đóng;
`CourtService.close` cũng khoá dòng sân con và từ chối khi chồng lượt còn sống
(`CourtClosureConflictError`).

## 28. `FOR NO KEY UPDATE` không chặn phép kiểm khoá ngoại — `FOR UPDATE` thì có

Chèn một dòng có khoá ngoại tới `courts` làm Postgres lấy `FOR KEY SHARE` trên dòng cha. `FOR KEY
SHARE` xung đột với `FOR UPDATE` nhưng KHÔNG xung đột với `FOR NO KEY UPDATE`.

- Muốn chèn lượt đặt phải CHỜ (đóng sân con): dùng `FOR UPDATE` (`court.service.ts`).
- Chỉ muốn tuần tự hoá một việc mà không chặn người chèn dòng con (hai đánh giá đồng thời trên cùng
  cơ sở): dùng `FOR NO KEY UPDATE` (`review.service.ts`).

Chọn nhầm thì hoặc khoá không có tác dụng, hoặc chặn cả luồng đặt sân.

## 29. `NOT` của Prisma trên cột nullable sai theo luật NULL của SQL

`NOT (status = 'HOLDING' AND hold_expires_at <= now)` gặp `hold_expires_at = NULL` cho ra `NULL`,
không phải `true` — dòng bị loại. Hậu quả thật: lượt đã khai chuyển khoản (`holdExpiresAt = null`)
biến mất khỏi "Lượt đặt của tôi".

**Fix**: viết điều kiện dạng KHẲNG ĐỊNH, liệt kê nhánh `null` tường minh (xem `listForUser` trong
`booking.service.ts`: `OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }]`).

## 30. `new Date("2026-02-31")` không lỗi — nó cuộn sang 03/03

JavaScript chấp nhận ngày không tồn tại và cuộn sang tháng sau. Kiểm bằng `Number.isNaN` là không
đủ.

**Fix** (`parseDateKey` trong `src/lib/date.ts`): parse xong, định dạng ngược lại và so với chuỗi
gốc; lệch là ngày không tồn tại → về hôm nay. Mọi chỗ nhận ngày từ URL/form đi qua hàm này.

## 31. `height: X%` trong khung `flex items-end` ra 0px

Biểu đồ doanh thu từng có khung, có trục, không có cột nào: khung ngoài `flex h-40 items-end`, mỗi
cột `flex-1` không có chiều cao, thanh bên trong `height: X%`. Với `items-end` (không phải
`stretch`), cột con cao theo nội dung — không xác định — và phần trăm của chiều cao không xác định
tính như `auto`: 0px.

**Fix** (`src/components/manage/revenue-chart.tsx`): mỗi cột `h-full` + `flex-col justify-end`,
phần trăm tính trên chiều cao xác định của khung.

## Lưu ý chung khi code

- **Ưu tiên `pnpm typecheck`/`pnpm test` qua terminal hơn tin theo IDE** khi vừa đổi
  `schema.prisma` — xem gotcha #2.
- **Không thêm dependency mới** nếu `fetch`/`node:crypto`/thư viện đã có (`jose`) làm được — xem
  gotcha #5. Kiểm tra cảnh báo `deprecated` mỗi lần `pnpm add`.
- **Đóng terminal sau khi override `DATABASE_URL` để test** — xem gotcha #4, #6.
- **Mọi cột `@unique` không nullable phải có kế hoạch xoá mềm riêng**, không áp dụng chung 1 công
  thức cho mọi cột.
- **Ràng buộc chạy đua (trùng chỗ, trùng tiền) phải kiểm bằng `pnpm db:check-conflict`**, không
  chỉ bằng unit test — xem gotcha #10, #11.
- **Không chạy `prisma migrate dev`** — nó xoá index viết tay. Dùng `migrate diff` + đọc SQL +
  `migrate deploy`, xem gotcha #11.
- **Không mặc định chuyển hướng về `/users`** sau đăng nhập/đăng ký — đó là trang của quản trị,
  người thường nhận 404. `?next=` trước, rồi `landingPathFor()`. Lỗi này từng nằm ở CẢ BỐN lối
  vào: mật khẩu, 2FA, passkey, đăng ký.
- **Route handler chuyển hướng người dùng thì dùng `redirectRelative()`** — xem gotcha #16.
- **Id lấy từ form trong action theo sân phải lọc theo `ctx.venueId`** — xem gotcha #19.
- **Đổi `schema.prisma` xong thì khởi động lại `pnpm dev`** — xem gotcha #18.
- **Đừng để đúng-sai phụ thuộc worker còn sống**: hạn giữ chỗ tự tính ở lịch, cron chỉ dọn cho gọn.
- **Phụ thuộc nạp lười (`ioredis` của BullMQ) phải có test nạp thử** — xem gotcha #20.
- **Dữ liệu qua socket là dữ liệu từ client**: validate + giới hạn tần suất — xem gotcha #23.
- **Form báo lỗi phải giữ chữ người dùng vừa gõ** (trừ mật khẩu/OTP) — xem gotcha #25.
- **Điều kiện Prisma trên cột nullable viết dạng khẳng định**, đừng dùng `NOT` — xem gotcha #29.
