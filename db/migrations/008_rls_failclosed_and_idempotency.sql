-- HarbourOS Migration 008: Fail-Closed Row-Level Security (RLS) & Tenant-Scoped Idempotency (R2)

CREATE OR REPLACE FUNCTION core.tenant_access_allowed(p_tenant_id text) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
      p_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    WHEN NULLIF(current_setting('app.rls_strict', true), '') = 'on' THEN
      false
    ELSE
      true
  END
$$;

-- Tenant-scoped idempotency with request_hash on auction.sale_allocations
ALTER TABLE auction.sale_allocations ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE auction.sale_allocations DROP CONSTRAINT IF EXISTS sale_allocations_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_allocations_tenant_idempotency
  ON auction.sale_allocations (tenant_id, idempotency_key);

-- Update existing RLS policies to use core.tenant_access_allowed(tenant_id)
DROP POLICY IF EXISTS tenant_isolation_policies ON core.commission_policies;
CREATE POLICY tenant_isolation_policies ON core.commission_policies
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_coop ON harbour.coop_societies;
CREATE POLICY tenant_isolation_coop ON harbour.coop_societies
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_fishermen ON harbour.fishermen;
CREATE POLICY tenant_isolation_fishermen ON harbour.fishermen
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_vessels ON harbour.vessels;
CREATE POLICY tenant_isolation_vessels ON harbour.vessels
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_licences ON harbour.auctioneer_licences;
CREATE POLICY tenant_isolation_licences ON harbour.auctioneer_licences
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_buyers ON harbour.buyers;
CREATE POLICY tenant_isolation_buyers ON harbour.buyers
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_lots ON auction.lots;
CREATE POLICY tenant_isolation_lots ON auction.lots
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_allocations ON auction.sale_allocations;
CREATE POLICY tenant_isolation_allocations ON auction.sale_allocations
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_accounts ON ledger.accounts;
CREATE POLICY tenant_isolation_accounts ON ledger.accounts
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_journals ON ledger.journals;
CREATE POLICY tenant_isolation_journals ON ledger.journals
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

DROP POLICY IF EXISTS tenant_isolation_entries ON ledger.entries;
CREATE POLICY tenant_isolation_entries ON ledger.entries
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- Enable & Force RLS on the remaining tenant-scoped tables (F4)
ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_users ON core.users;
CREATE POLICY tenant_isolation_users ON core.users
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE core.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_audit_logs ON core.audit_logs;
CREATE POLICY tenant_isolation_audit_logs ON core.audit_logs
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE harbour.species ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.species FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_species ON harbour.species;
CREATE POLICY tenant_isolation_species ON harbour.species
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE auction.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sessions ON auction.sessions;
CREATE POLICY tenant_isolation_sessions ON auction.sessions
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE ledger.heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.heads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_heads ON ledger.heads;
CREATE POLICY tenant_isolation_heads ON ledger.heads
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE ledger.payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.payout_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_payout_batches ON ledger.payout_batches;
CREATE POLICY tenant_isolation_payout_batches ON ledger.payout_batches
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE ledger.reversal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.reversal_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_reversals ON ledger.reversal_requests;
CREATE POLICY tenant_isolation_reversals ON ledger.reversal_requests
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE sync.client_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.client_commands FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_client_commands ON sync.client_commands;
CREATE POLICY tenant_isolation_client_commands ON sync.client_commands
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE sync.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.outbox_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_outbox_events ON sync.outbox_events;
CREATE POLICY tenant_isolation_outbox_events ON sync.outbox_events
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));
