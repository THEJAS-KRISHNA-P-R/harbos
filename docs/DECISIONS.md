# HarbourOS — Architectural Decisions, Conflict Resolutions & Open Register (`docs/DECISIONS.md`)

## 1. Source-of-Truth Authority Hierarchy (§1)
1. **Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021)** — binding law.
2. **HarbourOS Business Proposal PDF** — primary commercial & workflow specification.
3. **Architecture & Requirements Markdown (`MD`)** — technical specification where consistent with #1 and #2.
4. **Archived Prototype Reference (`docs/reference/`)** — reference math/export logic only; zero runtime authority.
5. **Visual Reference (`design.md`)** — layout/density inspiration only; palette overridden by §11 Navy-on-Off-White.

---

## 2. Architecture Decision Records (`ADR-001` … `ADR-009`)

| ADR ID | Decision Title | Status | Summary & Rationale |
| :--- | :--- | :--- | :--- |
| **ADR-001** | Single-Deployable Modular Monolith | Accepted (M0) | Ship one Express + Vite/React + PostgreSQL deployable (`src/shared`, `src/server`, `src/web`) with compile-time boundary checks (`scripts/check-boundaries.ts`). Rejects premature 6-microservice split (`C10`). |
| **ADR-002** | Dual-Driver PostgreSQL (`pg` + `@electric-sql/pglite`) | Accepted (M0, Wired in M1) | Use `pg` when `PG_CONNECTION_STRING` is set; otherwise boot embedded real PostgreSQL via `@electric-sql/pglite` at `PGLITE_DATA_DIR` so triggers, constraints, and roles execute in real Postgres SQL. |
| **ADR-003** | Integer Paisa, Integer Grams & Basis Points | Accepted (M0) | All currency is stored and computed as `BIGINT` paisa (`₹1 = 100 paisa`), weights as `BIGINT` grams (`1 kg = 1000 g`), and rates in basis points (`10,000 bps = 100%`). Zero IEEE-754 floats in settlement or weighing. |
| **ADR-004** | Configurable Commission Schedule per Tenant & Centre Type | Accepted (M0) | Store statutory splits in `ledger.commission_schedules` keyed by `(tenant_id, centre_type, effective_from)` with `CHECK (commission_bps <= 500)` and `CHECK (auctioneer_share_bps + hms_or_mms_share_bps + fisher_welfare_share_bps + coop_share_bps = 10000)`. |
| **ADR-005** | Double-Entry Journal + Real SHA-256 Hash Chain | Accepted (M0) | Every financial event posts balanced `ledger.journal_entries` + `ledger.journal_lines` (`SUM(debit_paisa) = SUM(credit_paisa)` via deferred constraint trigger) and computes a real `node:crypto` SHA-256 chain including `entry_seq`. |
| **ADR-006** | Default Commercial Mode A (`FIXED_SAAS_ONLY`) | Accepted (M0) | Default all tenants to `FIXED_SAAS_ONLY` (off-ledger SaaS invoice to HMS/MMS) so 100% of the statutory 5% commission and 95%+ vessel payout flow untouched. Modes B and C require `legal_signoff_ref` and `legal_signoff_date`. |
| **ADR-007** | Statutory Settlement Channels (`STANDARD_AUCTION`, `SOCIETY_DEPUTED_AUCTION`, `HMS_DIRECT_TAKEOVER`, `COOP_PROCUREMENT`) | Accepted (M0) | Model s.4(8) society-deputed auctioneer enforcement, s.10 proviso HMS direct takeover, and s.19(2) co-op 50%+ procurement as explicit `settlement_channel` variants rather than ad-hoc percentage overrides. |
| **ADR-008** | Phone + OTP Auth with Dev Echo Guardrail & HS256 JWT | Accepted (M0) | Implement `POST /api/v1/auth/otp/request` and `verify` issuing HS256 JWTs (`sub`, `memberships`, `jti`, `exp`). Server refuses to boot if `NODE_ENV=production` and `OTP_DEV_ECHO=true`. |
| **ADR-009** | Navy-on-Off-White Design System (Zero Green) | Accepted (M0) | Enforce `--bg-app: #F6F6F3`, `--bg-surface: #FFFFFF`, `--brand: #1F3866`, `--text-primary: #0C1B33`, and non-green semantic status badges (`--ok-*` cobalt/navy, `--warn-*` amber, `--danger-*` crimson) verified by `scripts/check-contrast.ts`. |

---

## 3. Statutory & Commercial Conflict Resolutions (`C1` – `C13`)

| ID | Conflict | Binding Resolution |
| :--- | :--- | :--- |
| **C1** | Maximum auction commission cap | Hard cap `commission_bps <= 500` (5.00%) under Act 16 of 2021 s.10(1). Both domain and DB reject `> 500`. |
| **C2** | Harbour / Landing Centre 5% split beneficiaries (s.10(1)) | Four statutory beneficiaries: **20% Auctioneer (2000 bps)**, **20% HMS (2000 bps)**, **40% Fishermen Annual Production Bonus (4000 bps)**, **20% Fisheries Co-operative Societies (2000 bps)**. No "Matsyafed" row in default Act schedule. |
| **C3** | Fish Market 5% split beneficiaries (s.14(1)) | Seeded by `centre_type`: `HARBOUR`/`LANDING_CENTRE` uses **20/20/40/20**; `FISH_MARKET` uses **20/20/30/30** (20% Auctioneer, 20% MMS, 30% Fisher Annual Bonus, 30% Co-op Societies). |
| **C4** | PDF 50/20/20/10 vs Act 20/20/40/20 | Ratios live in `ledger.commission_schedules` with `notification_ref` and `legal_basis_ref`. Default seed is the Act's 20/20/40/20 (harbour) and 20/20/30/30 (market). |
| **C5** | Section 4(8) society-loan vessels | Section 4(8) is an auctioneer-assignment constraint (`vessels.has_society_loan = true` requires an auctioneer deputed by that society, `SOCIETY_DEPUTED_AUCTION`), NOT a 97%/3% commission split. |
| **C6** | Section 19 basic price enforcement | Per-tenant setting `basic_price_enforcement IN ('BLOCK','WARN','OFF')` defaulting to `'WARN'` (`OPEN-01`). |
| **C7** | SaaS monetization vs statutory 5% commission | Three explicit modes: Mode A `FIXED_SAAS_ONLY` (default), Mode B `INSTITUTIONAL_SHARE_PILOT`, Mode C `BUYER_SERVICE_FEE_PILOT`. Modes B & C locked behind `legal_signoff_ref` (`OPEN-02`). |
| **C8** | Mode B platform fee math | 20% of institutional shares (HMS 20% + Co-op 20% = 40% of 5% = 200 bps) => **40 bps (0.40% of GTV)**; Auctioneer (100 bps) and Fisher Bonus (200 bps) untouched. |
| **C9** | GST treatment on commission vs platform fee | Statutory commission & vessel payout have `0` GST in dockside ledger. In Mode C, 18% GST applies only to the 100 bps buyer service fee (`OPEN-03`). |
| **C10** | 6 microservices + Kafka vs single deployable | Single-deployable modular monolith (`ADR-001`). |
| **C11** | Section 22 licenced auctioneer statutory return | Dedicated statutory return generator (`/api/v1/reports/section22-return`) alongside HMS/Auditor exports. |
| **C12** | Section 10 proviso (HMS direct takeover) | Supported via `settlement_channel = 'HMS_DIRECT_TAKEOVER'` (`auctioneer_share_bps = 0`, HMS + Fisher Bonus + Co-op sum to 10,000 bps, `OPEN-04`). |
| **C13** | Section 19(2) co-op 50%+ procurement at basic price | Supported via `settlement_channel = 'COOP_PROCUREMENT'` at `basic_price_paisa_per_kg` with `0` auction commission (`OPEN-05`). |

---

## 4. Open Legal, Policy & Product Register (`OPEN-01` – `OPEN-12`)

| ID | Topic | Owner | Safe Default Implemented |
| :--- | :--- | :--- | :--- |
| **OPEN-01** | Section 19 basic price publication & enforcement mode | Legal / HMS | Configurable `BLOCK \| WARN \| OFF` per tenant; default `WARN`. |
| **OPEN-02** | Commercial Fee Mode B / Mode C legal sign-off under s.10(1), s.14(1), s.23 | Legal | Default `FIXED_SAAS_ONLY` (Mode A); Modes B/C require `legal_signoff_ref` + `legal_signoff_date`. |
| **OPEN-03** | GST applicability on statutory commission vs buyer service fee | Tax Counsel | `0` GST in Modes A & B; 18% GST on 100 bps buyer service fee in Mode C (`gst_rate_bps` configurable). |
| **OPEN-04** | Exact redistribution of auctioneer 20% share under s.10 proviso (`HMS_DIRECT_TAKEOVER`) | Legal / Dept. of Fisheries | Configurable in `ledger.commission_schedules`; default allocates auctioneer 20% to HMS (`0 / 4000 / 4000 / 2000 bps`). |
| **OPEN-05** | Commission & fee rules on s.19(2) `COOP_PROCUREMENT` | Legal / Matsyafed | `0` auction commission; 100% of `weight * basic_price` credited to vessel owner. |
| **OPEN-06** | Official Government Gazette Malayalam terms for statutory export headers | Product / Translator | Bilingual dictionary isolated in `src/web/i18n/ml.json` + `en.json` (wired in M4). |
| **OPEN-07** | Production SMS DLT template & gateway provider | Ops | `SmsPort` interface in `src/server/platform/ports.ts` with console/noop adapters. |
| **OPEN-08** | Bank settlement rails (NEFT/IMPS/UPI nodal escrow) | Banking Partner | Ledger tracks `SETTLEMENT_Instruction` state machine (`PENDING -> SENT -> CONFIRMED \| FAILED`). |
| **OPEN-09** | Offline dockside operation & conflict resolution | Engineering / Field Ops | Out of scope for v1 (`DEFERRED-01`); M4 uses `navigator.onLine` check to disable write actions offline. |
| **OPEN-10** | Exact Annexure form columns for Section 22 auctioneer return | Legal / HMS | All fields listed in Act s.22 included in CSV/HTML print export; column order isolated in exporter module. |
| **OPEN-11** | Multi-currency support on export invoices | Product | Domestic ledger strictly `INR` integer paisa; export invoice display metadata isolated. |
| **OPEN-12** | Audit log & ledger retention period | Legal / Ops | Append-only tables with zero `DELETE` path; 7+ year retention assumed. |

---

## 5. Dependency Allowlist & Hygiene Log (§5)
- **Removed in M0:**
  - `esbuild` (`^0.25.0`) — conflicted with Vite 8 (which uses Rolldown/Oxc internally) and violated §3 P1 / §5.
  - `motion` (`^12.23.24`) — dropped per §5.
  - `dotenv` (`^17.2.3`) — dropped per §5 (`node --env-file-if-exists=.env` / `src/server/config.ts` handles env parsing).
- **Added in M0:**
  - `zod` (`^4.6.7`) — allowlisted in §5 for runtime boundary validation in `src/server/config.ts` and shared schemas.

---

## 6. Deferred Items Register (§15)

| Deferred ID | Feature | Deferral Reason & Seam Preserved |
| :--- | :--- | :--- |
| **DEFERRED-01** | Offline IndexedDB / CRDT dockside sync | Requires field study of multi-clerk scale contention (`OPEN-09`). `client_event_id` idempotency key reserved. |
| **DEFERRED-02** | Live Bluetooth / RS-232 WebSerial scale hardware | Requires physical indicator protocols. Weighing service accepts `weight_source: 'MANUAL' \| 'SERIAL_SIM' \| 'DEVICE'` (`M4`). |
| **DEFERRED-03** | Real bank nodal escrow API (ICICI / Federal / RazorpayX) | Requires HMS escrow onboarding (`OPEN-08`). Payout instruction state machine preserved. |
| **DEFERRED-04** | Real DLT SMS OTP gateway (MSG91 / Kaleyra) | Requires DLT principal entity registration (`OPEN-07`). `SmsPort` adapter seam in `src/server/platform/ports.ts`. |
| **DEFERRED-05** | Polygon / Hyperledger on-chain anchoring | PostgreSQL append-only triggers + SHA-256 hash chain + daily Merkle root (`ledger.daily_anchors`) provide verifiable tamper-evidence without blockchain gas/ops. |
| **DEFERRED-06** | Cold-storage IoT telemetry & EU Catch Certificate XML | Separate product line; export module emits lot-to-trade traceability JSON + printable certificate. |
| **DEFERRED-07** | Mobile native apps (Flutter / React Native) | Dockside web workspace uses 48px+ touch targets and high-contrast Navy-on-Off-White tokens for mobile browsers. |
