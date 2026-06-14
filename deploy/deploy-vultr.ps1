# deploy/deploy-vultr.ps1
# Deploy AgentFoundry to the Vultr host from the Windows laptop.
# Mirrors the pattern already in use on atrio-demo (45.77.52.54), deployed via
# docker compose with a port-remap override. The repo lives FLAT at /srv/agentfoundry.
#
# Usage (PowerShell):
#   .\deploy\deploy-vultr.ps1                      # uses defaults below (port 8096)
#   .\deploy\deploy-vultr.ps1 -Server 45.77.52.54 -PublicPort 8096
#
# Prerequrisites: ssh access as root@<server> (key in ~/.ssh), Docker + Docker
# Compose already installed on the host (they are, per the existing deployments).

param(
  [string]$Server     = "45.77.52.54",
  [string]$User       = "root",
  [string]$Repo       = "https://github.com/vsenthil7/AgentFoundry",
  [string]$Branch     = "main",
  [int]   $PublicPort = 8096,         # the port this project already runs on (verified live); other 80xx/57xx/87xx/90xx ports are taken
  [string]$SrvDir     = "/srv/agentfoundry"
)

$ErrorActionPreference = "Stop"
$target = "$User@$Server"
Write-Host "==> Deploying AgentFoundry to $target  (public port $PublicPort)" -ForegroundColor Cyan

# The remote script does the whole clone/pull + override + build + up, idempotently.
# Note: we pin the container's published port via an override so it never collides
# with the other projects already running on this box.
$remote = @"
set -e
echo '==> host: ' \$(hostname) ' / ' \$(date)
mkdir -p $SrvDir
# The repo lives DIRECTLY in $SrvDir (flat layout: $SrvDir/{backend,web,docker-compose.yml,...}),
# NOT in a nested $SrvDir/AgentFoundry subfolder.
if [ -d $SrvDir/.git ]; then
  echo '==> existing checkout at $SrvDir: pulling latest'
  cd $SrvDir
  git fetch --all
  git reset --hard origin/$Branch
else
  echo '==> fresh clone into $SrvDir'
  git clone $Repo $SrvDir
  cd $SrvDir
  git checkout $Branch
fi

# Refuse to collide: if the port is held by something that is NOT our own container, stop.
if ss -tlnp 2>/dev/null | grep -q ':$PublicPort '; then
  if ! docker compose ps --format '{{.Ports}}' 2>/dev/null | grep -q ':$PublicPort->'; then
    echo '!! port $PublicPort is in use by ANOTHER service on this host. Re-run with -PublicPort <free port>.'
    ss -tlnp 2>/dev/null | awk 'NR>1{print \$4}' | sed 's/.*://' | sort -n | uniq
    exit 1
  fi
  echo '==> port $PublicPort already held by our own container (expected on redeploy)'
fi

echo '==> writing docker-compose.override.yml (public port $PublicPort -> 8080, AF_SEED=1)'
cat > docker-compose.override.yml <<'EOF'
services:
  agentfoundry:
    ports:
      - "$PublicPort`:8080"
    environment:
      - AF_SEED=1
EOF
cat docker-compose.override.yml

echo '==> docker compose up -d --build'
docker compose up -d --build

echo '==> waiting for health'
sleep 5
# /health is behind auth (401 = server alive). Register endpoint should give 400 on empty body.
code=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PublicPort/ || echo 000)
echo "==> GET / -> \$code  (expect 200: web console served)"
reg=\$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:$PublicPort/auth/register -H 'content-type: application/json' -d '{}' || echo 000)
echo "==> POST /auth/register {} -> \$reg  (expect 400: server + auth wired)"

echo '==> running containers:'
docker compose ps
echo '==> DONE. Public URL: http://$Server`:$PublicPort/'
"@

# Pipe the remote script over ssh.
$remote | ssh $target "bash -s"

Write-Host ""
Write-Host "==> AgentFoundry deployed: http://$Server`:$PublicPort/" -ForegroundColor Green
Write-Host "    Open it in a browser, register a tenant admin, and you're in." -ForegroundColor Green
