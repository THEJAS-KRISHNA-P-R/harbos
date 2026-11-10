# HARBOUROS — PRODUCTION-READINESS PROMPT (v2.0)

> Put this file in the repo at `docs/PRODUCTION_PROMPT.md`. Paste **§0** into AI Studio as the first message. It supersedes the roadmap in `HARBOUROS_AGENT_PROMPT.md` (v1). The v1 rules on money, ledger, statute, design tokens and no-lock-in still apply unless this file says otherwise.

---

## 0. KICK-OFF MESSAGE (paste this first)

```text
You are the production-hardening engineer for HarbourOS. Read docs/PRODUCTION_PROMPT.md fully, then docs/PROGRESS.md and docs/DECISIONS.md.

Rules:
1. FIRST ACTION: rewrite docs/PROGRESS.md truthfully. It currently says "M0-M12 COMPLETED" and "D1/D8 DONE". Those claims are false (see §2). Replace with the real status table from §2.
2. Do NOT add features. No new screens, no new modules. Close the findings in §2 in the phase order in §5.
3. Work ONE phase per session (I will say "go R1"). Never start the next phase.
4. Every fix is red-then-green: write the failing test that reproduces the finding, paste its failing output, fix, paste the passing output.
5. Never claim anything works without pasting the command and its real output. If you cannot run it in AI Studio, write UNVERIFIED-IN-AI-STUDIO and give me the exact command.
6. Ponytail: delete before you add. Fewest files. No new dependency without a one-line justification in docs/DECISIONS.md.
7. Never invent legal, tax, bank-format or provider facts. Log them as OPEN with an owner.

Reply first with: (a) the 5 findings you think are most dangerous, in your own words, (b) anything in §2 you believe is wrong, with evidence. Then do R0.
```

---

## 1. GOAL AND DEFINITION OF "PUBLIC-READY"

**Assumption (Thejas to confirm):** "public" = the site is reachable on the open internet, but **only tenants provisioned by the platform operator can log in**. There is **no open self-signup**. If you want self-serve signup, that is a separate feature and a separate legal review.

**Public-ready means every row below is true, with evidence in `docs/PROGRESS.md`:**

| # | Gate | Evidence |
|---|---|---|
| G1 | No authentication bypass exists: no backdoor OTP, no unauthenticated user creation, no unauthenticated data | `tests/api/security.test.ts` green (the exploit reproductions in §3) |
| G2 | Tenant isolation holds at the database, not only in handlers | cross-tenant tests green on **real Postgres** |
| G3 | Every route has a zod-validated input and a declared role set | route-table test green |
| G4 | A fresh clone builds and deploys: lockfile, Docker image, compose | `npm ci && npm run check` and `docker build` succeed |
| G5 | Production refuses to start when unsafe (no DB URL, weak/missing secrets, demo flags on, no SMS provider) | boot tests green |
| G6 | No demo data and no internal documents ship to production | image scan: `docker run … ls`, `curl /assets/aistudio` → 404 |
| G7 | Observability is real, not simulated | `/metrics` numbers match a load-test count |
| G8 | Backups restore and the ledger verifies after restore | restore drill output |
| G9 | CI runs on every push with a Postgres service | CI run link / log |
| G10 | Statute citations in docs and UI are correct | §6 table checked line by line |
| G11 | All OPEN items with launch impact have an owner and a decision | `docs/DECISIONS.md` |
| G12 | A staged soft launch at one harbour passed the §8 go/no-go list | signed checklist |

**Default targets (DEFAULTS, Thejas to confirm or change):** p95 API latency < 500 ms at 100 concurrent users on staging hardware; ledger post p95 < 250 ms; 5xx rate < 1%; RPO ≤ 15 min; RTO ≤ 1 h. The repo's "3M+ users" claims are fiction and are removed (F11). Do not state a user-scale number anywhere until a load test supports it.

---

## 2. VERIFIED AUDIT OF `harbos-main.zip`

Method: unzipped, `npm install`, `npm run check` (exit 0, 27/27 tests), `npm audit --omit=dev` (0 vulnerabilities), read the server, auth, DB and web code, booted the server with `NODE_ENV=production` and sent the requests in §3. **Not verified (no Docker or real Postgres here):** the Docker image build, behaviour on real Postgres, mobile layout, performance under load, the Go backend at runtime. Treat those as unknown.

### 2.1 P0 launch blockers (exploited live unless marked "code")

| ID | Finding | Evidence |
|---|---|---|
| F1 | **Hardcoded OTP backdoor.** `verifyOtpForPhone` accepts `202100` for any phone, with or without a pending OTP, in every environment. The login UI even pre-fills it. | `src/server/platform/auth.ts`; live: token issued for the fisherman account in production mode |
| F2 | **Unauthenticated `POST /auth/register-operator`.** Anyone picks any `role` (including `SUPER_ADMIN`) and `tenantId` and receives a signed JWT, no OTP. If the phone already exists it **overwrites that user's role and name** (account takeover). | `app.ts` ~L630; live: SUPER_ADMIN token issued; existing accountant converted to SUPER_ADMIN "Pwned" |
| F3 | **Unauthenticated `GET /auth/operators`** lists every operator: phone, role, tenant, licence numbers. `POST /auth/otp/request` returns 404 for unknown phones (user enumeration) and returns the user's full name and role to the caller. | live: 8 operators with phones returned without login |
| F4 | **RLS is fail-open and never activated.** Policies read `core.current_tenant_id() IS NULL OR tenant_id = …`, so with no tenant set every row is visible and writable. The server never calls `set_config('app.tenant_id', …)`. 13 of 24 tables have no RLS at all (`core.users`, `core.tenants`, `core.audit_logs`, `ledger.heads`, `ledger.payout_batches`, `ledger.reversal_requests`, `auction.sessions`, …). Roles `harbour_app`/`harbour_platform` are created but never granted anything or used; compose runs the app as the Postgres superuser, which bypasses RLS anyway. Isolation today is only whatever `WHERE tenant_id = $1` each handler remembers. | `db/migrations/002`, `grep set_config` |
| F5 | **Authorization is wrong.** `POST /lots/:id/allocate` is open to `WHOLESALE_BUYER`, and `auctioneerLicenceId`, `buyerId`, `sessionId`, `fencingToken` come from the request body with demo defaults (`LIC-MUN-001`, `BUY-01`, `SES-MUN-MORNING-01`, **fencingToken = 10**). The licence is not bound to the caller, so the s.5 licence check can be satisfied by naming someone else's licence, and the stale-lease check is skipped when the client omits the token. `/bootstrap` returns **all tenants** (`SELECT * FROM core.tenants`) and every row of fishermen, buyers (credit limits), journals and users to **every role**. | `app.ts` ~L1049, ~L713; live: attacker saw all buyer credit columns |
| F6 | **Demo data is always seeded**, including with `DEMO_MODE=false`; the demo tenant and demo users with known phones are created in any database the app is pointed at. Combined with F1 this is a ready-made way in. | `seed.ts`; live: demo operators present in production mode |
| F7 | **Production login cannot work.** OTP delivery is `DISPATCHED_CONSOLE` only; with `OTP_DEV_ECHO=false` nobody receives a code, so the backdoor is the only way in. | `app.ts` `/otp/request` |
| F8 | **Silent data loss.** Without `DATABASE_URL` production runs PGlite `memory://` and the seed. A restart erases everything. `PGLITE_DATA_DIR` is parsed but unused. | `main.ts` `startServer` |
| F9 | **The Docker build is broken.** `Dockerfile` runs `npm ci`, which requires `package-lock.json`; the repo has only `bun.lock`. Also: runs as root, copies the whole tree including `.aistudio/`, no `.dockerignore`, no `HEALTHCHECK`, runs `npx tsx` at runtime. `docker-compose.yml` hardcodes placeholder secrets that pass the 32-byte length check and uses the Postgres superuser as the app login. | live: `npm ci` fails; files |
| F10 | **Internal documents are served publicly.** `public/assets/aistudio/` (pasted agent prompts, the architecture PDF, `design.md`) is copied into `dist/` and served at `/assets/aistudio/*`. `.aistudio/` (10 MB of screenshots) and the 53 KB prompt are in the repo root. | file listing |
| F11 | **Fake observability.** `GET /api/v1/system/metrics` is unauthenticated and returns invented numbers (1,327,102 requests after 2 minutes of uptime, 98.5% cache hit). `POST /system/metrics/simulate` mutates them. `recordRateLimitEvent({ allowed: true })` is always true. A 735-line `observability.ts`, a dashboard and tests assert "3.24M+ users". | live; `observability.ts` |
| F12 | **Two backends and a SQL backdoor.** `main.ts` compiles and spawns a Go server (`/tmp/go/bin/go`, `pkill -9 -f harbouros-go-api`), proxies `/api/*` to it, and falls back to Node. Both implement the same money and auth logic. The production image has no Go, so **production runs different code from the AI Studio preview**. `main.ts` also opens `127.0.0.1:5433/internal/pg-exec`, an **unauthenticated arbitrary-SQL endpoint**. This contradicts ADR-001 (single deployable) and was not in the v1 prompt. | `main.ts`, `backend-go/` |

### 2.2 P1 must-fix before public

| ID | Finding |
|---|---|
| F13 | No request validation anywhere (`zod` is used only in `config.ts`). `BigInt(req.body.x)` throws 500; `Number()` of junk yields `NaN`. The error handler returns raw `err.message` on 500 (SQL text leaks). |
| F14 | Sessions: one 8 h JWT, kept only in React state (a page reload logs the operator out), no refresh token, no logout, no revocation. OTP store is an in-memory `Map` (lost on restart, wrong with 2 instances), no attempt counter, no per-phone throttle, plain `===` compare. Changing the phone in `/auth/profile` needs no OTP. |
| F15 | Rate limiting: IP-keyed with no `trust proxy`, so behind any proxy all users share one bucket (25 auth attempts per 15 min **for everyone**). Limiters are mounted twice (`main.ts` and `app.ts`). Memory store (per instance). |
| F16 | Headers: only `nosniff` and `Referrer-Policy`. No CSP, HSTS, frame protection; `X-Powered-By: Express` is on. |
| F17 | `GET /api/health` is public, leaks env/demo/OTP flags and migration checksum, and runs a **full ledger-chain verification on every probe**. `/bootstrap` does 20 queries (many `SELECT *`, unbounded) plus a full chain verification per page load, O(ledger size). |
| F18 | IDs come from `Date.now()`: `USR-OP-${Date.now() % 100000}`, `AUD-…-${Date.now()}`, `IDEM-${Date.now()}-${boxes}`. They collide under load; the idempotency fallback is **not idempotent**. |
| F19 | Ledger: journal balance is **not** enforced in the database (migration 003 only adds a view); the row hash is computed in application code, not by a trigger. v1 §8 required both in the DB. Hash correctness depends on every writer being the app. |
| F20 | Structure: `app.ts` is 1,800 lines in one function; `ledger-service.ts` 818; workspace files up to 1,105 lines. The 'M2' DB test is a single `it` of the whole system. No test calls an HTTP route. |
| F21 | Frontend: one JS entry (workspaces not lazy-loaded; charts 411 kB always loaded), hand-rolled `window.location.pathname` routing, no error boundaries, ~80 `aria-*`/`role` attributes in ~8k lines of TSX, the `/ui` gallery and persona switcher ship in the production bundle, all Inter subsets (Cyrillic/Greek/Vietnamese) are bundled. |
| F22 | Product gap: v1 M5 required an offline-capable weighing queue and a service worker. `DECISIONS.md` marks it DEFERRED-01 while `PROGRESS.md` says M5 DONE. There is no manifest, no service worker, no offline queue. |
| F23 | Repo hygiene: no `package-lock.json`, no `README.md`, no `LICENSE`, no CI, package name `react-example` v0.0.0, `metadata.json` still describes "Infrastructure as Code, CI/CD", `.env.example` defaults to `OTP_DEV_ECHO=true` and `DEMO_MODE=true` (and the config schema defaults both to `true`). |
| F24 | `docs/DECISIONS.md` cites the wrong sections of Act 16 of 2021 (see §6) and `PROGRESS.md` marks M3–M9 DONE in one line with no per-milestone evidence. |

### 2.3 What is good and stays

Pure domain math (`money`, `split`, `allocate`, `ledger-hash`) with golden vectors and property tests; real SHA-256 and a verifier; integer paise/grams/bps; the 8 statutory checks inside one DB transaction with row locks; `ledger.heads` locking; append-only triggers incl. TRUNCATE; the `DbPort` abstraction with PGlite and `pg`; `config.ts`; the token CSS, WCAG script and boundary script; zero Firebase; `npm audit` clean; `npm run check` passes.

---

## 3. EXPLOIT REGRESSION TESTS (write these FIRST, in R0, and watch them FAIL)

Create `tests/api/security.test.ts`. It boots `createApiApp` on an ephemeral port with `NODE_ENV=production`-equivalent config and PGlite, and uses `fetch`. Each case below must **fail today** and **pass after the listed phase**.

| Test | Request | Expected after fix | Phase |
|---|---|---|---|
| T1 backdoor | `POST /auth/otp/verify {phone: seeded, otpCode: "202100"}` with no OTP requested | 401 | R1 |
| T2 register | `POST /auth/register-operator {role:"SUPER_ADMIN", …}` no auth | route does not exist (404) | R1 |
| T3 takeover | same call with an existing phone | 404, user unchanged | R1 |
| T4 directory | `GET /auth/operators` no auth | 404 | R1 |
| T5 enumeration | `POST /auth/otp/request` with unknown and known phone | identical status and body | R1 |
| T6 OTP brute force | 6 wrong codes for one phone | 429/locked, correct code now also rejected until lockout ends | R1 |
| T7 replay | verify the same valid OTP twice | second is 401 | R1 |
| T8 metrics | `GET /system/metrics`, `POST /system/metrics/simulate` no auth | 404 (removed) or 401 | R5 |
| T9 buyer allocate | buyer token `POST /lots/:id/allocate` | 403 | R2 |
| T10 licence binding | auctioneer A names auctioneer B's `auctioneerLicenceId` | 403 | R2 |
| T11 token default | allocate without `fencingToken` | 400 validation error | R3 |
| T12 bootstrap scope | fisherman token `GET /bootstrap` | only own tenant, only own fisherman rows, no other users' phones, no buyer credit data | R2 |
| T13 cross-tenant | tenant A token requests tenant B lot/journal/policy by id | 404 | R2 |
| T14 validation | `pricePerKgPaise: "abc"`, negative boxes, 10 MB body | 400/413, no stack or SQL text in body | R3 |
| T15 idempotency | same `Idempotency-Key` twice | same result, one journal | R3 |
| T16 headers | `GET /` | CSP, HSTS (prod), `X-Frame-Options`/`frame-ancestors`, no `X-Powered-By` | R3 |
| T17 public files | `GET /assets/aistudio/…` | 404 | R0 |
| T18 health | `GET /healthz`, `/readyz` | no config leak, no ledger scan | R3 |
| T19 boot safety | start with `NODE_ENV=production` and: no `DATABASE_URL`; secret < 32 bytes; placeholder secret; `DEMO_MODE=true`; `OTP_DEV_ECHO=true`; no SMS provider | process exits non-zero with a clear reason | R1/R4 |
| T20 SQL bridge | connect to `127.0.0.1:5433` | connection refused (bridge removed) | R0 |

DB-level tests (run on real Postgres in CI, PGlite where it supports it): with no tenant set, `SELECT` on every tenant table returns **0 rows**; with tenant A set, tenant B rows are invisible and `INSERT` with tenant B's id fails; the app role cannot `UPDATE/DELETE/TRUNCATE` ledger tables; an unbalanced journal fails at commit; the hash written by the DB trigger equals the TypeScript golden vector.

---

## 4. ENGINEERING RULES FOR THIS WORK

1. **Close findings, don't add features.** A change that does not map to an F-number or a G-gate needs a one-line reason in DECISIONS.
2. **Security fixes are fixed once at the shared layer** (auth middleware, `withTenant` wrapper, zod helper), never per route.
3. **Secure by default.** Defaults are production-safe: `OTP_DEV_ECHO=false`, `DEMO_MODE=false`, no demo seed, no console SMS in production. Dev convenience is opt-in and refused when `NODE_ENV=production`.
4. **One backend.** Node only. Delete Go, the bridge and the spawn code. *(Thejas: tell me now if you asked for the Go backend on purpose; otherwise this stands.)*
5. **Fail closed.** Missing tenant context → no rows. Missing secret → refuse to boot. Unknown role → 403.
6. **Least data.** Each role gets only the rows and columns it needs. Never `SELECT *` to a client.
7. **Evidence format** in `docs/PROGRESS.md` per phase: status, changed files, the failing test output, the passing output, `UNVERIFIED-IN-AI-STUDIO` items with the human command, new OPEN items.
8. **Do not weaken money, ledger or statute rules from v1** (integer math, append-only, dual-key reversals, Modes B/C locked behind sign-off).

---

## 5. PHASES

Each phase ends with its **Exit gate**. Run `npm run check` at the start of every session; if it was green and is red, fix that first.

### R0 — Freeze, clean and make it buildable (F9, F10, F12, F23, part of F20)
- Rewrite `docs/PROGRESS.md` honestly (kick-off rule 1).
- Write `tests/api/security.test.ts` (§3). Show T1–T20 failing.
- Delete: `backend-go/`, the Go spawn + proxy + `:5433` bridge in `main.ts`, `public/assets/aistudio/`, `.aistudio/`, `src/main.tsx` (re-export shim; point `index.html` at `/src/web/main.tsx`), stale `metadata.json` text. Move `HARBOUROS_AGENT_PROMPT.md` and the PDF/design inputs to `docs/internal/` and add `docs/internal/` to `.dockerignore`.
- Lockfile: pick **npm**, generate `package-lock.json`, delete `bun.lock`, add `"engines": {"node": ">=22"}`. Rename package `harbouros`, version `0.1.0`.
- Add `.dockerignore`, `README.md` (what it is, run, env table, deploy pointer), `LICENSE` (**OPEN: owner decides; default "All rights reserved" notice, not an open-source licence**), `SECURITY.md` (how to report).
- `.env.example`: safe defaults, no real-looking secrets.
- **Exit gate:** `npm ci && npm run check` exit 0; T17 and T20 pass; `git ls-files`-style listing shows no internal docs under `public/`; repo size drops (report before/after).

### R1 — Authentication rebuild (F1, F2, F3, F6, F7, F8, F14)
- Remove the `202100` path, `register-operator`, `auth/operators`, and the login screen's pre-filled demo code. `persona-switch` stays only when `DEMO_MODE=true` **and** `NODE_ENV!=='production'`, and is excluded from the production bundle.
- OTP: store **hashed** OTP in a DB table (`core.otp_challenges`: phone, hash, expires_at ≤ 5 min, attempts, locked_until, consumed_at); 6 digits from `crypto.randomInt`; max 5 attempts then lock; per-phone and per-IP throttle; constant-time compare; same response for known and unknown phones; invalidate on success.
- Sessions: short access JWT (≤ 15 min) + rotating refresh token in an `httpOnly; Secure; SameSite=Strict` cookie, **hash stored in `core.sessions`**, reuse detection revokes the session family, `POST /auth/logout`, `GET /auth/sessions`. Access token stays in memory; the client silently refreshes on load and on 401.
- Users are created only by `HARBOUR_ADMIN`/`SUPER_ADMIN` (invite) and the first super-admin by a CLI `scripts/create-super-admin.ts`. Changing a phone requires OTP on the new number.
- `Notify` port with a real adapter: **provider is OPEN-07/08 (Thejas)**. Until a provider adapter exists, production boot **fails** when `SMS_PROVIDER` is `console`. Add an outbox worker with retry and delivery status.
- Seed split: `scripts/seed-demo.ts` (explicit, refuses on `NODE_ENV=production`) replaces auto-seed. Production boot does **not** seed.
- Config: production requires `DATABASE_URL`, three distinct secrets ≥ 32 bytes that are not placeholders, `OTP_DEV_ECHO=false`, `DEMO_MODE=false`; defaults flipped to `false`; refresh and QR secrets no longer fall back to random values in production.
- **Exit gate:** T1–T7, T19 pass; a manual flow log shows OTP request → verify → refresh → logout → refresh rejected; unit test for lockout timing; restart test shows pending sessions survive (DB-backed).

### R2 — Tenant isolation and authorization (F4, F5)
- `withTenant(tenantId, userId, role, fn)` wrapper: `BEGIN; SELECT set_config('app.tenant_id',…, true), …;` used by **every** query path. No handler calls `db.query` directly.
- Migration rewrite: `core.current_tenant_id()` returns NULL when unset and policies are **`USING (tenant_id = core.current_tenant_id())` with `WITH CHECK` — no `IS NULL OR`**. `ENABLE` + `FORCE` RLS on **every** table that has `tenant_id`, including the 13 missed. `core.tenants` gets its own policy (`tenant_id` = own id; platform role sees all).
- Roles: `harbour_owner` (migrations), `harbour_app` (runtime, `NOBYPASSRLS`, explicit `GRANT`s, `REVOKE UPDATE, DELETE, TRUNCATE` on ledger tables), `harbour_platform` (separate pool for SUPER_ADMIN cross-tenant reads, every use audited). Compose/Cloud config uses the **app role** to connect, never the owner or a superuser.
- Authorization: derive `auctioneerLicenceId` from the caller's `entityRefId`, `buyerId` from the session or the paddle lookup, `sessionId` from the open session — never from the body, never defaulted. Remove `WHOLESALE_BUYER` from the allocate route; a remote buyer's bid is a separate `bid` endpoint that does not settle.
- Replace `/bootstrap` with per-workspace endpoints returning **only** what that role needs (column lists, no `SELECT *`, paginated), with the ledger-verification result read from a stored job result, not recomputed.
- Route table test: every route declares roles; the test iterates the Express router and fails on an undeclared route.
- **Exit gate:** T9, T10, T12, T13 pass; the DB tests in §3 pass **on real Postgres** (CI) and on PGlite where supported (list what PGlite cannot do); `grep -rn "SELECT \*" src/server` returns nothing in client-facing paths.

### R3 — API hardening (F11 partly, F13, F15, F16, F17, F18)
- Split `app.ts` by module (`identity`, `harbour`, `catch`, `auction`, `ledger`, `reports`) behind a small `defineRoute({ method, path, roles, input, handler })` helper that applies auth, role check, zod parse and error mapping once.
- Shared zod contracts in `src/shared/contracts/` for every request and response. Money and weight cross the wire as decimal **strings**.
- IDs: server-generated `crypto.randomUUID()` (or UUIDv7). **Idempotency** middleware: `Idempotency-Key` required on mutating money routes, stored with the response, replays return the stored result.
- Error handler: never return `err.message` for non-`AppError`; log with request id; return `{error:{code,message,requestId}}`.
- Headers: CSP (self only, fonts/images local, `frame-ancestors 'none'`), HSTS in production, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; disable `X-Powered-By`. (`helmet` is acceptable if justified.) No CORS unless an origin env is set.
- `trust proxy` configurable by env; **one** rate-limit layer, keyed by IP + phone for auth; document that the memory store is per instance (`// ponytail:` upgrade path = Postgres-backed counter).
- `GET /healthz` (process up) and `GET /readyz` (DB ping + migration version) with no config or demo flags. Ledger verification becomes a scheduled job writing to `ledger.verifications`; `GET /ledger/verify` reads the last result and `POST` triggers a run for `ACCOUNTANT`/`HARBOUR_ADMIN`.
- Body limit 100 kB default, per-route overrides; graceful shutdown (`SIGTERM`: stop accepting, drain, close pool).
- **Exit gate:** T11, T14, T15, T16, T18 pass; `app.ts` no longer exceeds 300 lines; no handler over 60 lines; concurrency test shows 50 parallel same-key requests produce one journal.

### R4 — Database integrity and operations (F8, F19)
- Real migration runner semantics (checksums, advisory lock, refuse edited applied files, forward-only). Squash the six migrations into a clean chain if they have never run in a durable database (state which in DECISIONS).
- DB-enforced invariants: deferred constraint trigger asserting `SUM(D)=SUM(C)` and ≥ 2 entries per journal; the hash computed by a BEFORE INSERT trigger on `ledger.entries` (using the head row lock), with the TypeScript function reduced to the verifier; one golden vector asserted in both.
- Production boot requires `DATABASE_URL`; `memory://` PGlite allowed only when `NODE_ENV!=='production'`. A durable PGlite directory is **not** a production option.
- Scripts: `scripts/backup.sh` (`pg_dump`), `scripts/restore.sh`, `scripts/verify-ledger.ts` run after restore. Document retention (OPEN-12).
- Index review from real query plans on seeded volume (report `EXPLAIN` for the five hottest queries).
- **Exit gate:** DB tests in §3 green on real Postgres; restore drill: dump → restore into an empty DB → `verify-ledger` true → counts equal (paste output, mark UNVERIFIED-IN-AI-STUDIO if Docker is unavailable); unbalanced-journal and tamper tests pass.

### R5 — Replace theatre with real observability (F11, F20 part)
- Delete `observability.ts` simulation, `/system/metrics*`, `PerformanceDashboard` fake series, `simulateProductionIncident`, the "3.24M" tests and strings. Platform "System" page shows **real** values only.
- Real counters and a latency histogram per route (in-process, Prometheus text format at `/metrics`, protected by a bearer token env and/or network policy), DB pool stats, outbox queue depth, last ledger-verification result and age, job failures. Structured JSON logs with request id, tenant id, user id (no PII bodies).
- Error-reporting seam: an `ErrorSink` port with a console adapter (a Sentry-compatible adapter is optional and behind env).
- **Exit gate:** T8 passes; a 1,000-request script produces `/metrics` counts that match exactly; no string `simulate`, `3M`, or `TRAFFIC_SURGE` remains (`grep`).

### R6 — Frontend production hardening (F21, F22, F14 client side)
- `react-router` with route-level `lazy()` per workspace; route guards by role; `ErrorBoundary` per workspace; `/ui` gallery and persona switcher compiled out of production (`import.meta.env.PROD`). Report bundle sizes before and after and set budgets from the measurement.
- Fonts: import only `latin` and `malayalam` subsets (and weights actually used).
- Auth client: in-memory access token, silent refresh, single-flight refresh, logout everywhere on refresh failure.
- Every screen has loading, empty, error and permission-denied states; every mutation disables its button while pending and shows the real server error code (not a stack).
- Accessibility pass on all 7 workspaces: labels, focus order, `aria-live` for toasts and sync status, keyboard-only path for `harbour` and `platform`. Automated axe run is **UNVERIFIED-IN-AI-STUDIO** unless the environment can run it; provide the command.
- **Offline (decision needed, see §9 Q5):** if included in v1, implement exactly the v1 M5 spec: IndexedDB command queue for weighing, UUID command ids, `/sync/commands` idempotent with quarantine, service worker for the app shell, web manifest. If not, show a persistent "Online required" banner, disable weighing writes when offline, and state it in the README.
- **Exit gate:** `npm run check` green; bundle report; Lighthouse/axe output or the human command; a recorded manual run through each workspace with screenshots at 360/768/1280 px under `docs/screens/`.

### R7 — Tests and CI (F20)
- Move toward one file per behaviour: split the monolithic DB test; add API tests for auth abuse, authorization matrix (every role × every route), cross-tenant, validation, idempotency, rate limiting; DB tests on real Postgres; concurrency tests (50 parallel allocations on one lot never oversell; stale fencing token rejected; double-stop on Dutch clock has one winner).
- `c8` coverage report; set a floor from the measured baseline and raise it, never lower it.
- GitHub Actions: Node 22, Postgres 16 service, `npm ci`, `npm run check`, DB + API tests against the service, `npm audit --omit=dev`, `docker build`, container smoke test (`/readyz`), upload coverage and bundle report.
- **Exit gate:** CI green on a clean checkout (paste the workflow file and a run log, or the exact local equivalent if CI cannot be executed here).

### R8 — Container, deploy, operate (F9, G4–G9)
- Multi-stage Dockerfile: build stage; runtime stage with production deps only, **non-root user**, `HEALTHCHECK` on `/readyz`, no dev tooling, no `tsx` at runtime (bundle the server with `esbuild` and pin a version compatible with the installed Vite, or justify an alternative), pinned base image tag. Verify the final image contains no `docs/internal`, `.aistudio`, `*.map` with secrets, or `.env`.
- `docker-compose.yml` for **local dev only**; `docker-compose.prod.example.yml` with `${VARS}` and no credentials. Migrations run as a separate one-shot command (`npm run migrate`), not on every app boot in production.
- `docs/DEPLOY.md`: Cloud Run, Fly.io and a plain VPS with a reverse proxy (TLS, HSTS, `trust proxy`), env table, secret rotation steps (JWT, QR HMAC; note that rotating the QR secret invalidates printed stickers — design a key id), zero-downtime migration policy, rollback.
- `docs/RUNBOOK.md` additions: ledger-verify failure procedure (stop settlement, snapshot, compare to the anchored head hash), restore procedure, OTP provider outage, suspected token leak.
- Uptime monitor and alert on `/readyz`, ledger-verify age, outbox depth.
- **Exit gate:** `docker build` and `docker run` evidence (or `UNVERIFIED-IN-AI-STUDIO` with the exact commands for the human); `docker run … ls /app` shows only runtime files; a staging deployment answers `/readyz`.

### R9 — Legal, privacy and content correctness (F24, G10, G11)
- Fix statute citations (§6) in `DECISIONS.md`, UI and exports; every UI string citing the Act must name a section that exists. Add "Generated by HarbourOS, not legal advice" to statutory exports.
- Modes B/C remain locked; add a visible banner when any tenant runs B/C without sign-off fields (impossible by DB CHECK; test it).
- Privacy: inventory personal data (names, phones, GSTIN, bank details, UTRs, licence numbers), define retention, and prepare `docs/PRIVACY_DRAFT.md` and `docs/TERMS_DRAFT.md` **for a lawyer to finalise** (OPEN-12). Do not publish them as final. Whether and how India's data-protection law applies, and what consent and breach-notice duties exist, must be confirmed by a lawyer; do not assert it.
- Remove demo imagery that implies real endorsements or real people; keep sample names obviously fictional.
- **Exit gate:** §6 table all "fixed"; `grep -rn "Munambam" src/server src/shared` returns only seed/demo files; OPEN register reviewed with Thejas.

### R10 — Staged launch
- Staging with production-like config and a separate database; run the §3 tests plus the load test against it.
- Load test (`autocannon` or a small fetch harness): login, bootstrap-replacement endpoints, allocate, ledger read at 100 concurrent users for 10 minutes; record machine, results, errors; compare to the §1 targets.
- Penetration-style self-review against the §3 list plus: JWT `alg` confusion, token in URL, CSRF on cookie refresh (SameSite + origin check), mass assignment, ID enumeration, file/path traversal on static, log injection.
- **Exit gate:** §8 go/no-go list signed by Thejas.

---

## 6. STATUTE CITATION FIXES (checked against the Act's text on India Code)

| Where | Currently says | Act 16 of 2021 says | Fix |
|---|---|---|---|
| `DECISIONS.md` C1 | Commission cap "under s.10(1)" | s.4(4): amount **not exceeding five percent** may be realised | cite s.4(4) |
| `DECISIONS.md` C2 | split at "s.10(1)" | s.4(5)(a): auctioneer 20, HMS/FLCMS 20, fishermen annual production bonus 40, societies taking part in the auction 20 | cite s.4(5)(a) |
| `DECISIONS.md` C3 | market split "s.14(1)", "20% Auctioneer, 20% MMS, **30% Fisher Annual Bonus, 30% Co-op Societies**" | s.4(5)(b): auctioneer 20, FMMS 20, **Fishermen Welfare Fund Board 30, LSGI/market owner 30** | cite s.4(5)(b); fix recipients in the seed and the UI |
| `DECISIONS.md` C4 | "PDF 50/20/20/10 vs Act" | The PDF split is 20/20/40/20, the same as the Act | delete the claim |
| `DECISIONS.md` OPEN-02 | "s.10(1), s.14(1), s.23" | s.4(6) (no other benefits), s.6(1)(iii) (auctioneer fees); s.23 is cancellation/suspension of licences | cite s.4(6), s.6(1)(iii) |
| `DECISIONS.md` C13 | s.19(2) "co-op 50%+ procurement" | s.19(2): fish may be procured through the fishermen's co-op society **after giving the basic price**; no 50% figure | remove "50%+" |
| `DECISIONS.md` C12 | s.10 proviso | HMS may, **with Government permission**, take over first sale avoiding auction (s.10(ii) proviso) | keep; require the permission reference |
| `DECISIONS.md` C1/C4 | "must" apportion | s.4(4) "may be realised", s.4(5) "may be apportioned" | wording: configurable, default = Act's ratios |
| `DECISIONS.md` numbering | ADR-004…009 and OPEN-01…12 differ from the v1 prompt | n/a | keep the repo's numbering; update references in other docs |

Also verify every `s.xx` string in `src/web/**` and exports against the Act text before R9 closes. The ones found by `grep` (s.4(5), s.4(8), s.5, s.19, s.21, s.19(2), s.10 proviso) are correct in sense; re-read each in context.

---

## 7. OPEN ITEMS THAT BLOCK LAUNCH (agent logs; Thejas resolves)

| ID | Item | Blocks |
|---|---|---|
| OPEN-07/08 | SMS (and WhatsApp) provider, sender registration and template approval requirements in India; chosen provider | R1 exit, launch |
| OPEN-13 | Hosting target (Cloud Run / Fly / VPS) and region | R8 |
| OPEN-14 | Production Postgres (managed provider, PITR on, who owns backups) | R4, R8 |
| OPEN-15 | Domain name, TLS, email sender domain | R8, launch |
| OPEN-16 | Licence/ownership notice for the code | R0 |
| OPEN-17 | Offline in v1 or online-only launch (Q5) | R6 |
| OPEN-18 | Legal opinion on s.4(6) for any transaction-linked fee, GST treatment, privacy/terms text (existing OPEN-02/03/12) | enabling modes B/C, publishing terms |
| OPEN-19 | Pilot harbour, bank payout file format, scale and printer models (existing OPEN-04/06/07 in v1 numbering) | pilot |
| OPEN-20 | Whether the Go backend was requested on purpose (§4 rule 4) | R0 |

---

## 8. GO / NO-GO CHECKLIST FOR PUBLIC RELEASE

All must be YES. Any NO blocks release.

1. T1–T20 and the DB isolation tests pass on the staging deployment.
2. No demo tenant, demo user or demo phone exists in the production database.
3. `/assets/aistudio` and every internal doc return 404; the image contains none.
4. Production boots only with a durable `DATABASE_URL`, strong distinct secrets, real SMS provider; otherwise it exits.
5. A real operator logs in with a real SMS OTP on a real phone.
6. Refresh, logout and session revocation work; stolen refresh reuse revokes the session.
7. A backup was restored into an empty database and `verify-ledger` returned true.
8. Ledger verification runs on a schedule and alerts on failure; the anchored head hash is stored outside the DB.
9. `/metrics` matches a counted load test; no simulated numbers remain.
10. CI is green on the release commit; `npm audit --omit=dev` is clean or each finding is justified.
11. Rollback was rehearsed (previous image + migration policy).
12. Statute citations are correct (§6); statutory exports carry the "not legal advice" line.
13. Modes B/C cannot be enabled without sign-off fields (DB CHECK tested).
14. Privacy and terms texts were reviewed by a lawyer (or the site does not collect personal data beyond provisioned users and says so).
15. The §1 targets were measured on staging and met, or Thejas accepted the measured numbers in writing.
16. A named person owns on-call, backups and the OTP provider account.

---

## 9. QUESTIONS FOR THEJAS (answer before the phase that needs them)

1. **Public = invite-only tenants, no open signup?** (assumed yes; affects R1, R9)
2. **Go backend:** requested on purpose? (default: delete in R0)
3. **Scale target:** what real concurrent users and harbours at launch? (the "3M" figure has no basis; defaults in §1)
4. **SMS provider** and who registers the sender/templates (R1)
5. **Offline weighing in v1, or online-only launch?** (R6)
6. **Hosting and Postgres provider**, and the production domain (R8)
7. **Licence notice** for the repository (R0)

---

**Final instruction to the agent:** start with §0. Do the PROGRESS.md rewrite, write the failing exploit tests, then R0 only. Report. Wait for "go R1".