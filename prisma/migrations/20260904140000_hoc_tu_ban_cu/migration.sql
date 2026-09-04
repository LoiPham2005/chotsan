-- Học từ bản cũ (../sports_booking/backend/prisma/schema.prisma).
--
-- Sáu thay đổi, mỗi cái sửa một thứ bản cũ làm đúng mà bản này làm sai hoặc bỏ:
--   1. Địa chỉ hai cấp phường/xã → tỉnh (cải cách hành chính 01/07/2025).
--   2. Tách "chủ sân tạm nghỉ" khỏi "admin khoá vì vi phạm".
--   3. Giữ khoá đối tượng của ảnh để xoá được file thật trên kho lưu trữ.
--   4. Mặt sân và trong-nhà là hai chiều độc lập.
--   5. Chính sách huỷ riêng của từng sân.
--   6. Nhóm lượt đặt cố định hàng tuần.

-- AlterEnum
BEGIN;
CREATE TYPE "CourtSurface_new" AS ENUM ('NATURAL_GRASS', 'ARTIFICIAL_GRASS', 'WOOD', 'RUBBER', 'CONCRETE', 'CLAY', 'EPOXY');
ALTER TABLE "public"."courts" ALTER COLUMN "surface" DROP DEFAULT;
ALTER TABLE "courts" ALTER COLUMN "surface" TYPE "CourtSurface_new" USING ("surface"::text::"CourtSurface_new");
ALTER TYPE "CourtSurface" RENAME TO "CourtSurface_old";
ALTER TYPE "CourtSurface_new" RENAME TO "CourtSurface";
DROP TYPE "public"."CourtSurface_old";
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VenueStatus" ADD VALUE 'UNDER_MAINTENANCE';
ALTER TYPE "VenueStatus" ADD VALUE 'ADMIN_LOCKED';

-- DropIndex
DROP INDEX "venues_status_city_district_idx";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "recurring_group_id" TEXT;

-- AlterTable
ALTER TABLE "courts" ADD COLUMN     "is_indoor" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "surface" DROP NOT NULL,
ALTER COLUMN "surface" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "declared_amount" INTEGER;

-- AlterTable
ALTER TABLE "venue_images" ADD COLUMN     "storage_key" TEXT;

-- AlterTable
ALTER TABLE "venues" DROP COLUMN "city",
DROP COLUMN "district",
ADD COLUMN     "cancel_fee_percent" INTEGER,
ADD COLUMN     "free_cancel_hours" INTEGER,
ADD COLUMN     "inactive_note" TEXT,
ADD COLUMN     "province" TEXT NOT NULL,
ADD COLUMN     "province_code" TEXT,
ADD COLUMN     "ward_code" TEXT,
ALTER COLUMN "ward" SET NOT NULL;

-- CreateIndex
CREATE INDEX "bookings_recurring_group_id_idx" ON "bookings"("recurring_group_id");

-- CreateIndex
CREATE INDEX "venues_status_province_ward_idx" ON "venues"("status", "province", "ward");

-- ---------------------------------------------------------------------------
-- PHẦN PRISMA KHÔNG SINH ĐƯỢC — phải viết tay, và phải giữ khi migrate lại
-- ---------------------------------------------------------------------------

-- Tìm sân theo tên/địa chỉ đang là SEQ SCAN.
--
-- `contains` + `mode: "insensitive"` của Prisma dịch ra `ILIKE '%...%'`, mà
-- index btree KHÔNG dùng được cho mẫu bắt đầu bằng `%`. Bản cũ khai
-- `extensions = [pg_trgm]` ngay trong schema nên không bao giờ mất; bản này
-- từng có index trgm rồi bị `prisma migrate dev` XOÁ khi sinh lại migration
-- (xem GOTCHAS #11). Dựng lại, và lần này ghi rõ để không mất nữa.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "venues_name_trgm_idx" ON "venues" USING gin ("name" gin_trgm_ops);
CREATE INDEX "venues_address_trgm_idx" ON "venues" USING gin ("address" gin_trgm_ops);

-- Mỗi cơ sở có ĐÚNG MỘT chủ.
--
-- Bản cũ đảm bảo bằng `Venue.ownerId` — một cột, không sai được. Bản này dùng
-- `VenueMember` (chuyển nhượng được, nhiều nhân viên) nên mất đảm bảo đó: một
-- lỗi ở tầng ứng dụng là sân có hai chủ, hoặc không chủ nào. Chỉ số này lấy
-- lại nửa quan trọng hơn.
CREATE UNIQUE INDEX "venue_members_mot_chu_cho_moi_co_so"
  ON "venue_members" ("venue_id")
  WHERE role = 'OWNER';

-- Ràng buộc giá trị. Đây là những phép kiểm mà tầng ứng dụng ĐÃ làm — thêm ở
-- đây vì một đường ghi quên gọi service là dữ liệu hỏng vĩnh viễn, và loại
-- hỏng này chỉ lộ ra lúc đối soát cuối tháng.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_diem_tu_1_den_5"
  CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_khoang_thoi_gian_hop_le"
  CHECK ("end_at" > "start_at" AND "slot_count" > 0);

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tien_khong_am"
  CHECK (subtotal >= 0 AND "discount_total" >= 0 AND total >= 0);

ALTER TABLE "payments" ADD CONSTRAINT "payments_tien_hop_le"
  CHECK (amount > 0 AND "refunded_amount" >= 0 AND "refunded_amount" <= amount);

ALTER TABLE "venue_hours" ADD CONSTRAINT "venue_hours_gio_dong_sau_gio_mo"
  CHECK ("is_closed" OR "close_minute" > "open_minute");

ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_khung_gio_hop_le"
  CHECK ("end_minute" > "start_minute" AND "price_per_slot" >= 0);

ALTER TABLE "venues" ADD CONSTRAINT "venues_phi_huy_tu_0_den_100"
  CHECK ("cancel_fee_percent" IS NULL OR "cancel_fee_percent" BETWEEN 0 AND 100);
