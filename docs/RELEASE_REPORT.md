# HarbourOS — Production Readiness Release Report (`v1.0.0`)

## 1. Executive Summary
HarbourOS v1.0.0 completes the full production-readiness hardening specification across security, multi-tenant Row-Level Security (RLS), statutory double-entry accounting under **Kerala Act 16 of 2021**, observability, and container deployment hygiene.

---

## 2. Red-to-Green Security Exploit Regression Verification (`tests/api/security.test.ts`)
All **16 security and statutory exploit tests** were first written and verified to fail (`0/16 pass, 16/16 fail`) against the pre-hardening codebase before applying fixes, and now pass **`16/16 GREEN`**:

| Test ID | Vulnerability / Statutory Gate | Pre-Fix (RED) | Post-Fix (GREEN) |
| :--- | :--- | :--- | :--- |
| **T01** | Hardcoded OTP `'202100'` rejected | `200 OK` (Exploitable) | `401 UNAUTHORIZED` |
| **T02** | OTP brute-force lockout after 5 failed attempts | `401` (Unlimited attempts) | `429 OTP_LOCKED` |
| **T03** | OTP single-use replay rejection | `200 OK` (Replayable) | `401 UNAUTHORIZED` |
| **T04** | Unauthenticated `/api/v1/auth/operators` & `/register-operator` removed | `200 / 201` (PII & Admin Takeover) | `404 NOT_FOUND` |
| **T05** | `/api/v1/system/sql-console` & `/source-bundle` removed | `200 OK` (SQL/Source Leak) | `404 NOT_FOUND` |
| **T06** | `/api/v1/bootstrap` scoped by caller role & tenant | `200 OK` (Leaked all users/logs to BUYER) | Scoped (`users: undefined`, `auditLogs: undefined`, 1 tenant) |
| **T07** | `allocate` rejects negative `boxesAllocated: -5` | `201` / `500` | `400 VALIDATION_ERROR` |
| **T08** | `allocate` rejects `NaN` / non-positive `pricePerKgPaise` | `500` | `400 VALIDATION_ERROR` |
| **T09** | `AUCTIONEER` cannot spoof another auctioneer's licence | `201` (Spoofed) | `403 FORBIDDEN` |
| **T10** | Uninspected lot (`inspection_grade IS NULL`) blocked at clearing (Act 16 s.21) | `201` (Cleared uninspected lot) | `422 LOT_REJECTED_UNFIT_S21` |
| **T11** | Replaying `Idempotency-Key` with different payload returns `422 IDEMPOTENCY_KEY_REUSED` | `200` (Ignored mutated params) | `422 IDEMPOTENCY_KEY_REUSED` |
| **T12** | Dual-key reversal rejects invalid second-approver supervisor PIN | `200` (No PIN check) | `401 INVALID_SUPERVISOR_PIN` |
| **T13** | Cross-tenant `POST /api/v1/lots/:lotId/inspect` blocked | `200` (Mutated foreign tenant lot) | `404 NOT_FOUND` |
| **T14** | Production config validation rejects placeholder secrets, `OTP_DEV_ECHO=true`, `DEMO_MODE=true` | Allowed boot | Throws fail-closed startup error |
| **T15** | Security headers (`CSP`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Request-Id`, no `X-Powered-By`) | Missing headers | Verified present on `/healthz` |
| **T16** | Fail-closed RLS (`core.tenant_access_allowed`) & deferred journal balance trigger (`trg_enforce_journal_balance`) | Fail-open when GUC unset; unbalanced entries allowed | 0 rows when GUC unset; unbalanced commit rejected |

---

## 3. Architectural & Codebase Cleanup Summary
- **Decommissioned Go Sidecar & `:5433` SQL Bridge:** Removed `/backend-go`, `/public/assets/aistudio`, `/bun.lock`, `/src/main.tsx` shim, and root debug screenshots.
- **Database Migrations `007`–`009`:**
  - `007_auth_and_sessions.sql`: `core.otp_challenges`, `core.sessions`, `core.users.supervisor_pin_hash`, `UNIQUE(phone_e164)`.
  - `008_rls_failclosed_and_idempotency.sql`: Fail-closed `core.tenant_access_allowed(tenant_id)` + `FORCE ROW LEVEL SECURITY` on all 19 tenant-scoped tables + `request_hash` & `UNIQUE(tenant_id, idempotency_key)` on `auction.sale_allocations`.
  - `009_statutory_ledger_and_payouts.sql`: `BANK_CLEARING` account kind, `BUYER_RECEIPT` reference type, nullable `auction.lots.inspection_grade`, `ledger.payout_batch_items`, `ledger.daily_anchors`, `ledger.verifications`, and deferred constraint trigger `trg_enforce_journal_balance`.
- **Real Observability:** Replaced fabricated `"3.24M"` user metrics and incident simulators with real in-process HTTP, SQL latency, and rate-limiter counters exposed at `GET /api/v1/metrics` (JSON & Prometheus text format) and `GET /healthz` / `GET /readyz`.
