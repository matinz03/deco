#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH=master
INTERVAL=30

cd "$REPO_DIR"
LAST="$(git rev-parse HEAD)"
FAILED=""
echo "Watching $BRANCH every ${INTERVAL}s; deployed commit is $LAST."

while true; do
  if git fetch origin "$BRANCH" --quiet; then
    CURRENT="$(git rev-parse "origin/$BRANCH")"
    if [[ "$CURRENT" != "$LAST" && "$CURRENT" != "$FAILED" ]]; then
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Deploying $CURRENT..."
      if "$REPO_DIR/deploy.sh" "$CURRENT"; then
        echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Deployment succeeded."
        LAST="$CURRENT"
        FAILED=""
      else
        echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Deployment failed and rollback was attempted." >&2
        FAILED="$CURRENT"
      fi
    fi
  else
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Fetch failed; keeping current deployment." >&2
  fi
  sleep "$INTERVAL"
done
