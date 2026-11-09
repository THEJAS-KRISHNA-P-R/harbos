-- ============================================================================
-- HARBOUROS MIGRATION 002: HARBOUR MASTER, REALCRAFT FLEET, SEC 5 LICENCES & SEC 19 FLOORS
-- PostgreSQL 16+ | Composite Foreign Keys | Kerala Act No. 16 of 2021
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS harbour;

-- 6. Table: harbour.coop_societies (Primary Fishermen Development Welfare Co-op Societies)
CREATE TABLE IF NOT EXISTS harbour.coop_societies (
  society_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  registration_no VARCHAR(64) NOT NULL,
  society_name_en VARCHAR(160) NOT NULL,
  society_name_ml VARCHAR(160) NOT NULL,
  bank_account_no VARCHAR(32) NOT NULL,
  bank_ifsc VARCHAR(16) NOT NULL,
  is_matsyafed_affiliated BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, society_id),
  UNIQUE (tenant_id, registration_no)
);

-- 7. Table: harbour.auctioneer_licences (Kerala Act 16 Section 5 — 3-Year Validity)
CREATE TABLE IF NOT EXISTS harbour.auctioneer_licences (
  licence_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  auctioneer_name VARCHAR(120) NOT NULL,
  licence_number VARCHAR(64) NOT NULL,
  authorised_officer_ref VARCHAR(120) NOT NULL,
  security_deposit_ref VARCHAR(120) NOT NULL,
  deputed_by_society_id UUID,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, licence_id),
  UNIQUE (tenant_id, licence_number),
  CONSTRAINT fk_auctioneer_user FOREIGN KEY (tenant_id, user_id) REFERENCES core.users(tenant_id, user_id),
  CONSTRAINT fk_auctioneer_society FOREIGN KEY (tenant_id, deputed_by_society_id) REFERENCES harbour.coop_societies(tenant_id, society_id)
);

-- 8. Table: harbour.vessels (RealCraft Registry & Section 4(8) Loan Tie-Ups)
CREATE TABLE IF NOT EXISTS harbour.vessels (
  vessel_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  owner_user_id UUID,
  realcraft_reg_no VARCHAR(64) NOT NULL,
  vessel_name VARCHAR(120) NOT NULL,
  owner_name VARCHAR(120) NOT NULL,
  owner_phone VARCHAR(20) NOT NULL,
  nfdp_id VARCHAR(64) NOT NULL,
  gear_type VARCHAR(80) DEFAULT 'Deep-Sea Multi-day Gillnet',
  length_meters NUMERIC(5,2) DEFAULT 22.40,
  has_active_society_loan BOOLEAN NOT NULL DEFAULT FALSE,
  loan_coop_society_id UUID,
  deputed_auctioneer_licence_id UUID,
  bank_account_no VARCHAR(32) NOT NULL DEFAULT '309810293819',
  bank_ifsc VARCHAR(16) NOT NULL DEFAULT 'SBIN0008912',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, vessel_id),
  UNIQUE (tenant_id, realcraft_reg_no),
  CONSTRAINT fk_vessel_loan_society FOREIGN KEY (tenant_id, loan_coop_society_id) REFERENCES harbour.coop_societies(tenant_id, society_id),
  CONSTRAINT fk_vessel_deputed_auctioneer FOREIGN KEY (tenant_id, deputed_auctioneer_licence_id) REFERENCES harbour.auctioneer_licences(tenant_id, licence_id)
);

-- 9. Table: harbour.wholesale_buyers (Registered Buyer Paddles & Real-Time Credit Limits)
CREATE TABLE IF NOT EXISTS harbour.wholesale_buyers (
  buyer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  user_id UUID,
  paddle_no INTEGER NOT NULL,
  company_name VARCHAR(160) NOT NULL,
  contact_person VARCHAR(120) NOT NULL,
  gstin VARCHAR(20) NOT NULL,
  mpeda_exporter_code VARCHAR(40),
  credit_limit_paise BIGINT NOT NULL DEFAULT 250000000,
  active_bid_holds_paise BIGINT NOT NULL DEFAULT 0,
  settled_balance_paise BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, buyer_id),
  UNIQUE (tenant_id, paddle_no)
);

-- 10. Table: harbour.species_catalog
CREATE TABLE IF NOT EXISTS harbour.species_catalog (
  species_code VARCHAR(32) PRIMARY KEY,
  name_en VARCHAR(120) NOT NULL,
  name_ml VARCHAR(120) NOT NULL,
  scientific_name VARCHAR(120) NOT NULL,
  fao_3alpha_code VARCHAR(8) NOT NULL,
  hsn_code VARCHAR(16) NOT NULL DEFAULT '0302',
  typical_box_weight_kg NUMERIC(6,2) NOT NULL DEFAULT 25.00
);

-- 11. Table: harbour.section19_floor_prices (Daily Floor Prices by Harbour Management Society)
CREATE TABLE IF NOT EXISTS harbour.section19_floor_prices (
  floor_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  species_code VARCHAR(32) NOT NULL REFERENCES harbour.species_catalog(species_code),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  floor_price_paise_per_kg BIGINT NOT NULL CHECK (floor_price_paise_per_kg > 0),
  published_by_hms_officer VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, species_code, effective_date)
);

-- Enable RLS
ALTER TABLE harbour.coop_societies ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.auctioneer_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.wholesale_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.section19_floor_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_coop ON harbour.coop_societies USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_licences ON harbour.auctioneer_licences USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_vessels ON harbour.vessels USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_buyers ON harbour.wholesale_buyers USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_floors ON harbour.section19_floor_prices USING (tenant_id = core.current_tenant_id());
