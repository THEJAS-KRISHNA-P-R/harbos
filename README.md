# HarbourOS — Multi-Tenant Statutory Fisheries Clearing Ledger (v1.0)

HarbourOS is a single-deployable multi-tenant statutory auction clearing ledger for coastal fishing harbours and fish landing centres. It implements integer-paise double-entry bookkeeping, SHA-256 hash-chained ledger entries, and statutory split calculations modeled on the **Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021)**.

## v1.0 Scope
- **Included:** Dockside lot weighing → Section 21 quality inspection gate → Licensed auctioneer lot allocation (with leader fencing token & idempotency) → Balanced double-entry statutory split (`ledger.journals` + `ledger.entries`) → Fisherman payable payout batch generation & manual UTR reconciliation → Buyer receivable receipt clearing → Section 22 statutory export.
- **Not Included in v1.0 (Deferred):** Automated payment gateway money movement (Razorpay/Stripe), real-time WebSocket Dutch clock bidding, Bluetooth/WebSerial hardware scale drivers, offline CRDT sync, and external MPEDA/NFDP/ReALCraft government portal adapters.

## Quick Start (Development on Embedded PGlite)

```bash
npm ci
npm run seed
npm run dev
```

Run the full verification gate (TypeScript typecheck, unit + DB + API exploit regression tests, architectural boundaries, WCAG 2.1 contrast audit, and Vite production build):

```bash
npm run check
```

## Production Configuration (`NODE_ENV=production`)

Production boot **refuses to start** unless all safety invariants below hold:

| Variable | Required in Prod | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | Yes (`production`) | Enables strict boot validation, HSTS, and fail-closed guards. |
| `DATABASE_URL` | **Yes** | PostgreSQL 16 connection URL connecting as `harbour_app` (`NOBYPASSRLS`). |
| `JWT_ACCESS_SECRET` | **Yes** | Distinct cryptographically random secret (`>= 32` bytes; no placeholder strings). |
| `QR_HMAC_SECRET` | **Yes** | Distinct cryptographically random secret (`>= 32` bytes; must differ from `JWT_ACCESS_SECRET`). |
| `OTP_DEV_ECHO` | **Yes (`false`)** | Must be `false` in production. |
| `DEMO_MODE` | **Yes (`false`)** | Must be `false` in production. |
| `SMS_PROVIDER` | **Yes (`msg91`)** | Must not be `console` or `noop` in production (`OPEN-07`). |
| `TRUST_PROXY` | Optional (`1`) | Hop count for reverse-proxy `X-Forwarded-For` client IP extraction. |

## Go-Live Checklist
1. Provision managed PostgreSQL 16 with Point-in-Time Recovery (PITR) (`OPEN-14`).
2. Run schema migrations using the owner role: `DATABASE_URL=$OWNER_URL npm run migrate`.
3. Provision the initial Super Admin operator: `BOOTSTRAP_ADMIN_PHONE=+91... BOOTSTRAP_ADMIN_NAME="..." npm run bootstrap-admin`.
4. Configure DLT-registered SMS provider credentials (`OPEN-07`).
5. Schedule `npx tsx scripts/anchor-ledger.ts` and `npx tsx scripts/verify-ledger.ts` via cron and store daily head hashes off-box.
6. Obtain written legal counsel sign-off (`docs/LEGAL_REVIEW.md`, `OPEN-02`, `OPEN-18`) before enabling Commercial Modes B or C.
