# WalkTogether AWS infrastructure (root module). Each folder in environments/ instantiates this module
# with its own state, variables and AWS account/region. Nothing here contains a secret value:
# application secrets live in AWS Secrets Manager and are written out-of-band (see
# security/policies/DEPLOYMENT_SECURITY.md); the RDS master password is generated and held by RDS
# itself (manage_master_user_password).
#
# Topology (docs/architecture + security/threat-model/THREAT_MODEL.md):
#   Internet → WAF → ALB (public subnets, TLS 1.2+/1.3) → app host (private subnet: nginx, api,
#   worker, platform-admin, clamav in Docker Compose) → RDS PostgreSQL + ElastiCache Redis (data
#   subnets, no internet route). Administration via SSM Session Manager only: no SSH, no bastion.

locals {
  name = "walktogether-${var.environment}"
}

module "kms" {
  source = "./modules/kms"
  name   = local.name
  region = var.aws_region
}

module "network" {
  source             = "./modules/network"
  name               = local.name
  cidr               = var.vpc_cidr
  az_count           = var.az_count
  single_nat_gateway = var.single_nat_gateway
  kms_key_arn        = module.kms.key_arn
  log_retention_days = var.log_retention_days
}

module "storage" {
  source                  = "./modules/storage"
  name                    = local.name
  kms_key_arn             = module.kms.key_arn
  backup_retention_days   = var.backup_retention_days
  backup_object_lock_days = var.backup_object_lock_days
  force_destroy           = !var.deletion_protection
}

module "edge" {
  source              = "./modules/edge"
  name                = local.name
  vpc_id              = module.network.vpc_id
  public_subnet_ids   = module.network.public_subnet_ids
  certificate_arn     = var.acm_certificate_arn
  admin_domain        = var.admin_domain
  admin_allowed_cidrs = var.admin_allowed_cidrs
  access_log_bucket   = module.storage.log_bucket_id
  deletion_protection = var.deletion_protection
  kms_key_arn         = module.kms.key_arn
  log_retention_days  = var.log_retention_days
}

module "secrets" {
  source      = "./modules/secrets"
  environment = var.environment
  kms_key_arn = module.kms.key_arn
}

module "database" {
  source                = "./modules/database"
  name                  = local.name
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.data_subnet_ids
  instance_class        = var.db_instance_class
  allocated_storage_gb  = var.db_allocated_storage_gb
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = var.deletion_protection
  kms_key_arn           = module.kms.key_arn
}

module "cache" {
  source      = "./modules/cache"
  name        = local.name
  environment = var.environment
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.data_subnet_ids
  node_type   = var.cache_node_type
  replicas    = var.cache_replicas
  kms_key_arn = module.kms.key_arn
}

module "compute" {
  source                = "./modules/compute"
  name                  = local.name
  environment           = var.environment
  region                = var.aws_region
  vpc_id                = module.network.vpc_id
  subnet_id             = module.network.private_subnet_ids[0]
  instance_type         = var.instance_type
  alb_security_group_id = module.edge.security_group_id
  target_group_arn      = module.edge.target_group_arn
  kms_key_arn           = module.kms.key_arn
  secret_arns           = module.secrets.secret_arns
  media_bucket_arn      = module.storage.media_bucket_arn
  backup_bucket_arn     = module.storage.backup_bucket_arn
  github_repository     = var.github_repository
}

# Data-tier access is granted only from the application host's security group.
resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = module.database.security_group_id
  referenced_security_group_id = module.compute.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from the application host only"
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_app" {
  security_group_id            = module.cache.security_group_id
  referenced_security_group_id = module.compute.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "Redis (TLS) from the application host only"
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = module.compute.security_group_id
  referenced_security_group_id = module.database.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL"
}

resource "aws_vpc_security_group_egress_rule" "app_to_cache" {
  security_group_id            = module.compute.security_group_id
  referenced_security_group_id = module.cache.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  description                  = "Redis (TLS)"
}

module "monitoring" {
  source                           = "./modules/monitoring"
  name                             = local.name
  kms_key_arn                      = module.kms.key_arn
  alert_email                      = var.alert_email
  alb_arn_suffix                   = module.edge.alb_arn_suffix
  target_group_arn_suffix          = module.edge.target_group_arn_suffix
  web_acl_name                     = module.edge.web_acl_name
  db_instance_id                   = module.database.instance_id
  cache_replication_group_id       = module.cache.replication_group_id
  instance_id                      = module.compute.instance_id
  enable_account_security_services = var.enable_account_security_services
  log_bucket_id                    = module.storage.log_bucket_id
}

module "github_oidc" {
  source            = "./modules/github-oidc"
  name              = local.name
  environment       = var.environment
  github_repository = var.github_repository
  create_provider   = var.create_github_oidc_provider
  instance_arn      = module.compute.instance_arn
}
