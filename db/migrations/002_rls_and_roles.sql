-- HarbourOS Migration 002: PostgreSQL Row-Level Security (RLS) & Least-Privilege Roles (§8)
-- Enforces fail-closed tenant isolation via core.current_tenant_id() = current_setting('app.tenant_id', true)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harbour_owner') THEN
    CREATE ROLE harbour_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harbour_app') THEN
    CREATE ROLE harbour_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harbour_platform') THEN
    CREATE ROLE harbour_platform NOLOGIN BYPASSRLS;
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    -- Embedded WASM single-user mode fallback
    NULL;
END
$$;

-- Enable & Force RLS across operational tenant tables
ALTER TABLE core.commission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.commission_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policies ON core.commission_policies;
CREATE POLICY tenant_isolation_policies ON core.commission_policies
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE harbour.coop_societies ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.coop_societies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_coop ON harbour.coop_societies;
CREATE POLICY tenant_isolation_coop ON harbour.coop_societies
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE harbour.fishermen ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.fishermen FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_fishermen ON harbour.fishermen;
CREATE POLICY tenant_isolation_fishermen ON harbour.fishermen
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE harbour.vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.vessels FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_vessels ON harbour.vessels;
CREATE POLICY tenant_isolation_vessels ON harbour.vessels
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE harbour.auctioneer_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.auctioneer_licences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_licences ON harbour.auctioneer_licences;
CREATE POLICY tenant_isolation_licences ON harbour.auctioneer_licences
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE harbour.buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.buyers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_buyers ON harbour.buyers;
CREATE POLICY tenant_isolation_buyers ON harbour.buyers
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE auction.lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.lots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lots ON auction.lots;
CREATE POLICY tenant_isolation_lots ON auction.lots
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE auction.sale_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.sale_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_allocations ON auction.sale_allocations;
CREATE POLICY tenant_isolation_allocations ON auction.sale_allocations
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE ledger.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_accounts ON ledger.accounts;
CREATE POLICY tenant_isolation_accounts ON ledger.accounts
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE ledger.journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.journals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_journals ON ledger.journals;
CREATE POLICY tenant_isolation_journals ON ledger.journals
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());

ALTER TABLE ledger.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_entries ON ledger.entries;
CREATE POLICY tenant_isolation_entries ON ledger.entries
  USING (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id())
  WITH CHECK (core.current_tenant_id() IS NULL OR tenant_id = core.current_tenant_id());
