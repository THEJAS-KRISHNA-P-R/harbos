# HarbourOS Pilot Operational Readiness Guide

## First Morning Dockside Procedure

This guide details the exact operational sequence for harbour administrators, weighing operators, auctioneers, and chief accountants on the first morning of pilot go-live at a government fish landing centre (e.g. Munambam FLC).

---

### 1. 03:30 AM — Systems Initialization & Network Check
1. **Power & Hardware**:
   - Turn on dockside industrial scales (Mettler Toledo / Essae RS-232 serial interfaces).
   - Check thermal printers (58mm mobile belt clip printers and 80mm desk receipt printers). Ensure paper roll feed is clean.
   - Verify 4G LTE cellular gateway and Wi-Fi access points along the auction quay.
2. **Health Verification**:
   - Access `https://<harbour-domain>/healthz` (returns `{"status":"ok"}`).
   - Access `https://<harbour-domain>/readyz` (verifies PostgreSQL connection and applied migrations).
3. **Database Readiness**:
   - Verify ledger chain integrity for the tenant:
     ```bash
     npm run job:ledger:verify -- MUN-TENANT-001
     ```

---

### 2. 04:00 AM — Masterdata & Section 19 Floor Prices
1. **Floor Prices Verification**:
   - Under Act 16 of 2021 Section 19, floor prices prevent predatory under-bidding.
   - Harbour Secretary reviews and sets statutory minimum floor prices:
     - Skipjack Tuna (`SKJ`): ₹180.00 / kg (18,000 paise).
     - Indian Mackerel (`MAC`): ₹120.00 / kg (12,000 paise).
     - Malabar Trevally (`TRV`): ₹220.00 / kg (22,000 paise).
2. **Buyer Guarantee Ledger Check**:
   - Wholesale buyers must have active bank guarantees registered before being permitted to paddle bids exceeding ₹50,000.

---

### 3. 04:30 AM — Vessel Arrival & Weighing Pit Operations
1. **Lot Tag Generation**:
   - As boat arrives, operator scans vessel QR passbook or selects registered boat.
   - Weighing scale captures gross weight and tare weight automatically.
   - Dockside tag is printed with lot QR code.

---

### 4. 05:00 AM — Clock Auction & Paddle Knock-Down
1. **Auction Session Start**:
   - Auctioneer opens session for the arrival batch.
   - Increments conform strictly to statutory tick rules (₹5/kg or ₹10/kg).
2. **Gavel Knock-Down**:
   - Auctioneer enters winning buyer paddle number.
   - Web Speech voice engine confirms: *"Lot 14 knocked down to Buyer 101 at 420 rupees per kg"* (or native Malayalam phonetic equivalent).
   - Buyer receipt slip is generated with tamper-evident SHA-256 hash.

---

### 5. 08:00 AM — Settlement Clearing & UTR Reconciliation
1. **Accountant Clearing Desk**:
   - Buyer pays invoice via RTGS/NEFT or Nodal UPI escrow.
   - Accountant uploads bank UTR CSV statement (`src/server/modules/payouts`).
   - HarbourOS automatically matches batch IDs and credits 95% proceeds to fisherman ledger accounts.

---

### 6. Emergency & Fallback SOPs
- **Internet Outage**: Handhelds cache weighment records locally in IndexedDB offline buffer. When connectivity returns, client replays lots via `POST /api/v1/sync/catch-buffer` with automatic idempotency deduplication.
- **Printer Jam**: Use "Reprint" button. Watermark `REPRINT — AUDITED COPY` is stamped automatically on all reprinted thermal tags to prevent double-clearing at harbour security gates.
- **Audit Tampering Warning**: If any ledger entry hash fails verification, all settlement payouts freeze immediately and an alert is logged to `core.audit_logs`.
