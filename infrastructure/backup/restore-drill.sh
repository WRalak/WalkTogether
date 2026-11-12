#!/usr/bin/env bash
# Restore drill: proves a backup can actually be restored. A backup is not considered reliable
# until this has passed for it. Records the measured restore time (RTO evidence).
#
# Mode A — restore a real encrypted backup (production drill):
#   BACKUP_FILE=walktogether-20261112T020000Z.dump.age   # local path or s3://… URL
#   AGE_IDENTITY=/secure/dr-key.txt                       # private key (DR vault)
#   ADMIN_URL=postgres://…/postgres                       # scratch server, never production
#   ./restore-drill.sh
#
# Mode B — dump-and-restore round trip (CI / development):
#   SOURCE_URL=postgres://…/walktogether ADMIN_URL=postgres://…/postgres ./restore-drill.sh
set -euo pipefail
umask 077
: "${ADMIN_URL:?ADMIN_URL is required}"

workdir=$(mktemp -d)
drill="wt_restore_drill_$(date +%s)"
cleanup() { psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $drill" >/dev/null 2>&1 || true; rm -rf "$workdir"; }
trap cleanup EXIT
dump="$workdir/restore.dump"

if [[ -n "${BACKUP_FILE:-}" ]]; then
  : "${AGE_IDENTITY:?AGE_IDENTITY is required to decrypt the backup}"
  src="$BACKUP_FILE"
  if [[ "$src" == s3://* ]]; then
    aws s3 cp "$src" "$workdir/backup.age"
    aws s3 cp "$src.sha256" "$workdir/backup.age.sha256" && (cd "$workdir" && sed "s#  .*#  backup.age#" backup.age.sha256 | sha256sum -c -)
    src="$workdir/backup.age"
  elif [[ -f "$src.sha256" ]]; then
    (cd "$(dirname "$src")" && sha256sum -c "$(basename "$src").sha256")
  fi
  age -d -i "$AGE_IDENTITY" -o "$dump" "$src"
else
  : "${SOURCE_URL:?SOURCE_URL or BACKUP_FILE is required}"
  pg_dump --format=custom --no-owner --no-privileges "$SOURCE_URL" -f "$dump"
fi

psql "$ADMIN_URL" -qc "CREATE DATABASE $drill"
target="${ADMIN_URL%/*}/$drill"
start=$(date +%s)
pg_restore --no-owner --no-privileges --exit-on-error -d "$target" "$dump"
elapsed=$(( $(date +%s) - start ))

migrations=$(psql "$target" -tAc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
[[ "$migrations" -gt 0 ]] || { echo "restored database has no applied migrations" >&2; exit 1; }
for t in users clubs club_memberships activities activity_gps_points payments invoices audit_logs; do
  b=$(psql "$target" -tAc "SELECT count(*) FROM $t")
  if [[ -n "${SOURCE_URL:-}" ]]; then
    a=$(psql "$SOURCE_URL" -tAc "SELECT count(*) FROM $t")
    [[ "$a" == "$b" ]] || { echo "MISMATCH in $t: source $a vs restored $b" >&2; exit 1; }
  fi
  echo "ok $t ($b rows)"
done
echo "restore drill passed: $migrations migrations, restore took ${elapsed}s (RTO evidence)"
