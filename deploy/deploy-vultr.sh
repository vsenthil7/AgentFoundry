#!/usr/bin/env bash
# deploy/deploy-vultr.sh
# Run this ON the Vultr host (ssh root@45.77.52.54 first), or it is invoked by
# deploy/deploy-vultr.ps1 from the laptop. Idempotent: clone-or-pull + build + up.
set -euo pipefail

REPO="${REPO:-https://github.com/vsenthil7/AgentFoundry}"
BRANCH="${BRANCH:-main}"
# 8096 is the port this project already runs on (verified live: agentfoundry ->
# 0.0.0.0:8096->8080). 8080/8081/8094/8095/8787/9000-9001/5432/5434 are taken by
# other projects on this shared host. Override with PUBLIC_PORT=... if 8096 ever moves.
PUBLIC_PORT="${PUBLIC_PORT:-8096}"
# The repo is cloned DIRECTLY into SRV_DIR (flat) — that is how this host is laid
# out (/srv/agentfoundry/{backend,web,docker-compose.yml,...}), not a nested
# /srv/agentfoundry/AgentFoundry subfolder.
SRV_DIR="${SRV_DIR:-/srv/agentfoundry}"

echo "==> host: $(hostname) / $(date)"
mkdir -p "$SRV_DIR"

if [ -d "$SRV_DIR/.git" ]; then
  echo "==> existing checkout at $SRV_DIR: pulling latest"
  cd "$SRV_DIR"
  git fetch --all
  git reset --hard "origin/$BRANCH"
else
  echo "==> fresh clone into $SRV_DIR"
  git clone "$REPO" "$SRV_DIR"
  cd "$SRV_DIR"
  git checkout "$BRANCH"
fi

echo "==> verifying port $PUBLIC_PORT is free (or already ours)"
# If something OTHER than our own container holds the port, stop — don't collide.
if ss -tlnp 2>/dev/null | grep -q ":${PUBLIC_PORT} "; then
  if docker compose ps --format '{{.Ports}}' 2>/dev/null | grep -q ":${PUBLIC_PORT}->"; then
    echo "==> port $PUBLIC_PORT is held by this project's own container (expected on redeploy)"
  else
    echo "!! port $PUBLIC_PORT is in use by ANOTHER service. Re-run with PUBLIC_PORT=<free port>." >&2
    echo "   Ports currently listening:" >&2
    ss -tlnp 2>/dev/null | awk 'NR>1{print $4}' | sed 's/.*://' | sort -n | uniq >&2
    exit 1
  fi
fi

echo "==> writing docker-compose.override.yml (public port $PUBLIC_PORT -> 8080, AF_SEED=1)"
cat > docker-compose.override.yml <<EOF
services:
  agentfoundry:
    ports:
      - "${PUBLIC_PORT}:8080"
    environment:
      - AF_SEED=1
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
