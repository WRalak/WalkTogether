-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('SUBSCRIPTION', 'SPONSORSHIP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('SUCCEEDED', 'PENDING_MANUAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SponsorStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('CHALLENGE', 'EVENT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'ENDED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('PENDING', 'FULFILLED', 'FORFEITED');

-- AlterTable
ALTER TABLE "challenge_participants" ADD COLUMN     "consented_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "payer_user_id" UUID NOT NULL,
    "plan_id" UUID,
    "subject_club_id" UUID,
    "subject_user_id" UUID,
    "campaign_id" UUID,
    "promotion_code" VARCHAR(40),
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" VARCHAR(20) NOT NULL,
    "provider_ref" VARCHAR(200),
    "idempotency_key" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20),
    "failure_reason" VARCHAR(300),
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "payment_id" UUID NOT NULL,
    "billed_to" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "provider_ref" VARCHAR(200),
    "admin_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "provider" VARCHAR(20) NOT NULL,
    "event_id" VARCHAR(200) NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "error" VARCHAR(300),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("provider","event_id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200),
    "percent_off" INTEGER,
    "amount_off_minor" INTEGER,
    "plan_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_redemptions" INTEGER,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "description" VARCHAR(2000),
    "logo_url" VARCHAR(500),
    "website_url" VARCHAR(500),
    "contact_email" VARCHAR(254) NOT NULL,
    "status" "SponsorStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsored_campaigns" (
    "id" UUID NOT NULL,
    "sponsor_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "CampaignType" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "budget_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KES',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "terms" VARCHAR(10000) NOT NULL,
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "prize_description" VARCHAR(1000),
    "challenge_config" JSONB,
    "challenge_id" UUID,
    "review_note" VARCHAR(500),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsored_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsored_events" (
    "event_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsored_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "campaign_rewards" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "rank" INTEGER,
    "description" VARCHAR(300) NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'PENDING',
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_subject_club_id_created_at_idx" ON "payments"("subject_club_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_subject_user_id_created_at_idx" ON "payments"("subject_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payer_user_id_idempotency_key_key" ON "payments"("payer_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_ref_key" ON "payments"("provider", "provider_ref");

-- CreateIndex
CREATE INDEX "payment_transactions_payment_id_created_at_idx" ON "payment_transactions"("payment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_payment_id_key" ON "invoices"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sponsors_slug_key" ON "sponsors"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sponsored_campaigns_challenge_id_key" ON "sponsored_campaigns"("challenge_id");

-- CreateIndex
CREATE INDEX "sponsored_campaigns_sponsor_id_status_idx" ON "sponsored_campaigns"("sponsor_id", "status");

-- CreateIndex
CREATE INDEX "sponsored_campaigns_status_starts_at_idx" ON "sponsored_campaigns"("status", "starts_at");

-- CreateIndex
CREATE INDEX "sponsored_events_campaign_id_idx" ON "sponsored_events"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_rewards_campaign_id_user_id_key" ON "campaign_rewards"("campaign_id", "user_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_user_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sponsored_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsored_campaigns" ADD CONSTRAINT "sponsored_campaigns_sponsor_id_fkey" FOREIGN KEY ("sponsor_id") REFERENCES "sponsors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsored_campaigns" ADD CONSTRAINT "sponsored_campaigns_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsored_events" ADD CONSTRAINT "sponsored_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsored_events" ADD CONSTRAINT "sponsored_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sponsored_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_rewards" ADD CONSTRAINT "campaign_rewards_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "sponsored_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_pos" CHECK ("amount_minor" > 0 AND "refunded_minor" >= 0 AND "refunded_minor" <= "amount_minor");
ALTER TABLE "payments" ADD CONSTRAINT "payments_subject" CHECK (("purpose" = 'SUBSCRIPTION' AND (("subject_club_id" IS NULL) <> ("subject_user_id" IS NULL)) AND "plan_id" IS NOT NULL) OR ("purpose" = 'SPONSORSHIP' AND "campaign_id" IS NOT NULL));
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_discount" CHECK (("percent_off" IS NULL) <> ("amount_off_minor" IS NULL) AND ("percent_off" IS NULL OR "percent_off" BETWEEN 1 AND 100));
ALTER TABLE "sponsored_campaigns" ADD CONSTRAINT "campaigns_budget_pos" CHECK ("budget_minor" > 0 AND "ends_at" > "starts_at");
-- Invoices are financial records: never deleted.
CREATE TRIGGER invoices_no_delete BEFORE DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_mutation();
