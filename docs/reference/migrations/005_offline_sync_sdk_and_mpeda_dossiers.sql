-- ============================================================================
-- HARBOUROS MIGRATION 005: OFFLINE MESH SYNC, EXTERNAL SDK GATEWAY & MPEDA DOSSIERS
-- PostgreSQL 16+ | Transactional Outbox | EU Catch Certificate EC Reg 1005/2008
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS sync_sdk;

-- 22. Table: sync_sdk.offline_sync_events (Jetty Tablet SQLite WASM Replay Queue)
CREATE TABLE IF NOT EXISTS sync_sdk.offline_sync_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  tablet_node_id VARCHAR(64) NOT NULL,
  client_event_seq BIGINT NOT NULL,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('WEIGH_LOT', 'SALE_ALLOCATION', 'QUALITY_INSPECTION')),
  payload_json JSONB NOT NULL,
  hmac_signature VARCHAR(128) NOT NULL,
  recorded_offline_at TIMESTAMPTZ NOT NULL,
  replayed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, tablet_node_id, client_event_seq)
);

-- 23. Table: sync_sdk.sdk_partners (External Portals Embedding @harbouros/auction-sdk)
CREATE TABLE IF NOT EXISTS sync_sdk.sdk_partners (
  partner_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  partner_name VARCHAR(160) NOT NULL,
  domain_origin VARCHAR(255) NOT NULL,
  api_key_prefix VARCHAR(32) NOT NULL,
  api_key_hash TEXT NOT NULL,
  webhook_endpoint VARCHAR(255) NOT NULL,
  hmac_secret TEXT NOT NULL,
  fee_rate_bps INTEGER NOT NULL DEFAULT 50,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 24. Table: sync_sdk.outbox_events (HMAC-SHA256 Signed Transactional Webhooks)
CREATE TABLE IF NOT EXISTS sync_sdk.outbox_events (
  outbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  partner_id UUID REFERENCES sync_sdk.sdk_partners(partner_id),
  topic VARCHAR(64) NOT NULL,
  payload_json JSONB NOT NULL,
  signature_header VARCHAR(128) NOT NULL,
  delivery_status VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'DELIVERED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

-- 25. Table: sync_sdk.whatsapp_receipts (Malayalam Fisherman Instant Receipt Log)
CREATE TABLE IF NOT EXISTS sync_sdk.whatsapp_receipts (
  receipt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  vessel_id UUID NOT NULL,
  lot_id VARCHAR(64) NOT NULL,
  recipient_phone_e164 VARCHAR(20) NOT NULL,
  message_ml TEXT NOT NULL,
  net_payout_paise BIGINT NOT NULL,
  delivery_status VARCHAR(24) NOT NULL DEFAULT 'SENT',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 26. Table: sync_sdk.mpeda_export_dossiers (EU EC Reg 1005/2008 Catch Certificates)
CREATE TABLE IF NOT EXISTS sync_sdk.mpeda_export_dossiers (
  dossier_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  certificate_ref_no VARCHAR(64) UNIQUE NOT NULL,
  lot_id VARCHAR(64) NOT NULL,
  vessel_id UUID NOT NULL,
  buyer_id UUID,
  fao_catch_area VARCHAR(64) NOT NULL DEFAULT 'FAO Area 51',
  eic_approval_code VARCHAR(32) NOT NULL DEFAULT 'IN/CO/319',
  core_temp_celsius NUMERIC(4,1) NOT NULL,
  is_non_iuu_certified BOOLEAN NOT NULL DEFAULT TRUE,
  dossier_json JSONB NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_dossier_lot FOREIGN KEY (tenant_id, lot_id) REFERENCES auction.fish_lots(tenant_id, lot_id)
);

-- Enable RLS
ALTER TABLE sync_sdk.offline_sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_sdk.sdk_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_sdk.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_sdk.whatsapp_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_sdk.mpeda_export_dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_offline_events ON sync_sdk.offline_sync_events USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_sdk_partners ON sync_sdk.sdk_partners USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_outbox ON sync_sdk.outbox_events USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_whatsapp ON sync_sdk.whatsapp_receipts USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_dossiers ON sync_sdk.mpeda_export_dossiers USING (tenant_id = core.current_tenant_id());
