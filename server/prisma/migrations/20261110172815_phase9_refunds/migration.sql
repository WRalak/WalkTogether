-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "provider_receipt" VARCHAR(100);
