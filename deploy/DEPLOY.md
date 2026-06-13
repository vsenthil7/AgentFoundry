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

This host already runs other projects on 8080/8081/8090/8091 and Postgres on
5432/5433, so AgentFoundry publishes on **8092** via a compose override (the same
pattern PitchProof used with 8090/8091).

### Option A — one command from the laptop (PowerShell)

```powershell
.\deploy\deploy-vultr.ps1
# or override: .\deploy\deploy-vultr.ps1 -Server 45.77.52.54 -PublicPort 8092
```

This SSHes to `root@45.77.52.54`, clones/pulls into `/srv/agentfoundry/AgentFoundry`,
writes the port-remap override, runs `docker compose up -d --build`, and smoke-tests
the running service.

### Option B — interactively on the server

```bash
ssh root@45.77.52.54
curl -fsSL https://raw.githubusercontent.com/vsenthil7/AgentFoundry/main/deploy/deploy-vultr.sh | bash
# or clone first and run ./deploy/deploy-vultr.sh
```

### After deploy

Open **http://45.77.52.54:8092/**, click "Register", create a tenant + admin
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
cd /srv/agentfoundry/AgentFoundry
docker compose ps                 # status
docker compose logs -f            # logs
docker compose pull && docker compose up -d --build   # update to latest main
docker compose down               # stop (data volume persists)
```

Durable data lives in the `agentfoundry-data` Docker volume mounted at `/data`
(credential hashes, sessions, the API-call audit trail). Removing the volume
resets the deployment to a clean slate.

## Ports in use on the shared host (for reference)

| Port | Project |
|------|---------|
| 8000 / 8081 | atrio / spoofvane-web |
| 8080 | atrio-frontend |
| 8090 / 8091 / 5433 | pitchproof (web / api / db) |
| 5432 | shared postgres |
| **8092** | **AgentFoundry (this project)** |
