-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_pending_secret_encrypted" TEXT,
ADD COLUMN     "mfa_secret_encrypted" TEXT;

-- CreateTable
CREATE TABLE "user_mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_recovery_codes_code_hash_key" ON "user_mfa_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "user_mfa_recovery_codes_user_id_idx" ON "user_mfa_recovery_codes"("user_id");

-- AddForeignKey
ALTER TABLE "user_mfa_recovery_codes" ADD CONSTRAINT "user_mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Financial integrity (security gap G9): payment rows are never deleted and their financial facts
-- never change after creation. Status, provider references, refund totals and timestamps still
-- evolve through the verified payment lifecycle; refunds can only grow and never exceed the amount.
CREATE OR REPLACE FUNCTION payments_protect_financial_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments are immutable financial records and cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.payer_user_id IS DISTINCT FROM OLD.payer_user_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.subject_club_id IS DISTINCT FROM OLD.subject_club_id
     OR NEW.subject_user_id IS DISTINCT FROM OLD.subject_user_id
     OR NEW.promotion_code IS DISTINCT FROM OLD.promotion_code
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'financial fields of payment % are immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.refunded_minor < OLD.refunded_minor OR NEW.refunded_minor > NEW.amount_minor THEN
    RAISE EXCEPTION 'refunded amount of payment % may only increase up to the payment amount', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER payments_immutable_financials
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_protect_financial_fields();
