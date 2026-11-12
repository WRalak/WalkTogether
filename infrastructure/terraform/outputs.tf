output "alb_dns_name" {
  description = "Point api_domain and admin_domain (CNAME/ALIAS) at this."
  value       = module.edge.alb_dns_name
}

output "app_instance_id" {
  description = "Set as the STAGING_INSTANCE_ID / PRODUCTION_INSTANCE_ID GitHub environment variable."
  value       = module.compute.instance_id
}

output "deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN GitHub environment variable."
  value       = module.github_oidc.role_arn
}

output "db_endpoint" {
  value = module.database.endpoint
}

output "db_master_secret_arn" {
  description = "RDS-managed master credentials (used once to run infrastructure/deployment/database-roles.sql)."
  value       = module.database.master_secret_arn
}

output "redis_endpoint" {
  value = module.cache.primary_endpoint
}

output "media_bucket" {
  value = module.storage.media_bucket_id
}

output "backup_bucket" {
  value = module.storage.backup_bucket_id
}

output "application_secret_names" {
  description = "Populate these in Secrets Manager before the first deploy (values never go in Terraform)."
  value       = module.secrets.secret_names
}
