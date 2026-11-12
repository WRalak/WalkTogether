# Backup and recovery

## 1. Objectives

| Scenario | RPO (max data loss) | RTO (max downtime) | Mechanism |
| --- | --- | --- | --- |
| Bad deploy / app bug | 0 | 15 min | `deploy.sh` automatic rollback to previous signed digests |
| Accidental data change/deletion | 5 min | 2 h | RDS point-in-time recovery to a new instance |
| Database instance / AZ failure | ≈0 (production Multi-AZ) | minutes (automatic failover) | RDS Multi-AZ |
| Region-wide loss, account compromise, ransomware | 24 h | 8 h | Daily age-encrypted dumps in an Object Lock bucket + rebuild from Terraform |
| Redis loss | n/a (cache, queues re-driven) | 30 min | ElastiCache snapshots; jobs are idempotent |

Targets are **objectives**, not yet measured at production scale. The restore drill records actual
restore time on every run (CI: small data set; quarterly drill: production-size copy). Record each
quarterly result in §5.

## 2. What is backed up

| Data | How | Retention | Encryption |
| --- | --- | --- | --- |
| PostgreSQL (all data) | RDS automated backups + PITR | 7 / 14 / 35 days (dev / staging / prod) | KMS (environment key) |
| PostgreSQL logical dumps | `infrastructure/backup/backup.sh` daily (systemd timer on the host) | 14 / 30 / 365 days; Object Lock 1 / 7 / 35 days | **age** public-key encryption before upload + SSE-KMS; SHA-256 sidecar |
| Media (S3) | Versioning (deleted/overwritten objects recoverable 30 days) | — | SSE-KMS |
| Infrastructure | Terraform code in git; state in versioned, encrypted S3 | — | KMS |
| Secrets | Secrets Manager (30-day recovery window) | — | KMS |

The host's IAM role can **write** backups but cannot read, overwrite or delete them; Object Lock
prevents deletion even by an administrator in GOVERNANCE mode without an explicit bypass.

## 3. Keys

* The **age private key** (backup decryption) is generated offline, stored in two places outside
  AWS (password manager vault + sealed offline copy) and never placed on servers or in CI. Only the
  public key (`AGE_RECIPIENT`) is configured in `walktogether/<env>/backup`.
* Losing the private key makes dumps unrecoverable — verify access to it during every drill.

## 4. Procedures

### Point-in-time recovery (most incidents)
1. Decide the target time (just before the bad change) from `audit_logs` / application logs.
2. `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier walktogether-production --target-db-instance-identifier walktogether-pitr-<date> --restore-time <ISO8601> ...` (same subnet group, security group, parameter group, KMS key).
3. Verify the restored data (row counts, the specific records), then either copy the affected rows
   back with a reviewed script, or switch `DATABASE_URL` in Secrets Manager to the new instance and
   redeploy.

### Restore from an encrypted dump (disaster)
```bash
BACKUP_FILE=s3://walktogether-production-backups-<acct>/walktogether-<timestamp>.dump.age \
AGE_IDENTITY=/secure/dr-key.txt \
ADMIN_URL=postgres://<admin>@<new-instance>/postgres \
infrastructure/backup/restore-drill.sh      # verifies checksum, decrypts, restores into a scratch DB, checks tables
```
Then restore into the target database with `pg_restore`, run `database-roles.sql`, update secrets,
and deploy the last signed images.

## 5. Testing

| Test | Frequency | Evidence |
| --- | --- | --- |
| Backup → encrypt → checksum → decrypt → restore → verify | Every CI run (`ci.yml`, integration job) | CI log "restore drill passed … restore took Ns" |
| Restore of a real production dump into a scratch instance | Quarterly | Record below |
| PITR restore | Twice a year | Record below |
| Full rebuild in a fresh account from Terraform + dumps | Yearly | Record below |

| Date | Test | Data size | Restore time | Result / issues |
| --- | --- | --- | --- | --- |
| _(first production drill pending — production not yet launched)_ | | | | |

## 6. Known gaps

* No cross-region copy of backups or media yet (single region af-south-1). Planned: S3 replication
  of the backup bucket to eu-west-1 with its own Object Lock, before reaching 10k members.
* Media bucket has versioning but no separate backup.
