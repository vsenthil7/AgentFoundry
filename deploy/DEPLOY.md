# Deploying AgentFoundry

AgentFoundry is a single Node service that serves the HTTP API **and** the built
web console on one port (`backend/src/bin-serve.ts`). That makes deployment simple:
one image, one container, one volume for durable data.

## Local run (no Docker)

```
cd web && npm install && npm run build
cd ../backend && npm install && npm run serve
# open http://localhost:8080
```

With durable storage (credentials, sessions, API-audit trail survive restart):

```
# Windows
set AF_DATA=.\data
set PORT=8080
cd backend && npm run serve
```

## Local run (Docker)

```
docker compose up -d --build
# open http://localhost:8080
```

## Deploy to Vultr (shared host 45.77.52.54)

This host runs several projects already, so AgentFoundry publishes on **8096** via a
compose override. The repo lives **flat at `/srv/agentfoundry`** (not a nested subfolder),
and it is **already deployed and running** there — most of the time you only need to
*update* it, not deploy fresh.

### Update the already-running deployment (the common case)

```bash
ssh root@45.77.52.54
cd /srv/agentfoundry
git pull
docker compose up -d --build
docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8096/   # expect 200
```

### Option A — one command from the laptop (PowerShell)

```powershell
.\deploy\deploy-vultr.ps1
# or override the port: .\deploy\deploy-vultr.ps1 -Server 45.77.52.54 -PublicPort 8096
```

This SSHes to `root@45.77.52.54`, clones/pulls **flat into `/srv/agentfoundry`**, writes
the port-remap override (8096 + `AF_SEED=1`), refuses to start if 8096 is held by a
*different* service, runs `docker compose up -d --build`, and smoke-tests the service.

### Option B — interactively on the server

```bash
ssh root@45.77.52.54
curl -fsSL https://raw.githubusercontent.com/vsenthil7/AgentFoundry/main/deploy/deploy-vultr.sh | bash
# or, since the repo is already at /srv/agentfoundry:  cd /srv/agentfoundry && ./deploy/deploy-vultr.sh
```

### Confirm a port before deploying (always worth it on a shared host)

```bash
ss -tlnp                                   # everything listening + owning process
ss -tlnp | grep -E ':8096 '                # is 8096 ours? (agentfoundry should show)
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

### After deploy

Open **http://45.77.52.54:8096/**, click "Register", create a tenant + admin
(tenant id e.g. `acme`, an email, an 8+ char password). You're the admin; you'll
see the admin user panel and the full Golden Thread console.

### Demo mode (populated operator console)

Set `AF_SEED=1` to boot with a populated audit trail, a tripped circuit breaker,
and a ready demo admin (`owner@acme.test` / `demo-password-123`). Useful for a
reviewer who wants to see the operator console with live data immediately rather
than empty panels. Add it to the compose override env or run
`AF_SEED=1 make serve` locally.

## Operations

```bash
cd /srv/agentfoundry
docker compose ps                 # status
docker compose logs -f            # logs
git pull && docker compose up -d --build   # update to latest main
docker compose down               # stop (data volume persists)
```

Durable data lives in the `agentfoundry-data` Docker volume mounted at `/data`
(credential hashes, sessions, the API-call audit trail). Removing the volume
resets the deployment to a clean slate.

## Ports in use on the shared host (verified live 14/06/2026)

| Port | Project |
|------|---------|
| 22 | ssh |
| 1025 / 8025 | atrio-mailhog (smtp / web) |
| 5432 | atrio-postgres |
| 5434 | convergence-db |
| 7880 / 7881 | atrio-livekit |
| 8000 | atrio-api |
| 8080 | atrio-frontend |
| 8081 | spoofvane-web |
| 8094 | stadiumpulse-spm |
| 8095 | convergence-app |
| **8096** | **AgentFoundry (this project)** |
| 8787 | revenuetwin-api |
| 9000 / 9001 | atrio-minio |

To pick a different port if 8096 ever moves, choose one NOT in this list (e.g. 8097+)
and pass it via `-PublicPort` / `PUBLIC_PORT=`.
