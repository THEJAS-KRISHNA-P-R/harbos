# HarbourOS — Multi-Tenant Statutory Fisheries Clearing Ledger (v1.0)

HarbourOS is a single-deployable, multi-tenant statutory auction clearing ledger for coastal fishing harbours and fish landing centres. It implements integer-paise (`bigint`) double-entry bookkeeping, SHA-256 hash-chained ledger entries, PostgreSQL Row-Level Security across 33 tenant-scoped tables, and statutory split calculations modeled on the **Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021)**.

## Documentation Index

| Document | Purpose |
| :--- | :--- |
| [`docs/CODEBASE.md`](docs/CODEBASE.md) | Complete technical map: repository layout, 11 backend modules, migrations `001`–`014`, RBAC matrix, frontend workspaces, and scripts. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architectural Decision Records (ADR-014 Modular Monolith, ADR-015 Single-Tx & Idempotency, ADR-016 Dual-Role RLS). |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Daily harbour operations, SHA-256 ledger verification, `RLS_PLATFORM_MODE` (`bypassrls` vs `owner`), and Cloud Run deployment & rollback. |
| [`docs/LEGAL_REVIEW.md`](docs/LEGAL_REVIEW.md) | Statutory Act 16 of 2021 legal sign-off requirements (Modes A/B/C, DPDP Act 2023). |
| [`docs/FIRST_MORNING.md`](docs/FIRST_MORNING.md) & [`docs/PILOT_KIT.md`](docs/PILOT_KIT.md) | Harbour shadow-pilot launch playbook and operator checklists. |
| [`docs/SLO.md`](docs/SLO.md) & [`docs/CAPACITY.md`](docs/CAPACITY.md) | Latency targets, scale benchmarks, and capacity planning. |
| [`docs/openapi.json`](docs/openapi.json) | Generated OpenAPI 3 specification (`npm run check:openapi`). |

## v1.0 Scope
- **Included:** Dockside lot weighing (`QR` signed tags) → Section 21 quality inspection gate → Licensed auctioneer lot allocation (with leader fencing token & DB-backed idempotency) → Balanced double-entry statutory split (`ledger.journals` + `ledger.entries`) → Fisherman payable payout batch generation & manual/bulk UTR reconciliation → Buyer receivable receipt clearing → Section 22 statutory export & shadow-pilot diff.
- **Not Included in v1.0 (Deferred):** Automated payment gateway money movement (Razorpay/Stripe), real-time WebSocket Dutch clock bidding, Bluetooth/WebSerial hardware scale drivers, offline CRDT sync, and external MPEDA/NFDP/ReALCraft government portal adapters.

## Quick Start (Local Dev on Embedded PGlite)

```bash
npm ci
npm run seed
npm run dev
```

Open `http://localhost:3000`.

### Fast & Full Verification Commands

```bash
# Fast gate (~10–20s): lockfile, tsc, i18n, boundaries, contrast, Cloud Run manifest parity, unit tests
npm run check:fast

# Full local verification (all static gates + 88 node:test tests + Vite build + bundle budget)
npm run check

# Browser E2E tests (Playwright — mobile zero-horizontal-scroll & RBAC gating)
npx playwright test

# Pin verification for .github/workflows/*.yml
npm run check:actions
```

## Production Configuration (`NODE_ENV=production`)

`src/server/config.ts` is the sole file permitted to read `process.env`. Production boot **refuses to start** unless all safety invariants hold (also enforced on Cloud Run manifests in CI via `npm run check:deploy`):

| Variable | Required in Prod | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | **Yes (`production`)** | Enables strict boot validation, HSTS, strict CSP, and fail-closed guards. |
| `DATABASE_URL` | **Yes** | PostgreSQL 16 connection URL as `harbour_app` (`NOBYPASSRLS`), typically via PgBouncer transaction mode. |
| `DATABASE_PLATFORM_URL` | **Yes** | PostgreSQL 16 connection URL as `harbour_platform` (pre-auth lookups, refresh tokens, anchoring). |
| `RLS_PLATFORM_MODE` | Recommended (`owner` on Cloud SQL / RDS) | `bypassrls` (self-hosted Postgres, default) or `owner` (managed Postgres without `BYPASSRLS`). |
| `JWT_ACCESS_SECRET` | **Yes** | Cryptographically random secret (`>= 32` bytes; no placeholder substrings). |
| `QR_HMAC_SECRET` | **Yes** | Distinct cryptographically random secret (`>= 32` bytes; must differ from `JWT_ACCESS_SECRET`). |
| `OTP_DEV_ECHO` | **Yes (`false`)** | Must be `false` in production. |
| `DEMO_MODE` | **Yes (`false`)** | Must be `false` in production. |
| `SMS_PROVIDER` | **Yes (`msg91`)** | Must not be `console` or `noop` in production. |
| `MSG91_AUTH_KEY` | **Yes** (when `msg91`) | DLT-registered MSG91 auth key. |
| `MSG91_SENDER_ID` | **Yes** (when `msg91`) | DLT-approved 6-char sender ID (e.g., `HARBOS`). |
| `MSG91_OTP_TEMPLATE_ID` | **Yes** (when `msg91`) | DLT-approved OTP template ID. |
| `TRUST_PROXY` | Optional (`1`) | Reverse-proxy hop count for `X-Forwarded-For` client IP resolution. |

## Go-Live Checklist
1. Provision Cloud SQL / PostgreSQL 16 with Point-in-Time Recovery (PITR) and configure `harbour_app` + `harbour_platform` roles (`docs/RUNBOOK.md` §3–4).
2. Configure GCP Secret Manager secrets, Artifact Registry, Workload Identity Federation, and GitHub Environment (`staging` / `production`).
3. Confirm `CI & Quality Gates` and `OWASP ZAP Baseline Scan` are green on `main`.
4. Deploy via `.github/workflows/deploy.yml` (runs owner-role `npm run migrate`, deploys `harbouros-web` and `harbouros-worker`, verifies `/readyz` + `/healthz` + CSP, and rolls back automatically on smoke failure).
5. Verify DLT-registered MSG91 OTP delivery on real handsets and schedule `npm run anchor:ledger` + `npm run verify:ledger` off-box.
6. Obtain written legal counsel sign-off (`docs/LEGAL_REVIEW.md`) before enabling Commercial Modes B or C.
