-- HarbourOS Migration 014: Idempotent Lot Counter Permissive RLS & Scale Hot-Query Indexes
-- 1. Ensures auction.lot_daily_counters has a permissive tenant isolation policy on upgraded DBs
--    (fixing restrictive-only policy from older migration 013 deployments).
-- 2. Adds composite covering indexes for multi-tenant scale queries & reporting (>100k ledger rows).

ALTER TABLE auction.lot_daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.lot_daily_counters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_lot_daily_counters ON auction.lot_daily_counters;
CREATE POLICY tenant_isolation_lot_daily_counters ON auction.lot_daily_counters
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

GRANT SELECT, INSERT, UPDATE ON auction.lot_daily_counters TO harbour_app;

-- Hot-query indexes for fisherman payables, buyer lookups, reports, and outbox polling
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_kind_id
  ON ledger.accounts (tenant_id, kind, account_id ASC);

CREATE INDEX IF NOT EXISTS idx_buyers_tenant_paddle
  ON harbour.buyers (tenant_id, paddle_no ASC);

CREATE INDEX IF NOT EXISTS idx_fishermen_tenant_id
  ON harbour.fishermen (tenant_id, fisherman_id ASC);

CREATE INDEX IF NOT EXISTS idx_payout_batch_items_tenant_batch
  ON ledger.payout_batch_items (tenant_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_payout_batch_items_tenant_fisherman
  ON ledger.payout_batch_items (tenant_id, fisherman_id);

CREATE INDEX IF NOT EXISTS idx_buyer_receipts_tenant_buyer
  ON ledger.buyer_receipts (tenant_id, buyer_id);

CREATE INDEX IF NOT EXISTS idx_lots_tenant_fisherman
  ON auction.lots (tenant_id, fisherman_id);

CREATE INDEX IF NOT EXISTS idx_allocations_tenant_buyer
  ON auction.sale_allocations (tenant_id, buyer_id);

CREATE INDEX IF NOT EXISTS idx_outbox_events_poll_created
  ON sync.outbox_events (status, next_attempt_at ASC, created_at ASC);
