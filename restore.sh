#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$REPO_DIR/infra/compose/docker-compose.yml"
ENV_FILE="$REPO_DIR/infra/compose/.env"
SNAPSHOT="${1:-}"
TOOL_IMAGE="pgvector/pgvector:pg17"

exec 9>"${TMPDIR:-/tmp}/deco-deploy.lock"
exec 8>"${TMPDIR:-/tmp}/deco-backup.lock"
if ! flock -n 9 || ! flock -n 8; then
  echo "Another Deco deploy, backup, or restore is already running." >&2
  exit 1
fi
if [[ -z "$SNAPSHOT" || ! "$SNAPSHOT" =~ ^[A-Za-z0-9._-]+$ || "$SNAPSHOT" == *..* ]]; then
  echo "Usage: CONFIRM_RESTORE=<snapshot> ./restore.sh <snapshot>" >&2
  exit 1
fi
if [[ "${CONFIRM_RESTORE:-}" != "$SNAPSHOT" ]]; then
  echo "Restore replaces the live database and all media." >&2
  echo "Set CONFIRM_RESTORE=$SNAPSHOT to continue." >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required=(
  BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY
  BACKUP_S3_BUCKET MINIO_ROOT_USER MINIO_ROOT_PASSWORD
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required to restore an off-host backup." >&2
    exit 1
  fi
done
if [[ "$BACKUP_S3_ENDPOINT" != https://* && "${BACKUP_ALLOW_INSECURE:-0}" != "1" ]]; then
  echo "BACKUP_S3_ENDPOINT must use HTTPS (or explicitly set BACKUP_ALLOW_INSECURE=1)." >&2
  exit 1
fi

BACKUP_PREFIX="${BACKUP_S3_PREFIX:-deco}"
PUBLIC_BUCKET="${STORAGE_PUBLIC_BUCKET:-deco-public}"
PRIVATE_BUCKET="${STORAGE_PRIVATE_BUCKET:-deco-private}"
if [[ ! "$BACKUP_PREFIX" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$ || "$BACKUP_PREFIX" == *..* ]] ||
   [[ ! "$BACKUP_S3_BUCKET" =~ ^[A-Za-z0-9.-]+$ ]] ||
   [[ ! "$PUBLIC_BUCKET" =~ ^[A-Za-z0-9.-]+$ ]] ||
   [[ ! "$PRIVATE_BUCKET" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid backup prefix or bucket name." >&2
  exit 1
fi

RESTORE_SUFFIX="$(date -u +%Y%m%d%H%M%S)"
RESTORE_DB="deco_restore_$RESTORE_SUFFIX"
OLD_DB="deco_before_restore_$RESTORE_SUFFIX"
NEW_UPLOADS_VOLUME="deco_uploads_restore_$RESTORE_SUFFIX"
OLD_UPLOADS_VOLUME="deco_uploads_before_restore_$RESTORE_SUFFIX"
NEW_PUBLIC_BUCKET="deco-restore-public-$RESTORE_SUFFIX"
NEW_PRIVATE_BUCKET="deco-restore-private-$RESTORE_SUFFIX"
OLD_PUBLIC_BUCKET="deco-before-public-$RESTORE_SUFFIX"
OLD_PRIVATE_BUCKET="deco-before-private-$RESTORE_SUFFIX"
STAGING="$(mktemp -d)"
REMOTE_ROOT="offsite/$BACKUP_S3_BUCKET/$BACKUP_PREFIX/$SNAPSHOT"

APP_STOPPED=0
OLD_DB_RENAMED=0
DB_SWAPPED=0
MEDIA_MUTATED=0

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

copy_volume() {
  local source_volume="$1"
  local target_volume="$2"
  docker run --rm --volume "$source_volume:/source:ro" --volume "$target_volume:/target" \
    "$TOOL_IMAGE" /bin/sh -c 'tar -C /source -cf - . | tar -C /target -xf -'
}

replace_volume() {
  local source_volume="$1"
  local target_volume="$2"
  docker run --rm --volume "$source_volume:/source:ro" --volume "$target_volume:/target" \
    "$TOOL_IMAGE" /bin/sh -c \
    'find /target -mindepth 1 -delete && tar -C /source -cf - . | tar -C /target -xf -'
}

copy_bucket() {
  local source_bucket="$1"
  local target_bucket="$2"
  compose exec -T minio mc cp --recursive --preserve \
    "local/$source_bucket/" "local/$target_bucket/"
}

replace_bucket() {
  local source_bucket="$1"
  local target_bucket="$2"
  compose exec -T minio mc rm --recursive --force "local/$target_bucket/" >/dev/null
  copy_bucket "$source_bucket" "$target_bucket"
}

remove_temp_resources() {
  set +e
  compose exec -T minio mc rm --recursive --force "local/$NEW_PUBLIC_BUCKET/" >/dev/null 2>&1
  compose exec -T minio mc rm --recursive --force "local/$NEW_PRIVATE_BUCKET/" >/dev/null 2>&1
  compose exec -T minio mc rm --recursive --force "local/$OLD_PUBLIC_BUCKET/" >/dev/null 2>&1
  compose exec -T minio mc rm --recursive --force "local/$OLD_PRIVATE_BUCKET/" >/dev/null 2>&1
  compose exec -T minio mc rb --force "local/$NEW_PUBLIC_BUCKET" >/dev/null 2>&1
  compose exec -T minio mc rb --force "local/$NEW_PRIVATE_BUCKET" >/dev/null 2>&1
  compose exec -T minio mc rb --force "local/$OLD_PUBLIC_BUCKET" >/dev/null 2>&1
  compose exec -T minio mc rb --force "local/$OLD_PRIVATE_BUCKET" >/dev/null 2>&1
  docker volume rm "$NEW_UPLOADS_VOLUME" >/dev/null 2>&1
  docker volume rm "$OLD_UPLOADS_VOLUME" >/dev/null 2>&1
  set -e
}

cleanup_files() {
  rm -f -- "$STAGING/postgres.dump" "$STAGING/uploads.tar.gz" "$STAGING/manifest.txt" \
    "$STAGING/public.inventory.jsonl" "$STAGING/private.inventory.jsonl" \
    "$STAGING/public.current.jsonl" "$STAGING/private.current.jsonl"
  rmdir -- "$STAGING"
}

rollback() {
  local exit_status="${1:-$?}"
  trap - ERR
  trap - TERM HUP INT
  set +e
  echo "Restore failed; rolling back database and media." >&2
  if [[ "$MEDIA_MUTATED" == "1" ]]; then
    replace_volume "$OLD_UPLOADS_VOLUME" deco_uploads_data
    replace_bucket "$OLD_PUBLIC_BUCKET" "$PUBLIC_BUCKET"
    replace_bucket "$OLD_PRIVATE_BUCKET" "$PRIVATE_BUCKET"
    compose exec -T minio mc rm --force "local/$PUBLIC_BUCKET/.deco-restore-marker" >/dev/null 2>&1
    compose exec -T minio mc rm --force "local/$PRIVATE_BUCKET/.deco-restore-marker" >/dev/null 2>&1
  fi
  if [[ "$DB_SWAPPED" == "1" ]]; then
    compose exec -T postgres psql -U deco -d postgres \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='deco' AND pid <> pg_backend_pid()" >/dev/null
    compose exec -T postgres dropdb -U deco --if-exists deco
  fi
  if [[ "$OLD_DB_RENAMED" == "1" ]]; then
    compose exec -T postgres psql -U deco -d postgres -v ON_ERROR_STOP=1 \
      -c "ALTER DATABASE $OLD_DB RENAME TO deco"
  fi
  if [[ "$APP_STOPPED" == "1" ]]; then
    compose up -d --wait --wait-timeout 180
  fi
  echo "Rollback attempted; inspect service health and retained temporary resources." >&2
  exit "$exit_status"
}

trap cleanup_files EXIT

compose exec -T minio mc alias set local \
  http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
compose exec -T minio mc alias set offsite \
  "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null

compose exec -T minio mc cat "$REMOTE_ROOT/postgres.dump" >"$STAGING/postgres.dump"
compose exec -T minio mc cat "$REMOTE_ROOT/uploads.tar.gz" >"$STAGING/uploads.tar.gz"
compose exec -T minio mc cat "$REMOTE_ROOT/manifest.txt" >"$STAGING/manifest.txt"
compose exec -T minio mc cat "$REMOTE_ROOT/public.inventory.jsonl" >"$STAGING/public.inventory.jsonl"
compose exec -T minio mc cat "$REMOTE_ROOT/private.inventory.jsonl" >"$STAGING/private.inventory.jsonl"

EXPECTED_DB_SHA="$(awk -F= '$1 == "postgres_sha256" {print $2}' "$STAGING/manifest.txt")"
EXPECTED_UPLOADS_SHA="$(awk -F= '$1 == "uploads_sha256" {print $2}' "$STAGING/manifest.txt")"
ACTUAL_DB_SHA="$(sha256sum "$STAGING/postgres.dump" | awk '{print $1}')"
ACTUAL_UPLOADS_SHA="$(sha256sum "$STAGING/uploads.tar.gz" | awk '{print $1}')"
if [[ -z "$EXPECTED_DB_SHA" || "$ACTUAL_DB_SHA" != "$EXPECTED_DB_SHA" ||
      -z "$EXPECTED_UPLOADS_SHA" || "$ACTUAL_UPLOADS_SHA" != "$EXPECTED_UPLOADS_SHA" ]]; then
  echo "Backup checksum mismatch; refusing restore." >&2
  exit 1
fi

MANIFEST_PUBLIC_BUCKET="$(awk -F= '$1 == "public_bucket" {print $2}' "$STAGING/manifest.txt")"
MANIFEST_PRIVATE_BUCKET="$(awk -F= '$1 == "private_bucket" {print $2}' "$STAGING/manifest.txt")"
if [[ "$MANIFEST_PUBLIC_BUCKET" != "$PUBLIC_BUCKET" || "$MANIFEST_PRIVATE_BUCKET" != "$PRIVATE_BUCKET" ]]; then
  echo "Backup bucket names do not match current storage configuration." >&2
  exit 1
fi

EXPECTED_PUBLIC_INVENTORY_SHA="$(awk -F= '$1 == "public_inventory_sha256" {print $2}' "$STAGING/manifest.txt")"
EXPECTED_PRIVATE_INVENTORY_SHA="$(awk -F= '$1 == "private_inventory_sha256" {print $2}' "$STAGING/manifest.txt")"
SAVED_PUBLIC_INVENTORY_SHA="$(sha256sum "$STAGING/public.inventory.jsonl" | awk '{print $1}')"
SAVED_PRIVATE_INVENTORY_SHA="$(sha256sum "$STAGING/private.inventory.jsonl" | awk '{print $1}')"
compose exec -T minio mc ls --recursive --json \
  "$REMOTE_ROOT/minio/$PUBLIC_BUCKET/" >"$STAGING/public.current.jsonl"
compose exec -T minio mc ls --recursive --json \
  "$REMOTE_ROOT/minio/$PRIVATE_BUCKET/" >"$STAGING/private.current.jsonl"
CURRENT_PUBLIC_INVENTORY_SHA="$(sha256sum "$STAGING/public.current.jsonl" | awk '{print $1}')"
CURRENT_PRIVATE_INVENTORY_SHA="$(sha256sum "$STAGING/private.current.jsonl" | awk '{print $1}')"
if [[ -z "$EXPECTED_PUBLIC_INVENTORY_SHA" || -z "$EXPECTED_PRIVATE_INVENTORY_SHA" ||
      "$SAVED_PUBLIC_INVENTORY_SHA" != "$EXPECTED_PUBLIC_INVENTORY_SHA" ||
      "$SAVED_PRIVATE_INVENTORY_SHA" != "$EXPECTED_PRIVATE_INVENTORY_SHA" ||
      "$CURRENT_PUBLIC_INVENTORY_SHA" != "$EXPECTED_PUBLIC_INVENTORY_SHA" ||
      "$CURRENT_PRIVATE_INVENTORY_SHA" != "$EXPECTED_PRIVATE_INVENTORY_SHA" ]]; then
  echo "Object-store inventory mismatch; refusing restore." >&2
  exit 1
fi

echo "Pre-staging restored database and media..."
compose exec -T postgres createdb -U deco -O deco "$RESTORE_DB"
if ! compose exec -T postgres pg_restore -U deco -d "$RESTORE_DB" \
  --no-owner --no-acl --single-transaction --exit-on-error <"$STAGING/postgres.dump"; then
  compose exec -T postgres dropdb -U deco --if-exists "$RESTORE_DB"
  echo "Transactional staging restore failed; live data was not touched." >&2
  exit 1
fi
if ! compose exec -T postgres psql -U deco -d "$RESTORE_DB" -v ON_ERROR_STOP=1 -Atc \
  "SELECT to_regclass('public.users') IS NOT NULL AND to_regclass('public.conversations') IS NOT NULL AND to_regclass('public.messages') IS NOT NULL" | grep -qx t; then
  compose exec -T postgres dropdb -U deco --if-exists "$RESTORE_DB"
  echo "Staging database validation failed; live data was not touched." >&2
  exit 1
fi

docker volume create "$NEW_UPLOADS_VOLUME" >/dev/null
docker run --rm -i --volume "$NEW_UPLOADS_VOLUME:/data" "$TOOL_IMAGE" \
  tar -C /data -xzf - <"$STAGING/uploads.tar.gz"
for bucket in "$NEW_PUBLIC_BUCKET" "$NEW_PRIVATE_BUCKET"; do
  compose exec -T minio mc mb --ignore-existing "local/$bucket" >/dev/null
done
compose exec -T minio mc cp --recursive --preserve \
  "$REMOTE_ROOT/minio/$PUBLIC_BUCKET/" "local/$NEW_PUBLIC_BUCKET/"
compose exec -T minio mc cp --recursive --preserve \
  "$REMOTE_ROOT/minio/$PRIVATE_BUCKET/" "local/$NEW_PRIVATE_BUCKET/"

echo "Pre-stage complete. Stopping application services for cutover..."
APP_STOPPED=1
trap 'rollback $?' ERR
trap 'rollback 143' TERM
trap 'rollback 129' HUP
trap 'rollback 130' INT
compose stop api web

docker volume create "$OLD_UPLOADS_VOLUME" >/dev/null
copy_volume deco_uploads_data "$OLD_UPLOADS_VOLUME"
for bucket in "$OLD_PUBLIC_BUCKET" "$OLD_PRIVATE_BUCKET"; do
  compose exec -T minio mc mb --ignore-existing "local/$bucket" >/dev/null
done
copy_bucket "$PUBLIC_BUCKET" "$OLD_PUBLIC_BUCKET"
copy_bucket "$PRIVATE_BUCKET" "$OLD_PRIVATE_BUCKET"
printf 'Deco restore rollback marker\n' | compose exec -T minio mc pipe \
  "local/$OLD_PUBLIC_BUCKET/.deco-restore-marker" >/dev/null
printf 'Deco restore rollback marker\n' | compose exec -T minio mc pipe \
  "local/$OLD_PRIVATE_BUCKET/.deco-restore-marker" >/dev/null

compose exec -T postgres psql -U deco -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='deco' AND pid <> pg_backend_pid()" >/dev/null
compose exec -T postgres psql -U deco -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE deco RENAME TO $OLD_DB"
OLD_DB_RENAMED=1
compose exec -T postgres psql -U deco -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE $RESTORE_DB RENAME TO deco"
DB_SWAPPED=1

MEDIA_MUTATED=1
replace_volume "$NEW_UPLOADS_VOLUME" deco_uploads_data
replace_bucket "$NEW_PUBLIC_BUCKET" "$PUBLIC_BUCKET"
replace_bucket "$NEW_PRIVATE_BUCKET" "$PRIVATE_BUCKET"
compose exec -T minio mc rm --force "local/$PUBLIC_BUCKET/.deco-backup-marker" >/dev/null
compose exec -T minio mc rm --force "local/$PRIVATE_BUCKET/.deco-backup-marker" >/dev/null

compose up -d --wait --wait-timeout 180
APP_STOPPED=0
trap - ERR TERM HUP INT

compose exec -T postgres dropdb -U deco --if-exists "$OLD_DB"
OLD_DB_RENAMED=0
compose exec -T postgres dropdb -U deco --if-exists "$RESTORE_DB"
remove_temp_resources
cleanup_files
trap - EXIT
echo "Restore complete and services healthy: $SNAPSHOT"
