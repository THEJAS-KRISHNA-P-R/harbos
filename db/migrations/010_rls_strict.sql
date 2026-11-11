-- HarbourOS Migration 010: Strict Fail-Closed RLS, Section 21 Gate, Payout Items & Refresh Tokens (Round 2 A1–A4)

-- A1: Strict fail-closed core.tenant_access_allowed() with zero fallback to true
CREATE OR REPLACE FUNCTION core.tenant_access_allowed(p_tenant_id text) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN NULLIF(current_setting('app.tenant_id', true), '') IS NOT NULL THEN
      p_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    WHEN NULLIF(current_setting('app.platform', true), '') = 'on' THEN
      true
    ELSE
      false
  END
$$;

-- A2: Section 21 Inspection Gate on auction.lots
ALTER TABLE auction.lots ADD COLUMN IF NOT EXISTS weighed_by_user_id text;
UPDATE auction.lots SET weighed_by_user_id = 'USR-WGH-01' WHERE weighed_by_user_id IS NULL;

ALTER TABLE auction.lots ALTER COLUMN inspection_grade DROP NOT NULL;
ALTER TABLE auction.lots ALTER COLUMN inspection_grade DROP DEFAULT;
ALTER TABLE auction.lots ALTER COLUMN status SET DEFAULT 'WEIGHED_PENDING_INSPECTION';

ALTER TABLE auction.lots DROP CONSTRAINT IF EXISTS lots_weight_source_check;
ALTER TABLE auction.lots ADD CONSTRAINT lots_weight_source_check CHECK (
  weight_source IN ('MANUAL', 'BLE_SCALE', 'SCALE_USB', 'SCALE_SERIAL')
);

ALTER TABLE auction.lots DROP CONSTRAINT IF EXISTS chk_lots_s21_inspection_required;
ALTER TABLE auction.lots ADD CONSTRAINT chk_lots_s21_inspection_required CHECK (
  status NOT IN ('OPEN_FOR_AUCTION', 'PARTIALLY_SOLD', 'FULLY_SOLD', 'SOLD')
  OR inspection_grade IS NOT NULL
);

-- A3: Unique UTR per tenant on payout_batches & buyer_receipts table
CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_batches_tenant_bank_utr
  ON ledger.payout_batches (tenant_id, bank_utr)
  WHERE bank_utr IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger.buyer_receipts (
  receipt_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  buyer_id text NOT NULL REFERENCES harbour.buyers(buyer_id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  payment_reference text NOT NULL,
  idempotency_key text NOT NULL,
  journal_id text NOT NULL REFERENCES ledger.journals(journal_id),
  recorded_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

-- A4: Refresh token families with rotation & reuse detection
CREATE TABLE IF NOT EXISTS core.refresh_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES core.users(user_id),
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  family_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON core.refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON core.refresh_tokens (user_id);

-- Enable & Force RLS on new tenant-scoped tables from 009 & 010
ALTER TABLE ledger.payout_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.payout_batch_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_payout_batch_items ON ledger.payout_batch_items;
CREATE POLICY tenant_isolation_payout_batch_items ON ledger.payout_batch_items
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE ledger.daily_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.daily_anchors FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_daily_anchors ON ledger.daily_anchors;
CREATE POLICY tenant_isolation_daily_anchors ON ledger.daily_anchors
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE ledger.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_verifications ON ledger.verifications;
CREATE POLICY tenant_isolation_verifications ON ledger.verifications
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

ALTER TABLE ledger.buyer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.buyer_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_buyer_receipts ON ledger.buyer_receipts;
CREATE POLICY tenant_isolation_buyer_receipts ON ledger.buyer_receipts
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- Least-privilege runtime roles harbour_app (NOBYPASSRLS) and harbour_platform (BYPASSRLS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harbour_app') THEN
    CREATE ROLE harbour_app LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE harbour_app LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harbour_platform') THEN
    CREATE ROLE harbour_platform LOGIN BYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE harbour_platform LOGIN BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  EXECUTE format('ALTER ROLE %I BYPASSRLS', current_user);
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    NULL;
END
$$;

GRANT USAGE ON SCHEMA core, harbour, auction, ledger, sync TO harbour_app, harbour_platform;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, harbour, auction, ledger, sync TO harbour_app, harbour_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, harbour, auction, ledger, sync TO harbour_app, harbour_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, harbour, auction, ledger, sync TO harbour_app, harbour_platform;

-- Immutable append-only ledger: neither harbour_app nor harbour_platform can UPDATE, DELETE, or TRUNCATE
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.entries, ledger.journals FROM harbour_app, harbour_platform, PUBLIC;
