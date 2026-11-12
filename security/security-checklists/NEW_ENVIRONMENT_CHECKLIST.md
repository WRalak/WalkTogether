# New environment checklist

1. [ ] Dedicated AWS account; root user with hardware MFA, no access keys; IAM Identity Center for humans
2. [ ] State bucket (versioned, KMS, public access blocked) + DynamoDB lock table; `backend.hcl` from the example
3. [ ] ACM certificate for the API and admin hostnames (DNS validation)
4. [ ] `terraform apply` in `infrastructure/terraform/environments/<env>`; confirm the SNS alert email subscription
5. [ ] Connect to RDS once with the RDS-managed master secret (via SSM port forwarding) and run `infrastructure/deployment/database-roles.sql`; set role passwords with `ALTER ROLE … PASSWORD` (generated, stored only in Secrets Manager)
6. [ ] Populate `walktogether/<env>/api`, `/migrate`, `/backup` in Secrets Manager (unique values; `DATABASE_URL` with `sslmode=verify-full`, `REDIS_URL` with `rediss://`, `METRICS_TOKEN`, `AGE_RECIPIENT`)
7. [ ] Make the repository readable from the host (public repo or read-only deploy key) — `/opt/walktogether`
8. [ ] GitHub environment `<env>`: variables from Terraform outputs; production → required reviewers
9. [ ] First deploy through `deploy-staging.yml` / `deploy-production.yml`; confirm health, alerts, Grafana
10. [ ] Run a restore drill against the first real backup; record it in `BACKUP_AND_RECOVERY.md` §5
11. [ ] Point DNS at the ALB; verify TLS (SSL Labs A or better) and security headers
