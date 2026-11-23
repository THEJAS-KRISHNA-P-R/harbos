#!/usr/bin/env bash
set -euo pipefail

# scripts/ci-pgbouncer.sh — Strict PgBouncer Transaction-Mode Gate
# - Runs PgBouncer in strict pool_mode = transaction with NO ignore_startup_parameters.
# - Points DATABASE_URL (harbour_app) at PgBouncer (127.0.0.1:6432).
# - Keeps DATABASE_PLATFORM_URL (harbour_platform) direct on Postgres (5432).
# - Verifies transaction-local GUC isolation, then executes `npm test` and
#   `npx tsx scripts/verify-rls.ts` through PgBouncer. Fails hard on any error.
#
# Optional modes:
#   --start-only : Start strict PgBouncer on BOUNCER_PORT and leave running (writes PID to WORK_DIR/pgbouncer.pid)
#   --stop       : Stop PgBouncer started via --start-only
#   (default)    : Start PgBouncer, verify GUC isolation, run `npm test` + `verify-rls`, stop on exit

MODE="${1:-full}"

WORK_DIR="${PGBOUNCER_WORK_DIR:-${TMPDIR:-/tmp}/harbour-pgbouncer}"
mkdir -p "$WORK_DIR"

if [ "$MODE" = "--stop" ]; then
  if [ -f "$WORK_DIR/pgbouncer.pid" ]; then
    PID="$(cat "$WORK_DIR/pgbouncer.pid" 2>/dev/null || true)"
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$WORK_DIR/pgbouncer.pid"
  fi
  exit 0
fi

echo "=== HarbourOS Strict PgBouncer Transaction-Mode Gate ==="

if ! command -v pgbouncer >/dev/null 2>&1; then
  echo "ERROR: pgbouncer binary is required for the PgBouncer CI gate and was not found in PATH." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql binary is required for the PgBouncer CI gate and was not found in PATH." >&2
  exit 1
fi

DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5432}"
DB_NAME="${PGDATABASE:-harbouros_test}"
APP_USER="${HARBOUR_APP_USER:-harbour_app}"
APP_PASS="${HARBOUR_APP_PASSWORD:-test_app_password_harbour_secret_2026}"
PLATFORM_USER="${HARBOUR_PLATFORM_USER:-harbour_platform}"
PLATFORM_PASS="${HARBOUR_PLATFORM_PASSWORD:-test_platform_password_harbour_secret_2026}"
BOUNCER_PORT="${PGBOUNCER_PORT:-6432}"

# Helper: detect processes listening on BOUNCER_PORT (supports ss, lsof, fuser)
list_port_listeners() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    (sudo ss -H -ltnp "sport = :${port}" 2>/dev/null || ss -H -ltnp "sport = :${port}" 2>/dev/null || true)
  elif command -v lsof >/dev/null 2>&1; then
    (sudo lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)
  else
    true
  fi
}

is_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "sport = :${port}" 2>/dev/null | grep -q .
    return $?
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  elif command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" >/dev/null 2>&1
    return $?
  fi
  return 1
}

terminate_pid() {
  local pid="$1"
  if [ -z "$pid" ]; then
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
  elif command -v sudo >/dev/null 2>&1 && sudo kill -0 "$pid" 2>/dev/null; then
    sudo kill "$pid" 2>/dev/null || true
  fi
}

ensure_bouncer_port_free() {
  local port="$1"

  # 1. Stop default OS pgbouncer service/socket if apt-get or systemd auto-started it
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl is-active --quiet pgbouncer.service 2>/dev/null || systemctl is-active --quiet pgbouncer.socket 2>/dev/null; then
      echo "[pgbouncer] Stopping default OS pgbouncer.service/socket to free port ${port}..."
      (sudo systemctl stop pgbouncer.service pgbouncer.socket 2>/dev/null || systemctl stop pgbouncer.service pgbouncer.socket 2>/dev/null || true)
      (sudo systemctl disable pgbouncer.service pgbouncer.socket 2>/dev/null || systemctl disable pgbouncer.service pgbouncer.socket 2>/dev/null || true)
    fi
  elif command -v service >/dev/null 2>&1; then
    (sudo service pgbouncer stop 2>/dev/null || service pgbouncer stop 2>/dev/null || true)
  fi

  # 2. Stop any stale PgBouncer recorded in our work directory pidfile
  if [ -f "$WORK_DIR/pgbouncer.pid" ]; then
    OLD_PID="$(cat "$WORK_DIR/pgbouncer.pid" 2>/dev/null || true)"
    terminate_pid "$OLD_PID"
    rm -f "$WORK_DIR/pgbouncer.pid"
  fi

  # 3. Inspect port ${port}; if any lingering pgbouncer process still holds it, stop it cleanly
  if is_port_in_use "$port"; then
    echo "[pgbouncer] Port ${port} is currently in use. Inspecting listeners:"
    list_port_listeners "$port"
    if command -v pgrep >/dev/null 2>&1 && pgrep -x pgbouncer >/dev/null 2>&1; then
      echo "[pgbouncer] Stopping lingering pgbouncer process(es)..."
      (sudo pkill -TERM -x pgbouncer 2>/dev/null || pkill -TERM -x pgbouncer 2>/dev/null || true)
    fi
  fi

  # 4. Wait up to 10s for port ${port} to be released (force-kill stubborn pgbouncer after 5s)
  local attempt
  for attempt in $(seq 1 20); do
    if ! is_port_in_use "$port"; then
      echo "[pgbouncer] Verified port ${port} is free."
      return 0
    fi
    if [ "$attempt" -eq 10 ] && command -v pgrep >/dev/null 2>&1 && pgrep -x pgbouncer >/dev/null 2>&1; then
      echo "[pgbouncer] Force-stopping unresponsive pgbouncer process(es) on port ${port}..."
      (sudo pkill -KILL -x pgbouncer 2>/dev/null || pkill -KILL -x pgbouncer 2>/dev/null || true)
    fi
    sleep 0.5
  done

  echo "ERROR: Port ${port} is still in use after cleanup. Active listeners:" >&2
  list_port_listeners "$port" >&2
  exit 1
}

ensure_bouncer_port_free "${BOUNCER_PORT}"

# 1. Generate strict transaction-mode PgBouncer config (ZERO ignore_startup_parameters)
cat <<EOF > "$WORK_DIR/pgbouncer.ini"
[databases]
${DB_NAME} = host=${DB_HOST} port=${DB_PORT} dbname=${DB_NAME}

[pgbouncer]
listen_port = ${BOUNCER_PORT}
listen_addr = 127.0.0.1
auth_type = plain
auth_file = ${WORK_DIR}/userlist.txt
pool_mode = transaction
max_client_conn = 400
default_pool_size = 25
min_pool_size = 5
reserve_pool_size = 10
server_reset_query = DISCARD ALL
server_check_query = SELECT 1
pidfile = ${WORK_DIR}/pgbouncer.pid
logfile = ${WORK_DIR}/pgbouncer.log
unix_socket_dir = ${WORK_DIR}
admin_users = ${APP_USER}
EOF

# Verify config contains NO ignore_startup_parameters
if grep -qi "ignore_startup_parameters" "$WORK_DIR/pgbouncer.ini"; then
  echo "ERROR: Strict PgBouncer gate forbids ignore_startup_parameters!" >&2
  exit 1
fi

# 2. Generate auth userlist
cat <<EOF > "$WORK_DIR/userlist.txt"
"${APP_USER}" "${APP_PASS}"
"${PLATFORM_USER}" "${PLATFORM_PASS}"
EOF
chmod 600 "$WORK_DIR/userlist.txt"

# PgBouncer refuses to run as root; drop to postgres or nobody if running as UID 0
PGBOUNCER_USER_ARGS=()
if [ "$(id -u)" -eq 0 ]; then
  if id postgres >/dev/null 2>&1; then
    chown -R postgres:postgres "$WORK_DIR"
    PGBOUNCER_USER_ARGS=(-u postgres)
  else
    chown -R nobody:nogroup "$WORK_DIR"
    PGBOUNCER_USER_ARGS=(-u nobody)
  fi
fi

cleanup() {
  if [ -f "$WORK_DIR/pgbouncer.pid" ]; then
    PID="$(cat "$WORK_DIR/pgbouncer.pid" 2>/dev/null || true)"
    terminate_pid "$PID"
    rm -f "$WORK_DIR/pgbouncer.pid"
  fi
}

if [ "$MODE" != "--start-only" ]; then
  trap cleanup EXIT
fi

: > "$WORK_DIR/pgbouncer.log"
echo "[pgbouncer] Starting strict transaction-mode PgBouncer ($(pgbouncer --version | head -n1)) on 127.0.0.1:${BOUNCER_PORT}"
pgbouncer -d "${PGBOUNCER_USER_ARGS[@]+"${PGBOUNCER_USER_ARGS[@]}"}" "$WORK_DIR/pgbouncer.ini"

# 3. Wait for PgBouncer readiness
READY=0
export PGPASSWORD="${APP_PASS}"
for _ in $(seq 1 30); do
  if psql -h 127.0.0.1 -p "${BOUNCER_PORT}" -U "${APP_USER}" -d "${DB_NAME}" -t -A -c "SELECT 1;" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -ne 1 ]; then
  echo "ERROR: PgBouncer failed to become ready on port ${BOUNCER_PORT}. Logs:" >&2
  cat "$WORK_DIR/pgbouncer.log" >&2 || true
  exit 1
fi

echo "[pgbouncer] Ready on 127.0.0.1:${BOUNCER_PORT} (pool_mode=transaction, no ignore_startup_parameters)"

# 4. Verify transaction-local GUC isolation across pooled transactions
ROWS_TX1="$(psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "${BOUNCER_PORT}" -U "${APP_USER}" -d "${DB_NAME}" -t -A -c \
  "BEGIN; SELECT set_config('app.tenant_id', 'munambam-demo', true); SELECT COUNT(*) FROM core.tenants; COMMIT;" | grep -E '^[0-9]+$' | tail -n1 | tr -d '[:space:]')"
echo "[pgbouncer] Tx1 (set_config app.tenant_id='munambam-demo', is_local=true) saw core.tenants rows: ${ROWS_TX1}"

if [ "${ROWS_TX1}" != "1" ]; then
  echo "ERROR: Expected Tx1 to see exactly 1 tenant row for munambam-demo, got '${ROWS_TX1}'" >&2
  exit 1
fi

ROWS_TX2="$(psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "${BOUNCER_PORT}" -U "${APP_USER}" -d "${DB_NAME}" -t -A -c \
  "BEGIN; SELECT COUNT(*) FROM core.tenants; COMMIT;" | grep -E '^[0-9]+$' | tail -n1 | tr -d '[:space:]')"
echo "[pgbouncer] Tx2 (no tenant context on pooled connection) saw core.tenants rows: ${ROWS_TX2}"

if [ "${ROWS_TX2}" != "0" ]; then
  echo "ERROR: PgBouncer leaked tenant context across transaction boundary (saw ${ROWS_TX2} rows)!" >&2
  exit 1
fi

echo "[pgbouncer] PASS: Transaction-local GUC strictly cleared across pooled transactions."

if [ "$MODE" = "--start-only" ]; then
  echo "[pgbouncer] Running in daemon mode (--start-only). PID=$(cat "$WORK_DIR/pgbouncer.pid")"
  exit 0
fi

# 5. Execute full test suite + RLS verification through PgBouncer
export DATABASE_URL="postgresql://${APP_USER}:${APP_PASS}@127.0.0.1:${BOUNCER_PORT}/${DB_NAME}"
export DATABASE_PLATFORM_URL="postgresql://${PLATFORM_USER}:${PLATFORM_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
export NODE_OPTIONS="--throw-deprecation"

echo "[pgbouncer] Running full test suite (npm test) through PgBouncer..."
npm test

echo "[pgbouncer] Running verify-rls.ts through PgBouncer..."
npx tsx scripts/verify-rls.ts

echo "=== Strict PgBouncer Transaction-Mode Gate: PASS ==="
