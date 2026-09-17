-- Mã thanh toán chung cho các lượt đặt tạo cùng một lần.
--
-- Khách chọn Sân 1 lúc 13:00 và Sân 8 lúc 14:00 = hai lượt đặt (mỗi lượt một
-- sân + một dãy giờ liền, vì ràng buộc chống trùng tính trên từng lượt). Trước
-- đây hai lượt đó không có gì nối với nhau: khách phải chuyển khoản hai lần,
-- chủ sân duyệt hai lần, và màn thanh toán không biết hiện lượt nào.
--
-- `NULL` = lượt đặt đứng riêng. Không backfill: mọi lượt cũ đều đứng riêng.
--
-- ⚠️ `prisma migrate diff` sinh kèm DROP INDEX cho hai chỉ số trigram viết tay
-- (`venues_name_trgm_idx`, `venues_address_trgm_idx`) — đã bỏ khỏi tệp này.
-- Xem docs/GOTCHAS.md #11.

ALTER TABLE "bookings" ADD COLUMN "checkout_code" TEXT;

CREATE INDEX "bookings_checkout_code_idx" ON "bookings"("checkout_code");
