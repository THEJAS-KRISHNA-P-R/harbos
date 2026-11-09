# HarbourOS — Operations & Ledger Integrity Runbook (`docs/RUNBOOK.md`)

## 1. Daily Harbour Morning Flow
1. **Weighing & QR Tagging (`/w/weighing`):** Weighing Operator selects landed vessel, selects species (Malayalam + English), captures integer gram weight, and locks the lot to print an HMAC-SHA256 signed QR sticker.
2. **Quality Certification (`/w/inspector`):** Authorized Inspector grades the lot under Section 21 (`A_EXPORT`, `A_DOMESTIC`, `B_PROCESS`, or `REJECTED_UNFIT`). Lots graded `REJECTED_UNFIT` are blocked from auction allocation.
3. **Pit Auction & Allocation (`/w/pit` & `/w/buyer`):** Licensed Auctioneer conducts the auction (`PHYSICAL_SHOUT`, `HYBRID_REMOTE`, `DUTCH_CLOCK`, `COOP_PROCUREMENT` s.19(2), or `HMS_DIRECT_TAKEOVER` s.10 proviso). Confirming a hammer drop runs all 8 statutory checks and posts a balanced double-entry journal in the same PostgreSQL transaction.
4. **End-of-Day Accounting & UTR Reconciliation (`/w/harbour`):** HMS Accountant generates the payout CSV batch, reconciles the bank UTR reference, and downloads the Section 22 Statutory Return.

## 2. Continuous SHA-256 Ledger Verification & Honest Limits (§8)
- Run `npx tsx scripts/verify-ledger.ts` (or call `GET /api/v1/ledger/verify`) to recompute the entire SHA-256 hash chain from genesis (`0000...0000`) in TypeScript and compare against `ledger.entries`.
- **Honest Limit (§8):** Database `BEFORE UPDATE OR DELETE` triggers block mutations by the runtime application role, whereas a database superuser/owner with `ALTER TABLE ... DISABLE TRIGGER` could rewrite underlying storage. Running `scripts/verify-ledger.ts` and anchoring the daily `headHash` externally (e.g. emailed daily by the HMS Chief Accountant) detects any out-of-band storage tampering.
