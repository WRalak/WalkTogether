# Monitoring

| Path | Purpose |
| --- | --- |
| `prometheus/prometheus.yml` | Scrapes the API (`/metrics`) and worker (`:9464/metrics`) with the `METRICS_TOKEN` bearer token |
| `prometheus/rules/security.yml` | Threat-detection alerts: credential stuffing, MFA failures, refresh-token replay, rate-limit abuse, authorization probing, admin-action bursts, forged payment webhooks |
| `prometheus/rules/platform.yml` | Availability, 5xx rate, latency, job failures, payment failure rate, host resources |
| `alertmanager/alertmanager.yml` | Routing: critical → on-call, `team=security` → security channel; receiver secrets from files |
| `grafana/` | Provisioned "WalkTogether — security & platform" dashboard |

Application errors go to **Sentry** (`SENTRY_DSN`, PII disabled). Logs are structured JSON (pino) with
credentials, tokens and cookies redacted; ship them to CloudWatch Logs (Terraform) or another
central store. Infrastructure alarms (RDS CPU/storage/connections, ElastiCache, ALB 5xx) are created
by `infrastructure/terraform/modules/monitoring`.

CI validates the rules with `promtool check rules` (`.github/workflows/security-scan.yml`).
