# Redis 7 (ElastiCache) in the data subnets: TLS in transit, KMS at rest, AUTH token required.
# The AUTH token is generated here and stored only in Secrets Manager (walktogether/<env>/redis);
# Terraform state is itself encrypted (S3 backend with KMS) and access-restricted.
variable "name" { type = string }
variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "node_type" { type = string }
variable "replicas" { type = number }
variable "kms_key_arn" { type = string }

resource "aws_security_group" "cache" {
  name        = "${var.name}-cache"
  description = "Redis - ingress only from the application host (rule in the root module)"
  vpc_id      = var.vpc_id
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
}

resource "random_password" "auth" {
  length  = 64
  special = false
}

resource "aws_elasticache_replication_group" "this" {
  #checkov:skip=CKV2_AWS_50:Driven by var.cache_replicas — automatic failover is on in production (1 replica).
  replication_group_id       = var.name
  description                = "WalkTogether cache, rate limits, queues and realtime state"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.node_type
  num_cache_clusters         = 1 + var.replicas
  automatic_failover_enabled = var.replicas > 0
  multi_az_enabled           = var.replicas > 0
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.cache.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  auth_token                 = random_password.auth.result
  auth_token_update_strategy = "ROTATE"

  snapshot_retention_limit   = 7
  snapshot_window            = "01:30-02:30"
  maintenance_window         = "sun:03:00-sun:04:00"
  auto_minor_version_upgrade = true
  apply_immediately          = false
}

resource "aws_secretsmanager_secret" "redis" {
  #checkov:skip=CKV2_AWS_57:Rotated by changing random_password (auth_token_update_strategy ROTATE), see DEPLOYMENT_SECURITY.md.
  name                    = "walktogether/${var.environment}/redis"
  description             = "ElastiCache AUTH token (compose into REDIS_URL as rediss://:TOKEN@host:6379)"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({
    REDIS_AUTH_TOKEN = random_password.auth.result
    REDIS_HOST       = aws_elasticache_replication_group.this.primary_endpoint_address
  })
}

output "security_group_id" { value = aws_security_group.cache.id }
output "replication_group_id" { value = aws_elasticache_replication_group.this.id }
output "primary_endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
