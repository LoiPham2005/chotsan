-- Hoá đơn hoa hồng nền tảng.
--
-- Chốt mô hình dòng tiền: tiền đặt sân đi THẲNG vào tài khoản của sân, nền tảng
-- xuất một hoá đơn hoa hồng mỗi tháng cho mỗi cơ sở.
--
-- Vì sao không giữ hộ tiền rồi tự cắt: giữ tiền của người khác là bước vào phạm
-- vi trung gian thanh toán, kèm ràng buộc pháp lý và vốn. Đổi lại phải đi ĐÒI,
-- nhưng có sẵn đòn bẩy — quá hạn thì khoá sân.
--
-- `@@unique([venueId, periodStart])` là chốt chặn chống xuất trùng: cron chạy
-- lại, hoặc admin bấm "xuất hoá đơn tháng này" hai lần, đều không tạo được hai
-- hoá đơn cho cùng một kỳ của cùng một sân.
--
-- ⚠️ Prisma còn sinh DROP INDEX cho venues_name_trgm_idx và
-- venues_address_trgm_idx — ĐÃ BỎ. Xem GOTCHAS #11.

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'DUE', 'PAID', 'OVERDUE', 'WAIVED');

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "booking_count" INTEGER NOT NULL,
    "gross_revenue" INTEGER NOT NULL,
    "commission_rate" DECIMAL(5,2) NOT NULL,
    "commission_amount" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "due_date" DATE NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "waived_by" TEXT,
    "waive_reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");

-- CreateIndex
CREATE INDEX "platform_invoices_status_due_date_idx" ON "platform_invoices"("status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_venue_id_period_start_key" ON "platform_invoices"("venue_id", "period_start");

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
