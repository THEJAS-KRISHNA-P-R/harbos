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
1. **Zero Direct SQL Outside Repos**: Routes, services, and UI components never execute raw SQL statements directly. All queries are encapsulated in dedicated `repo.ts` modules.
2. **App Shell Size Limit**: `src/server/app.ts` must remain lean (`<= 150 lines`), serving strictly as a route mounting harness.
3. **Module File Limits**: No file inside `src/server/**/*.ts` may exceed 600 lines.

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
- **`harbour_app` Role**: Restricted operational role with zero table-owner privileges, denied access to `core.schema_migrations` and `core.otp_challenges`, and strictly bound by PostgreSQL Row-Level Security (FORCE RLS across all 32 tenant tables).
- **`harbour_platform` Role**: Multi-tenant administrative role used exclusively for migrations, daily ledger anchoring, and cross-tenant benchmarks.
- **Fail-Closed Isolation**: When no session context is provided, `core.tenant_access_allowed(tenant_id)` returns `false`, ensuring 0 rows are returned across all tables.
