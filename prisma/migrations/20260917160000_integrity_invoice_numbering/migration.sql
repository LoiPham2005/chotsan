-- Toàn vẹn dữ liệu cơ sở/sân con + số hoá đơn không bao giờ trùng.
--
-- Sinh bằng `prisma migrate diff --from-schema <schema HEAD> --to-schema prisma/schema.prisma
-- --script`, rồi sửa tay đúng ba chỗ ghi ở dưới. So schema-với-schema nên KHÔNG có dòng
-- DROP INDEX trigram nào; ai sinh lại bằng `--from-config-datasource` sẽ thấy
-- `DROP INDEX venues_name_trgm_idx` / `venues_address_trgm_idx` — phải bỏ (GOTCHAS #11).
--
-- ⚠️ CHẠY CÁC CÂU KIỂM DỮ LIỆU MỒ CÔI/LỆCH TRƯỚC KHI ÁP (xem báo cáo đi kèm): mỗi khoá
-- ngoại mới dưới đây làm cả migration hỏng nếu database đang có dòng vi phạm.
--
-- 1. KHOÁ NGOẠI CÒN THIẾU
--    - price_rules.court_id, price_overrides.venue_id: trước đây trỏ tới bất cứ chuỗi nào,
--      kể cả sân con của cơ sở KHÁC. Dùng khoá ngoại HAI CỘT (court_id, venue_id) →
--      courts(id, venue_id): court_id NULL (= cả cơ sở) thì Postgres bỏ qua phép kiểm.
--      ON DELETE CASCADE: luật giá/đè giá là cấu hình, không phải lịch sử tiền.
--    - vouchers.venue_id: RESTRICT, không SET NULL — SET NULL biến mã riêng của một sân
--      thành mã dùng được ở mọi sân.
--    - disputes.user_id: RESTRICT như reviews.user_id — người dùng chỉ xoá mềm.
--
-- 2. bookings.venue_id PHẢI KHỚP courts.venue_id
--    Khoá ngoại hai cột thay cho bookings_court_id_fkey một cột. Lệch cơ sở là doanh thu,
--    hoá đơn hoa hồng và hàng chờ duyệt tiền tính sang nhầm cơ sở. ON UPDATE RESTRICT:
--    chuyển sân con sang cơ sở khác không được âm thầm kéo doanh thu cũ theo.
--    courts_id_venue_id_key là đích bắt buộc của khoá ngoại hai cột; Prisma quản lý nó
--    (`@@unique([id, venueId])`), nên `migrate diff` không bao giờ đòi xoá.
--
-- 3. payments.received_by mặc định VENUE — tiền đặt sân đi thẳng vào tài khoản sân.
--    Không sửa dòng cũ.
--
-- 4. platform_invoices."createdAt"/"updatedAt" → created_at/updated_at.
--    SỬA TAY #1: Prisma sinh DROP COLUMN + ADD COLUMN (mất ngày tạo của mọi hoá đơn cũ,
--    và ADD "updated_at" NOT NULL không mặc định còn hỏng ngay trên bảng có dữ liệu).
--    Thay bằng RENAME COLUMN — giữ dữ liệu, giữ nguyên DEFAULT.
--
-- 5. SEQUENCE platform_invoice_number_seq — VIẾT TAY, Prisma không biết (SỬA TAY #2).
--    Số hoá đơn cũ là `CS-YYYYMM-<6 ký tự cuối venue_id>`: hai sân trùng 6 ký tự cuối thì
--    trùng số, và hoá đơn sân thứ hai bị bỏ qua IM LẶNG. Số mới `CS-YYYYMM-000042` lấy
--    phần đuôi từ nextval() — Postgres không bao giờ trả cùng một giá trị hai lần, kể cả
--    giữa các transaction chạy song song hay bị huỷ (đổi lại có thể hở số, chấp nhận).
--    setval đẩy sequence qua mọi số cũ có đuôi toàn chữ số (nếu có), để số mới không thể
--    trùng số cũ. Kiểm còn nguyên: SELECT 1 FROM pg_class WHERE relkind = 'S' AND
--    relname = 'platform_invoice_number_seq'.
--
-- 6. Thứ tự (SỬA TAY #3): tạo courts_id_venue_id_key TRƯỚC khi gỡ khoá ngoại cũ, để không
--    có quãng nào bookings.court_id đứng không khoá ngoại trong lúc chờ tạo index.

-- CreateIndex
CREATE UNIQUE INDEX "courts_id_venue_id_key" ON "courts"("id", "venue_id");

-- DropForeignKey
ALTER TABLE "price_overrides" DROP CONSTRAINT "price_overrides_court_id_fkey";

-- DropForeignKey
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_court_id_fkey";

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "received_by" SET DEFAULT 'VENUE';

-- RenameColumn (thay cho DROP COLUMN + ADD COLUMN mà Prisma sinh ra)
ALTER TABLE "platform_invoices" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "platform_invoices" RENAME COLUMN "updatedAt" TO "updated_at";

-- AddForeignKey
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_court_id_venue_id_fkey" FOREIGN KEY ("court_id", "venue_id") REFERENCES "courts"("id", "venue_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_overrides" ADD CONSTRAINT "price_overrides_court_id_venue_id_fkey" FOREIGN KEY ("court_id", "venue_id") REFERENCES "courts"("id", "venue_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_overrides" ADD CONSTRAINT "price_overrides_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_court_id_venue_id_fkey" FOREIGN KEY ("court_id", "venue_id") REFERENCES "courts"("id", "venue_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateSequence (viết tay — xem mục 5)
CREATE SEQUENCE "platform_invoice_number_seq" AS BIGINT MINVALUE 1 NO CYCLE;

SELECT setval(
  '"platform_invoice_number_seq"',
  COALESCE(MAX(substring("number" FROM '^CS-[0-9]{6}-([0-9]+)$')::BIGINT), 0) + 1,
  false
)
FROM "platform_invoices";
