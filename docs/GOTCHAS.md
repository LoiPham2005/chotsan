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
cảm (`db:push`, `db:migrate`, `db:reset`).

## 7. Xoá mềm (`deletedAt`) + cột `email` là `@unique` — không thể để trống khi xoá

Muốn giải phóng email cho phép đăng ký lại sau khi xoá mềm, nhưng `email` là cột bắt buộc
(`String @unique`, không nullable) — không thể set `null` để "giải phóng" như cách làm với
`username` (nullable, Postgres cho phép nhiều `NULL` trên cột unique).

**Fix**: đổi `email` thành giá trị vô hại nhưng chắc chắn duy nhất khi xoá mềm:
`` `deleted_${id}@deleted.invalid` `` (`id` là cuid, tự đảm bảo không trùng ai). Dùng domain
`.invalid` (RFC 2606, dành riêng cho địa chỉ không hợp lệ) để không vô tình trùng domain thật nào.

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

**Fix**: đừng bao giờ tự dò. Dùng `isUniqueViolation(error, "ten_rang_buoc_hoac_ten_cot")` và
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
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script \
  > prisma/migrations/<timestamp>_<ten>/migration.sql

# 2. ĐỌC file vừa sinh, xoá mọi DROP INDEX / DROP CONSTRAINT đụng vào ràng buộc viết tay
# 3. Áp
pnpm exec prisma migrate deploy
```

⚠️ **Đừng dùng `prisma migrate dev`** trên dự án này. Nó vừa sinh vừa áp, nên tới lúc nhìn thấy
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

## Lưu ý chung khi code

- **Ưu tiên `pnpm typecheck`/`pnpm test` qua terminal hơn tin theo IDE** khi vừa đổi
  `schema.prisma` — xem gotcha #2.
- **Không thêm dependency mới** nếu `fetch`/`node:crypto`/thư viện đã có (`jose`) làm được — xem
  gotcha #5. Kiểm tra cảnh báo `deprecated` mỗi lần `pnpm add`.
- **Đóng terminal sau khi override `DATABASE_URL` để test** — xem gotcha #4, #6.
- **Mọi cột `@unique` không nullable phải có kế hoạch xoá mềm riêng**, không áp dụng chung 1 công
  thức cho mọi cột.
- **Ràng buộc chạy đua (trùng chỗ, trùng tiền) phải kiểm bằng `pnpm db:check-conflict`**, không
  chỉ bằng unit test — xem gotcha #10.
- **Không chạy `prisma migrate dev`** — nó xoá index viết tay. Dùng `migrate diff` + đọc SQL +
  `migrate deploy`, xem gotcha #11.
