-- ============================================================================
-- HARBOUROS MIGRATION 003: WEIGHING LOTS, SINGLE-LEADER LEASES & PARTIAL-BOX ALLOCATIONS
-- PostgreSQL 16+ | Atomic Inventory Trigger | Section 4(8) & 19 Database Guards
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auction;

-- 12. Table: auction.vessel_trips (Morning Berthing & Catch Registration)
CREATE TABLE IF NOT EXISTS auction.vessel_trips (
  trip_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  vessel_id UUID NOT NULL,
  departure_date DATE NOT NULL,
  berthing_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fao_catch_area VARCHAR(64) NOT NULL DEFAULT 'FAO Area 51',
  landing_coordinates VARCHAR(64) DEFAULT '10°10''32"N 76°10''45"E',
  iuu_clearance_verified BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tenant_id, trip_id),
  CONSTRAINT fk_trip_vessel FOREIGN KEY (tenant_id, vessel_id) REFERENCES harbour.vessels(tenant_id, vessel_id)
);

-- 13. Table: auction.fish_lots (BLE Scale Ingestion & Thermal QR Tagging)
CREATE TABLE IF NOT EXISTS auction.fish_lots (
  lot_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  trip_id UUID,
  vessel_id UUID NOT NULL,
  species_code VARCHAR(32) NOT NULL REFERENCES harbour.species_catalog(species_code),
  quality_grade VARCHAR(24) NOT NULL CHECK (quality_grade IN ('A_EXPORT', 'A_DOMESTIC', 'B_PROCESS', 'REJECTED_UNFIT')),
  gross_weight_kg NUMERIC(10,2) NOT NULL CHECK (gross_weight_kg > 0),
  tare_weight_kg NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tare_weight_kg >= 0),
  net_weight_kg NUMERIC(10,2) NOT NULL CHECK (net_weight_kg > 0),
  total_boxes INTEGER NOT NULL CHECK (total_boxes > 0),
  available_boxes INTEGER NOT NULL CHECK (available_boxes >= 0),
  temperature_celsius NUMERIC(4,1) NOT NULL,
  weighing_mode VARCHAR(24) NOT NULL DEFAULT 'BLE_VERIFIED' CHECK (weighing_mode IN ('BLE_VERIFIED', 'MANUAL_AUDITED')),
  scale_ble_mac VARCHAR(64),
  manual_audit_reason TEXT,
  qr_signature_hmac VARCHAR(128) NOT NULL,
  section19_floor_price_paise BIGINT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'IN_AUCTION' CHECK (status IN ('WEIGHED_READY', 'IN_AUCTION', 'PARTIALLY_SOLD', 'FULLY_SOLD', 'SETTLED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, lot_id),
  CONSTRAINT chk_available_le_total CHECK (available_boxes <= total_boxes),
  CONSTRAINT fk_lot_vessel FOREIGN KEY (tenant_id, vessel_id) REFERENCES harbour.vessels(tenant_id, vessel_id)
);

-- 14. Table: auction.quality_inspections (Section 21 Official Inspector Logs)
CREATE TABLE IF NOT EXISTS auction.quality_inspections (
  inspection_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  lot_id VARCHAR(64) NOT NULL,
  inspector_user_id UUID,
  inspector_name VARCHAR(120) NOT NULL,
  inspector_badge_no VARCHAR(64) NOT NULL,
  core_temp_celsius NUMERIC(4,1) NOT NULL,
  organoleptic_score INTEGER NOT NULL CHECK (organoleptic_score BETWEEN 0 AND 100),
  ammonia_ppm NUMERIC(6,2) NOT NULL DEFAULT 8.0,
  assigned_grade VARCHAR(24) NOT NULL CHECK (assigned_grade IN ('A_EXPORT', 'A_DOMESTIC', 'B_PROCESS', 'REJECTED_UNFIT')),
  remarks TEXT,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_insp_lot FOREIGN KEY (tenant_id, lot_id) REFERENCES auction.fish_lots(tenant_id, lot_id)
);

-- 15. Table: auction.single_leader_leases (Prevents Offline Split-Brain Double Selling)
CREATE TABLE IF NOT EXISTS auction.single_leader_leases (
  lease_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  shed_zone VARCHAR(32) NOT NULL DEFAULT 'SHED-01',
  leader_tablet_node_id VARCHAR(64) NOT NULL,
  auctioneer_licence_id UUID NOT NULL,
  fencing_token BIGINT NOT NULL DEFAULT 1,
  leased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (tenant_id, shed_zone)
);

-- 16. Table: auction.sale_allocations (Partial-Box & Full-Lot Hammer Drops)
CREATE TABLE IF NOT EXISTS auction.sale_allocations (
  allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  lot_id VARCHAR(64) NOT NULL,
  allocation_seq INTEGER NOT NULL,
  auctioneer_licence_id UUID NOT NULL,
  buyer_id UUID NOT NULL,
  buyer_paddle_no INTEGER NOT NULL,
  allocated_boxes INTEGER NOT NULL CHECK (allocated_boxes > 0),
  allocated_weight_kg NUMERIC(10,2) NOT NULL CHECK (allocated_weight_kg > 0),
  price_per_kg_paise BIGINT NOT NULL CHECK (price_per_kg_paise > 0),
  gross_amount_paise BIGINT NOT NULL CHECK (gross_amount_paise > 0),
  fencing_token BIGINT NOT NULL DEFAULT 1,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, lot_id, allocation_seq),
  CONSTRAINT fk_alloc_lot FOREIGN KEY (tenant_id, lot_id) REFERENCES auction.fish_lots(tenant_id, lot_id),
  CONSTRAINT fk_alloc_buyer FOREIGN KEY (tenant_id, buyer_id) REFERENCES harbour.wholesale_buyers(tenant_id, buyer_id),
  CONSTRAINT fk_alloc_licence FOREIGN KEY (tenant_id, auctioneer_licence_id) REFERENCES harbour.auctioneer_licences(tenant_id, licence_id)
);

-- Trigger Function: Enforce Section 19 Floor Price, Section 4(8) Loan Binding & Atomic Box Decrement
CREATE OR REPLACE FUNCTION auction.fn_allocate_lot_inventory() RETURNS TRIGGER AS $$
DECLARE
  v_lot auction.fish_lots%ROWTYPE;
  v_vessel harbour.vessels%ROWTYPE;
BEGIN
  -- Lock the lot row for atomic inventory update
  SELECT * INTO v_lot
  FROM auction.fish_lots
  WHERE tenant_id = NEW.tenant_id AND lot_id = NEW.lot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fish lot % not found for tenant %', NEW.lot_id, NEW.tenant_id;
  END IF;

  IF v_lot.quality_grade = 'REJECTED_UNFIT' THEN
    RAISE EXCEPTION 'SECTION 21 VIOLATION: Lot % is marked REJECTED_UNFIT and cannot be auctioned', NEW.lot_id;
  END IF;

  IF NEW.price_per_kg_paise < v_lot.section19_floor_price_paise THEN
    RAISE EXCEPTION 'SECTION 19 FLOOR VIOLATION: Bid % paise is below statutory floor % paise',
      NEW.price_per_kg_paise, v_lot.section19_floor_price_paise;
  END IF;

  IF NEW.allocated_boxes > v_lot.available_boxes THEN
    RAISE EXCEPTION 'INVENTORY OVERFLOW: Requested % boxes, only % available on lot %',
      NEW.allocated_boxes, v_lot.available_boxes, NEW.lot_id;
  END IF;

  -- Check Section 4(8) Co-op Society Loan Tie-Up
  SELECT * INTO v_vessel
  FROM harbour.vessels
  WHERE tenant_id = NEW.tenant_id AND vessel_id = v_lot.vessel_id;

  IF v_vessel.has_active_society_loan AND v_vessel.deputed_auctioneer_licence_id IS NOT NULL THEN
    IF NEW.auctioneer_licence_id <> v_vessel.deputed_auctioneer_licence_id THEN
      RAISE EXCEPTION 'SECTION 4(8) VIOLATION: Vessel % has an active Co-op loan and must be auctioned by deputed society auctioneer',
        v_vessel.vessel_name;
    END IF;
  END IF;

  -- Atomically decrement available boxes and transition status
  UPDATE auction.fish_lots
  SET available_boxes = available_boxes - NEW.allocated_boxes,
      status = CASE
        WHEN (available_boxes - NEW.allocated_boxes) = 0 THEN 'FULLY_SOLD'
        ELSE 'PARTIALLY_SOLD'
      END
  WHERE tenant_id = NEW.tenant_id AND lot_id = NEW.lot_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_allocate_lot_inventory ON auction.sale_allocations;
CREATE TRIGGER trg_allocate_lot_inventory
BEFORE INSERT ON auction.sale_allocations
FOR EACH ROW EXECUTE FUNCTION auction.fn_allocate_lot_inventory();

-- Enable RLS
ALTER TABLE auction.vessel_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.fish_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.single_leader_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction.sale_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_trips ON auction.vessel_trips USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_lots ON auction.fish_lots USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_inspections ON auction.quality_inspections USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_leases ON auction.single_leader_leases USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_allocations ON auction.sale_allocations USING (tenant_id = core.current_tenant_id());
