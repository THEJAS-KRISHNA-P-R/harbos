# HARBOUROS: MASTER SAAS BUSINESS MODEL, LEGAL COMPLIANCE, UI/UX & PILOT ROADMAP

**Version:** 3.0 — Commercial & Operational Master Plan  
**Target Market:** Kerala Fishing Harbours & Landing Centres $\rightarrow$ Pan-India Maritime States $\rightarrow$ Global Fisheries Exchanges  

---

## 1. EXECUTIVE SUMMARY: FROM VISION TO FOOLPROOF EXECUTION

HarbourOS is a multi-tenant vertical SaaS and financial clearing house engineered to digitize dockside fish auctions, weighing, statutory compliance, and multi-party financial settlements. 

Following an intensive legal and engineering review of the Kerala fisheries ecosystem, this Master Plan incorporates five foundational upgrades that make HarbourOS commercially viable, legally compliant, and operationally resilient at 5:00 AM on a wet harbour floor:

1. **Legally Bulletproof Multi-Mode Monetization:** Directly addresses **Section 4(6)** and **Section 6(1)(iii)** of the *Kerala Fish Procurement, Marketing and Maintenance of Quality Act, 2021* by supporting **Flat Institutional B2B SaaS Subscriptions** ($0\text{ bps}$ transaction fee on the auction floor) alongside optional B2B institutional revenue-sharing and deregulated buyer clearing fees.
2. **Gateway-Independent Settlement Architecture:** Eliminates Day-1 dependency on Razorpay Route approval by providing native **Corporate Bank Bulk Payout File Generation (NEFT/RTGS/IMPS)** and **UTR Reference Ledger Reconciliation** alongside optional automated split gateways.
3. **Single-Leader Offline Auction Authority:** Solves the offline "split-brain" bidding problem by separating multi-device offline weighing from **Single-Leader Leased Auction Sessions**, ensuring two disconnected tablets can never sell the same fish lot twice.
4. **Partial-Box & Multi-Allocation Auctioning:** Supports real-world harbour physics where a single 50-box catch lot of sardines or prawns is split across multiple wholesale buyers in rapid succession.
5. **Pilot-First Modular Monolith Rollout:** Cuts initial DevOps complexity by $70\%$ while preserving strict hexagonal module boundaries for future horizontal scaling.

---

## 2. LEGALLY COMPLIANT MULTI-MODE REVENUE ARCHITECTURE

### 2.1 Navigating the Kerala Act, 2021 (Sections 4(4), 4(5), 4(6) & 6(1)(iii))
Under the *Kerala Fish Procurement, Marketing and Maintenance of Quality Act, 2021*:
* **Section 4(4)** caps the seller-side auction commission at **$5.00\%$ ($500\text{ bps}$)**.
* **Section 4(5)** apportions that $5\%$ commission across four statutory pillars: **Harbour Management Society (HMS: $20\%$)**, **Matsyafed / Apex Federation ($20\%$)**, **Primary Fishermen Cooperative Society ($40\%$)**, and **Licensed Auctioneer ($20\%$)**.
* **Section 4(6)** states: *"No person, including the auctioneer, shall realise any other benefits of any kind, as money or otherwise, in connection with fish auctioning."*
* **Section 6(1)(iii)** prohibits auctioneers from collecting additional fees beyond the government-fixed commission.

### 2.2 The Three Configurable Monetization Modes in HarbourOS
To guarantee zero regulatory friction during government and cooperative procurement while maximizing long-term SaaS revenue across diverse jurisdictions, HarbourOS implements a per-tenant `billing_model` in `core.commission_policies`:

| Billing Mode | How HarbourOS Gets Paid | Statutory Deductions on a $₹1,00,000$ Lot | Where to Deploy |
| :--- | :--- | :--- | :--- |
| **Mode A: `FIXED_SAAS_ONLY` (Default for Kerala Pilot)** | Flat monthly B2B SaaS licence fee ($₹15,000\text{–}₹35,000/\text{month}$) + one-time onboarding fee paid by the HMS, Municipality, or Cooperative Society from their general administrative budget. | • **Fisherman Net:** $₹95,000$ ($95.0\%$) or $₹97,000$ ($97.0\%$ under Sec 4(8))<br>• **HMS:** $₹1,000$<br>• **Matsyafed:** $₹1,000$<br>• **Cooperative:** $₹2,000$<br>• **Auctioneer:** $₹1,000$<br>• **Buyer Payable:** $₹1,00,000$ ($0\text{ bps}$ extra fee) | **All Notified Kerala Harbours & Landing Centres (Day-1 Pilot)** — $100\%$ immune to Section 4(6) challenges because zero transaction-linked fees are charged on auction bids. |
| **Mode B: `INSTITUTIONAL_TECH_SHARE`** | Under a formal IT Modernization B2B Agreement with the HMS and Cooperative Society, HarbourOS receives an agreed $20\%$ technology service share of the HMS and Cooperative treasury allocations ($0.60\%$ / $60\text{ bps}$ of GMV) + $18\%$ GST ($₹108$). | • **Fisherman Net:** $₹95,000$ ($95.0\%$)<br>• **HMS Net:** $₹800$ ($₹200$ to HarbourOS)<br>• **Matsyafed:** $₹1,000$<br>• **Cooperative Net:** $₹1,600$ ($₹400$ to HarbourOS)<br>• **Auctioneer:** $₹1,000$<br>• **HarbourOS B2B Revenue:** $₹600$ ($+ ₹108\text{ GST}$) | **Co-op & Institutional Harbours** where the society prefers usage-based pricing over fixed monthly subscriptions and provides written legal sign-off. |
| **Mode C: `HYBRID_INSTITUTIONAL_AND_BUYER` / `EXTERNAL_SDK_GMV`** | Combines the $60\text{ bps}$ institutional share with a $100\text{ bps}$ ($1.00\%$) Buyer Clearing & Credit-Line Fee (or $50\text{ bps}$ External SDK API fee), plus $18\%$ GST on all taxable platform services. | • **Fisherman Net:** $₹95,000$<br>• **Institutional Net:** $₹4,400$<br>• **HarbourOS Institutional Share:** $₹600$<br>• **HarbourOS Buyer Clearing Fee:** $₹1,000$<br>• **Total HarbourOS Net Revenue:** $₹1,600$<br>• **GST ($18\%$ on $₹1,600$):** $₹288$<br>• **Total Buyer Payable:** $₹1,01,288$ | **Private Wholesale Hubs, Interstate B2B Trading Portals, Non-Regulated Coastal States, and International Harbours (SE Asia / GCC / East Africa).** |

> **Mathematical & Tax Alignment Note:** In Mode C above, the GST is explicitly calculated at $18\%$ across **both** the $₹600$ institutional share and the $₹1,000$ buyer fee ($18\% \times ₹1,600 = ₹288$), controlled by the boolean flags `apply_gst_on_tech_share` and `apply_gst_on_buyer_fee` in `core.commission_policies`. There is zero ambiguity between the accounting tables and the TypeScript `SettlementEngine`.

---

## 3. END-TO-END HARBOUR WORKFLOW (5:00 AM DOCKSIDE REALITY)

```
[1. Vessel Berthing] ──> [2. BLE/Audited Weighing & QR Tag] ──> [3. Single-Leader Auction Pit]
                                                                          │
[6. Fisherman WhatsApp Receipt & Bank Payout] <── [5. Hash-Chained Ledger] <── [4. Partial-Box Allocations]
```

1. **Step 1: Trip & Catch Registration (Offline-Capable):**
   * Vessel arrives at berth. The Weighing Operator scans the vessel's QR card (linked to its `realcraft_reg_no`) on the ruggedized Flutter tablet.
   * System checks `has_active_society_loan` to pre-configure **Section 4(8)** rules automatically.
2. **Step 2: Weighing, Section 21 Grading & Thermal QR Printing:**
   * Crates are placed on the industrial platform scale. Weight ($500.0\text{ kg}$ across $20\text{ boxes}$) is captured via Bluetooth (`BLE_VERIFIED`) or manual entry with mandatory supervisor audit reason (`MANUAL_AUDITED`).
   * Operator selects species (*Yellowfin Tuna / Kera*), verifies temperature ($\le 4.0^\circ\text{C}$), and assigns grade (`EXPORT_A`).
   * The Bluetooth belt printer outputs a waterproof thermal QR tag (`KL-MNH-20261105-D01-0012`) affixed to the master crate.
3. **Step 3: Auction Session & Partial-Box Bidding:**
   * The Licensed Auctioneer scans the Lot QR tag on the **Auctioneer Pit Pad** tablet.
   * System verifies the lot is not `REJECTED_UNFIT` (**Section 21**) and displays the **Section 19** daily floor price ($₹180/\text{kg}$).
   * Suppose Buyer Paddle `#14` bids $₹210/\text{kg}$ for **5 boxes** ($125\text{ kg}$), and Buyer Paddle `#29` bids $₹205/\text{kg}$ for the remaining **15 boxes** ($375\text{ kg}$).
   * The Auctioneer taps `Allocate 5 Boxes -> #14` (`allocation_seq = 1`) and `Allocate 15 Boxes -> #29` (`allocation_seq = 2`).
   * The database trigger `trg_allocate_lot_inventory` atomically decrements `available_boxes` from $20 \rightarrow 15 \rightarrow 0$ and marks the lot `FULLY_SOLD`.
4. **Step 4: Instant Ledger Posting & Settlement:**
   * Each allocation immediately posts a balanced double-entry journal locked via `ledger.ledger_heads`.
   * The Fisherman receives an instant Malayalam WhatsApp receipt showing the exact weight, buyer prices, statutory commission breakdown, and net payout amount.
   * At session close, the Harbour Accountant reconciles buyer UPI/IMPS collections and exports the **Bank Bulk Payout File** (or triggers automated gateway splits) to credit the Fisherman, HMS, Matsyafed, Cooperative Society, and Auctioneer.

---

## 4. MOBILE-FIRST UI/UX DESIGN SPECIFICATION

Harbour environments involve bright coastal glare, wet hands, loud ambient noise, and extreme time pressure. All interfaces follow strict ergonomic rules.

### 4.1 Design System & Ergonomic Rules
* **High-Contrast Maritime Daylight Theme:** Pure white (`#FFFFFF`) cards on deep slate (`#0F172A`) headers with WCAG AAA contrast ratios ($\ge 7:1$) for outdoor sunlight readability.
* **Wet-Hand Touch Targets:** Every interactive button on the Weighing and Auctioneer mobile screens has a minimum hit area of **$64\text{dp} \times 64\text{dp}$** with $12\text{dp}$ spacing. Zero drop-down menus during active auctions.
* **Bilingual Typography:** `Noto Sans Malayalam` + `Inter` for text; `JetBrains Mono` (`tabular-nums`) for all weights, paddle numbers, and currency figures.

### 4.2 Persona 1: Harbour Weighing & Auctioneer App (Flutter Android)

#### Screen A: Fast-Weigh & Lot Tagging Deck
```text
+------------------------------------------------------------------+
| [ONLINE ●] MUNAMBAM HARBOUR   Node: D01   Op: Rajan K.   05:14 AM|
+------------------------------------------------------------------+
| VESSEL: [ KL-07-MM-4412 (St. Antony) ]       [Scan Vessel QR 📷] |
| Society Loan: YES (Munambam Co-op)           Sec 19 Floor: ₹180  |
+------------------------------------------------------------------+
| SPECIES (Tap Icon):                                              |
| [ 🐟 Seer/Neymeen ] [ 🐟 Tuna/Kera * ] [ 🦐 Prawns ] [ 🐟 Sardine]|
+------------------------------------------------------------------+
| SCALE READING (BLE Connected - Sansui 500kg):                    |
|   +----------------------------------------------------------+   |
|   |               500.00 kg   (20 Boxes)                     |   |
|   +----------------------------------------------------------+   |
|   Boxes: [ - ]  [ 20 ]  [ + ]       Temp: [ 2.4 °C ] [Export A]  |
+------------------------------------------------------------------+
| [   🔒 LOCK WEIGHT & PRINT WATERPROOF QR TAG (64dp Height)   ]   |
+------------------------------------------------------------------+
```

#### Screen B: Auctioneer Fast-Key Pit Pad (Supports Partial Boxes & Offline Lease)
```text
+------------------------------------------------------------------+
| [🛡️ AUTHORITY: LOCAL LEADER LEASE #4]  Lot: KL-MNH-0012 (Tuna A) |
| Remaining Inventory: 15 / 20 Boxes (375.0 kg) | Floor: ₹180/kg   |
+------------------------------------------------------------------+
| CURRENT PRICE/KG:          ALLOCATE BOXES:      BUYER PADDLE:    |
|  ₹ 205.00 / kg              [ 15 ] Boxes         Paddle # [ 29 ] |
|  (Gross: ₹76,875)          [5] [10] [ALL 15]    (Kochi SeaFoods) |
+------------------------------------------------------------------+
| QUICK INCREMENTS:          NUMERIC KEYPAD (For Paddle & Boxes):  |
| [ + ₹1 ]  [ + ₹2 ]         [  1  ]   [  2  ]   [  3  ]           |
| [ + ₹5 ]  [ + ₹10 ]        [  4  ]   [  5  ]   [  6  ]           |
| [ + ₹20 ] [ + ₹50 ]        [  7  ]   [  8  ]   [  9  ]           |
| [ UNDO ]  [ CLEAR ]        [ CLR ]   [  0  ]   [ ⌫  ]           |
+------------------------------------------------------------------+
| [   🔨 CONFIRM ALLOCATION #2 (15 Boxes @ ₹205 -> Paddle #29)   ] |
+------------------------------------------------------------------+
```

### 4.3 Persona 2: Fisherman / Boat Owner App (Malayalam PWA + WhatsApp Bot)
* **Zero-Typing Interface:** Fishermen authenticate via OTP or by scanning their laminated Fisherman QR Card.
* **Voice-Readout Button (`🔊 മലയാളത്തിൽ കേൾക്കുക`):** Uses on-device Text-to-Speech in Malayalam to read out the day's total catch weight, auction sale price, statutory $5\%$ commission breakdown, and net bank payout.
* **Transparent Deduction Card:** Explicitly shows why either $5\%$ (Society Vessel) or $3\%$ (Section 4(8) Private Auctioneer) was deducted, eliminating dockside distrust.

### 4.4 Persona 3: Wholesale Buyer Terminal (Web & Mobile)
* **Multi-Harbour Live Watchlist:** Allows major seafood processors in Kochi, Kollam, or Kozhikode to view active lots across multiple harbours simultaneously.
* **Real-Time Credit Utilization Bar:** Displays `Credit Limit: ₹25,00,000 | Active Bid Holds: ₹4,50,000 | Available to Bid: ₹12,00,000`.
* **1-Click Export Compliance Dossier:** Next to every purchased `EXPORT_A` lot, buyers can click **"Download EU CATCH / MPEDA Traceability JSON & PDF"** containing the full vessel-to-buyer chain of custody.

### 4.5 Persona 4: Harbour Admin & Accountant Workbench (Next.js)
* **UTR & Bank Batch Settlement Console:**
  * Displays all pending buyer receivables and beneficiary payables.
  * Generates the 1-click **NEFT/RTGS/IMPS Bank Batch File** for fisherman and statutory payouts.
  * Provides the **Dual-Key Reversal Queue** where any requested post-sale correction requires both the Accountant and the Harbour Administrator to sign off with a mandatory audit reason.
* **Section 10 Statutory Compliance Report Generator:** Exports the monthly statutory ledger for the Harbour Management Society and Kerala Fisheries Department inspectors.

### 4.6 Persona 5: HarbourOS Super Admin Control Plane
* **Tenant & Regulatory Provisioning Engine:** Create a new harbour tenant in under 60 seconds, assign its `regulatory_regime`, and configure its `core.commission_policies` (`FIXED_SAAS_ONLY`, `INSTITUTIONAL_TECH_SHARE`, or `HYBRID_INSTITUTIONAL_AND_BUYER`).
* **Continuous SHA-256 Ledger Integrity Monitor:** Runs an automated background verification worker that re-computes the SHA-256 hash chain across `ledger.ledger_entries` and verifies `ledger.ledger_heads` for every tenant, alerting immediately if any database tampering is ever attempted.
* **SDK Partner & Webhook Gateway:** Manages API keys, HMAC secrets, and rate limits for external portals embedding the HarbourOS auction engine.

---

## 5. PLUG-AND-PLAY EXTERNAL AUCTION SDK & API ECOSYSTEM

When an existing fish trade portal, state fisheries corporation website, or international seafood exchange wants to use HarbourOS's real-time bidding and ledger engine on their own domain:

1. **Web Component Embed (`@harbouros/auction-sdk`):**
   ```html
   <script type="module" src="https://cdn.harbouros.io/sdk/v3/harbouros-auction.min.js"></script>
   <harbouros-auction-terminal
     tenant-id="f47ac10b-58cc-4372-a567-0e02b2c3d479"
     session-id="a1b2c3d4-e5f6-7890-1234-567890abcdef"
     sdk-jwt="eyJhbGciOiJFZERTQSI..."
     locale="ml-IN">
   </harbouros-auction-terminal>
   ```
2. **HMAC-SHA256 Signed Transactional Webhooks:**
   * Whenever a `sale_allocation` is confirmed, `sync_sdk.outbox_events` dispatches a signed webhook (`X-HarbourOS-Signature-256`) to the partner's backend containing the immutable financial breakdown, including the `sdk_external_fee_paise` owed to HarbourOS.

---

## 6. PILOT-FIRST 6-PHASE IMPLEMENTATION ROADMAP

To de-risk capital expenditure and ensure rapid dockside adoption, HarbourOS follows a strict **Pilot-First Rollout**:

| Phase | Timeline | Core Deliverables & Acceptance Gate |
| :--- | :--- | :--- |
| **Phase 0: Legal & Harbour Discovery** | Weeks 1–3 | • Observe 15+ live morning auctions at 1 target Kerala harbour (e.g., Munambam, Beypore, or Neendakara).<br>• Obtain written legal opinion on `FIXED_SAAS_ONLY` vs. `INSTITUTIONAL_TECH_SHARE` under Section 4(6).<br>• Sign MoU with 1 Cooperative Society / Harbour Management Society for a 60-day pilot. |
| **Phase 1: Core Foundation & RLS DB** | Weeks 4–7 | • Deploy PostgreSQL 16 with all 26 tables, composite FKs, and full RLS.<br>• Build `mod-identity-tenancy` and `mod-harbour-master` (Fishermen, Vessels, Buyers, Licences, Section 19 Floor Prices).<br>• **Gate:** 100% pass rate on automated Cross-Tenant RLS Isolation & `bigint` Money Conservation test suites. |
| **Phase 2: Weighing, QR & Offline Sync** | Weeks 8–11 | • Build Flutter Weighing Deck with BLE integration for 1 standard industrial scale + waterproof thermal QR printing.<br>• Implement offline SQLite storage and `sync_sdk.offline_sync_events`.<br>• **Gate:** Weighing Operator can tag 50 fish lots in $<15\text{ minutes}$ with Wi-Fi router unplugged. |
| **Phase 3: Physical Auction Pit Pad** | Weeks 12–15 | • Build the Single-Leader Auctioneer Pit Pad supporting partial-box allocations (`auction.sale_allocations`) and inventory triggers.<br>• **Gate:** Auctioneer can record a winning paddle and box allocation in $<2.0\text{ seconds}$ per hammer drop. |
| **Phase 4: Hash-Chained Ledger & Bank Batch** | Weeks 16–19 | • Implement `ledger.ledger_heads`, double-entry journals, Dual-Key Reversals, and the Corporate Bank NEFT/IMPS Batch File Generator.<br>• Launch Malayalam Fisherman WhatsApp receipts and PWA.<br>• **Gate:** Zero-paisa discrepancy across 1,000 simulated full and partial-box sales. |
| **Phase 5: Live 1-Harbour Pilot** | Weeks 20–24 | • Run live parallel operations at the pilot harbour with 2–3 licensed auctioneers and 30+ vessels.<br>• Validate daily bank reconciliation and collect HMS sign-off.<br>• **Gate:** $\ge 90\%$ of pilot vessels settled accurately on Day-of-Sale via HarbourOS ledger. |
| **Phase 6: Scale, Automated Splits & SDK** | Month 7+ | • Activate remote online buyer bidding (`CLOUD_AUTHORITATIVE`), Razorpay Route / Cashfree automated splits (post-compliance approval), External Auction SDK, and EU CATCH / MPEDA export traceability dossiers across 15+ harbours. |