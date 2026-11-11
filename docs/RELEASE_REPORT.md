# HarbourOS — Round 4 `/ponytail full` Production Release Report (`docs/RELEASE_REPORT.md`)

**Statute Authority:** Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021)  
**Target Stack:** Node.js 22 · TypeScript (`strict`) · Express 4 · PostgreSQL 15/16 (`harbour_app` `NOBYPASSRLS` + `harbour_platform` `BYPASSRLS`, with PGlite parity) · React 19 · Tailwind CSS 4

---

## 1. `ci:local` Verification Summary (`npm run ci:local` from Clean Archive + Fresh Empty PostgreSQL Database)

- **Total CI Steps in `scripts/ci-local.sh`:** 17 steps
- **Steps Verified Locally (`exit=0`):** 16 of 17 steps (`1. npm ci` through `16. playwright` all exit `0`, plus Dockerfile runner-stage simulation `npm ci --omit=dev` + `npm start` exits `0`)
- **Unverified Locally (`UNVERIFIED`):** 1 step (`17. docker build+run` — no `dockerd` daemon in this container; runner stage file set and `npm ci --omit=dev` + production boot simulated in `/tmp/harbouros-runner-sim`)
- **Total Automated Test Count:** **55 tests across 6 suites (`55 pass, 0 fail, 0 skipped`)** + **3 Playwright browser smoke tests (`3 pass, 0 fail`)**

| # | CI Step | Command (Executed in Clean Archive `/tmp/harbouros-ci-local`) | Exit Code / Status |
| :--- | :--- | :--- | :--- |
| **1** | `1. npm ci` | `npm ci --no-audit --no-fund` | **`0` (PASS)** |
| **2** | `2. gitleaks` | `gitleaks detect --config .gitleaks.toml --no-git --source . --redact` | **`0` (PASS — 0 leaks)** |
| **3** | `3. audit` | `npm audit --omit=dev --audit-level=high` | **`0` (PASS — 0 vulnerabilities)** |
| **4** | `4. lint` | `npm run lint` (`tsc --noEmit`) | **`0` (PASS)** |
| **5** | `5. boundaries` | `npm run check:boundaries` (includes R3 empty-catch gate) | **`0` (PASS)** |
| **6** | `6. contrast` | `npm run check:contrast` (22/22 WCAG 2.1 AA/AAA pairs) | **`0` (PASS)** |
| **7** | `7. empty-catch gate` | `! grep -rnE "catch\s*(\([^)]*\))?\s*\{\s*(//[^\n]*)?\s*\}" tests scripts src` | **`0` (PASS — 0 matches)** |
| **8** | `8. migrate` | `DATABASE_PLATFORM_URL=<owner> HARBOUR_APP_PASSWORD=... HARBOUR_PLATFORM_PASSWORD=... npm run migrate` | **`0` (PASS — 11 migrations)** |
| **9** | `9. seed` | `NODE_ENV=development DEMO_MODE=true DATABASE_PLATFORM_URL=<harbour_platform> npm run seed` | **`0` (PASS — zero DDL)** |
| **10** | `10. test` | `NODE_OPTIONS=--throw-deprecation DATABASE_URL=<harbour_app> DATABASE_PLATFORM_URL=<harbour_platform> npm test` | **`0` (PASS — 55/55)** |
| **11** | `11. verify-rls` | `NODE_OPTIONS=--throw-deprecation DATABASE_URL=<harbour_app> DATABASE_PLATFORM_URL=<harbour_platform> npx tsx scripts/verify-rls.ts` | **`0` (PASS — 27 tables 0\|0\|0)** |
| **12** | `12. smoke-prod` | `NODE_OPTIONS=--throw-deprecation DATABASE_URL=<harbour_app> DATABASE_PLATFORM_URL=<harbour_platform> npx tsx scripts/smoke-prod.ts` | **`0` (PASS)** |
| **13** | `13. build` | `npm run build` | **`0` (PASS)** |
| **14** | `14. budget` | `npm run check:budget` (`1,110.6 KB / 1,500.0 KB`, `25.6 KB` gzip entry JS) | **`0` (PASS)** |
| **15** | `15. demo-phone grep` | `! grep -rn "+91944700" src/web dist` | **`0` (PASS — 0 matches)** |
| **16** | `16. playwright` | `npx playwright test` (360px & 1280px light/dark, hero SVG, `<use>` sprites, reduced motion) | **`0` (PASS — 3/3)** |
| **17** | `17. docker build+run` | Real `docker build` + `docker run` (no local `dockerd`; runner stage simulated with `npm ci --omit=dev` + `npm start`) | **`UNVERIFIED (no dockerd; runner-sim exit=0)`** |

---

## 2. Round 4 Root Causes Resolved

1. **Phase A — Lockfile Sync (`package-lock.json` & `bun.lock`):**
   - Deleted `bun.lock`, regenerated `package-lock.json` with `npm install` (including `@playwright/test@1.65.0`, `playwright@1.65.0`, `playwright-core@1.65.0`), added `bun.lock` to `.gitignore`, and moved `npm ci` to the first step after checkout in `.github/workflows/ci.yml`.
2. **Phase B — Test / Seed / Role Separation (`src/server/platform/seed.ts`, `tests/helpers/pg-bootstrap.ts`, `scripts/verify-rls.ts`):**
   - Split `runMigrations` (owner DDL) from `seedDemo` (`harbour_platform` data-only, zero DDL).
   - Removed the 3 swallowing `catch {}` blocks in `security.test.ts`, `tenant-isolation.test.ts`, and `rls-strict.test.ts`, replacing them with `bootstrapTestDatabase()` in `tests/helpers/pg-bootstrap.ts` which verifies `core.schema_migrations` is current, runs `await seedDemo(platformDb)` without catching/hiding errors, and asserts the seeded tenant, 9 demo users, and >= 12 ledger entries exist.
   - Made `scripts/verify-rls.ts` self-contained (creates and cleans up a throwaway tenant via `platformDb` if the demo tenant is absent) and narrowed all `catch` blocks to explicit PostgreSQL error codes (`42501` / `P0001`).
3. **Phase C — Docker Step & Env Normalization (`src/server/config.ts`, `.github/workflows/ci.yml`, `Dockerfile`):**
   - Normalized `SMS_PROVIDER`, `OTP_DEV_ECHO`, `DEMO_MODE`, and enum/boolean env vars via `z.preprocess(v => typeof v === 'string' ? v.trim().toLowerCase() : v, ...)` so `SMS_PROVIDER=CONSOLE` in production fails with the intended `FATAL [config]: SMS_PROVIDER=console is forbidden when NODE_ENV=production.` message.
   - Updated `.github/workflows/ci.yml` Docker step to pass `SMS_PROVIDER=msg91`, `--network host`, `127.0.0.1`, a 30-second `/readyz` readiness loop with `docker logs` on failure, `frame-ancestors 'none'` header check on `/`, non-root UID check (`id -u != 0`), and `if: always()` container cleanup.
4. **Phase D — Compose & CI Hygiene (`docker-compose.yml` & `scripts/ci-local.sh`):**
   - Updated `docker-compose.yml` so `migrate` runs one-shot as `harbour_owner`, `seed` runs one-shot as `harbour_platform`, and `harbouros-app` connects as `harbour_app` / `harbour_platform`.

---

## 3. Technical Debt Ledger (`DEBT`) & Residual Risks

### Technical Debt & Engineering Lessons Ledger
1. **`DEBT-TEST-01` (Lesson from Rounds 1–3):**
   - **Tests must not swallow setup errors; CI env is the only truth.** Every `catch` block in `tests/`, `scripts/`, and `src/` is now gated by `! grep -rnE "catch\s*(\([^)]*\))?\s*\{\s*(//[^\n]*)?\s*\}" tests scripts src` and `scripts/check-boundaries.ts`, and all claims in this report are produced by `npm run ci:local` from a clean archive and fresh empty PostgreSQL database.
2. **`DEBT-CSP-01` (`style-src 'self' 'unsafe-inline'` in `src/server/app.ts`):**
   - `script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, and `font-src 'self' data:` are strictly enforced without external origins or unsafe directives. `style-src` retains `'unsafe-inline'` for Recharts SVG inline styles and dynamic chart tooltip positioning.

### Unverified in Local Container (No Docker Daemon)
1. **Real Docker Daemon Build & Run (`Step 17` in `ci:local`):**
   - Because this sandbox container does not run `dockerd`, `docker build` and `docker run` could not be executed via a Docker daemon locally and are marked **`UNVERIFIED`** per Rule R5 (while the exact runner-stage file set and `npm ci --omit=dev` + `npm start` boot were verified in `/tmp/harbouros-runner-sim`). To verify on a workstation or CI runner with Docker installed, run:
     ```bash
     docker build -t harbouros:ci .
     docker run -d --name harbouros-test --network host \
       -e NODE_ENV=production \
       -e PORT=8080 \
       -e DATABASE_URL="postgresql://harbour_app:test_app_password_harbour_secret_2026@127.0.0.1:5432/harbouros_test" \
       -e DATABASE_PLATFORM_URL="postgresql://harbour_platform:test_platform_password_harbour_secret_2026@127.0.0.1:5432/harbouros_test" \
       -e JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
       -e QR_HMAC_SECRET="$(openssl rand -hex 32)" \
       -e SMS_PROVIDER="msg91" \
       harbouros:ci
     ```

### Explicit Residual Risks
1. **Statute Citations & Commercial-Mode Legality (`NEEDS-COUNSEL` in `src/shared/contracts/statute.ts` & `docs/LEGAL_REVIEW.md`):**
   - Statutory section mappings (`s.10(1)` vs `s.4(4)/s.4(5)(a)` and `s.14(1)` vs `s.4(5)(b)`) and commercial fee-sharing modes (`INSTITUTIONAL_TECH_SHARE`, `HYBRID`) require formal legal sign-off by Kerala Fisheries Department / High Court counsel before commercial deployment.
2. **External SMS / WhatsApp Gateway Integration Not Live:**
   - Production startup refuses `console`/`noop` SMS providers; live TRAI DLT principal entity IDs, template IDs, and MSG91 / Meta Cloud API credentials must be provisioned in secret manager before production cutover.
3. **No Real Money Movement in v1:**
   - HarbourOS v1 records append-only SHA-256 hash-chained double-entry journals, generates ISO 20022 `pain.001` batch instructions, and reconciles bank UTRs (`camt.054` / CSV), but does not initiate live core-banking wire transfers directly.
