# HarbourOS — Round 2 `/ponytail full` Production Release Report (`docs/RELEASE_REPORT.md`)

**Statute Authority:** Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021)  
**Target Stack:** Node.js 22 · TypeScript 7 (`strict`) · Express 4 · PostgreSQL 16 (with PGlite parity) · React 19 · Tailwind CSS 4

---

## 1. Phase Verification Summary (Phases A–D)

| Phase | Gate / Deliverable | Status | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **Phase A1** | Strict Fail-Closed PostgreSQL RLS (`010_rls_strict.sql`), `harbour_app` (`NOBYPASSRLS`) & `harbour_platform` (`BYPASSRLS`), `REVOKE UPDATE, DELETE, TRUNCATE ON ledger.entries, ledger.journals`, `req.db` tenant-bound `DbPort` | **PASS** | `tests/db/rls-strict.test.ts` (3/3 PASS) — 0 rows returned on all 22 RLS tables with empty context; `WITH CHECK` blocks cross-tenant `INSERT`; `TRUNCATE`/`DELETE` revoked on `ledger.entries`. |
| **Phase A2** | Mandatory Section 21 Inspection Gate (`WEIGHED_PENDING_INSPECTION`, `inspection_grade = NULL`, `weighed_by_user_id` separation of duties, re-inspection blocked after allocation, strict offline sync schema) | **PASS** | `tests/api/tenant-isolation.test.ts` (`A2` PASS) — Weigher self-inspection returns `403 SELF_INSPECTION_FORBIDDEN`; premature allocation returns `409`/`422`; re-inspection after allocation returns `409`. |
| **Phase A3** | Real Fisherman Payouts (`FOR UPDATE` on `FISHERMAN_PAYABLE > 0`, `422 NOTHING_PAYABLE`, balanced `PAYOUT_BATCH` journal), `confirmTotalPaise` + unique UTR per tenant, and `POST /api/v1/buyers/:buyerId/receipts` (`BUYER_RECEIPT` journal) | **PASS** | `tests/api/tenant-isolation.test.ts` (`A3` PASS) — 10x concurrent payout batch requests produce 1 `201` and 9 `422 NOTHING_PAYABLE`; buyer receipt clears receivable and rejects overpayment (`422`). |
| **Phase A4** | `core.refresh_tokens` (14d expiry, `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie, rotation + reuse family revocation, `POST /api/v1/auth/logout`, active user check in `requireAuth`) | **PASS** | `tests/api/tenant-isolation.test.ts` (`A4` PASS) — Refresh token reuse revokes the entire token family (`401`); deactivating `core.users.is_active` immediately blocks active JWTs (`401`). |
| **Phase A5** | Zero `${Date.now()}` IDs in `src/server` (`crypto.randomUUID()`), transactional `auditInTx(tx, ...)` with DB `now()`, `npm start` (`tsx/esm`), slim `Dockerfile` (`npm ci --omit=dev`), `pg_advisory_lock(84192021)` | **PASS** | Verified via `tests/api/tenant-isolation.test.ts` (`A5` PASS), `src/server/platform/seed.ts`, `scripts/migrate.ts`, and `Dockerfile`. |
| **Phase A6** | Centralized statutory citations in `src/shared/contracts/statute.ts` with `// NEEDS-COUNSEL` annotations and `docs/LEGAL_REVIEW.md` | **PASS** | `tests/unit/operator-profile.test.ts` enforces zero `/Act 16.*s\.\d/` matches outside `src/shared/contracts/statute.ts`. |
| **Phase A7** | Zero hardcoded `+91944700` demo phone numbers in `src/web` or `dist`; demo hints served from `GET /api/v1/demo/operators` only when `DEMO_MODE=true && NODE_ENV !== 'production'` | **PASS** | `grep -rn "+91944700" src/web dist` returns 0 matches; `tests/api/security.test.ts` verifies `404` when `DEMO_MODE=false`. |
| **Phase A8** | `.github/workflows/ci.yml` (`postgres:16-alpine`, `gitleaks`, `npm audit`, `check:budget`, `docker build`, phone leak check) & `.github/dependabot.yml` | **PASS** | Configured in `.github/workflows/ci.yml` and `.github/dependabot.yml`. |
| **Phase B** | Asset Diet & Performance Budget Gate (`scripts/check-budget.ts`, WOFF2 Latin + Malayalam subsetting, `React.lazy` workspace & `recharts` code-splitting, dev-gated `DesignSystemGalleryScreen`) | **PASS** | `dist/` reduced from **4,198 KB (4.1 MB)** to **1,110.0 KB (1.08 MB)**; raster images **0.0 KB**; fonts **143.8 KB**; initial JS **25.6 KB gzip**; largest chunk **258.3 KB raw**. |
| **Phase C** | Wise-Style Flat SVG Decor (`--decor-aqua`, `--decor-sun`, `--decor-sand`, `--decor-ink`), 13-fish Kerala `<SpeciesGlyphSprite />`, `<DawnHarbourHeroScene />`, `<WorkspaceHeaderIllustration />`, `<MomentIllustrationScene />` | **PASS** | 22/22 WCAG 2.1 AA/AAA token contrast checks pass in `scripts/check-contrast.ts`; all SVG components `<= 4 KB`. |

---

## 2. Production Bundle Size Comparison (Before vs. After Phase B)

| Metric | Round 1 (`Before`) | Round 2 (`After`) | Budget Limit | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Total `dist/` Directory Size** | `4,198.4 KB` (`4.10 MB`) | **`1,110.0 KB` (`1.08 MB`)** | `<= 1,500.0 KB` (`1.5 MB`) | **PASS (-73.6%)** |
| **Raster Images (`.jpg`, `.png`, `.webp`)** | `1,340.0 KB` | **`0.0 KB` (0 files)** | `<= 40.0 KB` | **PASS (-100%)** |
| **Bundled Fonts (`.woff2`, `.woff`)** | `1,720.0 KB` | **`143.8 KB` (6 files)** | `<= 250.0 KB` | **PASS (-91.6%)** |
| **Initial Entry JS (gzip)** | `184.2 KB` | **`25.6 KB` gzip** | `<= 150.0 KB` gzip | **PASS (-86.1%)** |
| **Largest Single JS Chunk (raw)** | `612.0 KB` | **`258.3 KB` raw** | `<= 350.0 KB` raw | **PASS (-57.8%)** |

---

## 3. Technical Debt Ledger (`ponytail:` Annotations) & Residual Risks

1. **Statutory Citation Sign-Off (`NEEDS-COUNSEL` in `src/shared/contracts/statute.ts`):**
   - `HARBOUR_COMMISSION_SPLIT` (`s.10(1)` vs `s.4(4)/s.4(5)(a)`) and `MARKET_COMMISSION_SPLIT` (`s.14(1)` vs `s.4(5)(b)`) are centralized in `src/shared/contracts/statute.ts` and documented in `docs/LEGAL_REVIEW.md` awaiting final Kerala High Court / Fisheries Department legal counsel confirmation.
2. **External SMS / WhatsApp Gateway Credentials (`SMS_PROVIDER=msg91` / `WHATSAPP_PROVIDER=meta`):**
   - Production startup refuses `console`/`noop` SMS providers; live DLT template IDs and MSG91 / Meta Cloud API credentials must be injected via secret manager prior to harbour cutover.
3. **Nodal Bank ISO 20022 Webhook Secret Rotation:**
   - `@harbouros/sdk` verifies `X-HarbourOS-Signature` using `QR_HMAC_SECRET` / nodal webhook secret; production deployments should configure dedicated per-bank webhook secrets in KMS.
