
-- CreateEnum
CREATE TYPE "PaymentReceiver" AS ENUM ('PLATFORM', 'VENUE');

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'BANK_TRANSFER';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'AWAITING_CONFIRMATION';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "bank_code" TEXT,
ADD COLUMN     "card_type" TEXT,
ADD COLUMN     "checkout_url" TEXT,
ADD COLUMN     "declared_at" TIMESTAMPTZ(3),
ADD COLUMN     "declared_note" TEXT,
ADD COLUMN     "deeplink" TEXT,
ADD COLUMN     "expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "merchant_ref" TEXT NOT NULL,
ADD COLUMN     "proof_image_url" TEXT,
ADD COLUMN     "provider_paid_at" TIMESTAMPTZ(3),
ADD COLUMN     "qr_code_url" TEXT,
ADD COLUMN     "received_by" "PaymentReceiver" NOT NULL DEFAULT 'PLATFORM',
ADD COLUMN     "refunded_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reject_reason" TEXT,
ADD COLUMN     "request_id" TEXT,
ADD COLUMN     "response_code" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by" TEXT;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "fail_reason" TEXT,
ADD COLUMN     "merchant_ref" TEXT NOT NULL,
ADD COLUMN     "provider_refund_id" TEXT,
ADD COLUMN     "response_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchant_ref_key" ON "payments"("merchant_ref");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payments_status_declared_at_idx" ON "payments"("status", "declared_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_merchant_ref_key" ON "refunds"("merchant_ref");

