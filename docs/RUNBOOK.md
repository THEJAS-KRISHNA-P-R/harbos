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
| `harbour_platform` | `LOGIN, BYPASSRLS, NOCREATEDB, NOCREATEROLE` | `DATABASE_PLATFORM_URL` | Pre-auth lookups (phone-to-user resolution, OTP verification, rotating refresh tokens) and cross-tenant platform governance. |

### Provisioning Procedure:
1. **Initial Migration Execution (as PostgreSQL DB Admin / Owner):**
   ```bash
   export DATABASE_URL="postgres://admin_user:admin_pass@host:5432/harbour_db"
   export HARBOUR_APP_PASSWORD="<generated-app-secret-32-chars>"
   export HARBOUR_PLATFORM_PASSWORD="<generated-platform-secret-32-chars>"
   npm run migrate
   ```
2. **Export to Platform Secrets Manager (e.g., GCP Secret Manager / AWS Secrets Manager):**
   - Store `harbour_app` connection string as `DATABASE_URL`: `postgres://harbour_app:<app-pass>@host:5432/harbour_db?sslmode=require`
   - Store `harbour_platform` connection string as `DATABASE_PLATFORM_URL`: `postgres://harbour_platform:<platform-pass>@host:5432/harbour_db?sslmode=require`
3. **Container Boot Configuration:**
   - Inject `DATABASE_URL` and `DATABASE_PLATFORM_URL` directly as runtime environment variables.
   - Neither application role is ever granted `SUPERUSER` or `CREATEROLE`.
   - Migration runner connects as administrative migrator via `DATABASE_PLATFORM_URL`.

