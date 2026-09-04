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

---

## 1. Năm luật chi phối mọi màn

**1 · Mỗi màn một hành động chính.** Đúng một nút đặc màu xanh. Mọi nút khác là viền hoặc chữ.
Hai nút đặc cạnh nhau là bắt người dùng dừng lại suy nghĩ.

**2 · Không giấu sau dấu ba chấm.** Việc làm hằng ngày phải nhìn thấy ngay. Menu `⋯` chỉ chứa
việc hiếm và việc nguy hiểm (xoá sân, chuyển quyền sở hữu).

**3 · Giá hiện sẵn, không phải bấm mới biết.** Ô đơn lẻ mang giá của nó; trong lưới thì giá nằm ở
tiêu đề cột giờ. Bắt bấm từng ô để dò giá là bắt người làm việc của máy.

**4 · Trạng thái nói bằng CẢ màu LẪN chữ.** Khoảng 8% nam giới khó phân biệt đỏ–xanh. Chấm màu
luôn đi kèm nhãn chữ, không bao giờ đứng một mình. Phép thử: in ảnh đen trắng vẫn phân biệt được.

**5 · Ô bấm tối thiểu 44px**, kể cả trên desktop. Chủ sân thao tác trên máy tính bảng ở quầy, một
tay còn cầm điện thoại. Dùng biến `--tap-target`.

---

## 2. Màu — mỗi màu MỘT việc

Tất cả khai trong `src/app/globals.css` ở `:root`, ánh xạ sang Tailwind trong khối `@theme inline`.
**Không viết mã màu thẳng vào component** — dùng token.

### Xanh emerald — hành động chính VÀ còn trống

| Biến              | Mã        | Dùng ở đâu                                      |
| ----------------- | --------- | ----------------------------------------------- |
| `--primary-color` | `#10B981` | Nút chính, ô giờ đang chọn, chấm "còn trống"    |
| `--primary-hover` | `#059669` | Trạng thái hover của nút chính                  |
| `--primary-tint`  | `#ECFDF5` | Nền ô giờ còn trống, nền hộp thông báo tích cực |
| `--primary-line`  | `#A7F3D0` | Viền ô giờ còn trống                            |

Hai nghĩa "bấm được" và "đặt được" cố ý dùng chung một màu: trong sản phẩm này chúng là một.

### ⚠️ Cam — CHỈ nói "khung giờ vàng, giá cao hơn"

| Biến             | Mã        | Dùng ở đâu                    |
| ---------------- | --------- | ----------------------------- |
| `--accent-color` | `#F97316` | Viền đậm ô giờ vàng đang chọn |
| `--accent-tint`  | `#FFF7ED` | Nền ô giờ vàng                |
| `--accent-line`  | `#FDBA74` | Viền ô giờ vàng               |
| `--accent-text`  | `#C2410C` | Chữ giá trong khung giờ vàng  |

**Đây là màu đắt nhất trong hệ.** Không dùng cho nút, không dùng cho biểu tượng, không dùng để
nhấn mạnh chung chung. Dùng sai một lần là phá tín hiệu duy nhất người dùng đã học được.

### Xám — đã có người đặt

| Biến           | Mã        | Ghi chú       |
| -------------- | --------- | ------------- |
| `--taken-bg`   | `#F1F5F9` | Nền ô đã kín  |
| `--taken-line` | `#E2E8F0` | Viền ô đã kín |

Kín chỗ là chuyện **bình thường**, không phải lỗi — nên xám, tuyệt đối không đỏ.

### Đỏ — huỷ, lỗi, sắp hết

| Biến             | Mã        |
| ---------------- | --------- |
| `--danger-color` | `#EF4444` |
| `--danger-hover` | `#DC2626` |
| `--danger-tint`  | `#FEF2F2` |
| `--danger-line`  | `#FCA5A5` |

Dùng cho: nút huỷ, thông báo lỗi, nhãn "chờ thanh toán · còn 6 phút", ô tổng quan còn ≤1 sân.

### Nền, viền, chữ

| Biến              | Mã        | Dùng ở đâu                  |
| ----------------- | --------- | --------------------------- |
| `--bg-color`      | `#F8FAFC` | Nền trang                   |
| `--surface-color` | `#FFFFFF` | Nền thẻ, bảng, hộp          |
| `--surface-hover` | `#F1F5F9` | Nền khi rê chuột            |
| `--border-color`  | `#E2E8F0` | Viền thường                 |
| `--border-strong` | `#CBD5E1` | Viền ô nhập, nút viền       |
| `--text-main`     | `#0F172A` | Tiêu đề, số tiền            |
| `--text-muted`    | `#64748B` | Nội dung phụ                |
| `--text-subtle`   | `#94A3B8` | Nhãn mờ, chữ trong ô đã kín |

**Giao diện SÁNG**, không phải tối. Người chơi đứng ngoài sân giữa ban ngày; chủ sân nhìn màn hình
quầy suốt ngày. Khu quản trị (`(admin)`) dùng thanh điều hướng nền `#0F172A` để phân biệt khu vực,
nhưng vùng nội dung vẫn sáng.

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

---

## 4. Khoảng cách, bo góc, đổ bóng

- Cơ sở **8px**. Khoảng cách trong thẻ 12–20px, giữa các khối 14–22px.
- Bo góc: `--radius-sm` 6px (ô nhỏ trong lưới) · `--radius-md` 10px (thẻ, hộp) ·
  `--radius-lg` 14px (thẻ nổi, hộp hoá đơn). Nút 8–9px.
- Đổ bóng **rất nhẹ**, chỉ dùng cho hộp hoá đơn dính: `--card-shadow`. Không đổ bóng thẻ thường —
  viền 1px là đủ và đọc rõ hơn.

---

## 5. Thành phần dùng lại

### Nút — cao 44px, chữ nói rõ việc sẽ xảy ra

| Loại      | Kiểu                                                             |
| --------- | ---------------------------------------------------------------- |
| Chính     | nền `--primary-color`, chữ trắng, 700                            |
| Phụ       | nền trắng, viền 1.5px `--border-strong`, chữ `--text-main`, 600  |
| Nguy hiểm | nền trắng, viền 1.5px `--danger-line`, chữ `--danger-color`, 600 |
| Mờ        | nền `#E2E8F0`, chữ `--text-subtle`, 700                          |

**Nút chính mang theo số tiền**: `Chốt sân · 360.000đ`. Trả lời trước câu hỏi ai cũng hỏi trước
khi bấm. Nút mờ phải nói **cần làm gì để bấm được** (`Chọn giờ trước`), không chỉ đơ ra.

### Ô khung giờ — bước 30 PHÚT

Toàn hệ thống chạy bước 30 phút, không phải 1 giờ. Năm trạng thái, mỗi trạng thái khác nhau ở
**ba chỗ**: nền, kiểu viền, và dòng chữ.

| Trạng thái         | Nền                 | Viền                   | Chữ           |
| ------------------ | ------------------- | ---------------------- | ------------- |
| Còn trống          | `--primary-tint`    | 1.5px `--primary-line` | "Còn trống"   |
| Giờ vàng           | `--accent-tint`     | 1.5px `--accent-line`  | "Giờ vàng"    |
| Đang chọn          | `--primary-color`   | 1.5px cùng màu         | "✓ Đang chọn" |
| Đã có người        | `--taken-bg`        | 1.5px `--taken-line`   | "Đã có người" |
| Đóng cửa / bảo trì | trắng hoặc sọc chéo | 1.5px **đứt nét**      | "Đóng cửa"    |

### Lưới sân × giờ — thành phần đắt nhất, dựng trước mọi màn

Xuất hiện ở **bốn nơi** với bốn cách bày khác nhau: màn khách (desktop), màn chủ sân (desktop),
máy tính bảng, điện thoại. Viết một lần, cấu hình bằng props.

Quy tắc bất biến:

- **Hàng = sân, cột = khung 30 phút.** Người ta hỏi _"19h còn sân nào?"_, không hỏi _"sân 7 có
  rảnh không?"_ — nên đừng bắt chọn từng sân rồi mới xem giờ.
- **Hai ô nửa giờ gom thành nhóm theo giờ**: khe 3px giữa hai nửa, khe 7–9px giữa các giờ. Mắt
  vẫn đọc theo giờ thay vì loạn 32 cột rời rạc.
- **Giá nằm ở tiêu đề cột giờ**, không nhồi vào ô. Ô 30 phút rộng ~33px, nhét "90k" vào là chữ
  nhỏ tới mức không ai đọc.
- **Ở màn chủ sân, một lượt đặt vẽ thành MỘT khối liền** (`grid-column: span N`), không lặp tên
  qua từng ô. Đúng cách lịch thật hoạt động, và tên khách mới đủ chỗ.
- **Dải tổng quan cả ngày** đặt phía trên lưới: 32 ô mảnh, mỗi ô ghi _số sân còn trống_, tô màu
  theo mức khan hiếm. Liếc một cái là biết nên đặt giờ nào.

### Ô nhập và báo lỗi

Cao 44px, viền 1.5px `--border-strong`, bo 8px. Khi lỗi: viền `--danger-color`, chữ lỗi
`--danger-color` cỡ 12 ngay dưới.

**Báo lỗi phải nói sai ở đâu và sửa thế nào.** "Số điện thoại không hợp lệ" là đổ lỗi; "Thiếu 5
số. Số Việt Nam có 10 chữ số." là chỉ đường.

---

## 6. Responsive — ba khổ, KHÔNG phải phóng to thu nhỏ

| Khổ           | Mốc    | Đặc điểm                                                                   |
| ------------- | ------ | -------------------------------------------------------------------------- |
| Điện thoại    | 390px  | Người chơi đặt sân                                                         |
| Máy tính bảng | 834px  | **Nhân viên quầy dùng cả ngày** — thiết bị quan trọng nhất của khu quản lý |
| Desktop       | 1440px | Chủ sân xem báo cáo, quản trị viên                                         |

Mỗi khổ có **một chỗ đổi hẳn cách bày**, không phải co giãn:

**Điện thoại**

- Hoá đơn cột phải → **thanh dính đáy màn**, số tiền luôn trong tầm mắt
- Lưới: cột tên sân **đứng yên**, phần giờ **vuốt ngang** — 3 giờ (6 ô) mỗi lần để ô rộng ~50px
- Bộ lọc: 3 lọc dùng nhiều nhất thành chip hiện sẵn, phần còn lại vào tấm trượt.
  **Đây là chỗ DUY NHẤT được phép giấu**, vì màn hình không đủ chỗ.

**Máy tính bảng**

- Menu trái → **hai tab trên đầu** (quầy chỉ dùng hai màn)
- Ô cao **56px** thay vì 46px — màn hình cảm ứng, người bấm đang đứng
- Lưới hiện 5 giờ quanh cao điểm, vuốt ngang xem giờ sáng

**Desktop**

- Hoá đơn là **cột phải dính theo**: người dùng đổi giờ nhiều lần trước khi quyết, mỗi lần đổi số
  tiền phải nhảy ngay trước mắt

---

## 7. Những thứ ĐỪNG làm

- **Đừng dùng gradient cho logo hay icon.** Nhoè ở favicon, chết khi in đen trắng lên hoá đơn,
  không thêu được lên áo đấu.
- **Đừng dùng emoji làm biểu tượng.** Vẽ SVG nét (16/20/24px, cùng một kiểu) để đổi màu và phóng
  to được.
- **Đừng ẩn sân hết chỗ** khỏi kết quả tìm kiếm — chỉ mờ lại và đổi nút thành "Xem ngày khác".
- **Đừng đổ bóng thẻ thường.** Viền 1px đọc rõ hơn và không tạo cảm giác "app nhiều lớp".
- **Đừng viết mã màu thẳng vào component.** Dùng token; đổi tông sau này chỉ sửa một chỗ.
- **Đừng tạo thư mục/pattern cho nhu cầu chưa có.** Trước khi thêm cấu trúc mới, tự hỏi: đã có ≥2
  nơi cần dùng thật chưa?
