#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="/tmp/harbouros-ci-local"
RUNNER_SIM_DIR="/tmp/harbouros-runner-sim"

ADMIN_URL="${DATABASE_ADMIN_URL:-postgresql://postgres:postgrespassword@127.0.0.1:5432/postgres}"
TEST_DB="harbouros_test"
APP_PASS="test_app_password_harbour_secret_2026"
PLAT_PASS="test_platform_password_harbour_secret_2026"

OWNER_DB_URL="postgresql://postgres:postgrespassword@127.0.0.1:5432/${TEST_DB}"
APP_DB_URL="postgresql://harbour_app:${APP_PASS}@127.0.0.1:5432/${TEST_DB}"
PLAT_DB_URL="postgresql://harbour_platform:${PLAT_PASS}@127.0.0.1:5432/${TEST_DB}"

echo "===================================================================="
echo "HarbourOS ci:local — Clean-Archive + Fresh-PostgreSQL Verification"
echo "===================================================================="

# 0. Verify PostgreSQL reachability
if ! PGPASSWORD=postgrespassword psql -h 127.0.0.1 -U postgres -d postgres -c "SELECT 1;" >/dev/null 2>&1; then
  echo "UNVERIFIED: Neither Docker Postgres nor local PostgreSQL at 127.0.0.1:5432 is reachable."
  echo "To run manually:"
  echo "  docker run -d --name pg-ci -p 5432:5432 -e POSTGRES_PASSWORD=postgrespassword -e POSTGRES_DB=harbouros_test postgres:16-alpine"
  echo "  DATABASE_ADMIN_URL=postgresql://postgres:postgrespassword@127.0.0.1:5432/postgres npm run ci:local"
  exit 1
fi

# 1. Create clean archive of repository in /tmp/harbouros-ci-local
rm -rf "${WORK_DIR}" "${RUNNER_SIM_DIR}"
mkdir -p "${WORK_DIR}"
if [ -d "${ROOT_DIR}/.git" ] && command -v git >/dev/null 2>&1 && git -C "${ROOT_DIR}" rev-parse --verify HEAD >/dev/null 2>&1; then
  git -C "${ROOT_DIR}" archive HEAD | tar -x -C "${WORK_DIR}"
else
  tar -C "${ROOT_DIR}" \
    --exclude='./node_modules' \
    --exclude='./dist' \
    --exclude='./.git' \
    --exclude='./.data' \
    --exclude='./test-results' \
    --exclude='./playwright-report' \
    --exclude='./bun.lock' \
    -cf - . | tar -xf - -C "${WORK_DIR}"
fi

# 2. Drop and recreate a fresh empty harbouros_test database
echo "[ci:local] Resetting fresh empty database ${TEST_DB}..."
PGPASSWORD=postgrespassword psql -h 127.0.0.1 -U postgres -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);" >/dev/null
PGPASSWORD=postgrespassword psql -h 127.0.0.1 -U postgres -d postgres -c "CREATE DATABASE ${TEST_DB};" >/dev/null

declare -a STEP_NAMES=()
declare -a STEP_RESULTS=()
OVERALL_FAIL=0

run_step() {
  local name="$1"
  shift
  echo ""
  echo "--------------------------------------------------------------------"
  echo "[ci:local] STEP: ${name}"
  echo "--------------------------------------------------------------------"
  (
    cd "${WORK_DIR}" && "$@"
  )
  local rc=$?
  STEP_NAMES+=("${name}")
  STEP_RESULTS+=("${rc}")
  if [ "${rc}" -ne 0 ]; then
    OVERALL_FAIL=1
    echo "[ci:local] STEP FAILED: ${name} (exit=${rc})"
  else
    echo "[ci:local] STEP PASSED: ${name} (exit=0)"
  fi
}

# Step 0: Lockfile Synchronicity Guard
run_step "0. check-lockfile" npx tsx scripts/check-lockfile.ts

# Step 1: npm ci
run_step "1. npm ci" npm ci --no-audit --no-fund

# Step 2: gitleaks
run_step "2. gitleaks" gitleaks detect --config .gitleaks.toml --no-git --source . --redact

# Step 3: audit
run_step "3. audit" npm audit --omit=dev --audit-level=high

# Step 4: lint
run_step "4. lint" npm run lint

# Step 5: boundaries
run_step "5. boundaries" npm run check:boundaries

# Step 6: contrast
run_step "6. contrast" npm run check:contrast

# Step 7: empty-catch gate
run_step "7. empty-catch gate" bash -c '! grep -rnE "catch\s*(\([^)]*\))?\s*\{\s*(//[^\n]*)?\s*\}" tests scripts src'

# Step 8: migrate (owner role)
run_step "8. migrate" env \
  DATABASE_PLATFORM_URL="${OWNER_DB_URL}" \
  HARBOUR_APP_PASSWORD="${APP_PASS}" \
  HARBOUR_PLATFORM_PASSWORD="${PLAT_PASS}" \
  npm run migrate

# Step 9: seed (platform role, zero DDL)
run_step "9. seed" env \
  NODE_ENV=development \
  DEMO_MODE=true \
  DATABASE_PLATFORM_URL="${PLAT_DB_URL}" \
  npm run seed

# Step 10: test (as harbour_app + harbour_platform, never owner)
run_step "10. test" env \
  NODE_OPTIONS="--throw-deprecation" \
  DATABASE_URL="${APP_DB_URL}" \
  DATABASE_PLATFORM_URL="${PLAT_DB_URL}" \
  npm test

# Step 11: verify-rls (as harbour_app)
run_step "11. verify-rls" env \
  NODE_OPTIONS="--throw-deprecation" \
  DATABASE_URL="${APP_DB_URL}" \
  DATABASE_PLATFORM_URL="${PLAT_DB_URL}" \
  npx tsx scripts/verify-rls.ts

# Step 12: smoke-prod (as harbour_app)
run_step "12. smoke-prod" env \
  NODE_OPTIONS="--throw-deprecation" \
  DATABASE_URL="${APP_DB_URL}" \
  DATABASE_PLATFORM_URL="${PLAT_DB_URL}" \
  npx tsx scripts/smoke-prod.ts

# Step 13: build
run_step "13. build" npm run build

# Step 14: budget
run_step "14. budget" npm run check:budget

# Step 15: demo-phone grep
run_step "15. demo-phone grep" bash -c '! grep -rn "+91944700" src/web dist'

# Step 16: playwright
if [ -d "/ms-playwright" ] && ls /ms-playwright/chromium* >/dev/null 2>&1; then
  run_step "16. playwright" npx playwright test
else
  STEP_NAMES+=("16. playwright")
  STEP_RESULTS+=("UNVERIFIED (chromium absent)")
fi

# Step 17: docker build+run (or runner-stage simulation if no docker daemon)
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  run_step "17. docker build+run" bash -c '
    docker build -t harbouros:ci .
    docker rm -f harbouros-test >/dev/null 2>&1 || true
    docker run -d --name harbouros-test --network host \
      -e NODE_ENV=production \
      -e PORT=8080 \
      -e DATABASE_URL="'"${APP_DB_URL}"'" \
      -e DATABASE_PLATFORM_URL="'"${PLAT_DB_URL}"'" \
      -e JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
      -e QR_HMAC_SECRET="$(openssl rand -hex 32)" \
      -e SMS_PROVIDER=msg91 \
      harbouros:ci
    READY=0
    for i in $(seq 1 30); do
      if curl -sf http://127.0.0.1:8080/readyz >/dev/null; then
        READY=1
        break
      fi
      sleep 1
    done
    if [ "$READY" -ne 1 ]; then
      docker logs harbouros-test
      docker rm -f harbouros-test || true
      exit 1
    fi
    curl -sf http://127.0.0.1:8080/healthz >/dev/null
    curl -sI http://127.0.0.1:8080/ | grep -qi "frame-ancestors '\''none'\''"
    UID_VAL="$(docker exec harbouros-test id -u | tr -d "[:space:]")"
    docker rm -f harbouros-test || true
    [ "$UID_VAL" != "0" ]
  '
else
  echo ""
  echo "--------------------------------------------------------------------"
  echo "[ci:local] STEP: 17. docker build+run (dockerd absent -> simulating Dockerfile runner stage)"
  echo "--------------------------------------------------------------------"
  mkdir -p "${RUNNER_SIM_DIR}/db" "${RUNNER_SIM_DIR}/scripts" "${RUNNER_SIM_DIR}/src"
  cp "${WORK_DIR}/package.json" "${WORK_DIR}/package-lock.json" "${WORK_DIR}/tsconfig.json" "${WORK_DIR}/server.ts" "${RUNNER_SIM_DIR}/"
  cp -r "${WORK_DIR}/dist" "${RUNNER_SIM_DIR}/dist"
  cp -r "${WORK_DIR}/src/server" "${RUNNER_SIM_DIR}/src/server"
  cp -r "${WORK_DIR}/src/shared" "${RUNNER_SIM_DIR}/src/shared"
  cp -r "${WORK_DIR}/db/migrations" "${RUNNER_SIM_DIR}/db/migrations"
  cp "${WORK_DIR}/scripts/migrate.ts" "${WORK_DIR}/scripts/seed-demo.ts" "${RUNNER_SIM_DIR}/scripts/"

  (
    cd "${RUNNER_SIM_DIR}"
    npm ci --omit=dev --no-audit --no-fund
    SIM_PORT=8080
    if curl -sI http://127.0.0.1:8080/ >/dev/null 2>&1; then
      SIM_PORT=18080
    fi
    NODE_ENV=production \
      PORT="${SIM_PORT}" \
      DATABASE_URL="${APP_DB_URL}" \
      DATABASE_PLATFORM_URL="${PLAT_DB_URL}" \
      JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
      QR_HMAC_SECRET="$(openssl rand -hex 32)" \
      SMS_PROVIDER=msg91 \
      npm start >/tmp/harbouros-runner-sim.log 2>&1 &
    SIM_PID=$!
    trap "kill ${SIM_PID} >/dev/null 2>&1 || true" EXIT

    READY=0
    for i in $(seq 1 30); do
      if kill -0 "${SIM_PID}" 2>/dev/null && curl -sf "http://127.0.0.1:${SIM_PORT}/readyz" >/dev/null; then
        READY=1
        break
      fi
      sleep 1
    done
    if [ "${READY}" -ne 1 ]; then
      echo "Runner stage simulation failed to reach /readyz. Logs:"
      cat /tmp/harbouros-runner-sim.log
      exit 1
    fi
    echo "[runner-sim] Bound to port ${SIM_PORT} (PID ${SIM_PID})"
    echo "[runner-sim] /readyz -> $(curl -sf "http://127.0.0.1:${SIM_PORT}/readyz")"
    echo "[runner-sim] /healthz -> $(curl -sf "http://127.0.0.1:${SIM_PORT}/healthz")"
    CSP_HDR="$(curl -sI "http://127.0.0.1:${SIM_PORT}/" | grep -i "content-security-policy" | tr -d '\r')"
    echo "[runner-sim] / CSP -> ${CSP_HDR}"
    echo "${CSP_HDR}" | grep -qi "frame-ancestors 'none'"
    kill "${SIM_PID}" >/dev/null 2>&1 || true
    wait "${SIM_PID}" 2>/dev/null || true
    trap - EXIT
  )
  SIM_RC=$?
  if [ "${SIM_RC}" -eq 0 ]; then
    STEP_NAMES+=("17. docker build+run")
    STEP_RESULTS+=("UNVERIFIED (no dockerd; runner-sim exit=0)")
  else
    STEP_NAMES+=("17. docker build+run")
    STEP_RESULTS+=("FAIL (runner-sim exit=${SIM_RC})")
    OVERALL_FAIL=1
  fi
fi

echo ""
echo "===================================================================="
echo "HarbourOS ci:local Summary Table (Clean Archive + Fresh Empty DB)"
echo "===================================================================="
printf "%-30s | %s\n" "CI Step" "Exit Code / Status"
echo "-------------------------------+------------------------------------"
for idx in "${!STEP_NAMES[@]}"; do
  printf "%-30s | %s\n" "${STEP_NAMES[$idx]}" "${STEP_RESULTS[$idx]}"
done
echo "===================================================================="

rm -rf "${WORK_DIR}" "${RUNNER_SIM_DIR}"

if [ "${OVERALL_FAIL}" -ne 0 ]; then
  echo "[ci:local] FAILED: One or more steps returned a non-zero exit code."
  exit 1
fi
echo "[ci:local] ALL VERIFIED CI STEPS PASSED (exit=0)."
exit 0
