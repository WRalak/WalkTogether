#!/usr/bin/env bash
# Encrypted logical backup of the WalkTogether database (complements RDS automated snapshots + PITR).
#
#   DATABASE_URL=postgres://...?sslmode=require \
#   AGE_RECIPIENT=age1...            # public key; the private key lives offline / in the DR vault
#   BACKUP_BUCKET=s3://wt-backups-prod/logical \
#   BACKUP_KMS_KEY_ID=arn:aws:kms:...  # optional: SSE-KMS on top of client-side encryption
#   ./backup.sh
#
# Plaintext never leaves this machine: the dump is encrypted with age before upload, a SHA-256
# checksum is uploaded alongside, and the plaintext file is removed even if a step fails.
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
if [[ -z "${AGE_RECIPIENT:-}" ]]; then
  echo "AGE_RECIPIENT is required: refusing to create an unencrypted backup" >&2
  exit 2
fi

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
ts=$(date -u +%Y%m%dT%H%M%SZ)
plain="$workdir/walktogether-${ts}.dump"
enc="$plain.age"

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" -f "$plain"
age -r "$AGE_RECIPIENT" -o "$enc" "$plain"
rm -f "$plain"
(cd "$workdir" && sha256sum "$(basename "$enc")" > "$(basename "$enc").sha256")

if [[ -n "${BACKUP_BUCKET:-}" ]]; then
  sse=(--sse AES256)
  [[ -n "${BACKUP_KMS_KEY_ID:-}" ]] && sse=(--sse aws:kms --sse-kms-key-id "$BACKUP_KMS_KEY_ID")
  aws s3 cp "$enc" "$BACKUP_BUCKET/$(basename "$enc")" "${sse[@]}"
  aws s3 cp "$enc.sha256" "$BACKUP_BUCKET/$(basename "$enc").sha256" "${sse[@]}"
  echo "backup uploaded: $BACKUP_BUCKET/$(basename "$enc")"
else
  dest="${BACKUP_DIR:-.}"
  mv "$enc" "$enc.sha256" "$dest/"
  echo "backup written: $dest/$(basename "$enc")"
fi
