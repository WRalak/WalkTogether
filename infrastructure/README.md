# Infrastructure

Everything needed to build, run, deploy, monitor and recover WalkTogether. Application code lives in
`server/`, `platform-admin/` and `mobile/`; mobile builds are configured in `mobile/eas.json`.

| Path | Purpose |
| --- | --- |
| `docker/Dockerfile.api` | API image (also runs the worker and the migration job); multi-stage, non-root, `tini` |
| `docker/Dockerfile.platform-admin` | Platform-admin image (Next.js standalone), non-root |
| `docker/docker-compose.yml` | **Production** stack for one hardened host: read-only containers, dropped capabilities, resource limits, edge/egress/internal-data networks, images pinned by digest |
| `docker/postgres-init.sql` | PostGIS/pg_trgm + test DB for the **local** `docker-compose.yml` at the repo root |
| `nginx/nginx.conf`, `nginx/security-headers.conf` | TLS 1.2/1.3 reverse proxy, rate limits, WebSockets, ALB health listener, security headers |
| `terraform/` | AWS: VPC, WAF + ALB, private app host (SSM only), RDS PostgreSQL, ElastiCache, S3, KMS, Secrets Manager, alarms, GuardDuty/CloudTrail, GitHub OIDC deploy role; `environments/{development,staging,production}` |
| `kubernetes/` | Hardened manifests for a future move to EKS (**only when scale justifies it**) |
| `monitoring/` | Prometheus (scrape config, security + platform alert rules), Alertmanager, Grafana security dashboard |
| `deployment/deploy.sh` | Runs on the host via SSM: verifies Cosign signatures, renders secrets, migrates, rolls out, health-checks, rolls back |
| `deployment/database-roles.sql` | Least-privilege PostgreSQL roles (`wt_migrator`, `wt_app`, `wt_readonly`) |
| `backup/backup.sh`, `backup/restore-drill.sh` | age-encrypted `pg_dump` to S3 and a verified restore drill (runs in CI) |
| `loadtest/` | autocannon load-test scenarios and the recorded baseline |

Security rationale and procedures: [`../security/policies/DEPLOYMENT_SECURITY.md`](../security/policies/DEPLOYMENT_SECURITY.md),
[`../security/policies/BACKUP_AND_RECOVERY.md`](../security/policies/BACKUP_AND_RECOVERY.md). Hosting map:
[`../docs/deployment/HOSTING.md`](../docs/deployment/HOSTING.md).

```bash
# Validate locally
terraform -chdir=infrastructure/terraform fmt -check -recursive
checkov -d infrastructure --framework terraform kubernetes dockerfile --compact --quiet
```
