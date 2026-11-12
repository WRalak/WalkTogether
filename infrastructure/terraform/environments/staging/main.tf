# staging environment. State: S3 backend with KMS encryption and DynamoDB locking, configured at init:
#   terraform init -backend-config=backend.hcl   (copy backend.hcl.example; it holds no secrets)
terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.100.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
  }
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
  # Guard against applying this environment to the wrong AWS account.
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = {
      Project     = "walktogether"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}

variable "aws_account_id" {
  description = "The AWS account dedicated to this environment (separate accounts per environment)."
  type        = string
}
variable "aws_region" {
  type    = string
  default = "af-south-1"
}
variable "acm_certificate_arn" { type = string }
variable "alert_email" { type = string }
variable "admin_allowed_cidrs" {
  type    = list(string)
  default = []
}

module "walktogether" {
  source = "../.."

  environment         = "staging"
  aws_region          = var.aws_region
  acm_certificate_arn = var.acm_certificate_arn
  alert_email         = var.alert_email
  admin_allowed_cidrs = var.admin_allowed_cidrs

  vpc_cidr                         = "10.20.0.0/16"
  api_domain                       = "api.staging.walktogether.app"
  admin_domain                     = "admin.staging.walktogether.app"
  single_nat_gateway               = true
  instance_type                    = "t3.medium"
  db_instance_class                = "db.t4g.small"
  db_allocated_storage_gb          = 30
  db_multi_az                      = false
  db_backup_retention_days         = 14
  cache_node_type                  = "cache.t4g.small"
  cache_replicas                   = 0
  deletion_protection              = true
  backup_retention_days            = 30
  backup_object_lock_days          = 7
  log_retention_days               = 365
  create_github_oidc_provider      = true
  enable_account_security_services = true
}

output "alb_dns_name" { value = module.walktogether.alb_dns_name }
output "app_instance_id" { value = module.walktogether.app_instance_id }
output "deploy_role_arn" { value = module.walktogether.deploy_role_arn }
output "db_endpoint" { value = module.walktogether.db_endpoint }
output "db_master_secret_arn" { value = module.walktogether.db_master_secret_arn }
output "redis_endpoint" { value = module.walktogether.redis_endpoint }
output "media_bucket" { value = module.walktogether.media_bucket }
output "backup_bucket" { value = module.walktogether.backup_bucket }
output "application_secret_names" { value = module.walktogether.application_secret_names }
