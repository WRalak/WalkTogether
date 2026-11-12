# Infrastructure alarms → encrypted SNS topic → on-call email. Application- and security-level
# alerting (auth failures, token reuse, admin bursts, forged webhooks) is in
# infrastructure/monitoring (Prometheus/Alertmanager). Optionally enables the account-wide
# threat-detection services: GuardDuty and a multi-region CloudTrail with log file validation.
variable "name" { type = string }
variable "kms_key_arn" { type = string }
variable "alert_email" { type = string }
variable "alb_arn_suffix" { type = string }
variable "target_group_arn_suffix" { type = string }
variable "web_acl_name" { type = string }
variable "db_instance_id" { type = string }
variable "cache_replication_group_id" { type = string }
variable "instance_id" { type = string }
variable "enable_account_security_services" { type = bool }
variable "log_bucket_id" { type = string }

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = var.kms_key_arn
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarms = {
    alb-5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_ELB_5XX_Count", stat = "Sum", threshold = 25, op = "GreaterThanThreshold", periods = 2
      dims      = { LoadBalancer = var.alb_arn_suffix }
      desc      = "Load balancer is returning 5xx responses"
    }
    target-5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 50, op = "GreaterThanThreshold", periods = 2
      dims      = { LoadBalancer = var.alb_arn_suffix }
      desc      = "Application is returning 5xx responses"
    }
    unhealthy-target = {
      namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold", periods = 2
      dims      = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.target_group_arn_suffix }
      desc      = "Application host failing health checks"
    }
    waf-blocked-surge = {
      namespace = "AWS/WAFV2", metric = "BlockedRequests", stat = "Sum", threshold = 1000, op = "GreaterThanThreshold", periods = 1
      dims      = { WebACL = var.web_acl_name, Region = data.aws_region.current.name, Rule = "ALL" }
      desc      = "WAF is blocking an unusual volume of requests (possible attack)"
    }
    db-cpu = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold", periods = 3
      dims      = { DBInstanceIdentifier = var.db_instance_id }
      desc      = "Database CPU high"
    }
    db-storage = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 5368709120, op = "LessThanThreshold", periods = 1
      dims      = { DBInstanceIdentifier = var.db_instance_id }
      desc      = "Database free storage below 5 GB"
    }
    db-connections = {
      namespace = "AWS/RDS", metric = "DatabaseConnections", stat = "Maximum", threshold = 150, op = "GreaterThanThreshold", periods = 2
      dims      = { DBInstanceIdentifier = var.db_instance_id }
      desc      = "Database connections unusually high"
    }
    cache-memory = {
      namespace = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", stat = "Maximum", threshold = 80, op = "GreaterThanThreshold", periods = 2
      dims      = { ReplicationGroupId = var.cache_replication_group_id }
      desc      = "Redis memory above 80% (queues use noeviction)"
    }
    host-status = {
      namespace = "AWS/EC2", metric = "StatusCheckFailed", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold", periods = 2
      dims      = { InstanceId = var.instance_id }
      desc      = "Application host failed an EC2 status check"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.desc
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.stat
  dimensions          = each.value.dims
  period              = 300
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# --- Account-wide threat detection (enable in one environment per AWS account) ------------------
resource "aws_guardduty_detector" "this" {
  #checkov:skip=CKV2_AWS_3:Single-account deployment per environment; no AWS Organization delegated admin.
  count  = var.enable_account_security_services ? 1 : 0
  enable = true
}

resource "aws_cloudwatch_event_rule" "guardduty" {
  count       = var.enable_account_security_services ? 1 : 0
  name        = "${var.name}-guardduty-findings"
  description = "GuardDuty findings of medium severity and above"
  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Finding"]
    detail        = { severity = [{ numeric = [">=", 4] }] }
  })
}

resource "aws_cloudwatch_event_target" "guardduty" {
  count = var.enable_account_security_services ? 1 : 0
  rule  = aws_cloudwatch_event_rule.guardduty[0].name
  arn   = aws_sns_topic.alerts.arn
}

data "aws_iam_policy_document" "sns" {
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com", "cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.sns.json
}

resource "aws_cloudwatch_log_group" "trail" {
  count             = var.enable_account_security_services ? 1 : 0
  name              = "/walktogether/${var.name}/cloudtrail"
  retention_in_days = 365
  kms_key_id        = var.kms_key_arn
}

data "aws_iam_policy_document" "trail_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "trail" {
  count              = var.enable_account_security_services ? 1 : 0
  name               = "${var.name}-cloudtrail"
  assume_role_policy = data.aws_iam_policy_document.trail_assume.json
}

resource "aws_iam_role_policy" "trail" {
  count = var.enable_account_security_services ? 1 : 0
  role  = aws_iam_role.trail[0].id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.trail[0].arn}:*" }]
  })
}

resource "aws_cloudtrail" "this" {
  #checkov:skip=CKV_AWS_252:Per-delivery SNS notifications add noise; trail events stream to CloudWatch Logs and GuardDuty findings are alerted.
  count                         = var.enable_account_security_services ? 1 : 0
  name                          = "${var.name}-trail"
  s3_bucket_name                = var.log_bucket_id
  s3_key_prefix                 = "cloudtrail"
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  kms_key_id                    = var.kms_key_arn
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.trail[0].arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.trail[0].arn
}

output "alerts_topic_arn" { value = aws_sns_topic.alerts.arn }
