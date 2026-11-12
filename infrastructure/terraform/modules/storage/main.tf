# Private S3 buckets. All block public access, deny non-TLS requests, are versioned and log access.
#   media   — user uploads (served through short-lived signed URLs by the API), SSE-KMS
#   backups — age-encrypted pg_dump files (infrastructure/backup), SSE-KMS, Object Lock
#   logs    — ALB and S3 access logs (SSE-S3: ALB log delivery does not support KMS keys)
variable "name" { type = string }
variable "kms_key_arn" { type = string }
variable "backup_retention_days" { type = number }
variable "backup_object_lock_days" { type = number }
variable "force_destroy" { type = bool }

data "aws_caller_identity" "current" {}
data "aws_elb_service_account" "this" {}

locals {
  buckets = {
    media   = "${var.name}-media-${data.aws_caller_identity.current.account_id}"
    backups = "${var.name}-backups-${data.aws_caller_identity.current.account_id}"
    logs    = "${var.name}-logs-${data.aws_caller_identity.current.account_id}"
  }
}

resource "aws_s3_bucket" "logs" {
  #checkov:skip=CKV_AWS_144:Cross-region replication of access logs is not required (RPO applies to data, not logs).
  #checkov:skip=CKV_AWS_145:ALB access-log delivery only supports SSE-S3.
  #checkov:skip=CKV_AWS_18:This is the access-log destination bucket.
  #checkov:skip=CKV2_AWS_62:No consumers of object events for logs.
  bucket        = local.buckets.logs
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket" "media" {
  #checkov:skip=CKV_AWS_144:Media is reproducible from users' devices; cross-region replication is a cost decision documented in BACKUP_AND_RECOVERY.md.
  #checkov:skip=CKV2_AWS_62:The API records uploads itself; no S3 event consumers.
  bucket        = local.buckets.media
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket" "backups" {
  #checkov:skip=CKV_AWS_144:Cross-region copies are made by the backup job (BACKUP_AND_RECOVERY.md) to keep Object Lock semantics simple.
  #checkov:skip=CKV2_AWS_62:No consumers of object events for backups.
  bucket              = local.buckets.backups
  force_destroy       = var.force_destroy
  object_lock_enabled = true
}

resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.backup_object_lock_days
    }
  }
}

locals {
  all = {
    media   = aws_s3_bucket.media
    backups = aws_s3_bucket.backups
    logs    = aws_s3_bucket.logs
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.all
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.all
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = local.all
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "kms" {
  for_each = { media = aws_s3_bucket.media, backups = aws_s3_bucket.backups }
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_logging" "this" {
  for_each      = { media = aws_s3_bucket.media, backups = aws_s3_bucket.backups }
  bucket        = each.value.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3/${each.key}/"
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "retention"
    status = "Enabled"
    filter {}
    transition {
      days          = 30
      storage_class = "GLACIER_IR"
    }
    expiration {
      days = var.backup_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "noncurrent-and-incomplete"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = 400
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

data "aws_iam_policy_document" "tls_only" {
  for_each = local.all
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value.arn, "${each.value.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []
    content {
      sid       = "AlbAccessLogs"
      actions   = ["s3:PutObject"]
      resources = ["${each.value.arn}/alb/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
      principals {
        type        = "AWS"
        identifiers = [data.aws_elb_service_account.this.arn]
      }
    }
  }
  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []
    content {
      sid       = "CloudTrailAclCheck"
      actions   = ["s3:GetBucketAcl"]
      resources = [each.value.arn]
      principals {
        type        = "Service"
        identifiers = ["cloudtrail.amazonaws.com"]
      }
    }
  }
  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []
    content {
      sid       = "CloudTrailWrite"
      actions   = ["s3:PutObject"]
      resources = ["${each.value.arn}/cloudtrail/AWSLogs/${data.aws_caller_identity.current.account_id}/*"]
      principals {
        type        = "Service"
        identifiers = ["cloudtrail.amazonaws.com"]
      }
    }
  }
  dynamic "statement" {
    for_each = each.key == "logs" ? [1] : []
    content {
      sid       = "S3ServerAccessLogs"
      actions   = ["s3:PutObject"]
      resources = ["${each.value.arn}/s3/*"]
      principals {
        type        = "Service"
        identifiers = ["logging.s3.amazonaws.com"]
      }
      condition {
        test     = "StringEquals"
        variable = "aws:SourceAccount"
        values   = [data.aws_caller_identity.current.account_id]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each   = local.all
  bucket     = each.value.id
  policy     = data.aws_iam_policy_document.tls_only[each.key].json
  depends_on = [aws_s3_bucket_public_access_block.this]
}

output "media_bucket_id" { value = aws_s3_bucket.media.id }
output "media_bucket_arn" { value = aws_s3_bucket.media.arn }
output "backup_bucket_id" { value = aws_s3_bucket.backups.id }
output "backup_bucket_arn" { value = aws_s3_bucket.backups.arn }
output "log_bucket_id" { value = aws_s3_bucket.logs.id }
output "log_bucket_arn" { value = aws_s3_bucket.logs.arn }
