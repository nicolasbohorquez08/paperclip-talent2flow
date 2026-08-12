# Paperclip Local Development Setup Guide

This guide documents the exact, verified steps to run **Paperclip** locally in a development environment using an external PostgreSQL database running inside a Docker container.

This document is formatted for both **human developers** and **AI agents** to execute reliably.

---

## Step 0: Clone the Repository

> **Note**: This repository is private. Ensure you or your AI agent have appropriate GitHub access permissions (SSH key or Personal Access Token configured) before proceeding.

Clone the repository and checkout the `vendor/talent2flow` branch:

```bash
git clone -b vendor/talent2flow git@github.com:nicolasbohorquez08/paperclip-talent2flow.git
cd paperclip-talent2flow
```

* **Why `vendor/talent2flow`?** This branch contains the custom Talent2flow patches and configuration tailored for this development setup.

---

## Environment & Prerequisites

Before running Paperclip, verify the runtime environment meets the following versions:

1. **Node.js**: Requires version `>= 20`
   ```bash
   node -v
   # Output verified: v24.16.0
   ```
2. **pnpm**: Requires version `>= 9`
   ```bash
   pnpm -v
   # Output verified: 9.15.4
   ```
3. **Docker Desktop / Docker Daemon**: Must be active.
   - If the Docker daemon is not running on macOS, start Docker Desktop:
     ```bash
     open -a Docker
     ```
   - Verify Docker daemon readiness:
     ```bash
     docker ps
     ```

---

## Step 1: Start the PostgreSQL Database Container

Paperclip uses a PostgreSQL 17 database defined in `docker/docker-compose.yml`.

### 1.1 Launch the `db` Service
Run `docker compose` for the `db` service specifically. Note that `docker compose` validates environment variables across the compose file, so a dummy or generated `BETTER_AUTH_SECRET` must be passed inline:

```bash
BETTER_AUTH_SECRET=$(openssl rand -hex 32) docker compose -f docker/docker-compose.yml up -d db
```

* **Why inline `BETTER_AUTH_SECRET`?** Docker Compose parses variable references for all services in `docker-compose.yml` (including `server` which requires `BETTER_AUTH_SECRET`) before starting the target container (`db`).

### 1.2 Resolve Port 5432 Conflicts (If Applicable)
If a local PostgreSQL instance (e.g. Homebrew `postgresql@15`) is running on the host machine, it will conflict with Docker's port mapping (`0.0.0.0:5432`).

* **Check port binding:**
  ```bash
  lsof -i :5432
  ```
* **Stop local Homebrew PostgreSQL if listening:**
  ```bash
  launchctl unload ~/Library/LaunchAgents/homebrew.mxcl.postgresql@15.plist 2>/dev/null
  ```
* **Verify Docker is the sole process listening on 5432:**
  ```bash
  lsof -i :5432
  # Should show: COMMAND com.docker ...
  ```

### 1.3 Ensure Database Role Credentials
Ensure the `paperclip` database user password matches the expected connection string:

```bash
docker exec docker-db-1 psql -U paperclip -d paperclip -c "ALTER USER paperclip WITH PASSWORD 'paperclip';"
```

* **Why?** Ensures explicit password synchronization for `paperclip` on `localhost:5432`.

---

## Step 2: Configure Environment Variables (`.env`)

Create the `.env` file in the project root (`paperclip-talent2flow/.env`) based on `.env.example`.

### `.env` File Content:
```env
DATABASE_URL=postgres://paperclip:paperclip@127.0.0.1:5432/paperclip
PORT=3100
SERVE_UI=false
BETTER_AUTH_SECRET=bfc99671e74113cfdf5627aa57781ce5e317d4d1b351317b548698cbf4a05ff7

# Discord webhook for daily merge digest (scripts/discord-daily-digest.sh)
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# External chat-agent service (Cloud Run) used by per-agent chat completions.
CHAT_AGENT_SERVICE_URL=https://gemini-chat-agent-56688938888.us-east1.run.app/chat
# CHAT_AGENT_SERVICE_TOKEN=
```

* **Why `127.0.0.1` in `DATABASE_URL`?** Using explicit IP `127.0.0.1` avoids IPv6 (`::1`) resolution mismatches on macOS Node.js network stacks.
* **Why set `BETTER_AUTH_SECRET`?** Paperclip authentication service requires a 32+ byte secret for session signing.

---

## Step 3: Install Workspace Dependencies

Install all pnpm workspace dependencies:

```bash
pnpm install
```

* **Why?** Paperclip is a monorepo containing 31 workspace packages (`@paperclipai/server`, `@paperclipai/db`, `@paperclipai/ui`, plugins, SDKs). `pnpm install` links workspace dependencies and installs native modules like `sqlite3` and `esbuild`.

---

## Step 4: Run Database Migrations

Apply pending Drizzle database schema migrations to the external PostgreSQL database:

```bash
set -a && source .env && set +a
pnpm db:migrate
```

* **Why `set -a && source .env && set +a`?** Sourcing `.env` exports `DATABASE_URL` directly into the process environment. Without `DATABASE_URL`, `@paperclipai/db` falls back to embedded PGlite.
* **Verification output:**
  ```text
  Migrating database via DATABASE_URL
  Applying 127 pending migration(s)...
  Migrations complete
  ```

---

## Step 5: Start the Development Server (`pnpm dev`)

Start the Paperclip development server with environment variables sourced from `.env`:

```bash
set -a && source .env && set +a
pnpm dev
```

### Server Startup Verification:
The console output should display:

```text
  ───────────────────────────────────────────────────────
Mode             external-postgres  |  vite-dev-middleware
Deploy           local_trusted (private)
Bind             loopback (127.0.0.1)
Auth             ready
Server           3100
API              http://127.0.0.1:3100/api (health: http://127.0.0.1:3100/api/health)
UI               http://127.0.0.1:3100
Database         postgres://paperclip:***@127.0.0.1:5432/paperclip
Migrations       already applied
  ───────────────────────────────────────────────────────
```

### Health Check Verification:
Verify server operational status via HTTP GET:

```bash
curl http://127.0.0.1:3100/api/health
```

**Expected JSON Response:**
```json
{
  "status": "ok",
  "version": "0.3.1",
  "deploymentMode": "local_trusted",
  "deploymentExposure": "private",
  "authReady": true,
  "bootstrapStatus": "ready"
}
```

---

## Troubleshooting Checklist for AI Agents & Humans

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| `Permission denied (publickey)` on `git clone` | Private repository access missing | Verify SSH key or GitHub PAT with access to `nicolasbohorquez08/paperclip-talent2flow` |
| `Cannot connect to the Docker daemon` | Docker Desktop is closed | Run `open -a Docker` and wait 5s |
| `Mode: embedded-postgres` appears on `pnpm dev` | `DATABASE_URL` was not in `process.env` when booting | Run `set -a && source .env && set +a` before `pnpm dev` |
| `password authentication failed for user "paperclip"` | Password mismatch or `.env` file contains literal `***` | Ensure `.env` has `paperclip:paperclip` and run `ALTER USER paperclip WITH PASSWORD 'paperclip';` inside container |
| `PostgresError: role "paperclip" does not exist` | Connection routed to local Homebrew PostgreSQL instead of Docker | Run `lsof -i :5432` and unload local `postgresql@15` |
