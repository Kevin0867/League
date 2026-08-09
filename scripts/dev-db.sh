#!/usr/bin/env bash
# Idempotent local PostgreSQL bootstrap for this project's dev container.
# Initializes a cluster if needed, starts the server, applies committed Prisma
# migrations, and seeds demo data when the database is empty. Safe to re-run.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/lib/postgresql/padata}"
DB_NAME="pure_academy"
DB_ROLE="pure"
DB_PASS="pure"
SOCK_DIR="/var/run/postgresql"

log() { echo "[dev-db] $*"; }

# 1. Initialize the cluster once.
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initializing cluster at $PGDATA"
  mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"
  mkdir -p "$SOCK_DIR"; chown postgres:postgres "$SOCK_DIR"
  su postgres -c "$PGBIN/initdb -D $PGDATA -A trust --encoding=UTF8 --locale=C" >/dev/null
fi

# 2. Start the server if it isn't already accepting connections.
mkdir -p "$SOCK_DIR"; chown postgres:postgres "$SOCK_DIR" 2>/dev/null || true
if ! pg_isready -h 127.0.0.1 -q; then
  log "starting PostgreSQL"
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l $SOCK_DIR/pg.log \
    -o '-c listen_addresses=127.0.0.1 -c unix_socket_directories=$SOCK_DIR' start" >/dev/null
  for _ in $(seq 1 20); do pg_isready -h 127.0.0.1 -q && break; sleep 0.5; done
fi

# 3. Ensure role + database exist.
su postgres -c "psql -h 127.0.0.1 -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_ROLE'\"" | grep -q 1 || \
  su postgres -c "psql -h 127.0.0.1 -c \"CREATE ROLE $DB_ROLE WITH LOGIN PASSWORD '$DB_PASS' CREATEDB;\"" >/dev/null
su postgres -c "psql -h 127.0.0.1 -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1 || \
  su postgres -c "psql -h 127.0.0.1 -c \"CREATE DATABASE $DB_NAME OWNER $DB_ROLE;\"" >/dev/null

# 4. Apply committed migrations (no-op if already applied).
cd "$(dirname "$0")/.."
if [ -f node_modules/.bin/prisma ]; then
  log "applying migrations"
  npx prisma migrate deploy >/dev/null 2>&1 || npx prisma migrate deploy || true

  # 5. Seed only when empty.
  COUNT=$(psql "postgresql://$DB_ROLE@127.0.0.1:5432/$DB_NAME" -tAc "SELECT count(*) FROM \"Person\"" 2>/dev/null || echo 0)
  if [ "${COUNT:-0}" = "0" ]; then
    log "seeding demo data"
    npm run db:seed >/dev/null 2>&1 || true
  fi
fi

log "ready → postgresql://$DB_ROLE@127.0.0.1:5432/$DB_NAME"
