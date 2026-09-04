-- ============================================================
-- CHỐNG TRÙNG KHUNG GIỜ Ở TẦNG DATABASE
-- ============================================================
-- Prisma không diễn đạt được ràng buộc này, nên viết tay.
--
-- VÌ SAO KHÔNG KIỂM TRONG SERVICE:
-- Hai request đến cùng lúc, cả hai cùng chạy "SELECT ... WHERE overlap" và cả
-- hai cùng thấy trống, rồi cả hai cùng INSERT. Kiểm trong code chỉ thu hẹp cửa
-- sổ chứ không đóng được nó. `EXCLUDE` thì Postgres tự khoá — đúng một cái
-- thắng, cái kia nhận lỗi 23P01 và service dịch thành "khung giờ vừa có người đặt".
--
-- CHỈ ÁP CHO LƯỢT ĐẶT CÒN SỐNG: HOLDING và CONFIRMED và CHECKED_IN.
-- Lượt đã huỷ/hết hạn phải cho phép trùng, nếu không khung giờ bị khoá vĩnh viễn
-- bởi một lượt đặt mà khách đã bỏ.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_khong_trung_khung_gio"
  EXCLUDE USING gist (
    "court_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE (status IN ('HOLDING', 'CONFIRMED', 'CHECKED_IN'));

-- Tăng tốc màn lịch sân: luôn hỏi "sân này, ngày này, các lượt còn sống".
CREATE INDEX "bookings_lich_san_idx"
  ON "bookings" ("venue_id", "start_at")
  WHERE status IN ('HOLDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED');
