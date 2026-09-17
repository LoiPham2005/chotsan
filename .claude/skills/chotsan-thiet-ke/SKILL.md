---
name: chotsan-thiet-ke
description: Hệ thiết kế của ChốtSân — mã màu và mỗi màu dùng vào việc gì, chữ, khoảng cách, thành phần dùng lại (nút, ô nhập, ô khung giờ, lưới sân × giờ), quy tắc responsive ba khổ màn. Đọc TRƯỚC khi viết bất kỳ giao diện nào trong repo này, kể cả sửa một nút.
---

# Hệ thiết kế ChốtSân

Nền tảng đặt sân thể thao. **Ưu tiên: nhìn vào biết dùng ngay.** Không hoa mĩ, không giấu chức
năng sau menu, không bắt người dùng khám phá.

Toàn bộ giao diện, chú thích code, thông báo lỗi và tên test đều bằng **tiếng Việt có dấu**.

Bản vẽ đầy đủ: [design/chotsan-giao-dien.html](../../../design/chotsan-giao-dien.html) — mở bằng
trình duyệt. Quyết định về vai trò, bảng, danh sách màn: [THIET_KE_LAI.md](../../../docs/THIET_KE_LAI.md).
Mã thật (route, component, token đang chạy): `.claude/skills/chotsan-project/references/ui-routes.md`.

⚠️ **Bản vẽ `design/` lệch skill ở ba chỗ — theo skill, đừng theo bản vẽ**: có tab bar đáy (skill:
không); tô cam ô "còn 1 khung" (skill: cam CHỈ giờ vàng); lưới "giá ở tiêu đề cột, ô không chữ" (skill:
ô trống ghi giá — §5).

---

## 1. Năm luật chi phối mọi màn

**1 · Mỗi màn một hành động chính.** Đúng một nút đặc màu xanh. Mọi nút khác là viền hoặc chữ.
Hai nút đặc cạnh nhau là bắt người dùng dừng lại suy nghĩ.

**2 · Không giấu sau dấu ba chấm.** Việc làm hằng ngày phải nhìn thấy ngay. Menu `⋯` chỉ chứa
việc hiếm và việc nguy hiểm (xoá sân, chuyển quyền sở hữu). Không menu ba gạch cho điều hướng chính
(§6).

**3 · Giá hiện sẵn, không phải bấm mới biết.** Ô đơn lẻ mang giá của nó — kể cả ô trong lưới đặt sân
(ô còn trống ghi giá rút gọn `70k`, §5). Bắt bấm từng ô để dò giá là bắt người làm việc của máy.

**4 · Trạng thái nói bằng CẢ màu LẪN chữ.** Khoảng 8% nam giới khó phân biệt đỏ–xanh. Chấm màu
luôn đi kèm nhãn chữ, không bao giờ đứng một mình. Phép thử: in ảnh đen trắng vẫn phân biệt được.

**5 · Ô bấm tối thiểu 44px**, kể cả trên desktop. Chủ sân thao tác trên máy tính bảng ở quầy, một
tay còn cầm điện thoại. Cách làm trong mã (biến `--tap-target: 44px` có khai nhưng component dùng
thẳng lớp Tailwind):

- `<Button>` cỡ mặc định và `<Input>`: **`min-h-11`/`h-11`** (44px). Dùng `min-h` chứ không `h` cho nút
  — nhãn dài trên màn 320px xuống dòng thay vì tràn ngang.
- Nút `sm` (và `icon-sm`) **nhìn 36px** (`min-h-9`) cho bảng dày đặc, nhưng **vùng chạm nới bằng lớp giả
  trong suốt** `relative` + `after:absolute after:inset-x-0 after:-inset-y-1.5` — dòng không cao thêm
  (xem `src/components/ui/button.tsx`). Nới 6px chứ không 4px: lớp giả tính từ mép TRONG viền, nút viền
  1.5px nới 4px chỉ được 41px.
- **Bảng/dải dày đặc** và chữ nhỏ bấm được ngoài `<Button>` (link "Bỏ chọn tất cả", nút chép, "Đóng"
  thông báo, viên thuốc "Theo sân/Theo giờ") cũng dùng `after:` để nới vùng chạm tới ≥ 44px. Đo bằng
  `getBoundingClientRect`/`elementFromPoint`, không đoán bằng mắt.

---

## 2. Màu — mỗi màu MỘT việc

Tất cả khai trong `src/app/globals.css` ở `:root`, ánh xạ sang Tailwind trong khối `@theme inline`
(thêm token thì thêm tên vào `src/lib/cn.ts`). **Không viết mã màu thẳng vào component, không dùng
màu Tailwind thẳng** (`emerald-500`, `red-600`, `amber-400`…) — dùng token.

### Xanh emerald — hành động chính VÀ còn trống

| Biến              | Lớp Tailwind        | Mã        | Dùng ở đâu                                                  |
| ----------------- | ------------------- | --------- | ----------------------------------------------------------- |
| `--primary-color` | `bg-brand`          | `#10B981` | NỀN nút chính, ô giờ đang chọn, chấm "còn trống"            |
| `--primary-hover` | `bg-brand-hover`    | `#059669` | Hover của nút chính                                         |
| `--primary-tint`  | `bg-brand-tint`     | `#ECFDF5` | Nền hộp thông báo tích cực, nền nhãn "Đã xác nhận", hover ô |
| `--primary-line`  | `border-brand-line` | `#A7F3D0` | Viền hộp/nhãn tích cực                                      |
| `--primary-text`  | `text-brand-text`   | `#047857` | **MỌI chữ xanh** trên nền sáng: link, "Đã lưu", nhãn        |

Hai nghĩa "bấm được" và "đặt được" cố ý dùng chung một màu: trong sản phẩm này chúng là một.

**Quy tắc chữ xanh**: `#10B981` làm CHỮ trên nền trắng chỉ đạt **2,5:1** — dưới AA (4,5:1), đọc không
nổi ngoài nắng. Chữ xanh (link, câu thành công, nhãn trạng thái trên nền nhạt) LUÔN dùng
`--primary-text` / `text-brand-text`. `--primary-color` chỉ dùng làm NỀN, VIỀN, CHẤM, ICON lớn.

### ⚠️ Cam — CHỈ nói "khung giờ vàng, giá cao hơn"

| Biến             | Lớp Tailwind     | Mã        | Dùng ở đâu                                |
| ---------------- | ---------------- | --------- | ----------------------------------------- |
| `--accent-color` | `peak`           | `#F97316` | Viền đậm ô giờ vàng                       |
| `--accent-tint`  | `bg-peak-tint`   | `#FFF7ED` | Nền ô giờ vàng                            |
| `--accent-line`  | `ring-peak-line` | `#FDBA74` | Viền ô giờ vàng, luật "Giờ vàng" bảng giá |
| `--accent-text`  | `text-peak-text` | `#C2410C` | Chữ giá ô giờ vàng, nhãn giờ trên thước   |

**Đây là màu đắt nhất trong hệ.** Trong mã, cam CHỈ xuất hiện ở lưới đặt sân (ô + nhãn thước giờ vàng)
và dòng luật "Giờ vàng" trong bảng giá. Không dùng cho nút, biểu tượng, nhãn "chờ", hộp cảnh báo, hoá
đơn trễ, hover link, màu môn (bóng rổ là tím hồng, không cam), hay "còn ít chỗ". Dùng sai một lần là
phá tín hiệu duy nhất người dùng đã học được. Không có giọng thông báo "cảnh báo" vàng/cam.

Sao đánh giá dùng `--rating-color` `#F59E0B` (`text-rating`/`fill-rating`) — CHỈ cho sao, vì nó đứng
sát tông cam.

### Xám — đã có người đặt

| Biến           | Mã        | Ghi chú       |
| -------------- | --------- | ------------- |
| `--taken-bg`   | `#F1F5F9` | Nền ô đã kín  |
| `--taken-line` | `#E2E8F0` | Viền ô đã kín |

Kín chỗ là chuyện **bình thường**, không phải lỗi — nên xám, tuyệt đối không đỏ.

### Đỏ — huỷ, lỗi, sắp hết

| Biến             | Lớp Tailwind         | Mã        | Dùng ở đâu                                |
| ---------------- | -------------------- | --------- | ----------------------------------------- |
| `--danger-color` | `danger`             | `#EF4444` | Viền ô nhập lỗi, viền hover nút nguy hiểm |
| `--danger-hover` | `danger-hover`       | `#DC2626` | —                                         |
| `--danger-tint`  | `bg-danger-tint`     | `#FEF2F2` | Nền hộp lỗi, nền nhãn "Chờ thanh toán"    |
| `--danger-line`  | `border-danger-line` | `#FCA5A5` | Viền hộp lỗi, viền nút nguy hiểm          |
| `--danger-text`  | `text-danger-text`   | `#B91C1C` | **MỌI chữ đỏ**: câu lỗi, nhãn, đếm ngược  |

Dùng cho: nút huỷ, thông báo lỗi, nhãn "Chờ thanh toán · còn 6 phút", "Không tới", ô tổng quan còn ≤1
sân.

**Quy tắc chữ đỏ**: `#EF4444` làm chữ 12px trên nền trắng chỉ **3,8:1** — dưới AA, mà câu lỗi dưới ô
nhập là dòng người dùng cần đọc nhất. Chữ đỏ LUÔN dùng `--danger-text` (~6:1, kể cả trên nền đỏ nhạt).

### Màu trạng thái — theo mã đang chạy

| Trạng thái                                 | Kiểu                                                                  | Vì sao                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Lượt đặt "Chờ thanh toán" (HOLDING)        | ĐỎ nhạt: `bg-danger-tint text-danger-text` + viền đỏ nhạt             | Chỗ giữ sắp hết hạn, khách phải trả ngay — KHÔNG cam                          |
| "Đã xác nhận"                              | xanh nhạt `bg-brand-tint text-brand-text`                             | Đã chốt tiền                                                                  |
| "Đã tới sân"                               | trắng, viền xanh, chữ `brand-text`                                    | Tích cực, khác "Đã xác nhận" để lướt là thấy                                  |
| "Hoàn tất"                                 | trắng, viền xám đậm                                                   | Xong, hết việc                                                                |
| "Đã huỷ" / "Hết hạn giữ chỗ"               | xám `bg-elevated text-muted`                                          | Hết hiệu lực — bình thường, không phải lỗi                                    |
| "Không tới"                                | đỏ nhạt                                                               | Sự cố của lượt đặt                                                            |
| Cơ sở "Chờ duyệt" (PENDING)                | **nền trắng + viền ĐỨT NÉT xám** (`border-dashed border-line-strong`) | Chờ NGƯỜI KHÁC làm, không sai, không gấp; khác "Bản nháp" cả khi in đen trắng |
| Cơ sở "Bản nháp" / "Tạm nghỉ" / "Đang sửa" | xám viền liền                                                         | —                                                                             |
| Cơ sở "Đang nhận đặt"                      | xanh nhạt                                                             | —                                                                             |
| Cơ sở "Bị khoá"                            | đỏ nhạt                                                               | —                                                                             |

Nguồn: `BOOKING_STATUS` trong `src/lib/booking-status.ts` (MỘT bộ nhãn cho cả khách và chủ sân),
`STATUS_LABEL` trong `src/app/(manage)/manage/page.tsx`. Hộp một câu dùng `<Notice tone>`: `danger`
(lỗi, việc phải sửa), `success` (việc đã xong), `neutral` xám (thông tin, **đang chờ**, lời nhắc).

### Nền, viền, chữ

| Biến              | Mã        | Dùng ở đâu                                         |
| ----------------- | --------- | -------------------------------------------------- |
| `--bg-color`      | `#F8FAFC` | Nền trang                                          |
| `--surface-color` | `#FFFFFF` | Nền thẻ, bảng, hộp, ô nhập                         |
| `--surface-hover` | `#F1F5F9` | Nền khi rê chuột                                   |
| `--border-color`  | `#E2E8F0` | Viền thường                                        |
| `--border-strong` | `#CBD5E1` | Viền ô nhập, nút viền                              |
| `--text-main`     | `#0F172A` | Tiêu đề, số tiền                                   |
| `--text-muted`    | `#64748B` | Nội dung phụ                                       |
| `--text-subtle`   | `#94A3B8` | Nhãn mờ, chữ trong ô đã kín (tương phản thấp — §8) |

**Giao diện SÁNG**, không phải tối. Người chơi đứng ngoài sân giữa ban ngày; chủ sân nhìn màn hình
quầy suốt ngày. Khu quản trị (`(admin)`) dùng thanh điều hướng nền `--admin-nav` `#0F172A`
(`bg-admin-nav`) để phân biệt khu vực, nhưng vùng nội dung vẫn sáng.

Màu nhận diện môn: `--sport-{môn}` (chữ/biểu tượng bậc 700) + `--sport-{môn}-tint` (nền bậc 100), MỘT
màu phẳng, tránh xanh emerald và cam. Chỉ để phân biệt môn khi lướt danh sách.

---

## 3. Chữ

**Be Vietnam Pro** — dựng riêng cho tiếng Việt, dấu không bị cắt hay lệch. Nạp qua
`next/font/google` trong `layout.tsx`, dùng bằng biến `--font-be-vietnam-pro`.

| Vai trò       | Cỡ / đậm                            | Ví dụ                 |
| ------------- | ----------------------------------- | --------------------- |
| Tiêu đề trang | 30 / 800, `letter-spacing: -0.02em` | "Sân cầu lông Quận 7" |
| Tiêu đề khối  | 19 / 700                            | "Chọn khung giờ"      |
| Nội dung      | 15 / 400                            | "Giá đã gồm thuế…"    |
| Nhãn          | 13 / 600                            | "CÒN 2 SÂN TRỐNG"     |
| Số tiền lớn   | 24–25 / 800                         | "360.000đ"            |

Số tiền **luôn** có dấu chấm phân nhóm nghìn và hậu tố `đ`: `360.000đ`. Trong ô hẹp thì rút gọn
`90k`, không bao giờ `90.000` cụt đuôi.

Ô nhập chữ 16px trên điện thoại (`text-base sm:text-sm`): dưới 16px Safari iOS tự phóng to cả trang.

---

## 4. Khoảng cách, bo góc, đổ bóng

- Cơ sở **8px**. Khoảng cách trong thẻ 12–20px, giữa các khối 14–22px.
- Bo góc: `--radius-sm` 6px (ô nhỏ trong lưới) · `--radius-md` 10px (thẻ, hộp) ·
  `--radius-lg` 14px (thẻ nổi, hộp hoá đơn) · **`--radius-control` 8px** (nút và ô nhập,
  `rounded-token-control`).
- **Thẻ, hộp, bảng, khung lưới KHÔNG đổ bóng** — viền 1px là đủ và đọc rõ hơn. Bóng chỉ cho thứ NỔI
  hoặc DÍNH trên trang, mỗi loại một token:
  - `--shadow-dock` — thanh dính đáy màn điện thoại (bóng hắt LÊN trên).
  - `--shadow-sticky-edge` — mép phải cột tên sân đứng yên của lưới (tín hiệu "phần giờ đang trượt").
  - `--shadow-nang-1/2/3` — thứ nổi hẳn trên trang (thông báo dính đáy dùng `nang-3`).
  - `--shadow-chon` — bóng xanh, CHỈ thứ đang được CHỌN.
  - Màu bóng nằm ở token, không viết `rgba(...)` vào component. Không đổ bóng khi hover thẻ, không
    nhấc thẻ (`-translate-y`) — hover đổi viền/màu chữ là đủ.

---

## 5. Thành phần dùng lại

Nút, ô nhập, hộp báo LUÔN dùng `<Button>`, `<Input>` (+ `fieldClassName` cho `<select>`/`<textarea>`),
`<Notice>` trong `src/components/ui/`. Thao tác không lấy lại được dùng `ConfirmButton` (bước xác nhận
tại chỗ, không `window.confirm`). Không viết class CSS thủ công kiểu `.card`/`.badge`/`.alert` — đã
xoá hết.

### Nút — cao 44px, chữ nói rõ việc sẽ xảy ra

| Loại      | Variant                | Kiểu                                                                               |
| --------- | ---------------------- | ---------------------------------------------------------------------------------- |
| Chính     | `default`              | nền `--primary-color`, chữ trắng, 700. MỖI MÀN MỘT NÚT                             |
| Phụ       | `outline`              | nền trắng, viền 1.5px `--border-strong`, chữ `--text-main`, 600                    |
| Nguy hiểm | `destructive`          | nền trắng, viền 1.5px `--danger-line`, chữ **`--danger-text`**, 600 — không đặc đỏ |
| Mờ        | `default` + `disabled` | nền `#E2E8F0`, chữ `--text-subtle`, 700                                            |

Cỡ: mặc định `min-h-11`; `sm` nhìn 36px + `after:` nới vùng chạm (§1 luật 5); `lg` `min-h-12`; `icon`
44px. Link dạng nút dùng `variant="link"` (chữ `--primary-text`).

**Nút chính mang theo số tiền**: `Chốt sân · 360.000đ`. Trả lời trước câu hỏi ai cũng hỏi trước
khi bấm. Nút mờ phải nói **cần làm gì để bấm được** (`Chọn giờ trước`), không chỉ đơ ra.

### Ô khung giờ — bước 30 PHÚT

Toàn hệ thống chạy bước 30 phút, không phải 1 giờ. Mỗi trạng thái khác nhau ở **nền, viền và
chữ trong ô** (theo `src/components/booking/slot-grid.tsx`):

| Trạng thái                | Nền                               | Viền                 | Chữ trong ô                          |
| ------------------------- | --------------------------------- | -------------------- | ------------------------------------ |
| Còn trống                 | trắng (hover `--primary-tint`)    | 1px `--border-color` | giá rút gọn `70k`, màu `--text-main` |
| Giờ vàng                  | `--accent-tint`                   | 1px `--accent-line`  | giá rút gọn, màu `--accent-text`     |
| Đang chọn                 | `--primary-color` + `shadow-chon` | —                    | dấu ✓ trắng                          |
| Đã có người               | `--taken-bg`                      | —                    | "Đã đặt"                             |
| Đóng cửa / bảo trì        | sọc chéo                          | —                    | "Bảo trì"                            |
| Chưa mở bán (chưa có giá) | xám rất nhạt                      | —                    | "—" (không bao giờ "0")              |

### Lưới sân × giờ — thành phần đắt nhất, dựng trước mọi màn

Xuất hiện ở **bốn nơi** với bốn cách bày khác nhau: màn khách (desktop), màn chủ sân (desktop),
máy tính bảng, điện thoại. Viết một lần, cấu hình bằng props.

Quy tắc bất biến:

- **Hàng = sân, cột = khung 30 phút.** Người ta hỏi _"19h còn sân nào?"_, không hỏi _"sân 7 có
  rảnh không?"_ — nên đừng bắt chọn từng sân rồi mới xem giờ.
- **Hai ô nửa giờ gom thành nhóm theo giờ**: khe 3px giữa hai nửa, khe 7–9px giữa các giờ. Mắt
  vẫn đọc theo giờ thay vì loạn 32 cột rời rạc. _(Chưa làm trong mã.)_
- **ĐÃ CHỐT: giá nằm TRONG ô còn trống** (`70k`), không ở tiêu đề cột. Bản trước của skill ghi hai
  luật mâu thuẫn ("giá ở tiêu đề cột, ô không chữ" và "ô trống ghi giá 70k"); mã theo luật SAU vì giá
  có thể khác nhau giữa các sân cùng giờ, và ô rộng ≥ 44px đủ chỗ cho chữ 13px. Bản vẽ `design/` còn
  vẽ theo luật cũ — đừng theo.
- **Ở màn chủ sân, một lượt đặt vẽ thành MỘT khối liền** (`grid-column: span N`), không lặp tên
  qua từng ô. _(Mã hiện dùng danh sách theo giờ cho lịch chủ sân.)_
- **Dải tổng quan cả ngày** đặt phía trên lưới: 32 ô mảnh, mỗi ô ghi _số sân còn trống_, tô màu
  theo mức khan hiếm (xám → đỏ khi còn ≤1, KHÔNG cam). _(Chưa làm trong mã.)_

### Ô nhập và báo lỗi

Cao 44px, viền 1.5px `--border-strong`, bo 8px, nền trắng. Khi lỗi: viền `--danger-color`, chữ lỗi
**`--danger-text`** cỡ 12 ngay dưới (prop `error` của `<Input>` tự làm và tự nối `aria-describedby`).

**Báo lỗi phải nói sai ở đâu và sửa thế nào.** "Số điện thoại không hợp lệ" là đổ lỗi; "Thiếu 5
số. Số Việt Nam có 10 chữ số." là chỉ đường. Lỗi Zod mặc định dịch qua `formErrorMap(labels)` trong
`src/lib/form-errors.ts`. Báo lỗi xong **form giữ nguyên chữ đã gõ** (React 19 tự xoá form sau action,
kể cả khi lỗi — trả `values` hoặc dùng ô có kiểm soát), trừ mật khẩu/OTP.

---

## 6. Responsive — ba khổ, KHÔNG phải phóng to thu nhỏ

| Khổ           | Mốc    | Đặc điểm                                                                   |
| ------------- | ------ | -------------------------------------------------------------------------- |
| Điện thoại    | 390px  | Người chơi đặt sân                                                         |
| Máy tính bảng | 834px  | **Nhân viên quầy dùng cả ngày** — thiết bị quan trọng nhất của khu quản lý |
| Desktop       | 1440px | Chủ sân xem báo cáo, quản trị viên                                         |

Mỗi khổ có **một chỗ đổi hẳn cách bày**, không phải co giãn:

**Điện thoại**

- **Header HAI HÀNG khi đã đăng nhập, KHÔNG menu ba gạch, KHÔNG tab bar đáy.** Hàng 1: logo, tên
  người dùng, "Đăng xuất" (việc hiếm). Hàng 2: các mục điều hướng (việc hằng ngày), **cuộn ngang** khi
  hẹp. Cuộn trang thì hàng 1 trôi đi, hàng mục **dính mép trên** (chỉ tốn ~48px cố định). Khách chưa
  đăng nhập: một hàng. Bản vẽ `design/` Mobile 390 có tab bar đáy — là lệch, đừng làm.
- Thanh điều hướng khu quản trị: dải ngang cuộn được; từ `lg` thành cột trái.
- Hoá đơn cột phải → **thanh dính đáy màn** (`--shadow-dock`), số tiền luôn trong tầm mắt
- Lưới: cột tên sân **đứng yên**, phần giờ **vuốt ngang** — 3 giờ (6 ô) mỗi lần để ô rộng ~50px
- Bộ lọc: 3 lọc dùng nhiều nhất thành chip hiện sẵn, phần còn lại vào tấm trượt.
  **Đây là chỗ DUY NHẤT được phép giấu**, vì màn hình không đủ chỗ.

**Máy tính bảng**

- Header một hàng từ `md`.
- Menu trái → **hai tab trên đầu** (quầy chỉ dùng hai màn)
- Ô cao **56px** thay vì 46px — màn hình cảm ứng, người bấm đang đứng
- Lưới hiện 5 giờ quanh cao điểm, vuốt ngang xem giờ sáng

**Desktop**

- Hoá đơn là **cột phải dính theo**: người dùng đổi giờ nhiều lần trước khi quyết, mỗi lần đổi số
  tiền phải nhảy ngay trước mắt

---

## 7. Những thứ ĐỪNG làm

- **Đừng dùng gradient** cho logo, icon, nền thẻ, nền ảnh thay thế hay chữ. Nhoè ở favicon, chết khi in
  đen trắng lên hoá đơn, không thêu được lên áo đấu. Ngoại lệ duy nhất: nền sọc chéo ô "Bảo trì" (một
  tín hiệu trạng thái, không phải trang trí).
- **Đừng dùng emoji làm biểu tượng.** Vẽ SVG nét (16/20/24px, cùng một kiểu) để đổi màu và phóng
  to được.
- **Đừng ẩn sân hết chỗ** khỏi kết quả tìm kiếm — chỉ mờ lại và đổi nút thành "Xem ngày khác".
- **Đừng đổ bóng thẻ tĩnh** (thẻ, hộp, bảng, khung lưới), kể cả khi hover. Viền 1px đọc rõ hơn và không
  tạo cảm giác "app nhiều lớp". Bóng chỉ cho thứ nổi/dính (§4).
- **Đừng viết mã màu thẳng hay màu Tailwind thẳng vào component.** Dùng token; đổi tông sau này chỉ
  sửa một chỗ.
- **Đừng dùng `--primary-color`/`--danger-color` làm màu chữ nhỏ** — dùng `--primary-text`/`--danger-text`.
- **Đừng dùng cam** cho bất cứ gì ngoài giờ vàng (§2).
- **Đừng gấp điều hướng vào menu ba gạch, đừng thêm tab bar đáy** (§6).
- **Đừng viết class CSS thủ công** cho kiểu dáng dùng lại — viết component React.
- **Đừng tạo thư mục/pattern cho nhu cầu chưa có.** Trước khi thêm cấu trúc mới, tự hỏi: đã có ≥2
  nơi cần dùng thật chưa?

## 8. Câu hỏi thiết kế CÒN MỞ (chưa chốt, đừng tự quyết lặng lẽ)

Các điểm dưới đây đã đo và biết là dưới chuẩn đọc AA (4,5:1 cho chữ thường), nhưng đổi chúng là đổi
diện mạo cả hệ — cần người quyết thiết kế chốt trước khi sửa. Ai sửa thì cập nhật cả skill này lẫn
`globals.css` cùng lúc.

1. **`--text-subtle` `#94A3B8` trên nền trắng chỉ ~2,6:1.** Đang dùng cho chữ ô "Đã đặt"/"Bảo trì",
   chữ nút mờ, mục chưa chọn của thanh quản trị (trên nền tối). Hướng có thể: đổi sang `#64748B`
   (trùng `--text-muted`) hoặc một mã giữa hai bậc; hay giữ vì đó là chữ "không cần đọc". Chưa đổi.
2. **Chữ trắng trên nút xanh `#10B981` chỉ ~2,5:1.** Nút chính chữ 14px đậm vẫn dưới AA (chữ lớn cần
   3:1 cũng chưa đạt). Hướng có thể: nền nút `--primary-hover` `#059669` (~3,8:1) hoặc bậc đậm hơn,
   hoặc chữ tối trên nền xanh. Đổi là đổi màu thương hiệu thấy nhiều nhất — chưa đổi.
3. `--tap-target` khai nhưng không component nào đọc: giữ làm tài liệu hay nối vào `min-h-[var(--tap-target)]`.
4. Các phần lưới trong skill chưa làm (nhóm nửa giờ, dải tổng quan, khối liền ở lịch chủ sân, ô 56px
   trên máy tính bảng) — còn là hướng đích hay bỏ.

## `min-w-0` — chữ hay quên nhất, và hỏng nặng nhất

Phần tử con của `flex` hoặc `grid` mặc định là `min-width: auto`: **nó nở ra vừa nội dung thay vì
chịu bó theo cha**. Hậu quả là `overflow-x-auto` đặt bên trong hoàn toàn vô hiệu — bảng không cuộn
trong khung của nó mà đẩy rộng CẢ TRANG.

Trên điện thoại, trang tràn ngang trông như: header bị cắt mất nút, chữ chạy ra ngoài mép, và người
dùng phải cuộn ngang để đọc một câu. Đã xảy ra thật với lưới sân × khung giờ, và với header (logo + 3
mục + "Đăng xuất" rộng thêm 101px ở 390px — lý do header điện thoại tách hai hàng).

**Luật**: mọi khung bọc nội dung rộng (bảng, lưới, dải cuộn) phải có `min-w-0` ở CẢ khung cuộn lẫn
mọi phần tử flex/grid cha của nó.

```tsx
<section className="min-w-0">
  {" "}
  {/* ô của grid */}
  <div className="flex min-w-0 flex-col">
    {" "}
    {/* khung flex */}
    <div className="min-w-0 overflow-x-auto">
      <div className="min-w-max">{/* nội dung rộng */}</div>
    </div>
  </div>
</section>
```

Với ô `flex-1` mang chữ bên trong (dải tổng quan cả ngày), `flex-1` một mình cũng không đủ — thêm
`min-w-0` cho ô, và ẩn chữ ở khổ hẹp nhất.

**Cách kiểm, không đoán bằng mắt:**

```js
document.documentElement.scrollWidth <= window.innerWidth; // phải đúng ở MỌI khổ
```

Đo ở 320 · 360 · 390 · 430 · 768 · 1024 · 1280 · 1920. 320px là iPhone SE đời cũ — dưới ngưỡng đó
thì ẩn chữ trong logo, giữ biểu tượng.

## Lưới đặt sân — năm luật đã chốt sau nhiều vòng sửa

1. **Không đường kẻ.** Ô là khối bo tròn (`rounded-xl`) tách nhau bằng khoảng trắng 6px. Kẻ vạch
   giữa mọi ô làm cả lưới trông như giấy ô li.
2. **Nhãn giờ nằm trên RANH GIỚI giữa hai ô**, không nằm giữa ô — ô giữa nhãn 17:00 và 17:30 là
   khung 17:00–17:30. Đánh dấu ranh giới bằng chấm nhỏ, không bằng vạch. Vạch cuối mang giờ đóng
   cửa.
3. **Mọi nhãn giờ cùng cỡ, cùng độ đậm** (`text-xs font-semibold`). Giờ vàng chỉ đổi MÀU chữ.
4. **Ẩn khung đã qua giờ** ở đầu ngày, ghi một dòng "Đã ẩn N khung". Không bày cả dãy ô "Đã qua".
5. **Ô nói bằng chữ**: còn trống ghi giá (`70k`), đã đặt ghi "Đã đặt", bảo trì ghi "Bảo trì" trên
   nền sọc chéo, đang chọn là dấu ✓ trên nền xanh thương hiệu. Luật này THẮNG luật cũ "giá ở tiêu đề
   cột" (§5).

Chọn tự do nhiều ô, nhiều sân; máy chủ gom thành từng lượt đặt (một sân + một dãy liền) bằng
`slotsToRanges`. Hai kiểu xem "Theo sân" / "Theo giờ" — trên điện thoại "Theo giờ" dễ dùng hơn.
