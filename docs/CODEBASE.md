# HarbourOS Codebase Guide (`docs/CODEBASE.md`)

This guide is the technical map of HarbourOS for engineers, auditors, and operators. Every path, script, module boundary, and invariant below reflects the actual repository layout and automated CI gates.

---

## 1. Repository Layout

```text
.
├── server.ts                       # Local dev / preview entrypoint (Express + Vite middleware on port 3000)
├── Dockerfile                      # Production multi-stage Node 22 container image
├── deploy/
│   ├── cloud-run-web.yaml          # Cloud Run Service manifest for HTTP API + SPA (`src/server/entry/web.ts`)
│   └── cloud-run-worker.yaml       # Cloud Run Service manifest for outbox worker (`src/server/entry/worker.ts`)
├── db/
│   └── migrations/                 # 14 immutable SQL migrations (001..014) — never edit shipped files <= 014
├── src/
│   ├── shared/                     # Pure isomorphic code (zero server/web imports)
│   │   ├── contracts/              # Statutory citations (Act 16 of 2021), 56-route RBAC matrix, Zod DTOs
│   │   ├── domain/                 # Integer-paise BigInt arithmetic, Modes A/B/C split, allocation rules, SHA-256 ledger hash, UTR validation
│   │   ├── ids.ts                  # Typed prefixed ID generators
│   │   ├── sdk/                    # Typed client SDK / error helpers
│   │   └── types/                  # Shared domain & API response types
│   ├── server/                     # Modular monolith backend (Express 4 + PostgreSQL 16 / PGlite)
│   │   ├── app.ts                  # Thin route mounting & security header shell (<= 150 lines)
│   │   ├── config.ts               # SOLE file permitted to read `process.env`; fail-closed production schema
│   │   ├── main.ts                 # Shared server bootstrap helper
│   │   ├── entry/                  # Runtime entrypoints: `web.ts`, `worker.ts`, `jobs.ts`
│   │   ├── ports/                  # Port interfaces: `db.ts`, `sms.ts`
│   │   ├── adapters/               # Concrete infrastructure: `db-pg.ts`, `db-pglite.ts`, `sms-msg91.ts`, `llm-gemini.ts`
│   │   ├── platform/               # Cross-cutting infrastructure (auth, route wrapper, idempotency, ledger, observability, seed)
│   │   └── modules/                # 11 isolated domain modules (`index.ts`, `routes.ts`, `service.ts`, `repo.ts`)
│   └── web/                        # React 19 + TypeScript + Tailwind v4 SPA
│       ├── main.tsx                # SPA bootstrap & font imports (`@fontsource/inter`, `jetbrains-mono`, `noto-sans-malayalam`)
│       ├── app/                    # App shell, router, RBAC workspace guard, auth modal, command palette, drawers
│       ├── ui/                     # Reusable UI primitives (`DataTable` mobile cards + desktop table, `Card`, `Badge`, `Modal`, `tokens.css`)
│       ├── workspaces/             # 7 lazy-loaded role workspaces (`weighing`, `pit`, `buyer`, `fisher`, `inspector`, `harbour`, `platform`)
│       ├── i18n/                   # English (`en`) & Malayalam (`ml`) dictionaries (`npm run check:i18n` parity gated)
│       ├── lib/                    # API client (in-memory JWT + cookie refresh), QR utilities, offline helpers
│       └── shared/                 # Shared web formatting & print slip helpers
├── scripts/                        # Migrations, seeding, static gates, RLS/ledger verifiers, load & rehearsal harnesses
├── tests/                          # `unit`, `characterization`, `db`, `api`, `multi-instance` (`node:test`), and `e2e` (Playwright)
├── .github/workflows/              # SHA-pinned CI (`ci.yml`), Cloud Run deploy (`deploy.yml`), OWASP ZAP (`zap-nightly.yml`)
├── .zap/rules.tsv                  # OWASP ZAP baseline scan alert policy
└── .gitleaksignore                 # Per-finding fingerprints for deliberate redaction/stub test fixtures
```

---

## 2. Backend Modular Monolith (`src/server/`)

### Runtime Entrypoints (`src/server/entry/`)
| Entrypoint | Role | Command |
| :--- | :--- | :--- |
| `src/server/entry/web.ts` | Serves Express API (`/api/v1/*`, `/healthz`, `/readyz`) + built Vite SPA (`dist/`). | `node --import tsx src/server/entry/web.ts` |
| `src/server/entry/worker.ts` | Drains transactional SMS/notification outbox (`sync.outbox_events`) with exponential backoff + runs an `unref()`'d HTTP `/healthz` & `/readyz` probe listener on `config.PORT` for Cloud Run readiness. | `node --import tsx src/server/entry/worker.ts` |
| `src/server/entry/jobs.ts` | Scheduled/CLI operational jobs (daily ledger head anchoring, verification). | `npx tsx src/server/entry/jobs.ts` |
| `server.ts` (repo root) | Local development wrapper running Express + Vite dev middleware on port `3000`. | `npm run dev` |

### Domain Modules (`src/server/modules/*`)
External callers may only import a module through its `index.ts` barrel (`scripts/check-boundaries.ts`). Modules never import adapters directly — they consume `PlatformPorts` via `src/server/platform/ports.ts`.

| Module | Responsibility |
| :--- | :--- |
| `auction` | Live pit sessions, leader lease fencing (`auction.sessions`), 8-check statutory lot allocation (`POST /api/v1/lots/:lotId/allocate`), and atomic ledger posting. |
| `identity` | OTP request/verify (`core.otp_challenges`), cross-instance rate limiting (`core.auth_rate_limits`), short-lived JWT access tokens + rotating `HttpOnly` refresh cookies (`core.refresh_tokens`), supervisor PIN hashing (per-user CSPRNG salt), operator profiles, locale/consent, and DPDP Act 2023 export/erasure. |
| `ledger` | Append-only double-entry journals & entries (`ledger.journals`, `ledger.entries`), SHA-256 hash chain verification (`GET /api/v1/ledger/verify`), dual-key reversals (`POST /api/v1/ledger/reversals`), and audit imports. |
| `lots` | Dockside weighing lot capture (`POST /api/v1/lots`), HMAC-SHA256 QR sticker reprinting, Section 21 quality inspection grading (`A_EXPORT`, `A_DOMESTIC`, `B_PROCESS`, `REJECTED_UNFIT`), and optional advisory Gemini vision assist (`POST /api/v1/lots/:lotId/ai-assist`). |
| `masterdata` | Harbour entities (co-operative societies, fishermen, vessels, buyers, licences, species, sessions, floor prices), deactivation, and bulk CSV import. |
| `notifications` | Outbox status inspection (`GET /api/v1/notifications/outbox`) and MSG91 SMS delivery dispatch via the `SmsPort`. |
| `payouts` | Fisherman payable payout batch creation, single/bulk UTR reconciliation, buyer receivable receipt clearing, and pre-DB HMAC-authenticated Bank Nodal webhook ingestion (`POST /api/v1/webhooks/bank-nodal`). |
| `platform` | Readiness/liveness probes, Prometheus metrics (`GET /api/v1/metrics`), migration governance status, and cross-harbour benchmarks. |
| `reports` | Section 22 statutory returns, daily secretary balance sheets, and shadow-pilot diff reconciliation (`POST /api/v1/reports/shadow-diff`). |
| `sync` | Idempotent offline dockside catch command ingestion (`POST /api/v1/sync/commands`). |
| `tenancy` | Multi-tenant harbour provisioning (`POST /api/v1/tenants`), tenant user management, statutory policy sign-off modes, and role-filtered `/api/v1/bootstrap` payloads. |

### Ports & Adapters
- **Ports (`src/server/ports/`):** `db.ts` (`DbPort`, `withTenant()` transaction helper), `sms.ts` (`SmsPort`).
- **Adapters (`src/server/adapters/`):**
  - `db-pg.ts`: Production PostgreSQL 16 pool (`pg`) with dual pools (`harbour_app` tenant pool + `harbour_platform` pool + optional read replica) compatible with PgBouncer transaction mode.
  - `db-pglite.ts`: Embedded PGlite adapter for zero-setup local development and fast unit/API tests (explicitly blocked when `NODE_ENV=production`).
  - `sms-msg91.ts`: DLT-compliant MSG91 OTP/SMS gateway adapter with daily cap enforcement.
  - `llm-gemini.ts`: Sole file permitted to import `@google/genai`; disabled by default (`LLM_PROVIDER=none`).

### Automated Boundary Rules (`scripts/check-boundaries.ts`)
Every commit is verified against static structural invariants:
1. `src/shared/**` imports nothing from `src/server/**` or `src/web/**`.
2. `src/server/**` and `src/web/**` never import each other.
3. SQL `.query()` calls are allowed **only** in `src/server/modules/**/repo.ts`, `src/server/adapters/**`, `src/server/ports/db.ts`, and `src/server/platform/seed.ts`.
4. `process.env` is read **only** in `src/server/config.ts`.
5. `Math.random` is banned in `src/shared/domain/**` and `src/server/modules/**`.
6. `src/server/app.ts` `<= 150` lines; every file in `src/server/**/*.ts` `<= 600` lines.
7. Sibling workspaces under `src/web/workspaces/<w>/` never cross-import each other.
8. Zero empty or comment-only `catch {}` blocks across `src/`, `scripts/`, and `tests/`.
9. Zero hardcoded 6-digit hex colors or banned green palette tokens in `src/web/**/*.tsx` (all colors come from semantic CSS variables in `src/web/ui/tokens.css`, audited for WCAG 2.1 AA contrast by `scripts/check-contrast.ts`).

---

## 3. Database Schema, RLS & PgBouncer (`db/migrations/`)

HarbourOS ships 14 immutable migrations (`001` through `014`) across five PostgreSQL schemas: `core`, `harbour`, `auction`, `ledger`, and `sync`. **Never edit shipped migrations `<= 014`; always add a new numbered migration (`015_*.sql`).**

| Migration | Summary |
| :--- | :--- |
| `001_harbouros_schema.sql` | Base `core`, `harbour`, `auction`, `ledger`, `sync` tables. |
| `002_rls_and_roles.sql` | Least-privilege roles (`harbour_app`, `harbour_platform`) and initial Row-Level Security policies. |
| `003_ledger_hash_triggers.sql` | Append-only `BEFORE UPDATE OR DELETE` immutability triggers on `ledger.journals` and `ledger.entries`. |
| `004_auction_leases_and_fencing.sql` | Pit session leader leases and monotonic fencing tokens. |
| `005_sdk_partners_and_webhooks.sql` | Partner API keys and bank nodal webhook registry. |
| `006_high_traffic_covering_indexes.sql` | Covering indexes for hot dockside reads and allocations. |
| `007_auth_and_sessions.sql` | `core.otp_challenges`, `core.refresh_tokens`, and operator auth metadata. |
| `008_rls_failclosed_and_idempotency.sql` | Fail-closed `core.tenant_access_allowed(tenant_id)` helper and `core.idempotency_keys`. |
| `009_statutory_ledger_and_payouts.sql` | Statutory Modes A/B/C split fields, payout batches, and UTR clearing tables. |
| `010_rls_strict.sql` | Hardened `FORCE ROW LEVEL SECURITY` coverage across tenant tables. |
| `011_rls_no_guc_bypass.sql` | Removes any unsafe GUC bypass paths; enforces strict transaction-local `set_config('app.tenant_id', ..., true)`. |
| `012_scale_and_pilot.sql` | `fillfactor=50` HOT-update tuning, `core.auth_rate_limits`, and pilot reporting tables. |
| `013_tenant_short_codes_and_lot_counter.sql` | Per-tenant atomic lot sequence counter (`harbour.lot_counters`) and short codes. |
| `014_rls_lot_counter_and_scale_indexes.sql` | Enables permissive RLS on `harbour.lot_counters` (bringing total protected tenant tables to **33**) and adds scale-tested covering indexes. |

### PgBouncer Transaction-Mode Safety
- All tenant queries execute inside `db.transaction()` via `src/server/platform/http-route.ts` using `SELECT set_config('app.tenant_id', $1, true)` (transaction-local GUC). No session-level `SET` or advisory session state is used.
- `scripts/ci-pgbouncer.sh` validates the entire 88-test suite and `scripts/verify-rls.ts` through real PgBouncer in `pool_mode = transaction` (`ignore_startup_parameters = extra_float_digits`, `server_reset_query = DISCARD ALL`).

---

## 4. Statutory Settlement Engine & SHA-256 Ledger (`src/shared/domain/`)

All monetary calculations live in pure, dependency-free TypeScript modules under `src/shared/domain/` and use **integer paise (`bigint`)** — floating-point currency math is never used:

- `money.ts`: Integer paise formatting, safe parsing, and exact rounding helpers.
- `split.ts`: Act 16 of 2021 commission split calculator supporting statutory **Mode A** (default 5% Act split), **Mode B**, and **Mode C** (commercial modes require documented legal sign-off per `docs/LEGAL_REVIEW.md`).
- `allocate.ts`: 8-point statutory lot allocation validation (quality grade `!= REJECTED_UNFIT`, active auctioneer licence, floor price compliance, buyer credit limit check, leader fencing token, idempotency, balance conservation).
- `ledger-hash.ts`: Deterministic SHA-256 running chain from genesis (`0000...0000`) verified by `GET /api/v1/ledger/verify` and `npm run verify:ledger`.
- `utr-validation.ts`: Strict NEFT/RTGS/IMPS UTR format validation for manual and bulk payout reconciliation.

---

## 5. Security & RBAC Architecture

- **Default-Deny 56-Route RBAC Matrix (`src/shared/contracts/rbac.ts`):** Every API endpoint is declared in `ROUTE_RBAC_MATRIX` across 8 roles (`SUPER_ADMIN`, `HARBOUR_ADMIN`, `LICENSED_AUCTIONEER`, `FISHERMAN_BOAT_OWNER`, `WHOLESALE_BUYER`, `WEIGHING_OPERATOR`, `ACCOUNTANT`, `AUTHORIZED_INSPECTOR`). Unmapped routes fail closed.
- **Role-Scoped Payloads:** `/api/v1/bootstrap` strips financial ledger/payout/audit fields for roles without accounting privileges.
- **Session & Credential Hygiene:** Access JWTs stay in memory on the client; refresh tokens rotate via `HttpOnly; SameSite=Strict; Path=/api/v1/auth` cookies (`core.refresh_tokens`). Supervisor PINs use per-user CSPRNG salts (`scrypt`).
- **Pre-DB Webhook Auth:** `POST /api/v1/webhooks/bank-nodal` verifies the `X-Bank-Signature` HMAC-SHA256 header before opening a tenant DB transaction and requires explicit `tenantId` in non-demo mode.
- **HTTP Hardening (`src/server/app.ts`):** Strict production CSP (zero `'unsafe-inline'`, `object-src 'none'`, `form-action 'self'`, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy`, `Cross-Origin-Opener-Policy`, and `Cross-Origin-Embedder-Policy`.
- **Supply-Chain & Scanner Gates:**
  - Every GitHub Action `uses:` in `.github/workflows/*.yml` is pinned to a verified 40-char peeled commit SHA with `# vX.Y.Z` tag comments (`npm run check:actions`).
  - Secret scanning via Gitleaks (`.gitleaksignore` only contains 3 per-finding fingerprints for deliberate redaction/stub test fixtures).
  - Nightly OWASP ZAP baseline scan (`.github/workflows/zap-nightly.yml`, `.zap/rules.tsv`) using `zaproxy/action-baseline` v0.15.0.

---

## 6. Frontend Architecture (`src/web/`)

- **7 Lazy-Loaded Role Workspaces (`src/web/workspaces/`):**
  1. `/w/weighing` (`Weighing & Lots`) — `WEIGHING_OPERATOR`, `HARBOUR_ADMIN`, `SUPER_ADMIN`
  2. `/w/pit` (`Auction Pit Pad`) — `LICENSED_AUCTIONEER`, `HARBOUR_ADMIN`, `SUPER_ADMIN`
  3. `/w/buyer` (`Buyer Clearing`) — `WHOLESALE_BUYER`, `SUPER_ADMIN`
  4. `/w/fisher` (`Fisher Passbook`) — `FISHERMAN_BOAT_OWNER`, `SUPER_ADMIN`
  5. `/w/inspector` (`Quality (s.21)`) — `AUTHORIZED_INSPECTOR`, `HARBOUR_ADMIN`, `SUPER_ADMIN`
  6. `/w/harbour` (`Harbour & Ledger`) — `HARBOUR_ADMIN`, `ACCOUNTANT`, `SUPER_ADMIN`
  7. `/w/platform` (`Platform Admin`) — `SUPER_ADMIN`
- **Frontend RBAC Gating (`src/web/app/App.tsx`, `CommandPaletteModal.tsx`, `OperatorProfileDrawer.tsx`):** Sidebar/bottom navigation, keyboard shortcuts (`1–7`, `L`), `⌘K` palette, Ledger Inspector drawer, and route rendering strictly enforce `WORKSPACES[i].allowedRoles`. Demo persona switcher is hidden in production.
- **Mobile-First Zero Horizontal Scroll (`src/web/ui/index.tsx`):** `DataTable` renders stacked mobile cards (`md:hidden`, `data-testid="datatable-mobile-list"`) with `[overflow-wrap:anywhere]`, `flex-wrap`, and truncated badges on viewports `< 768px`, and semantic HTML `<table>` on `md:` and wider screens — verified at 390px viewport in Playwright (`tests/e2e/smoke.spec.ts`).
- **Bilingual i18n (`src/web/i18n/`):** English and Malayalam key parity enforced by `npm run check:i18n`.
- **Bundle Budget:** Total production JS/CSS asset budget capped at `1500 KB` (`npm run check:budget`).

---

## 7. Scripts & Verification Reference

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start local dev server (`Express + Vite`) on `http://localhost:3000` with embedded PGlite. |
| `npm run seed` | Seed demo Munambam harbour data into local PGlite / PostgreSQL. |
| `npm run check:fast` | Fast (~10–20s) gate: lockfile sync, `tsc --noEmit`, i18n parity, boundaries, WCAG contrast, Cloud Run manifest-config parity (`check:deploy`), and unit tests. |
| `npm run check:deploy` | Validate `deploy/cloud-run-{web,worker}.yaml` against Cloud Run constraints and `src/server/config.ts` (including negative secret test). |
| `npm run check:actions` | Verify every `.github/workflows/*.yml` `uses:` pin matches a real 40-char peeled tag SHA. |
| `npm test` | Run full `node:test` suite (`characterization`, `unit`, `db`, `api`, `multi-instance` — 88 tests). |
| `npm run test:api` | Run API & compliance test suite (`tests/api/*.test.ts`). |
| `npx playwright test` | Run Playwright browser E2E suite (`tests/e2e/smoke.spec.ts` — mobile zero-scroll + RBAC gating). |
| `npm run build && npm run check:budget` | Build Vite production SPA and assert bundle size budget (`<= 1500 KB`). |
| `npm run migrate` | Apply migrations `001`–`014` idempotently (supports `RLS_PLATFORM_MODE=bypassrls\|owner`). |
| `npx tsx scripts/verify-rls.ts` | Live database verification of all 33 tenant tables, role privileges, and ledger immutability. |
| `npm run verify:ledger` | Recompute SHA-256 ledger chain from genesis and verify integrity. |
| `npm run anchor:ledger` | Anchor daily ledger head hash to configured sink (`ANCHOR_SINK_DIR` / `ANCHOR_WEBHOOK_URL`). |
| `npm run gen:openapi` / `npm run check:openapi` | Regenerate or drift-check `docs/openapi.json`. |
| `npm run check` | Full local verification pipeline (all static gates + 88 tests + build + bundle budget). |

---

## 8. Performance Characteristics & Measurable Definition of Done

### Measured Scale & Load Baselines (PostgreSQL 16 + PgBouncer Transaction Mode)
- **Scale fixture (`scripts/scale-fixture.ts`, 126k ledger rows):** 13/13 `EXPLAIN` plans pass with p95 under `8 ms`.
- **Two-instance sustained mixed load (60s):** Overall p95 `131 ms`, zero `5xx`, zero oversell, clean SHA-256 ledger chain.
- **Hot-lot contention (200 concurrent allocations on a single lot):** p95 `2.5–3.1 s` (serialized safely by row-level lock + idempotency with zero oversell).

### Measurable Launch Criteria
1. **Repository & CI Green:** `CI & Quality Gates` (`ci.yml`) and `OWASP ZAP Baseline Scan` (`zap-nightly.yml`) both pass on `main` on GitHub Actions; Gitleaks reports zero unignored findings.
2. **Staging Deploy Green:** `.github/workflows/deploy.yml` succeeds against `staging`, applying migrations as owner, booting both `harbouros-web` and `harbouros-worker`, and passing post-deploy `/readyz`, `/healthz`, and CSP checks.
3. **Production Readiness & Pilot Gate:** Cloud SQL PITR backups verified, DLT-registered MSG91 OTP delivery verified end-to-end on real handsets, legal sign-off recorded per `docs/LEGAL_REVIEW.md`, and shadow-pilot reconciliation (`docs/FIRST_MORNING.md`, `docs/PILOT_KIT.md`) completed with zero ledger drift.
