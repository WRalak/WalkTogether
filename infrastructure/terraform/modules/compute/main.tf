# The application host: one EC2 instance in a private subnet running the hardened Docker Compose
# stack (infrastructure/docker/docker-compose.yml). No public IP, no SSH key, SSH daemon disabled,
# IMDSv2 only, encrypted root volume, automatic security updates. Operators use SSM Session
# Manager (logged); deployments arrive through SSM Run Command from the GitHub OIDC deploy role.
variable "name" { type = string }
variable "environment" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "subnet_id" { type = string }
variable "instance_type" { type = string }
variable "alb_security_group_id" { type = string }
variable "target_group_arn" { type = string }
variable "kms_key_arn" { type = string }
variable "secret_arns" { type = list(string) }
variable "media_bucket_arn" { type = string }
variable "backup_bucket_arn" { type = string }
variable "github_repository" { type = string }

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "Application host - HTTPS and health checks from the load balancer only"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "https_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  description                  = "nginx (HTTPS) from the ALB"
}

resource "aws_vpc_security_group_ingress_rule" "health_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  description                  = "ALB health check listener"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  for_each                     = toset(["443", "8080"])
  security_group_id            = var.alb_security_group_id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = tonumber(each.value)
  to_port                      = tonumber(each.value)
  description                  = "ALB to application host"
}

# Outbound: HTTPS (container registry, AWS APIs, payment/SMS/email/push providers, OS updates),
# SMTP submission. Data-tier egress is added in the root module.
resource "aws_vpc_security_group_egress_rule" "https_out" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to registries, AWS APIs and providers"
}

resource "aws_vpc_security_group_egress_rule" "http_out" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "Ubuntu package mirrors (packages are GPG-signed)"
}

resource "aws_vpc_security_group_egress_rule" "smtp_out" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 465
  to_port           = 465
  description       = "SMTPS (implicit TLS) to the email provider"
}

# --- IAM: least privilege for the host --------------------------------------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name}-app-host"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

data "aws_iam_policy_document" "app" {
  statement {
    sid       = "ReadOwnEnvironmentSecrets"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = concat(var.secret_arns, ["arn:aws:secretsmanager:${var.region}:*:secret:walktogether/${var.environment}/*"])
  }
  statement {
    sid       = "UseEnvironmentKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [var.kms_key_arn]
  }
  statement {
    sid       = "Media"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
    resources = ["${var.media_bucket_arn}/*"]
  }
  statement {
    sid       = "MediaList"
    actions   = ["s3:ListBucket"]
    resources = [var.media_bucket_arn]
  }
  statement {
    # Write-only: the host can add backups but cannot read, delete or overwrite them (Object Lock).
    sid       = "BackupsWriteOnly"
    actions   = ["s3:PutObject"]
    resources = ["${var.backup_bucket_arn}/*"]
  }
}

resource "aws_iam_role_policy" "app" {
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name}-app-host"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = false
  monitoring                  = true
  ebs_optimized               = true
  disable_api_termination     = var.environment == "production"

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 1          # containers cannot reach instance credentials
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 60
    encrypted             = true
    kms_key_id            = var.kms_key_arn
    delete_on_termination = true
  }

  user_data_replace_on_change = false
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    environment       = var.environment
    region            = var.region
    github_repository = var.github_repository
    backup_bucket     = element(split(":", var.backup_bucket_arn), length(split(":", var.backup_bucket_arn)) - 1)
    kms_key_arn       = var.kms_key_arn
  })

  lifecycle {
    ignore_changes = [ami] # AMI updates are rolled deliberately (replace instance), not on every plan
  }

  tags = { Name = "${var.name}-app" }
}

resource "aws_lb_target_group_attachment" "app" {
  target_group_arn = var.target_group_arn
  target_id        = aws_instance.app.id
  port             = 443
}

output "security_group_id" { value = aws_security_group.app.id }
output "instance_id" { value = aws_instance.app.id }
output "instance_arn" { value = aws_instance.app.arn }
