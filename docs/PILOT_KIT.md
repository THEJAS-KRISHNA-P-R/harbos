# HarbourOS — Harbour Pilot Onboarding Kit (`docs/PILOT_KIT.md`)

This pack covers day-minus-7 onboarding through day-5 shadow-pilot sign-off for a new Kerala Fish Landing Centre (FLC) under the Kerala Marine Fishing Regulation / Act 16 of 2021 rules.

---

## 1. Pre-Pilot Harbour Readiness Checklist (T-7 to T-1)
- [ ] **Tenant Provisioning:** Create honest empty tenant via `POST /api/v1/tenants` (provisions only tenant record, statutory policy v1, genesis ledger head, and 5 institutional accounts — zero placeholder rows).
- [ ] **Statutory Policy Sign-Off:** Confirm commission split bps (5% total: 20% auctioneer, 20% HMS fund, 40% fisherman bonus escrow, 20% co-op society) and Section 19 floor enforcement mode (`WARN` for week 1 shadow pilot, `HARD_BLOCK` for live cutover).
- [ ] **Hardware Verification:**
  - Weighing scales calibrated and paired (BLE / RS-232 / manual fallback).
  - 58mm / 80mm thermal printers loaded and tested on `/w/weighing` and `/w/pit`.
  - Backup 4G LTE router active for dockside handhelds.
- [ ] **SMS DLT Registration:** Confirm `MSG91_SENDER_ID`, `MSG91_OTP_TEMPLATE_ID`, and live OTP delivery to 3 harbour test numbers (Malayalam + English).
- [ ] **RLS & Ledger Gate:** Run `npx tsx scripts/verify-rls.ts` (matching production `RLS_PLATFORM_MODE`) and `npm run verify:ledger -- <TENANT_ID>`.

---

## 2. Masterdata CSV Import Templates (Atomic Dry-Run → Commit)
All imports run via `POST /api/v1/masterdata/import/:entityType` with JSON body `{ "csvText": "...", "dryRun": true }` first, then `"dryRun": false`. Commits are **atomic all-or-nothing** inside a single PostgreSQL transaction (any formula-injection prefix `= + - @`, invalid GSTIN mod-36 checksum, invalid E.164 phone, or DB constraint error rolls back the entire batch).

### Co-op Societies (`coop-societies`)
```csv
regNo,nameEn,nameMl
KL-ERN-COOP-01,Munambam Fishermen Co-op,മുനമ്പം മത്സ്യത്തൊഴിലാളി സഹകരണ സംഘം
```

### Fishermen (`fishermen`)
```csv
fullName,phoneE164,welfareBoardNo,coopSocietyId,bankAccountRef
Rajan K,+919847100001,KFWFB-ERN-1001,SOC-XXXX,SBIN0001234-9876
```

### Vessels (`vessels`)
```csv
registrationNo,vesselNameEn,vesselNameMl,ownerFishermanId,hasActiveSocietyLoan
IND-KL-07-MM-1001,St. Antony,സെന്റ് ആന്റണി,FSH-XXXX,false
```

### Wholesale Buyers (`buyers`)
```csv
buyerName,paddleNo,gstin,exportRegNo,escrowBalancePaise,approvedCreditPaise
Malabar Marine Exports,101,32AABCM1234A1Z5,MPEDA-KL-101,50000000,100000000
```

### Species & Section 19 Floors (`species`)
```csv
code,nameEn,nameMl,scientificName,floorPricePaisePerKg,exportEligible
SKJ,Skipjack Tuna,ചൂര,Katsuwonus pelamis,18000,true
MAC,Indian Mackerel,അയല,Rastrelliger kanagurta,12000,true
```

### Licensed Auctioneers (`licences` — Section 5 <= 1-year validity)
```csv
auctioneerUserId,auctioneerName,licenceNo,validFrom,validUntil
USR-XXXX,Suresh Nair,LIC-KL-2026-01,2026-01-01,2026-12-31
```

---

## 3. Five-Day Shadow-Pilot Protocol (0-Paise Cutover Gate)
During Days 1–5, harbour clerks continue the paper auction register alongside HarbourOS. Every evening at 18:00 IST:
1. Export paper totals as CSV (`lotCode,hammerPaise,fishermanNetPaise,commissionPaise`).
2. Submit to `POST /api/v1/reports/shadow-diff`.
3. Download all 5 statutory reports (`daily-auction`, `fisherman-statement`, `statutory-apportionment`, `buyer-ledger`, `payout-reconciliation`) as CSV via `GET /api/v1/reports/:type?format=csv`.
4. Run daily SHA-256 ledger anchor (`npm run anchor:ledger`) and archive the signed JSONL anchor line.

### Go-Live Sign-Off Criteria
Cutover from paper register to HarbourOS live clearing requires **3 consecutive trading days** with:
- `shadow-diff`: `zeroPaiseDivergence === true` (`0` paise difference across every lot).
- `statutory-apportionment`: `allocatedTotalPaise === ledgerBalancePaise` for all 4 recipient pools.
- `npm run verify:ledger`: `verified === true` with zero gaps.
- Chief Accountant & Harbour Secretary written sign-off below.

| Date | Lots Weighed | Lots Sold | Shadow-Diff Delta (Paise) | Ledger Anchor Head Hash (first 16 hex) | Accountant Sign-Off |
|---|---|---|---|---|---|
| Day 1 | | | | | |
| Day 2 | | | | | |
| Day 3 | | | | | |
| Day 4 | | | | | |
| Day 5 | | | | | |
