variable "environment" {
  description = "development | staging | production"
  type        = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging or production."
  }
}

variable "aws_region" {
  description = "AWS region (Cape Town is the closest region to Kenya)."
  type        = string
  default     = "af-south-1"
}

variable "vpc_cidr" {
  type = string
}

variable "az_count" {
  description = "Availability zones to spread subnets across (RDS and the ALB need at least two)."
  type        = number
  default     = 2
}

variable "single_nat_gateway" {
  description = "One NAT gateway for all AZs (cheaper; not highly available)."
  type        = bool
  default     = true
}

variable "api_domain" {
  description = "Public API hostname, e.g. api.walktogether.app"
  type        = string
}

variable "admin_domain" {
  description = "Platform admin hostname, e.g. admin.walktogether.app"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate (in this region) covering api_domain and admin_domain."
  type        = string
}

variable "admin_allowed_cidrs" {
  description = "Optional office/VPN CIDRs allowed to reach the admin hostname. Empty = reachable from anywhere (still MFA-protected)."
  type        = list(string)
  default     = []
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 50
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_retention_days" {
  type    = number
  default = 14
}

variable "cache_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "cache_replicas" {
  description = "Read replicas in addition to the primary (>= 1 enables automatic failover)."
  type        = number
  default     = 0
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  description = "How long encrypted database dumps are kept in the backup bucket."
  type        = number
  default     = 90
}

variable "backup_object_lock_days" {
  description = "Backups cannot be deleted or overwritten for this many days (ransomware protection)."
  type        = number
  default     = 14
}

variable "alert_email" {
  description = "Address subscribed to the alerts SNS topic (confirm the subscription email)."
  type        = string
}

variable "github_repository" {
  description = "owner/name of the repository whose deploy workflows may assume the deploy role."
  type        = string
  default     = "WRalak/WalkTogether"
}

variable "create_github_oidc_provider" {
  description = "The GitHub OIDC provider is account-wide: create it in exactly one environment per AWS account."
  type        = bool
  default     = false
}

variable "enable_account_security_services" {
  description = "Enable GuardDuty and a multi-region CloudTrail (account-wide; enable in one environment per account)."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 365
}
