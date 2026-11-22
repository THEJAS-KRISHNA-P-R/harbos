# HarbourOS — Operations & Ledger Integrity Runbook (`docs/RUNBOOK.md`)

## 1. Daily Harbour Morning Flow
1. **Weighing & QR Tagging (`/w/weighing`):** Weighing Operator selects landed vessel, selects species (Malayalam + English), captures integer gram weight, and locks the lot to print an HMAC-SHA256 signed QR sticker.
2. **Quality Certification (`/w/inspector`):** Authorized Inspector grades the lot under Section 21 (`A_EXPORT`, `A_DOMESTIC`, `B_PROCESS`, or `REJECTED_UNFIT`). Lots graded `REJECTED_UNFIT` are blocked from auction allocation.
3. **Pit Auction & Allocation (`/w/pit` & `/w/buyer`):** Licensed Auctioneer conducts the auction (`PHYSICAL_SHOUT`, `HYBRID_REMOTE`, `DUTCH_CLOCK`, `COOP_PROCUREMENT` s.19(2), or `HMS_DIRECT_TAKEOVER` s.10 proviso). Confirming a hammer drop runs all 8 statutory checks and posts a balanced double-entry journal in the same PostgreSQL transaction.
4. **End-of-Day Accounting & UTR Reconciliation (`/w/harbour`):** HMS Accountant generates the payout CSV batch, reconciles the bank UTR reference, and downloads the Section 22 Statutory Return.

## 2. Continuous SHA-256 Ledger Verification & Honest Limits (§8)
- Run `npx tsx scripts/verify-ledger.ts` (or call `GET /api/v1/ledger/verify`) to recompute the entire SHA-256 hash chain from genesis (`0000...0000`) in TypeScript and compare against `ledger.entries`.
- **Honest Limit (§8):** Database `BEFORE UPDATE OR DELETE` triggers block mutations by the runtime application role, whereas a database superuser/owner with `ALTER TABLE ... DISABLE TRIGGER` could rewrite underlying storage. Running `scripts/verify-ledger.ts` and anchoring the daily `headHash` externally (e.g. emailed daily by the HMS Chief Accountant) detects any out-of-band storage tampering.

## 3. Database Role Provisioning & Secrets Management
HarbourOS enforces strict least-privilege separation across two distinct application database roles:

| Role Name | Privileges | Target URL Variable | Purpose |
|---|---|---|---|
| `harbour_app` | `LOGIN, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE` | `DATABASE_URL` | All normal tenant requests. Bound to `app.tenant_id` per request via `withTenant()`. Forbidden from accessing platform-only tables (`core.otp_challenges`, `core.refresh_tokens`, `core.schema_migrations`). Immutable ledger rows cannot be updated, deleted, or truncated. |
| `harbour_platform` | `LOGIN, BYPASSRLS` (`bypassrls` mode) **or** `LOGIN, NOBYPASSRLS` + table owner (`owner` mode) | `DATABASE_PLATFORM_URL` | Pre-auth lookups (phone-to-user resolution, OTP verification, rotating refresh tokens), scheduled jobs, and cross-tenant platform governance. |

### Deployment Mode Selection (`RLS_PLATFORM_MODE`)
1. **Option A — Self-Hosted PostgreSQL (`RLS_PLATFORM_MODE=bypassrls`, default):**
   - `harbour_platform` receives `BYPASSRLS` (`NOSUPERUSER, NOCREATEDB, NOCREATEROLE`).
   - All 33 tenant tables retain `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
   - Migrate & verify:
     ```bash
     export RLS_PLATFORM_MODE=bypassrls
     export DATABASE_PLATFORM_URL="postgres://admin_user:admin_pass@host:5432/harbour_db"
     export HARBOUR_APP_PASSWORD="<generated-app-secret-32-chars>"
     export HARBOUR_PLATFORM_PASSWORD="<generated-platform-secret-32-chars>"
     npm run migrate
     DATABASE_URL="postgres://harbour_app:${HARBOUR_APP_PASSWORD}@host:5432/harbour_db" \
     DATABASE_PLATFORM_URL="postgres://harbour_platform:${HARBOUR_PLATFORM_PASSWORD}@host:5432/harbour_db" \
       npx tsx scripts/verify-rls.ts
     ```
2. **Option B — Managed PostgreSQL without `BYPASSRLS` (`RLS_PLATFORM_MODE=owner` — Cloud SQL, AWS RDS, Supabase):**
   - Managed Postgres providers disallow granting `BYPASSRLS` to customer roles. Setting `RLS_PLATFORM_MODE=owner` configures `harbour_platform` as `NOBYPASSRLS`, transfers table ownership of `core/harbour/auction/ledger/sync` tables to `harbour_platform`, and sets `NO FORCE ROW LEVEL SECURITY` so ONLY the owner (`harbour_platform`) can execute cross-tenant platform queries while `harbour_app` remains strictly isolated by RLS across all 33 tenant tables.
   - Migrate & verify:
     ```bash
     export RLS_PLATFORM_MODE=owner
     export DATABASE_PLATFORM_URL="postgres://admin_user:admin_pass@host:5432/harbour_db"
     export HARBOUR_APP_PASSWORD="<generated-app-secret-32-chars>"
     export HARBOUR_PLATFORM_PASSWORD="<generated-platform-secret-32-chars>"
     npm run migrate
     RLS_PLATFORM_MODE=owner \
     DATABASE_URL="postgres://harbour_app:${HARBOUR_APP_PASSWORD}@host:5432/harbour_db" \
     DATABASE_PLATFORM_URL="postgres://harbour_platform:${HARBOUR_PLATFORM_PASSWORD}@host:5432/harbour_db" \
       npx tsx scripts/verify-rls.ts
     ```
3. **Export to Platform Secrets Manager (e.g., GCP Secret Manager / AWS Secrets Manager):**
   - Store `harbour_app` connection string as `DATABASE_URL`: `postgres://harbour_app:<app-pass>@pgbouncer:6432/harbour_db?sslmode=require`
   - Store `harbour_platform` connection string as `DATABASE_PLATFORM_URL`: `postgres://harbour_platform:<platform-pass>@host:5432/harbour_db?sslmode=require`
4. **Container Boot Configuration:**
   - Inject `DATABASE_URL`, `DATABASE_PLATFORM_URL`, and `RLS_PLATFORM_MODE` (`bypassrls` or `owner`) directly as runtime environment variables.
   - Neither application role is ever granted `SUPERUSER` or `CREATEROLE`.


