# HarbourOS — Statutory & Legal Compliance Review (`docs/LEGAL_REVIEW.md`)

**Statute Authority:** Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021)

---

## 1. Canonical Statutory Section Mapping (`src/shared/contracts/statute.ts`)

| Statutory Provision | Legal Rule | HarbourOS Enforcement Point |
| :--- | :--- | :--- |
| **Section 4(8)** | A fishing vessel with an active loan from a Fisheries Co-operative Society must have its catch auctioned by an auctioneer deputed by that society. | `allocateLotSale` (`src/server/platform/ledger-service.ts`) verifies `vessel.loan_coop_society_id === licence.deputed_by_society_id` before clearing. |
| **Section 10(1)** | Fishing Harbour / Fish Landing Centre auction commission cannot exceed **5% (500 bps)** and is distributed **20% Auctioneer / 20% HMS / 40% Fishermen Annual Production Bonus / 20% Fisheries Co-operative Societies**. | `core.commission_policies` (`CHECK (commission_bps <= 500)`) and `computeStatutorySettlement` (`src/shared/domain/settlement.ts`). |
| **Section 10 Proviso** | Where licensed auctioneers are unavailable or default, the Harbour Management Society (HMS) may directly conduct the auction (`auctioneer_share_bps = 0`). | `HMS_DIRECT_TAKEOVER` mode in `computeStatutorySettlement` reallocates the 20% auctioneer share to HMS (`0 / 4000 / 4000 / 2000 bps`). |
| **Section 14(1)** | Fish Market (MMS) auction commission cannot exceed **5% (500 bps)** and is distributed **20% Auctioneer / 20% MMS / 30% Fishermen Annual Production Bonus / 30% Fisheries Co-operative Societies**. | `KERALA_MARKET` preset in `core.commission_policies` (`2000 / 2000 / 3000 / 3000 bps`). |
| **Section 19(1)** | Harbour Management Committee publishes species-wise basic floor prices. | `auction.species.floor_price_paise_per_kg` and per-tenant `floor_enforcement` (`BLOCK` / `WARN`). |
| **Section 19(2)** | Fisheries Co-operative Societies may procure up to 50%+ of catch at the published basic price with **0% auction commission**. | `COOP_PROCUREMENT` mode in `computeStatutorySettlement` credits 100% of `hammer_paise` directly to the fisherman (`commission_paise = 0`). |
| **Section 21** | Mandatory quality & hygiene inspection; catch unfit for human consumption or uninspected cannot be auctioned. | `auction.lots.inspection_grade` is nullable (`009_statutory_ledger_and_payouts.sql`). Both `null` (uninspected) and `REJECTED_UNFIT` are blocked with `422 LOT_REJECTED_UNFIT_S21`. |
| **Section 22** | Licensed auctioneers must submit periodic returns of catch weight, species, hammer price, commission deducted, and net payable to fishermen. | `GET /api/v1/exports/section22.csv` (`SUPER_ADMIN`, `HARBOUR_ADMIN`, `ACCOUNTANT`, `AUCTIONEER`). |
| **Section 23** | Strictly prohibits unauthorized deductions (`kuli`, `vatta`, or extra commissions) from fisherman settlements. | Commercial Mode A (`FIXED_SAAS_ONLY`) is the default; Modes B & C are blocked at both API and PostgreSQL `CHECK` level unless `legal_signoff_ref` and `legal_signoff_date` are recorded. |

---

## 2. Commercial Monetization Legal Guardrail (Conflict C7 / `OPEN-02`)
- **Mode A (`FIXED_SAAS_ONLY` — Default):** HarbourOS charges an off-ledger institutional SaaS subscription to the HMS/MMS. 100% of the statutory 5% commission and 95%+ fisherman net proceeds flow untouched through the double-entry ledger.
- **Mode B (`INSTITUTIONAL_TECH_SHARE`) & Mode C (`HYBRID`):** Enforced by `chk_commercial_mode_legal_signoff` in `db/migrations/001_schema_and_tenancy.sql` and `POST /api/v1/policies` in `src/server/app.ts`. Any attempt to activate Mode B or Mode C without a valid `legal_signoff_ref` and `legal_signoff_date` is rejected with `422 FORBIDDEN`.
