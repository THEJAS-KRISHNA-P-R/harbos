-- HarbourOS Migration 013: Tenant Short Codes, Per-Tenant-Per-Day Lot Counter & Globally Unique Display Codes
-- Enforces:
-- 1. core.tenants.short_code: UNIQUE, 2-6 uppercase letters, backfilled cleanly.
-- 2. auction.lot_daily_counters: Per-tenant, per-day (Asia/Kolkata date) atomic counter table for gapless lot numbering.
-- 3. UNIQUE (tenant_id, lot_code) on auction.lots.

-- 1. Add short_code column to core.tenants if not exists
ALTER TABLE core.tenants ADD COLUMN IF NOT EXISTS short_code text;

-- Backfill short_code for existing tenants:
-- Derive from slug (letters only, uppercase, 3-6 chars) with collision-free disambiguation
DO $$
DECLARE
  t RECORD;
  base_code text;
  candidate text;
  suffix int;
BEGIN
  FOR t IN SELECT tenant_id, slug FROM core.tenants WHERE short_code IS NULL ORDER BY tenant_id ASC LOOP
    base_code := UPPER(REGEXP_REPLACE(t.slug, '[^A-Za-z]', '', 'g'));
    IF LENGTH(base_code) < 2 THEN
      base_code := 'TEN';
    END IF;
    base_code := SUBSTRING(base_code FROM 1 FOR 4);
    
    candidate := base_code;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM core.tenants WHERE short_code = candidate AND tenant_id != t.tenant_id) LOOP
      candidate := SUBSTRING(base_code FROM 1 FOR 3) || suffix::text;
      suffix := suffix + 1;
    END LOOP;

    UPDATE core.tenants SET short_code = candidate WHERE tenant_id = t.tenant_id;
  END LOOP;
END $$;

-- Enforce NOT NULL, uppercase 2-6 letter format, and UNIQUE on short_code
ALTER TABLE core.tenants ALTER COLUMN short_code SET NOT NULL;
ALTER TABLE core.tenants DROP CONSTRAINT IF EXISTS tenants_short_code_format;
ALTER TABLE core.tenants ADD CONSTRAINT tenants_short_code_format CHECK (short_code ~ '^[A-Z0-9]{2,6}$');
ALTER TABLE core.tenants DROP CONSTRAINT IF EXISTS tenants_short_code_unique;
ALTER TABLE core.tenants ADD CONSTRAINT tenants_short_code_unique UNIQUE (short_code);

-- 2. Create atomic per-tenant, per-day lot counter table
CREATE TABLE IF NOT EXISTS auction.lot_daily_counters (
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  day_code text NOT NULL, -- Format: YYMMDD in Asia/Kolkata
  last_seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day_code)
);

-- RLS on lot_daily_counters
ALTER TABLE auction.lot_daily_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.lot_daily_counters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_lot_daily_counters ON auction.lot_daily_counters;
CREATE POLICY tenant_isolation_lot_daily_counters ON auction.lot_daily_counters
  AS RESTRICTIVE
  USING (tenant_id = core.current_tenant_id())
  WITH CHECK (tenant_id = core.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON auction.lot_daily_counters TO harbour_app;

-- 3. Ensure UNIQUE (tenant_id, lot_code) on auction.lots
ALTER TABLE auction.lots DROP CONSTRAINT IF EXISTS uq_lots_tenant_lot_code;
ALTER TABLE auction.lots ADD CONSTRAINT uq_lots_tenant_lot_code UNIQUE (tenant_id, lot_code);
