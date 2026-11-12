# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
GitHub's **"Report a vulnerability"** (Security → Advisories) on this repository. Include steps to
reproduce, the affected component (`server`, `mobile`, `platform-admin`, `infrastructure`) and the
impact you observed.

| Stage | Target |
| --- | --- |
| Acknowledgement | 2 business days |
| Triage and severity (CVSS 3.1) | 5 business days |
| Fix — critical / high | 7 / 30 days (see `security/vulnerability-management/VULNERABILITY_MANAGEMENT.md`) |
| Coordinated disclosure | after the fix is deployed, credited if you wish |

Good-faith research that avoids privacy violations, data destruction and service disruption, and
only touches accounts you own, will not be pursued legally. Do not access other users' data, run
volumetric/DoS tests, or test payment flows with real money; use the M-Pesa and Stripe sandboxes.

## Supported versions

Only the latest release on `main` (API, platform admin) and the current store version of the
mobile app receive security fixes.

## Where the security documentation lives

| Document | Purpose |
| --- | --- |
| [`security/GAP_ANALYSIS.md`](security/GAP_ANALYSIS.md) | What was in place, what was missing, what was closed (with evidence) |
| [`security/threat-model/THREAT_MODEL.md`](security/threat-model/THREAT_MODEL.md) | Assets, trust boundaries, STRIDE threats and mitigations |
| [`security/incident-response/INCIDENT_RESPONSE.md`](security/incident-response/INCIDENT_RESPONSE.md) | Severity levels, roles, playbooks linked from every alert |
| [`security/vulnerability-management/VULNERABILITY_MANAGEMENT.md`](security/vulnerability-management/VULNERABILITY_MANAGEMENT.md) | Scanning, SLAs, the exception process |
| [`security/policies/ACCESS_CONTROL_POLICY.md`](security/policies/ACCESS_CONTROL_POLICY.md) | Roles, permissions, admin access, RLS decision |
| [`security/policies/BACKUP_AND_RECOVERY.md`](security/policies/BACKUP_AND_RECOVERY.md) | RPO/RTO, backup and restore procedures, drills |
| [`security/policies/DEPLOYMENT_SECURITY.md`](security/policies/DEPLOYMENT_SECURITY.md) | Pipeline stages, signing, secrets, environments |
| [`security/policies/DATA_PROTECTION_POLICY.md`](security/policies/DATA_PROTECTION_POLICY.md) | Personal data, Kenya DPA 2019, retention, data-subject rights |
| [`security/security-checklists/`](security/security-checklists/) | Release, PR review and new-environment checklists |
| [`docs/security/SECURITY_ARCHITECTURE.md`](docs/security/SECURITY_ARCHITECTURE.md) | Application security design (auth, RBAC, tenant isolation) |

## What we do **not** claim

WalkTogether has **not** been externally penetration-tested or certified against any standard
(ISO 27001, SOC 2, PCI DSS). The controls above are mapped to OWASP ASVS, OWASP API Top 10, OWASP
MASVS, NIST CSF and CIS benchmarks as design references, and every claim in these documents points
to code, configuration or a test you can run. Card data never touches our systems (Stripe-hosted
checkout; M-Pesa STK push), which keeps PCI scope to SAQ A.
