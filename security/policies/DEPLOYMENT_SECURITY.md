# Deployment security

## 1. Environments

| | Development | Staging | Production |
| --- | --- | --- | --- |
| AWS account | Own account | Own account | Own account |
| Data | Synthetic only | Synthetic / anonymised only — **never production data** | Real |
| Secrets | `walktogether/development/*` | `walktogether/staging/*` | `walktogether/production/*` (unique values) |
| Payments | Sandboxes (Daraja sandbox, Stripe test) | Sandboxes | Live |
| Deploy trigger | Manual | Automatic after green CI + security scan on `main` | Manual, **required reviewers** |

Production credentials are never used in development or staging, and no developer machine holds them.

## 2. Pipeline (18 stages)

| # | Stage | Where | Fails the release when |
| --- | --- | --- | --- |
| 1 | Checkout | all | — |
| 2 | Install from lockfile (`npm ci`) | ci.yml | lockfile out of sync |
| 3 | Lint + format (ESLint incl. security rules, Prettier) | ci.yml | any error or warning |
| 4 | Typecheck | ci.yml | any error |
| 5 | Unit tests | ci.yml | any failure |
| 6 | Integration tests as least-privilege DB role + backup/restore drill + migration drift | ci.yml | any failure |
| 7 | API security tests (auth, MFA, authorization, tenant isolation, abuse) | ci.yml | any failure |
| 8 | SAST: Semgrep registry + custom rules (with rule tests) | security-scan.yml | any finding |
| 9 | Dependency scan: npm audit, Trivy fs, Dependabot | security-scan.yml | high/critical without exception |
| 10 | Secret scan: Gitleaks over full history | security-scan.yml | any finding |
| 11 | Container scan: Trivy | ci.yml, deploy-staging, deploy-production | CRITICAL without exception |
| 12 | Build images (non-root check, config-guard smoke test) | ci.yml, deploy-staging | build/smoke failure |
| 13 | SBOM: Syft (SPDX + CycloneDX), attested with Cosign | ci.yml, deploy-staging | — |
| 14 | Deploy staging: GHCR by digest, Cosign keyless signing, OIDC → SSM → `deploy.sh` (verifies signature on host) | deploy-staging.yml | signature/health failure (auto-rollback) |
| 15 | Smoke + security checks on staging (TLS, headers, /metrics hidden, HTTP→HTTPS, auth required) + ZAP baseline | deploy-staging.yml | any check |
| 16 | Production approval: GitHub `production` environment reviewers | deploy-production.yml | not approved |
| 17 | Deploy production: verify signature + SBOM attestation, re-scan with today's CVE data, exception register valid | deploy-production.yml | any |
| 18 | Health verification: healthy for 5 min, headers, docs/metrics not exposed | deploy-production.yml | any (host rolls back on failed health) |

Also on every push: IaC scanning (Checkov, Trivy config, `terraform validate`), runtime config
validation (Prometheus, Alertmanager, nginx, Compose) and an OWASP ZAP API scan.

**No security check may be disabled or soft-failed to make a pipeline pass.** The only way past a
finding is a documented, approved, expiring exception (`VULNERABILITY_MANAGEMENT.md` §5).

## 3. Supply chain (SLSA-oriented)

* Builds run only on GitHub-hosted runners from `main`; images are addressed by **digest**, never tags.
* Build provenance (`provenance: mode=max`) and SBOM attestations are attached to each image.
* Cosign keyless signatures bind each image to `deploy-staging.yml@refs/heads/main` of this
  repository; `deploy.sh` refuses unsigned images and mutable tags.
* GitHub Actions are pinned to major-version tags. **Gap:** pinning to commit SHAs is planned
  (Dependabot will keep SHAs current).
* Scanner versions are pinned (Semgrep, Checkov, Trivy, Syft, ZAP images).

## 4. Secrets

* Stored only in AWS Secrets Manager (`walktogether/<env>/{api,migrate,backup,redis}`), encrypted
  with the environment KMS key. Terraform creates the containers; values are written by the owner
  with `aws secretsmanager put-secret-value` from a secure workstation.
* Rendered at deploy time to root-owned `0600` files in `/etc/walktogether/`; never baked into
  images, never in git (`.env.example` holds placeholders only; Gitleaks enforces).
* GitHub holds **no cloud keys**: deploys use OIDC with a role restricted to one GitHub environment
  and one host. The only GitHub secret is `EXPO_TOKEN` (mobile-release environment).
* Rotation: JWT/HMAC keys and provider credentials yearly and on any suspicion; DB passwords
  (`ALTER ROLE … PASSWORD`) yearly; Redis AUTH by rotating `random_password` (dual-token
  `ROTATE` strategy). Record each rotation in the change log.

## 5. Hosts and network

* App host in a private subnet; no public IP, SSH disabled, IMDSv2 only, encrypted EBS, unattended
  security upgrades, auditd, Docker with `no-new-privileges`.
* Containers: non-root, read-only root filesystem, all capabilities dropped, resource limits, three
  networks (edge / egress / internal data).
* Only the ALB is internet-facing (WAF in front). PostgreSQL and Redis live in subnets without an
  internet route and accept connections only from the app host's security group, over TLS.

## 6. Required GitHub settings (configure in repository settings — not expressible in code)

* Branch protection on `main`: require PR review, require status checks **CI** and
  **Security scan**, require CODEOWNERS review, block force pushes.
* Environment `production`: required reviewers (at least one person other than the author once the
  team has two members), deployment branches limited to `main`.
* Environments `staging`, `production`: variables `STAGING_INSTANCE_ID` / `PRODUCTION_INSTANCE_ID`,
  `STAGING_API_URL` / `PRODUCTION_API_URL`, `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION` (outputs of Terraform).
* Enable secret scanning push protection and Dependabot security updates; require 2FA for the org.
