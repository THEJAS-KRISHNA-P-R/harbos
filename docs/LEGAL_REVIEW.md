# HarbourOS — Statutory & Legal Compliance Review (`docs/LEGAL_REVIEW.md`)

**Statute Authority:** Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021)

---

## 1. Canonical Statutory Section Mapping (`src/shared/contracts/statute.ts`)

All statutory citations across server, shared contracts, and web workspaces are centralized in `src/shared/contracts/statute.ts` (`ACT_16_2021_CITATIONS`). No file outside `src/shared/contracts/statute.ts` is permitted to hardcode `/Act 16.*s\.\d/` strings (enforced by unit test in `tests/unit/operator-profile.test.ts`).

| Statutory Key | Canonical Citation (`statute.ts`) | Legal Rule | HarbourOS Enforcement Point |
| :--- | :--- | :--- | :--- |
| `SOCIETY_DEPUTED_AUCTIONEER` | **Act 16/2021 s.4(8)** | A fishing vessel with an active loan from a Fisheries Co-operative Society must have its catch auctioned by an auctioneer deputed by that society. | `allocateLotSale` (`src/server/platform/ledger-service.ts`) verifies `vessel.loan_coop_society_id === licence.deputed_by_society_id` before clearing (`422 COOP_LOAN_AUCTIONEER_MISMATCH_S4_8`). |
| `HARBOUR_COMMISSION_SPLIT` | **Act 16/2021 s.10(1)** *(NEEDS-COUNSEL: s.4(4)/s.4(5) vs s.10(1))* | Fishing Harbour / Fish Landing Centre auction commission cannot exceed **5% (500 bps)** and is distributed **20% Auctioneer / 20% HMS / 40% Fishermen Annual Production Bonus / 20% Fisheries Co-operative Societies**. | `core.commission_policies` (`CHECK (commission_bps <= 500)`) and `computeStatutorySettlement` (`src/shared/domain/settlement.ts`). |
| `HMS_DIRECT_TAKEOVER` | **Act 16/2021 s.10(1) Proviso** | Where licensed auctioneers are unavailable or default, the Harbour Management Society (HMS) may directly conduct the auction (`auctioneer_share_bps = 0`). | `HMS_DIRECT_TAKEOVER` mode in `computeStatutorySettlement` reallocates the 20% auctioneer share to HMS (`0 / 4000 / 4000 / 2000 bps`). |
| `MARKET_COMMISSION_SPLIT` | **Act 16/2021 s.14(1)** *(NEEDS-COUNSEL: s.4(5)(b) vs s.14(1))* | Fish Market (MMS) auction commission cannot exceed **5% (500 bps)** and is distributed **20% Auctioneer / 20% MMS / 30% Fishermen Annual Production Bonus / 30% Fisheries Co-operative Societies**. | `KERALA_MARKET` preset in `core.commission_policies` (`2000 / 2000 / 3000 / 3000 bps`). |
| `FLOOR_PRICE_PUBLICATION` | **Act 16/2021 s.19(1)** | Harbour Management Committee publishes species-wise basic floor prices. | `auction.species.floor_price_paise_per_kg` and per-tenant `floor_enforcement` (`BLOCK` / `WARN`). |
| `COOP_PROCUREMENT_ZERO_COMMISSION` | **Act 16/2021 s.19(2)** | Fisheries Co-operative Societies may procure up to 50%+ of catch at the published basic price with **0% auction commission**. | `COOP_PROCUREMENT` mode in `computeStatutorySettlement` credits 100% of `hammer_paise` directly to the fisherman (`commission_paise = 0`). |
| `QUALITY_HYGIENE_INSPECTION` | **Act 16/2021 s.21** | Mandatory quality & hygiene inspection; catch unfit for human consumption or uninspected cannot be auctioned. | Lots enter `WEIGHED_PENDING_INSPECTION` (`inspection_grade = NULL`). Only `POST /api/v1/lots/:lotId/inspect` moves a lot to `OPEN_FOR_AUCTION` or `BLOCKED_UNFIT` (enforcing separation of duties from `weighed_by_user_id`). |
| `STATUTORY_AUCTION_RETURNS` | **Act 16/2021 s.22** | Licensed auctioneers must submit periodic returns of catch weight, species, hammer price, commission deducted, and net payable to fishermen. | `GET /api/v1/exports/section22.csv` (`SUPER_ADMIN`, `HARBOUR_ADMIN`, `ACCOUNTANT`, `LICENSED_AUCTIONEER`). |
| `NO_ILLEGAL_DEDUCTIONS` | **Act 16/2021 s.23** | Strictly prohibits unauthorized deductions (`kuli`, `vatta`, or extra commissions) from fisherman settlements. | Commercial Mode A (`FIXED_SAAS_ONLY`) is the default; Modes B & C are blocked at both API and PostgreSQL `CHECK` level unless `legal_signoff_ref` and `legal_signoff_date` are recorded. |

---

## 2. Open Statutory Citation Discrepancies (`NEEDS-COUNSEL`)

As flagged in `src/shared/contracts/statute.ts`, two section-numbering discrepancies exist between the Ordinance / Bill drafts and the final gazetted Kerala Act 16 of 2021:
1. **Harbour 5% Commission Split (`20 / 20 / 40 / 20`):** Some early rules and commentary cite **s.4(4) / s.4(5)(a)**, whereas the consolidated Act structure places Harbour Management Society powers and commission distribution under **s.10(1)**.
2. **Fish Market 5% Commission Split (`20 / 20 / 30 / 30`):** Early drafts cite **s.4(5)(b)**, whereas Market Management Society provisions appear under **s.14(1)**.

Both pairs are mapped in `STATUTE_CITATION_REVIEW_NOTES` in `src/shared/contracts/statute.ts` so a single edit updates all UI badges, CSV headers, and AI grounding prompts upon final counsel sign-off.

---

## 3. Commercial Monetization Legal Guardrail (Conflict C7 / `OPEN-02`)
- **Mode A (`FIXED_SAAS_ONLY` — Default):** HarbourOS charges an off-ledger institutional SaaS subscription to the HMS/MMS. 100% of the statutory 5% commission and 95%+ fisherman net proceeds flow untouched through the double-entry ledger.
- **Mode B (`INSTITUTIONAL_TECH_SHARE`) & Mode C (`HYBRID`):** Enforced by `chk_commercial_mode_legal_signoff` in `db/migrations/001_schema_and_tenancy.sql` and `POST /api/v1/policies` in `src/server/app.ts`. Any attempt to activate Mode B or Mode C without a valid `legal_signoff_ref` and `legal_signoff_date` is rejected with `422 FORBIDDEN`.
