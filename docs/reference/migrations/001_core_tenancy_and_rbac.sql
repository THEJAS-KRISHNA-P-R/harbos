-- ============================================================================
-- HARBOUROS MIGRATION 001: CORE MULTI-TENANCY, RBAC & COMMISSION POLICIES
-- PostgreSQL 16+ | Strict Row-Level Security (RLS) | Kerala Act No. 16 of 2021
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS core;

-- Helper function to retrieve active tenant_id from PgBouncer transaction session
CREATE OR REPLACE FUNCTION core.current_tenant_id() RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- 1. Table: core.tenants
CREATE TABLE IF NOT EXISTS core.tenants (
  tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) UNIQUE NOT NULL,
  name_en VARCHAR(160) NOT NULL,
  name_ml VARCHAR(160) NOT NULL,
  harbour_type VARCHAR(32) NOT NULL CHECK (harbour_type IN ('MAJOR_HARBOUR', 'MINOR_HARBOUR', 'LANDING_CENTRE', 'WHOLESALE_MARKET')),
  un_locode VARCHAR(16) DEFAULT 'IN MNM',
  district VARCHAR(64) NOT NULL DEFAULT 'Ernakulam',
  state_code VARCHAR(8) NOT NULL DEFAULT 'KL',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Table: core.commission_policies (Kerala Act 16 Sections 4(4), 4(5), 4(6))
CREATE TABLE IF NOT EXISTS core.commission_policies (
  policy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  billing_mode VARCHAR(40) NOT NULL CHECK (billing_mode IN ('FIXED_SAAS_ONLY', 'INSTITUTIONAL_TECH_SHARE', 'HYBRID_INSTITUTIONAL_AND_BUYER')),
  monthly_saas_price_paise BIGINT NOT NULL DEFAULT 3000000,
  seller_commission_cap_bps INTEGER NOT NULL DEFAULT 500 CHECK (seller_commission_cap_bps <= 500), -- Max 5.00%
  split_auctioneer_bps INTEGER NOT NULL DEFAULT 2000,    -- 20% of 5% = 1.00%
  split_hms_bps INTEGER NOT NULL DEFAULT 2000,           -- 20% of 5% = 1.00%
  split_fisher_bonus_bps INTEGER NOT NULL DEFAULT 4000,  -- 40% of 5% = 2.00% (Sec 4(5))
  split_coop_society_bps INTEGER NOT NULL DEFAULT 2000,  -- 20% of 5% = 1.00%
  harbouros_cut_from_hms_bps INTEGER NOT NULL DEFAULT 2000,
  harbouros_cut_from_coop_bps INTEGER NOT NULL DEFAULT 2000,
  buyer_clearing_fee_bps INTEGER NOT NULL DEFAULT 100,
  gst_rate_bps INTEGER NOT NULL DEFAULT 1800,
  apply_gst_on_tech_share BOOLEAN NOT NULL DEFAULT TRUE,
  apply_gst_on_buyer_fee BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id),
  CONSTRAINT chk_statutory_split_10000 CHECK (
    split_auctioneer_bps + split_hms_bps + split_fisher_bonus_bps + split_coop_society_bps = 10000
  )
);

-- 3. Table: core.users (8 Persona Roles)
CREATE TABLE IF NOT EXISTS core.users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  email VARCHAR(160),
  role VARCHAR(32) NOT NULL CHECK (role IN (
    'SUPER_ADMIN',
    'HARBOUR_ADMIN',
    'LICENSED_AUCTIONEER',
    'FISHERMAN_BOAT_OWNER',
    'WHOLESALE_BUYER',
    'WEIGHING_OPERATOR',
    'ACCOUNTANT',
    'AUTHORIZED_INSPECTOR'
  )),
  auth_pin_hash TEXT,
  preferred_locale VARCHAR(10) NOT NULL DEFAULT 'ml-IN',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, phone_e164),
  UNIQUE (tenant_id, user_id)
);

-- 4. Table: core.role_permissions
CREATE TABLE IF NOT EXISTS core.role_permissions (
  permission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(32) NOT NULL,
  resource VARCHAR(64) NOT NULL,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_read BOOLEAN NOT NULL DEFAULT TRUE,
  can_Execute_reversal BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (role, resource)
);

-- 5. Table: core.audit_logs (Immutable security audit trail)
CREATE TABLE IF NOT EXISTS core.audit_logs (
  audit_id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id),
  actor_user_id UUID,
  actor_role VARCHAR(32) NOT NULL,
  action_code VARCHAR(64) NOT NULL,
  entity_table VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_ip VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on all tenant-scoped tables in core
ALTER TABLE core.commission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_commission_policies ON core.commission_policies
  USING (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_isolation_users ON core.users
  USING (tenant_id = core.current_tenant_id());

CREATE POLICY tenant_isolation_audit_logs ON core.audit_logs
  USING (tenant_id = core.current_tenant_id());
