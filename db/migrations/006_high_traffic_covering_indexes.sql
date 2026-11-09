-- ============================================================================
-- HarbourOS Migration 006: High-Traffic Covering & Composite Indexes
-- Optimizes multi-tenant read storms, idempotency lookups, SHA-256 chain scans,
-- and audit log filtering under concurrent dockside & buyer load.
-- ============================================================================

-- 1. Covering composite index for active auction lot discovery by tenant + status
CREATE INDEX IF NOT EXISTS idx_lots_tenant_status_code
  ON auction.lots (tenant_id, status, lot_code ASC);

-- 2. Fast idempotent replay & chronological allocation lookups
CREATE INDEX IF NOT EXISTS idx_allocations_tenant_created_desc
  ON auction.sale_allocations (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_allocations_tenant_idempotency
  ON auction.sale_allocations (tenant_id, idempotency_key);

-- 3. Ordered SHA-256 hash-chain verification & journal drilldown index
CREATE INDEX IF NOT EXISTS idx_entries_tenant_seq_asc
  ON ledger.entries (tenant_id, entry_seq ASC);

CREATE INDEX IF NOT EXISTS idx_entries_tenant_journal
  ON ledger.entries (tenant_id, journal_id);

-- 4. Chronological double-entry journal & nodal payout batch indexes
CREATE INDEX IF NOT EXISTS idx_journals_tenant_created_desc
  ON ledger.journals (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_batches_tenant_created_desc
  ON ledger.payout_batches (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payout_batches_tenant_status
  ON ledger.payout_batches (tenant_id, status);

-- 5. High-throughput audit trail & outbox event indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_desc
  ON core.audit_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_desc
  ON core.audit_logs (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbox_events_tenant_created_desc
  ON sync.outbox_events (tenant_id, created_at DESC);
