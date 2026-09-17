#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$REPO_DIR/infra/compose/docker-compose.yml"
ENV_FILE="$REPO_DIR/infra/compose/.env"

exec 8>"${TMPDIR:-/tmp}/deco-backup.lock"
if ! flock -n 8; then
  echo "Another Deco backup or restore is already running." >&2
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
    echo "$name is required for off-host backups." >&2
    exit 1
  fi
done

if [[ "$BACKUP_S3_ENDPOINT" != https://* && "${BACKUP_ALLOW_INSECURE:-0}" != "1" ]]; then
  echo "BACKUP_S3_ENDPOINT must use HTTPS (or explicitly set BACKUP_ALLOW_INSECURE=1)." >&2
  exit 1
fi

BACKUP_PREFIX="${BACKUP_S3_PREFIX:-deco}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
PUBLIC_BUCKET="${STORAGE_PUBLIC_BUCKET:-deco-public}"
PRIVATE_BUCKET="${STORAGE_PRIVATE_BUCKET:-deco-private}"
if [[ ! "$BACKUP_PREFIX" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$ || "$BACKUP_PREFIX" == *..* ]] ||
   [[ ! "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] ||
   [[ ! "$BACKUP_S3_BUCKET" =~ ^[A-Za-z0-9.-]+$ ]] ||
   [[ ! "$PUBLIC_BUCKET" =~ ^[A-Za-z0-9.-]+$ ]] ||
   [[ ! "$PRIVATE_BUCKET" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Invalid backup prefix or retention period." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMMIT="$(git -C "$REPO_DIR" rev-parse --verify HEAD)"
SNAPSHOT="$BACKUP_PREFIX/$STAMP-$COMMIT"
STAGING="$(mktemp -d)"
cleanup() {
  rm -f -- "$STAGING/postgres.dump" "$STAGING/uploads.tar.gz" "$STAGING/manifest.txt" \
    "$STAGING/public.inventory.jsonl" "$STAGING/private.inventory.jsonl"
  rmdir -- "$STAGING"
}
trap cleanup EXIT

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Creating PostgreSQL dump for $SNAPSHOT..."
compose exec -T postgres pg_dump -U deco -d deco --format=custom --no-owner --no-acl >"$STAGING/postgres.dump"
test -s "$STAGING/postgres.dump"
DB_SHA256="$(sha256sum "$STAGING/postgres.dump" | awk '{print $1}')"
docker run --rm --volume deco_uploads_data:/data:ro pgvector/pgvector:pg17 \
  tar -C /data -czf - . >"$STAGING/uploads.tar.gz"
UPLOADS_SHA256="$(sha256sum "$STAGING/uploads.tar.gz" | awk '{print $1}')"

compose exec -T minio mc alias set local \
  http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
compose exec -T minio mc alias set offsite \
  "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" >/dev/null
compose exec -T minio mc mb --ignore-existing "offsite/$BACKUP_S3_BUCKET" >/dev/null

REMOTE_ROOT="offsite/$BACKUP_S3_BUCKET/$SNAPSHOT"
compose exec -T minio mc pipe "$REMOTE_ROOT/postgres.dump" <"$STAGING/postgres.dump" >/dev/null
compose exec -T minio mc pipe "$REMOTE_ROOT/uploads.tar.gz" <"$STAGING/uploads.tar.gz" >/dev/null
compose exec -T minio mc mb --ignore-existing "local/$PUBLIC_BUCKET" >/dev/null
compose exec -T minio mc mb --ignore-existing "local/$PRIVATE_BUCKET" >/dev/null
compose exec -T minio mc cp --recursive --preserve \
  "local/$PUBLIC_BUCKET/" "$REMOTE_ROOT/minio/$PUBLIC_BUCKET/"
compose exec -T minio mc cp --recursive --preserve \
  "local/$PRIVATE_BUCKET/" "$REMOTE_ROOT/minio/$PRIVATE_BUCKET/"
printf 'Deco backup bucket marker\n' | compose exec -T minio mc pipe \
  "$REMOTE_ROOT/minio/$PUBLIC_BUCKET/.deco-backup-marker" >/dev/null
printf 'Deco backup bucket marker\n' | compose exec -T minio mc pipe \
  "$REMOTE_ROOT/minio/$PRIVATE_BUCKET/.deco-backup-marker" >/dev/null
compose exec -T minio mc ls --recursive --json \
  "$REMOTE_ROOT/minio/$PUBLIC_BUCKET/" >"$STAGING/public.inventory.jsonl"
compose exec -T minio mc ls --recursive --json \
  "$REMOTE_ROOT/minio/$PRIVATE_BUCKET/" >"$STAGING/private.inventory.jsonl"
PUBLIC_INVENTORY_SHA256="$(sha256sum "$STAGING/public.inventory.jsonl" | awk '{print $1}')"
PRIVATE_INVENTORY_SHA256="$(sha256sum "$STAGING/private.inventory.jsonl" | awk '{print $1}')"
compose exec -T minio mc pipe "$REMOTE_ROOT/public.inventory.jsonl" \
  <"$STAGING/public.inventory.jsonl" >/dev/null
compose exec -T minio mc pipe "$REMOTE_ROOT/private.inventory.jsonl" \
  <"$STAGING/private.inventory.jsonl" >/dev/null

cat >"$STAGING/manifest.txt" <<EOF
created_utc=$STAMP
git_commit=$COMMIT
postgres_sha256=$DB_SHA256
uploads_sha256=$UPLOADS_SHA256
public_bucket=$PUBLIC_BUCKET
private_bucket=$PRIVATE_BUCKET
public_inventory_sha256=$PUBLIC_INVENTORY_SHA256
private_inventory_sha256=$PRIVATE_INVENTORY_SHA256
EOF
compose exec -T minio mc pipe "$REMOTE_ROOT/manifest.txt" <"$STAGING/manifest.txt" >/dev/null
compose exec -T minio mc stat "$REMOTE_ROOT/postgres.dump" >/dev/null
compose exec -T minio mc stat "$REMOTE_ROOT/uploads.tar.gz" >/dev/null
compose exec -T minio mc stat "$REMOTE_ROOT/manifest.txt" >/dev/null
compose exec -T minio mc stat "$REMOTE_ROOT/public.inventory.jsonl" >/dev/null
compose exec -T minio mc stat "$REMOTE_ROOT/private.inventory.jsonl" >/dev/null

compose exec -T minio mc rm --recursive --force --older-than "${RETENTION_DAYS}d" \
  "offsite/$BACKUP_S3_BUCKET/$BACKUP_PREFIX/" >/dev/null

echo "Off-host backup complete: s3://$BACKUP_S3_BUCKET/$SNAPSHOT"
