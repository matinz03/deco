#!/bin/bash
# Polls GitHub every 30s and runs deploy.sh when new commits appear on master.

REPO_DIR=~/deco
BRANCH=master
INTERVAL=30

echo "Watching $BRANCH for changes every ${INTERVAL}s... (Ctrl+C to stop)"

cd "$REPO_DIR"
LAST=$(git rev-parse origin/$BRANCH)

while true; do
  git fetch origin $BRANCH --quiet 2>/dev/null
  CURRENT=$(git rev-parse origin/$BRANCH)

  if [ "$CURRENT" != "$LAST" ]; then
    echo "[$(date '+%H:%M:%S')] New commit detected: $CURRENT — deploying..."
    bash ~/deco/deploy.sh
    LAST=$CURRENT
    echo "[$(date '+%H:%M:%S')] Deploy done. Watching for next change..."
  fi

  sleep $INTERVAL
done
