# Secret CONTAINERS only. Values are written out-of-band by an authorised operator
# (aws secretsmanager put-secret-value …) and are never in Terraform code or state.
# deploy.sh renders walktogether/<env>/api and /migrate into 0600 env files on the host.
variable "environment" { type = string }
variable "kms_key_arn" { type = string }

locals {
  secrets = {
    api     = "API and worker runtime configuration: DATABASE_URL (wt_app, sslmode=verify-full), REDIS_URL (rediss://), JWT/HMAC/encryption keys, provider credentials (M-Pesa, Stripe, SMTP, SMS), METRICS_TOKEN"
    migrate = "Migration job: DATABASE_URL for wt_migrator (sslmode=verify-full)"
    backup  = "Backup job: DATABASE_URL for a read-only dump role and AGE_RECIPIENT (public key; the private key is kept offline)"
  }
}

resource "aws_secretsmanager_secret" "this" {
  #checkov:skip=CKV2_AWS_57:Application secrets are rotated by the documented runbook (security/policies/DEPLOYMENT_SECURITY.md §Secrets), not a Lambda.
  for_each                = local.secrets
  name                    = "walktogether/${var.environment}/${each.key}"
  description             = each.value
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = 30
}

output "secret_arns" { value = [for s in aws_secretsmanager_secret.this : s.arn] }
output "secret_names" { value = [for s in aws_secretsmanager_secret.this : s.name] }
