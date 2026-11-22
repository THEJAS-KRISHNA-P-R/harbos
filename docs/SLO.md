# HarbourOS — Service Level Objectives & Alerting (`docs/SLO.md`)

## 1. Service Window
HarbourOS operates two distinct traffic regimes per Kerala Fish Landing Centre (FLC):
- **Auction Peak Window (04:00 – 10:00 IST daily):** High-concurrency dockside weighing, quality grading, pit auction knock-downs, and buyer settlement. Zero-downtime mandatory.
- **Clearing & Reporting Window (10:00 – 20:00 IST daily):** Bank UTR payout reconciliation, statutory Section 22 returns, shadow-pilot diffing, and daily SHA-256 ledger anchoring.

---

## 2. Service Level Indicators (SLIs) & Targets (SLOs)

| Domain | SLI Definition | 30-Day SLO Target | Error Budget (30d) | Verified Baseline (`scripts/load.ts` / `scripts/check-plans.ts`) |
|---|---|---|---|---|
| **API Availability (Peak)** | Ratio of non-5xx responses on `/api/v1/*` during 04:00–10:00 IST | **99.95%** | 21.6 min / month | `0` HTTP 5xx across 7,124 ops (2 web instances behind PgBouncer) |
| **API Latency (Mixed R/W)** | p95 HTTP latency across `/api/v1/lots`, `/api/v1/bootstrap`, `/api/v1/reports/*` | **< 500 ms** (target < 150 ms) | 5% of requests | Measured **45.75 ms** sustained p95 (**57.95 ms** overall) |
| **Hot-Query DB Execution** | PostgreSQL `EXPLAIN ANALYZE` p95 on 13 hot queries at >100k ledger entries | **< 50 ms** & 0 Seq Scans on >100k tables | 0 regressions | Measured **2.12 ms – 14.57 ms** across 13/13 queries (`126k+` entries) |
| **Zero-Oversell Integrity** | Ratio of `auction.sale_allocations` where `SUM(boxes_allocated) <= total_boxes` | **100.00%** (strict invariant) | **0 boxes** | Verified `10/10` boxes allocated under 200 concurrent requests (`409` on 190 excess) |
| **Ledger Conservation & Hash Chain** | Daily `npm run verify:ledger` + `apportionment == ledger` parity | **100.00%** (0 paise divergence) | **0 paise** | Verified clean across all tenants + 10,000-case property tests |
| **OTP & Alert SMS Delivery** | Ratio of `sync.outbox_events` dispatched within 30s (excluding carrier blocks) | **99.50%** | 0.50% | Exponential backoff (`10s * 2^attempts`), dead-letter after 5 attempts |
| **Recovery Objectives** | PostgreSQL PITR & stateless Cloud Run failover | **RPO <= 5 min**, **RTO <= 15 min** | — | Stateless web/worker pods; PgBouncer transaction pooling |

---

## 3. Burn-Rate Alerts & On-Call Actions

| Alert | Trigger Condition | Severity | Immediate Runbook Action |
|---|---|---|---|
| `HarbourApi5xxBurnFast` | 5xx rate > 1% over 5 min (14.4× burn) | **P1 Page** | Inspect Cloud Run logs + `/readyz`; verify PgBouncer pool saturation and PostgreSQL primary health. |
| `HarbourApiLatencyHigh` | p95 > 500 ms for 10 consecutive min | **P2 Page** | Check `pg_stat_activity` for lock waits on `auction.lots`; run `ANALYZE` and verify PgBouncer `default_pool_size`. |
| `HarbourOutboxDeadLetterSpike` | `harbouros_outbox_dead_letter_total` increases by >= 5 in 15 min | **P2 Page** | Check MSG91 DLT template/quota status; inspect `sync.outbox_events WHERE status = 'DEAD_LETTER'`. |
| `HarbourLedgerVerifyFailure` | `npm run verify:ledger` exits non-zero | **P0 Freeze** | Freeze payout batch generation immediately; compare latest `ledger.daily_anchors` against external JSONL HMAC sink. |
| `HarbourUnsettledPayoutAging` | `agedOver24hUnsettledCount > 0` in `payout-reconciliation` report | **P3 Ticket** | Escalate to HMS Chief Accountant to upload missing Bank Nodal UTR CSV. |

---

## 4. Telemetry Endpoints
- Liveness: `GET /healthz` (process up, zero DB query).
- Readiness: `GET /readyz` (PostgreSQL connectivity + migration head check).
- Prometheus metrics: `GET /api/v1/metrics` (authenticated `HARBOUR_ADMIN` / `SUPER_ADMIN` only; exports SQL query counters, rate-limit rejects, and `harbouros_outbox_dead_letter_total`).
