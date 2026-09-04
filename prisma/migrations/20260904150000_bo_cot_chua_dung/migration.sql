-- Bỏ bốn cột chưa có nơi nào ghi hay đọc.
--
-- Nguyên tắc trong CLAUDE.md: chưa có ≥2 nơi cần dùng thật thì đừng dựng sẵn.
-- Cả bốn cột dưới đây đều thêm ở migration trước theo kiểu "để sau dùng":
--
--   • payments.declared_amount  — mã QR đã ghim số tiền, khách không gõ lại;
--                                 mà chủ sân vẫn phải mở app ngân hàng đối chiếu.
--   • venues.province_code
--   • venues.ward_code          — hai nguồn sự thật song song với province/ward,
--                                 không gì ép chúng khớp nhau. Danh mục hành
--                                 chính thuộc về code (như src/lib/permissions.ts).
--   • bookings.recurring_group_id — chưa có tính năng đặt cố định. Kèm index
--                                 trên bảng NÓNG NHẤT hệ thống cho cột toàn NULL.
--
-- ⚠️ Prisma còn sinh thêm DROP INDEX cho venues_name_trgm_idx và
-- venues_address_trgm_idx — ĐÃ BỎ ĐI. Xem GOTCHAS #11: index viết tay không
-- nằm trong schema.prisma nên lần migrate nào Prisma cũng đòi xoá chúng.

-- DropIndex
DROP INDEX "bookings_recurring_group_id_idx";

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "recurring_group_id";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "declared_amount";

-- AlterTable
ALTER TABLE "venues" DROP COLUMN "province_code",
DROP COLUMN "ward_code";
