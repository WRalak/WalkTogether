#!/usr/bin/env bash
# Encrypted logical backup of the WalkTogether database (complements RDS snapshots / PITR).
# Usage: DATABASE_URL=... BACKUP_BUCKET=s3://bucket/path AGE_RECIPIENT=age1... ./backup.sh
set -euo pipefail
ts=$(date -u +%Y%m%dT%H%M%SZ)
file="walktogether-${ts}.dump"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" -f "$file"
if [[ -n "${AGE_RECIPIENT:-}" ]]; then age -r "$AGE_RECIPIENT" -o "$file.age" "$file" && rm "$file" && file="$file.age"; fi
if [[ -n "${BACKUP_BUCKET:-}" ]]; then aws s3 cp "$file" "$BACKUP_BUCKET/$file" --sse AES256; fi
echo "backup written: $file"
