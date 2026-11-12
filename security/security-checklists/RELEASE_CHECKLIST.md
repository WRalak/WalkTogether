# Release security acceptance checklist

A release goes to production only when every box is ticked (or an exception is recorded in
`security/vulnerability-management/exceptions.yaml`). Most items are enforced by the pipeline; the
reviewer confirms the evidence.

## Automated (confirm green in the run)
- [ ] CI: lint, typecheck, unit, integration as `wt_app`, API security tests, backup/restore drill, migration drift
- [ ] Security scan: Semgrep, Gitleaks, npm audit, Trivy fs/config, Checkov, Terraform validate, config validation, ZAP API scan
- [ ] Images: non-root, Trivy gate passed, SBOM produced, signed by `deploy-staging.yml` on `main`
- [ ] Staging smoke checks + ZAP baseline passed
- [ ] `check_exceptions.py`: no expired exceptions

## Reviewer
- [ ] Changes to auth, payments, permissions or tenant scoping have tests for the abuse case
- [ ] New API routes: validation schema, authentication, permission check, rate limit where public
- [ ] New club routes use `requireClubPermission` with the club id from the path
- [ ] No new secrets in code, config or logs; new config uses Secrets Manager
- [ ] Database migrations reviewed: no data loss, grants still correct (`database-roles.sql`), no weakening of append-only/immutable tables
- [ ] Personal data changes reflected in `DATA_PROTECTION_POLICY.md` (inventory, retention)
- [ ] New dependencies reviewed (maintenance, licence, install scripts)
- [ ] Rollback plan known (previous digests; migrations backward-compatible)

## After deploy
- [ ] Health verification job green; no new alerts in 30 minutes
- [ ] Security dashboard (Grafana "WalkTogether security") shows normal levels
