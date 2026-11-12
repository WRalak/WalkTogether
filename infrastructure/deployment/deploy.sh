#!/usr/bin/env bash
# Runs ON the application host (invoked by GitHub Actions through AWS SSM Run Command — the host has
# no inbound SSH). Deploys exactly the image digests that CI built, scanned and signed.
#
#   deploy.sh <environment> <api-image@sha256:…> <platform-admin-image@sha256:…>
#
# 1. Refuses anything that is not pinned by digest.
# 2. Verifies each image's Cosign signature (keyless, GitHub OIDC identity of this repository's
#    deploy workflow) before it can run.
# 3. Renders secrets from AWS Secrets Manager into root-owned 0600 env files (never on disk in git).
# 4. Runs migrations, rolls the stack, waits for health; on failure re-deploys the previous digests.
set -euo pipefail
umask 077

ENVIRONMENT="${1:?environment}"
API_IMAGE="${2:?api image digest}"
ADMIN_IMAGE="${3:?platform-admin image digest}"
REPO_DIR="${REPO_DIR:-/opt/walktogether}"
STATE_DIR=/var/lib/walktogether
ENV_DIR=/etc/walktogether
SIGNER_REPO="${SIGNER_REPO:-WRalak/WalkTogether}"
AWS_REGION="${AWS_REGION:-af-south-1}"

for img in "$API_IMAGE" "$ADMIN_IMAGE"; do
  [[ "$img" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "refusing to deploy a mutable tag: $img" >&2; exit 2; }
  cosign verify "$img" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --certificate-identity-regexp "^https://github.com/${SIGNER_REPO}/\.github/workflows/deploy-(staging|production)\.yml@refs/" \
    >/dev/null || { echo "signature verification failed for $img" >&2; exit 3; }
done

render_secret() { # secret-id → env file (key=value per JSON field)
  aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$1" --query SecretString --output text |
    python3 -c 'import json,sys; [print(f"{k}={v}") for k,v in json.load(sys.stdin).items()]' > "$2.tmp"
  chmod 600 "$2.tmp" && mv "$2.tmp" "$2"
}
install -d -m 700 "$ENV_DIR" "$STATE_DIR"
render_secret "walktogether/${ENVIRONMENT}/api" "$ENV_DIR/api.env"
render_secret "walktogether/${ENVIRONMENT}/migrate" "$ENV_DIR/migrate.env"

compose() { docker compose -f "$REPO_DIR/infrastructure/docker/docker-compose.yml" --env-file "$ENV_DIR/compose.env" "$@"; }
apply() {
  printf 'WT_API_IMAGE=%s\nWT_PLATFORM_ADMIN_IMAGE=%s\n' "$1" "$2" > "$ENV_DIR/compose.env"
  compose pull --quiet
  compose run --rm migrate
  compose up -d --remove-orphans api worker platform-admin clamav nginx
}
healthy() {
  for _ in $(seq 1 30); do
    if compose exec -T api node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then return 0; fi
    sleep 5
  done
  return 1
}

previous=""
[[ -f "$STATE_DIR/current" ]] && previous=$(cat "$STATE_DIR/current")
apply "$API_IMAGE" "$ADMIN_IMAGE"
if healthy; then
  printf '%s %s\n' "$API_IMAGE" "$ADMIN_IMAGE" > "$STATE_DIR/current"
  echo "deployed $API_IMAGE"
else
  echo "health check failed — rolling back" >&2
  if [[ -n "$previous" ]]; then
    # shellcheck disable=SC2086
    apply $previous && healthy && echo "rolled back to $previous" >&2
  fi
  exit 4
fi
