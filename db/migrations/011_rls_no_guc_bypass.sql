-- HarbourOS Migration 011: Strict Fail-Closed RLS Without GUC Bypass & RLS On All Tables (Round 3 Phase B1 & B2)

-- B1 / P0-1: Eliminate platform GUC bypass so harbour_app can never disable RLS
CREATE OR REPLACE FUNCTION core.tenant_access_allowed(p_tenant_id text) RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL
     AND p_tenant_id = NULLIF(current_setting('app.tenant_id', true), '');
$$;
GRANT EXECUTE ON FUNCTION core.tenant_access_allowed(text) TO harbour_app, harbour_platform;

-- B2 / P1-1: Enable and Force RLS with tenant policy on the remaining 5 tables
-- 1. core.tenants: harbour_app sees only its own tenant row matching app.tenant_id; harbour_platform has BYPASSRLS
ALTER TABLE core.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_tenants ON core.tenants;
CREATE POLICY tenant_isolation_tenants ON core.tenants
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- 2. core.sessions
ALTER TABLE core.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sessions ON core.sessions;
CREATE POLICY tenant_isolation_sessions ON core.sessions
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- 3. core.sdk_api_keys
ALTER TABLE core.sdk_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.sdk_api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_sdk_api_keys ON core.sdk_api_keys;
CREATE POLICY tenant_isolation_sdk_api_keys ON core.sdk_api_keys
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- 4. sync.webhook_deliveries
ALTER TABLE sync.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync.webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_webhook_deliveries ON sync.webhook_deliveries;
CREATE POLICY tenant_isolation_webhook_deliveries ON sync.webhook_deliveries
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- 5. auction.leader_leases
ALTER TABLE auction.leader_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.leader_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_leader_leases ON auction.leader_leases;
CREATE POLICY tenant_isolation_leader_leases ON auction.leader_leases
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- Ensure FORCE RLS on all earlier tenant-scoped tables
ALTER TABLE core.commission_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE harbour.coop_societies FORCE ROW LEVEL SECURITY;
ALTER TABLE harbour.fishermen FORCE ROW LEVEL SECURITY;
ALTER TABLE harbour.vessels FORCE ROW LEVEL SECURITY;
ALTER TABLE harbour.auctioneer_licences FORCE ROW LEVEL SECURITY;
ALTER TABLE harbour.buyers FORCE ROW LEVEL SECURITY;
ALTER TABLE auction.lots FORCE ROW LEVEL SECURITY;
ALTER TABLE auction.sale_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.journals FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.entries FORCE ROW LEVEL SECURITY;
ALTER TABLE core.users FORCE ROW LEVEL SECURITY;
ALTER TABLE core.audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE harbour.species FORCE ROW LEVEL SECURITY;
ALTER TABLE auction.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.heads FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.payout_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger.reversal_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE sync.client_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE sync.outbox_events FORCE ROW LEVEL SECURITY;

-- Revoke access to platform-only tables from harbour_app
REVOKE ALL ON core.otp_challenges FROM harbour_app;
REVOKE ALL ON core.refresh_tokens FROM harbour_app;
REVOKE ALL ON core.schema_migrations FROM harbour_app;
