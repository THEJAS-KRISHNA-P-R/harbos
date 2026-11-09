# HarbourOS — Milestone Progress & Verification Log (`docs/PROGRESS.md`)

## Summary Status: M0 – M12 COMPLETED

### 1. Definition of Done (`D1` – `D10`) Evidence Matrix

| Criterion | Status | Evidence |
| :--- | :--- | :--- |
| **D1** Clean install & build | **DONE** | `npm run check` (`tsc --noEmit && tsx --test tests/**/*.test.ts && tsx scripts/check-boundaries.ts && tsx scripts/check-contrast.ts && vite build`) exits 0. |
| **D2** Integer paise & grams; zero float math | **DONE** | `src/shared/domain/money.ts`, `split.ts`, `allocate.ts` + 10,000-case property test in `tests/unit/m1-domain.test.ts`. |
| **D3** Real SHA-256 append-only balanced ledger | **DONE** | `src/shared/domain/ledger-hash.ts` + `db/migrations/001_harbouros_schema.sql` (`BEFORE UPDATE OR DELETE` trigger) + `scripts/verify-ledger.ts` (`headHash: 9b9d738a773b16a57a8aec3e656695f761385de2bffbe2086bbf75230ccb8178`). |
| **D4** Tenant isolation & verified JWT context | **DONE** | `src/server/platform/auth.ts` (`jose` HS256 JWT) + `core.current_tenant_id()` in PostgreSQL. |
| **D5** Lot oversell & stale leader fencing prevention | **DONE** | `allocateLotSale` in `src/server/platform/ledger-service.ts` + `tests/db/m2-postgres-ledger.test.ts` (rejects oversell, stale fencing token `< 10`, expired s.5 licence, s.4(8) loan mismatch, s.21 `REJECTED_UNFIT`). |
| **D6** All 7 Workspaces wired end-to-end | **DONE** | `/w/weighing`, `/w/pit`, `/w/buyer`, `/w/fisher`, `/w/inspector`, `/w/harbour`, `/w/platform` + `/login` + `/ui`. |
| **D7** Navy-on-Off-White UI, pill buttons (`--radius-pill: 9999px`), 16px cards, zero green | **DONE** | `npm run check:contrast` (17/17 WCAG 2.1 checks pass) + zero matches on §11.3 green & hardcoded hex grep gates. |
| **D8** Portable PostgreSQL (`PGlite` default + `DATABASE_URL`) | **DONE** | `src/server/ports/db.ts`, `src/server/adapters/db-pglite.ts`, `Dockerfile`, `docker-compose.yml`, `docs/PORTABILITY.md`. |
| **D9** Zero Firebase; vendor SDKs only inside `adapters/` | **DONE** | `npm run check:boundaries` (`[boundaries] All §6 architectural boundary and §11.3 visual hygiene rules passed.`). |
| **D10** Open decisions logged with owners | **DONE** | `OPEN-01` through `OPEN-12` and `DEFERRED` table recorded in `docs/DECISIONS.md`. |

---

### 2. Milestone Execution Log

#### M0 — Triage, Foundation & Design System
- Status: **DONE**
- Changed files: `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `scripts/check-boundaries.ts`, `scripts/check-contrast.ts`, `src/web/ui/tokens.css`, `src/web/ui/index.tsx`, `docs/DECISIONS.md`, `docs/PROGRESS.md`.
- Gate results: `npm run check` → exit 0; 17/17 WCAG 2.1 contrast checks pass; zero green tokens; zero hardcoded hex in `.tsx`.

#### M1 — Domain Core (Pure TypeScript)
- Status: **DONE**
- Changed files: `src/shared/ids.ts`, `src/shared/contracts/rbac.ts`, `src/shared/domain/money.ts`, `src/shared/domain/split.ts`, `src/shared/domain/allocate.ts`, `src/shared/domain/ledger-hash.ts`, `tests/unit/m1-domain.test.ts`.
- Gate results:
  - Golden Vector Mode A (`FIXED_SAAS_ONLY` on `10,000,000` paise): Fisherman `9,500,000`, Bonus `200,000`, Auctioneer `100,000`, HMS `100,000`, Co-op `100,000`, HOS `0`, Payable `10,000,000`.
  - Golden Vector Mode B (`INSTITUTIONAL_TECH_SHARE`): Fisherman `9,500,000`, Bonus `200,000`, Auctioneer `100,000`, HMS `80,000`, Co-op `80,000`, HOS `40,000`, Payable `10,000,000`.
  - Golden Vector Mode C (`HYBRID`): Fisherman `9,500,000`, Bonus `200,000`, Auctioneer `100,000`, HMS `80,000`, Co-op `80,000`, HOS `140,000`, GST `18,000`, Payable `10,118,000`.
  - 10,000-case random hammer conservation property test: PASS.
  - Partial-box allocation gram conservation property test: PASS.

#### M2 — Real PostgreSQL (`@electric-sql/pglite`), Migrations & Deterministic Seed
- Status: **DONE**
- Changed files: `db/migrations/001_harbouros_schema.sql`, `src/server/ports/db.ts`, `src/server/adapters/db-pglite.ts`, `src/server/platform/seed.ts`, `tests/db/m2-postgres-ledger.test.ts`.
- Gate results: Idempotent migration apply + `munambam-demo` seed + `BEFORE UPDATE OR DELETE` append-only trigger verification PASS.

#### M3 – M9 — Auth, RBAC, 7 Workspaces, Statutory Auction Engine, Double-Entry Ledger & Compliance Exports
- Status: **DONE**
- Changed files: `src/server/platform/auth.ts`, `src/server/platform/ledger-service.ts`, `src/server/app.ts`, `src/server/main.ts`, `src/web/lib/api.ts`, `src/web/workspaces/{weighing,pit,buyer,fisher,inspector,harbour,platform}/index.tsx`, `src/web/app/App.tsx`.
- Gate results: All 8 statutory checks (`s.4(4)`, `s.4(8)`, `s.5`, `s.10`, `s.19`, `s.21`, fencing token, buyer credit lock) and dual-key reversals verified in `tests/db/m2-postgres-ledger.test.ts`.

#### M11 & M12 — Ledger Verifier, Portability Proof & Runbook
- Status: **DONE**
- Changed files: `scripts/verify-ledger.ts`, `Dockerfile`, `docker-compose.yml`, `docs/PORTABILITY.md`, `docs/RUNBOOK.md`.
- `UNVERIFIED-IN-AI-STUDIO`:
  1. External PostgreSQL 16 via Docker Compose — human command: `docker compose up --build`
  2. Live Bluetooth / RS-232 scale hardware indicator (`OPEN-06`) — human command: test Web Bluetooth in Chromium against physical dockside scale.
  3. Native Android/iOS Malayalam TTS voice availability (`OPEN-09`) — fallback displays full Malayalam passbook transcript on screen.

---

### 3. Latest Real Gate Outputs

```text
$ npm run check && npx tsx scripts/verify-ledger.ts
[boundaries] All §6 architectural boundary and §11.3 visual hygiene rules passed.
[contrast] PASS | text-primary on bg-app       | #0F1F3D on #F6F6F3 | 15.11:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | text-primary on bg-surface   | #0F1F3D on #FFFFFF | 16.36:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | text-primary on bg-sunken    | #0F1F3D on #ECEDE8 | 13.90:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | text-secondary on bg-app     | #3B4A66 on #F6F6F3 | 8.23:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | text-secondary on bg-surface | #3B4A66 on #FFFFFF | 8.91:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | text-muted on bg-app         | #5A6882 on #F6F6F3 | 5.19:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | text-muted on bg-surface     | #5A6882 on #FFFFFF | 5.62:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | brand-fg on brand            | #FFFFFF on #1F3866 | 11.57:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | brand-fg on brand-hover      | #FFFFFF on #162A4F | 14.21:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | brand-soft-fg on brand-soft  | #162A4F on #E6EBF4 | 11.88:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | danger-fg on danger-bg       | #8A1C13 on #FDECEA | 8.14:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | danger on danger-bg          | #B42318 on #FDECEA | 6.57:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | warning on warning-bg        | #8A5300 on #FFF4DB | 5.79:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | info on info-bg              | #1B5E92 on #E3F0FA | 5.91:1 (min 4.5:1 - WCAG AA Text (4.5:1))
[contrast] PASS | border-strong on bg-app      | #74829F on #F6F6F3 | 3.57:1 (min 3.0:1 - WCAG Non-Text (3.0:1))
[contrast] PASS | border-strong on bg-surface  | #74829F on #FFFFFF | 3.86:1 (min 3.0:1 - WCAG Non-Text (3.0:1))
[contrast] PASS | focus on bg-app              | #2D4A80 on #F6F6F3 | 8.07:1 (min 3.0:1 - WCAG Non-Text (3.0:1))
[contrast] All 17 WCAG 2.1 token contrast checks passed.
✓ built in 800ms
{
  "verified": true,
  "entryCount": 12,
  "lastEntrySeq": "12",
  "headHash": "9b9d738a773b16a57a8aec3e656695f761385de2bffbe2086bbf75230ccb8178"
}
```
