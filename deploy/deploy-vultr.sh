#!/usr/bin/env bash
# deploy/deploy-vultr.sh
# Run this ON the Vultr host (ssh root@45.77.52.54 first), or it is invoked by
# deploy/deploy-vultr.ps1 from the laptop. Idempotent: clone-or-pull + build + up.
set -euo pipefail

REPO="${REPO:-https://github.com/vsenthil7/AgentFoundry}"
BRANCH="${BRANCH:-main}"
PUBLIC_PORT="${PUBLIC_PORT:-8092}"   # 8080/8081/8090/8091 already used on this host
SRV_DIR="${SRV_DIR:-/srv/agentfoundry}"

echo "==> host: $(hostname) / $(date)"
mkdir -p "$SRV_DIR"
cd "$SRV_DIR"

if [ -d AgentFoundry/.git ]; then
  echo "==> existing checkout: pulling latest"
  cd AgentFoundry
  git fetch --all
  git reset --hard "origin/$BRANCH"
else
  echo "==> fresh clone"
  git clone "$REPO" AgentFoundry
  cd AgentFoundry
  git checkout "$BRANCH"
fi

echo "==> writing docker-compose.override.yml (public port $PUBLIC_PORT -> 8080)"
cat > docker-compose.override.yml <<EOF
services:
  agentfoundry:
    ports:
      - "${PUBLIC_PORT}:8080"
EOF
cat docker-compose.override.yml

echo "==> docker compose up -d --build"
docker compose up -d --build

echo "==> waiting for health"
sleep 5
code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${PUBLIC_PORT}/" || echo 000)
echo "==> GET / -> $code  (expect 200: web console served)"
reg=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:${PUBLIC_PORT}/auth/register" -H 'content-type: application/json' -d '{}' || echo 000)
echo "==> POST /auth/register {} -> $reg  (expect 400: server + auth wired)"

echo "==> running containers:"
docker compose ps
PUBIP=$(curl -s ifconfig.me || echo "<server-ip>")
echo "==> DONE. Public URL: http://${PUBIP}:${PUBLIC_PORT}/"
