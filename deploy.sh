#!/bin/bash
set -e

cd ~/deco
git pull origin main
docker compose -f infra/compose/docker-compose.yml build
docker compose -f infra/compose/docker-compose.yml up -d

echo "Done. Checking health..."
sleep 3
curl -s http://localhost:8080/health
