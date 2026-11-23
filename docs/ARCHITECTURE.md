# HarbourOS Architecture & Architectural Decision Records (ADRs)

HarbourOS is an institutional, multi-tenant digital operating system for government fish landing centres and harbours, designed to enforce the **Kerala Fish Auctioning, Marketing and Maintenance of Quality Act 2021 (Act 16 of 2021)**.

---

## ADR-014: Modular Monolith (`src/server/modules/*`)

### Context
HarbourOS previously consolidated route definitions and business logic into monolithic controllers. As the system expanded to support multiple horizontal runtimes (`web`, `worker`, `jobs`), tight coupling between HTTP routing, business calculations, and direct database execution threatened maintainability, statutory verification, and transaction boundaries.

### Decision
Adopt a strict **Modular Monolith** architecture with clean domain isolation under `src/server/modules/`:
- `auction`: Real-time Dutch and English clock auctions, bid increments, and gavel execution (§11).
- `identity`: PBKDF2/Argon2-hardened operator authentication, session issuance, RBAC enforcement, and DPDP Act 2023 privacy rights.
- `ledger`: Append-only double-entry financial ledger with SHA-256 running hash chaining (§8).
- `lots`: Dockside weighment, species grading, crate RFID pairing, and Gemini multimodal vision assist.
- `masterdata`: Baseline statutory species, harbour buyer rosters, GSTIN validation, and floor price controls.
- `notifications`: Async transactional outbox SMS worker with MSG91 integration and backoff.
- `payouts`: Settlement batch vouchers, direct bank nodal clearing, and UTR reconciliation.
- `platform`: Multi-tenant governance, schema migrations, and Prometheus observability.
- `reports`: Daily harbour secretary balance sheets and statutory compliance audits.
- `sync`: Client offline catch buffers and server outbox event synchronization.
- `tenancy`: Cross-tenant RLS policy boundaries and administrative provisioning.

### Enforcement Rules
1. **Zero Direct SQL Outside Repos**: Routes, services, and UI components never execute raw SQL statements directly. All `.query()` calls are restricted to `src/server/modules/**/repo.ts`, `src/server/adapters/**`, `src/server/ports/db.ts`, and `src/server/platform/seed.ts` (enforced by `npm run check:boundaries`).
2. **Centralized Config & Manifest Parity**: `process.env` is read exclusively in `src/server/config.ts`. Cloud Run manifests (`deploy/cloud-run-web.yaml`, `deploy/cloud-run-worker.yaml`) are tested against `parseEnvConfig()` in CI via `npm run check:deploy`.
3. **Worker Health Listener**: `src/server/entry/worker.ts` binds an HTTP `/healthz` and `/readyz` probe listener on `config.PORT` (`unref()`'d so `SIGTERM` drains cleanly) to satisfy Cloud Run container startup/liveness probes alongside the transactional outbox poll loop.
4. **App Shell & Module Size Limits**: `src/server/app.ts` must remain lean (`<= 150 lines`), and no file inside `src/server/**/*.ts` may exceed `600 lines`.

---

## ADR-015: Single Transaction per Request & DB-Backed Idempotency

### Context
In high-throughput dockside operations, intermittent cellular connectivity causes mobile handhelds and weighing scales to retry requests repeatedly. Furthermore, running multi-instance clusters behind PgBouncer in transaction mode requires that no application state or idempotency keys depend on local process memory.

### Decision
1. **One Transaction Per Request**:
   - Write endpoints execute within a single atomic database transaction (`db.transaction`).
   - Every request is guaranteed `<= 5` round-trips to the database (`X-DB-RoundTrips` header enforced).
2. **DB-Backed Idempotency (`core.idempotency_keys`)**:
   - Requests carrying `Idempotency-Key` write their status (`PENDING` -> `COMMITTED`) and serialized response body to `core.idempotency_keys`.
   - Concurrent retries across distinct container instances await or immediately replay the committed response, preventing duplicate auction settlements or double-charges.
3. **Cross-Instance Auth Rate Limiting (`core.auth_rate_limits`)**:
   - Authentication brute-force protection is enforced via `core.auth_rate_limits` using transactional atomic upserts with rolling 15-minute sliding windows.
4. **Hot-Row Concurrency Tuning (`fillfactor=50`)**:
   - High-update tables (`ledger.heads`, `ledger.accounts`, `auction.sessions`, `harbour.buyers`) use PostgreSQL `fillfactor=50` to guarantee HOT (Heap-Only Tuple) in-page updates without index fragmentation.

---

## ADR-016: Dual-Role Database Permissions & RLS Isolation

### Context
To defend against SQL injection and unauthorized tenant data leakage, the database connection must not operate as a database superuser.

### Decision
- **`harbour_app` Role**: Restricted operational role (`LOGIN, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE`) with zero table-owner privileges, denied access to `core.schema_migrations`, `core.otp_challenges`, and `core.refresh_tokens`, and strictly bound by PostgreSQL Row-Level Security across all **33 tenant-scoped tables**.
- **`harbour_platform` Role**: Multi-tenant administrative role used for pre-auth phone/OTP lookups, rotating refresh tokens, migrations, daily ledger anchoring, and cross-tenant governance. Supports two deployment modes via `RLS_PLATFORM_MODE`:
  - `bypassrls` (self-hosted Postgres, default): `harbour_platform` holds `BYPASSRLS`; all 33 tenant tables retain `FORCE ROW LEVEL SECURITY`.
  - `owner` (managed Postgres such as Cloud SQL / RDS / Supabase): `harbour_platform` is `NOBYPASSRLS` and owns the schema tables with `NO FORCE ROW LEVEL SECURITY`, while `harbour_app` remains strictly constrained by RLS on all 33 tenant tables.
- **Fail-Closed Isolation**: When no session context (`set_config('app.tenant_id', ..., true)`) is set, `core.tenant_access_allowed(tenant_id)` evaluates to `false`, returning 0 rows across every tenant table.

