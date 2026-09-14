#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$REPO_DIR/infra/compose/docker-compose.yml"
ENV_FILE="$REPO_DIR/infra/compose/.env"
TARGET_REF="${1:-origin/master}"

exec 9>"${TMPDIR:-/tmp}/deco-deploy.lock"
if ! flock -n 9; then
  echo "Another Deco deployment is already running." >&2
  exit 1
fi

cd "$REPO_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ "${DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION:-0}" != "0" &&
      "${DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION:-false}" != "false" ]]; then
  echo "The one-time group-key migration cannot run through automatic rollback." >&2
  echo "Drain old API instances and follow SETUP.md's manual cutover procedure." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Refusing to deploy over tracked local changes." >&2
  exit 1
fi
if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "Refusing to deploy with unexpected untracked files in the Docker build context." >&2
  exit 1
fi

git fetch origin master
TARGET_COMMIT="$(git rev-parse --verify "${TARGET_REF}^{commit}")"
PREVIOUS_COMMIT="$(git rev-parse --verify HEAD)"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

rollback() {
  local exit_status="${1:-$?}"
  trap - ERR
  trap - TERM HUP INT
  echo "Deployment failed; rebuilding previous commit $PREVIOUS_COMMIT." >&2
  git checkout --detach "$PREVIOUS_COMMIT"
  compose build
  compose up -d --wait --wait-timeout 180
  echo "Rollback restored $PREVIOUS_COMMIT." >&2
  exit "$exit_status"
}

POSTGRES_RUNNING="$(compose ps --status running -q postgres)"
MINIO_RUNNING="$(compose ps --status running -q minio)"
if [[ -n "$POSTGRES_RUNNING" && -n "$MINIO_RUNNING" ]]; then
  "$REPO_DIR/backup.sh"
elif docker volume inspect deco_postgres_data >/dev/null 2>&1 ||
     docker volume inspect deco_minio_data >/dev/null 2>&1; then
  echo "Existing data volumes found but Postgres and MinIO are not both running; refusing an unbacked deployment." >&2
  exit 1
else
  echo "No existing Postgres/MinIO pair is running; treating this as first deployment."
fi

trap 'rollback $?' ERR
trap 'rollback 143' TERM
trap 'rollback 129' HUP
trap 'rollback 130' INT
git checkout --detach "$TARGET_COMMIT"
compose build
compose up -d --wait --wait-timeout 180

trap - ERR TERM HUP INT
echo "Deployment healthy at $TARGET_COMMIT."
