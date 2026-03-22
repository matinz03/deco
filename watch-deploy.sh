#!/bin/bash
# Polls GitHub every 30s and runs deploy.sh when new commits appear on master.

REPO_DIR=~/deco
BRANCH=master
INTERVAL=5

echo "Watching $BRANCH for changes every ${INTERVAL}s... (Ctrl+C to stop)"

cd "$REPO_DIR"
LAST=$(git rev-parse origin/$BRANCH)

while true; do
  git fetch origin $BRANCH --quiet 2>/dev/null
  CURRENT=$(git rev-parse origin/$BRANCH)

  if [ "$CURRENT" != "$LAST" ]; then
    echo "[$(date '+%H:%M:%S')] New commit detected: $CURRENT — deploying..."
    if bash ~/deco/deploy.sh; then
      echo "[$(date '+%H:%M:%S')] Deploy succeeded."
    else
      echo "[$(date '+%H:%M:%S')] Deploy FAILED — check logs above."
    fi
    LAST=$CURRENT
    echo "[$(date '+%H:%M:%S')] Watching for next change..."
  fi

  sleep $INTERVAL
done
