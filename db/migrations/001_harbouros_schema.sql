-- HarbourOS Migration 001: Statutory Multi-Tenant Schema & Append-Only Double-Entry Ledger (§8)

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS harbour;
CREATE SCHEMA IF NOT EXISTS auction;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS sync;

CREATE OR REPLACE FUNCTION core.current_tenant_id() RETURNS text
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')
$$;

CREATE TABLE IF NOT EXISTS core.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.tenants (
  tenant_id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name_en text NOT NULL,
  name_ml text NOT NULL,
  centre_type text NOT NULL CHECK (centre_type IN ('KERALA_HARBOUR', 'KERALA_LANDING_CENTRE', 'KERALA_MARKET', 'INDIA_COOP')),
  floor_enforcement text NOT NULL DEFAULT 'WARN' CHECK (floor_enforcement IN ('BLOCK', 'WARN', 'OFF')),
  active_policy_id text NOT NULL,
  hms_account_id text NOT NULL,
  coop_pool_account_id text NOT NULL,
  harbouros_revenue_account_id text NOT NULL,
  gst_payable_account_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.commission_policies (
  policy_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  version_num integer NOT NULL,
  commercial_mode text NOT NULL CHECK (commercial_mode IN ('FIXED_SAAS_ONLY', 'INSTITUTIONAL_TECH_SHARE', 'HYBRID')),
  commission_bps integer NOT NULL CHECK (commission_bps >= 0 AND commission_bps <= 500),
  auctioneer_share_bps integer NOT NULL CHECK (auctioneer_share_bps >= 0),
  hms_share_bps integer NOT NULL CHECK (hms_share_bps >= 0),
  fisher_bonus_share_bps integer NOT NULL CHECK (fisher_bonus_share_bps >= 0),
  coop_share_bps integer NOT NULL CHECK (coop_share_bps >= 0),
  institutional_tech_share_bps integer NOT NULL DEFAULT 2000,
  buyer_fee_bps integer NOT NULL DEFAULT 100,
  gst_rate_bps integer NOT NULL DEFAULT 1800,
  notification_ref text NOT NULL,
  legal_basis_ref text NOT NULL,
  legal_signoff_ref text,
  legal_signoff_date text,
  effective_from text NOT NULL,
  CHECK (auctioneer_share_bps + hms_share_bps + fisher_bonus_share_bps + coop_share_bps = 10000),
  CHECK (
    commercial_mode = 'FIXED_SAAS_ONLY'
    OR (legal_signoff_ref IS NOT NULL AND length(trim(legal_signoff_ref)) > 0 AND legal_signoff_date IS NOT NULL AND length(trim(legal_signoff_date)) > 0)
  )
);

CREATE TABLE IF NOT EXISTS core.users (
  user_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  phone_e164 text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN (
    'SUPER_ADMIN',
    'HARBOUR_ADMIN',
    'LICENSED_AUCTIONEER',
    'FISHERMAN_BOAT_OWNER',
    'WHOLESALE_BUYER',
    'WEIGHING_OPERATOR',
    'ACCOUNTANT',
    'AUTHORIZED_INSPECTOR'
  )),
  pin_code text NOT NULL DEFAULT '1234',
  entity_ref_id text,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS core.audit_logs (
  audit_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  actor_user_id text NOT NULL,
  actor_role text NOT NULL,
  action_code text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details_json text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS harbour.coop_societies (
  society_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  name_en text NOT NULL,
  name_ml text NOT NULL,
  reg_no text NOT NULL
);

CREATE TABLE IF NOT EXISTS harbour.fishermen (
  fisherman_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  full_name text NOT NULL,
  phone_e164 text NOT NULL,
  welfare_board_no text NOT NULL,
  coop_society_id text NOT NULL REFERENCES harbour.coop_societies(society_id),
  payable_account_id text NOT NULL,
  bonus_escrow_account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS harbour.vessels (
  vessel_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  registration_no text NOT NULL,
  vessel_name_en text NOT NULL,
  vessel_name_ml text NOT NULL,
  owner_fisherman_id text NOT NULL REFERENCES harbour.fishermen(fisherman_id),
  has_active_society_loan boolean NOT NULL DEFAULT false,
  loan_coop_society_id text REFERENCES harbour.coop_societies(society_id),
  qr_token text NOT NULL
);

CREATE TABLE IF NOT EXISTS harbour.auctioneer_licences (
  licence_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  auctioneer_user_id text NOT NULL,
  auctioneer_name text NOT NULL,
  licence_no text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'SUSPENDED')),
  valid_from text NOT NULL,
  valid_until text NOT NULL,
  deputed_by_society_id text REFERENCES harbour.coop_societies(society_id),
  payable_account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS harbour.buyers (
  buyer_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  buyer_name text NOT NULL,
  paddle_no integer NOT NULL,
  gstin text NOT NULL,
  export_reg_no text,
  escrow_balance_paise bigint NOT NULL DEFAULT 0,
  approved_credit_paise bigint NOT NULL DEFAULT 0,
  unsettled_payables_paise bigint NOT NULL DEFAULT 0,
  active_holds_paise bigint NOT NULL DEFAULT 0,
  receivable_account_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS harbour.species (
  species_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  code text NOT NULL,
  name_en text NOT NULL,
  name_ml text NOT NULL,
  scientific_name text NOT NULL,
  floor_price_paise_per_kg bigint NOT NULL CHECK (floor_price_paise_per_kg >= 0),
  export_eligible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS auction.lots (
  lot_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  lot_code text NOT NULL,
  vessel_id text NOT NULL REFERENCES harbour.vessels(vessel_id),
  fisherman_id text NOT NULL REFERENCES harbour.fishermen(fisherman_id),
  species_id text NOT NULL REFERENCES harbour.species(species_id),
  sale_unit_type text NOT NULL DEFAULT 'BOX' CHECK (sale_unit_type IN ('WEIGHT_KG', 'BOX', 'BASKET', 'PIECE')),
  total_boxes integer NOT NULL CHECK (total_boxes > 0),
  available_boxes integer NOT NULL CHECK (available_boxes >= 0 AND available_boxes <= total_boxes),
  net_grams bigint NOT NULL CHECK (net_grams > 0),
  available_grams bigint NOT NULL CHECK (available_grams >= 0 AND available_grams <= net_grams),
  core_temp_c numeric(4,1) NOT NULL DEFAULT 2.0,
  inspection_grade text NOT NULL DEFAULT 'A_EXPORT' CHECK (inspection_grade IN ('A_EXPORT', 'A_DOMESTIC', 'B_PROCESS', 'REJECTED_UNFIT')),
  inspection_notes text NOT NULL DEFAULT 'Fresh dockside landing ice-chilled',
  inspected_by_user_id text,
  weight_source text NOT NULL DEFAULT 'MANUAL' CHECK (weight_source IN ('MANUAL', 'SIMULATOR', 'BLE_SCALE')),
  qr_signature text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN_FOR_AUCTION' CHECK (status IN ('WEIGHED_PENDING_INSPECTION', 'OPEN_FOR_AUCTION', 'PARTIALLY_SOLD', 'FULLY_SOLD', 'BLOCKED_UNFIT')),
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS auction.sessions (
  session_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  session_code text NOT NULL,
  auction_mode text NOT NULL DEFAULT 'PHYSICAL_SHOUT' CHECK (auction_mode IN ('PHYSICAL_SHOUT', 'HYBRID_REMOTE', 'DUTCH_CLOCK', 'COOP_PROCUREMENT', 'HMS_DIRECT_TAKEOVER')),
  active_lot_id text,
  leader_device_id text NOT NULL,
  fencing_token integer NOT NULL DEFAULT 1,
  lease_expires_at text NOT NULL,
  dutch_start_price_paise bigint NOT NULL DEFAULT 65000,
  dutch_floor_price_paise bigint NOT NULL DEFAULT 42000,
  status text NOT NULL DEFAULT 'OPEN'
);

CREATE TABLE IF NOT EXISTS auction.sale_allocations (
  allocation_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  lot_id text NOT NULL REFERENCES auction.lots(lot_id),
  allocation_seq integer NOT NULL,
  session_id text NOT NULL,
  auction_mode text NOT NULL,
  policy_id text NOT NULL,
  auctioneer_licence_id text NOT NULL,
  buyer_id text NOT NULL REFERENCES harbour.buyers(buyer_id),
  boxes_allocated integer NOT NULL CHECK (boxes_allocated > 0),
  grams_allocated bigint NOT NULL CHECK (grams_allocated > 0),
  price_per_kg_paise bigint NOT NULL CHECK (price_per_kg_paise > 0),
  hammer_paise bigint NOT NULL CHECK (hammer_paise > 0),
  buyer_payable_paise bigint NOT NULL CHECK (buyer_payable_paise > 0),
  fisherman_net_paise bigint NOT NULL CHECK (fisherman_net_paise >= 0),
  bonus_escrow_paise bigint NOT NULL CHECK (bonus_escrow_paise >= 0),
  auctioneer_paise bigint NOT NULL CHECK (auctioneer_paise >= 0),
  hms_net_paise bigint NOT NULL CHECK (hms_net_paise >= 0),
  coop_net_paise bigint NOT NULL CHECK (coop_net_paise >= 0),
  harbouros_revenue_paise bigint NOT NULL CHECK (harbouros_revenue_paise >= 0),
  gst_paise bigint NOT NULL CHECK (gst_paise >= 0),
  floor_warning_triggered boolean NOT NULL DEFAULT false,
  government_permission_ref text,
  idempotency_key text NOT NULL UNIQUE,
  fencing_token integer NOT NULL,
  journal_id text NOT NULL,
  server_latency_ms integer NOT NULL DEFAULT 2,
  created_at text NOT NULL,
  UNIQUE (tenant_id, lot_id, allocation_seq)
);

CREATE TABLE IF NOT EXISTS ledger.accounts (
  account_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  kind text NOT NULL CHECK (kind IN (
    'FISHERMAN_PAYABLE',
    'FISHERMAN_BONUS_ESCROW',
    'BUYER_RECEIVABLE',
    'AUCTIONEER_PAYABLE',
    'HMS_FUND',
    'COOP_SOCIETY_FUND',
    'HARBOUROS_REVENUE',
    'GST_PAYABLE'
  )),
  code text NOT NULL,
  name_en text NOT NULL,
  owner_entity_id text NOT NULL,
  balance_paise bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ledger.heads (
  tenant_id text PRIMARY KEY REFERENCES core.tenants(tenant_id),
  last_entry_seq bigint NOT NULL DEFAULT 0,
  last_row_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger.journals (
  journal_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  reference_type text NOT NULL CHECK (reference_type IN ('SALE_ALLOCATION', 'REVERSAL', 'PAYOUT_BATCH', 'BONUS_RELEASE')),
  reference_id text NOT NULL,
  description text NOT NULL,
  reverses_journal_id text REFERENCES ledger.journals(journal_id),
  authorized_by_user_1 text,
  authorized_by_user_2 text,
  reason_note text,
  total_amount_paise bigint NOT NULL CHECK (total_amount_paise > 0),
  created_at text NOT NULL,
  CHECK (
    reverses_journal_id IS NULL
    OR (
      authorized_by_user_1 IS NOT NULL
      AND authorized_by_user_2 IS NOT NULL
      AND authorized_by_user_1 <> authorized_by_user_2
      AND reason_note IS NOT NULL
      AND length(trim(reason_note)) >= 5
    )
  )
);

CREATE TABLE IF NOT EXISTS ledger.entries (
  entry_seq bigint NOT NULL,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  journal_id text NOT NULL REFERENCES ledger.journals(journal_id),
  account_id text NOT NULL REFERENCES ledger.accounts(account_id),
  direction text NOT NULL CHECK (direction IN ('D', 'C')),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  prev_row_hash text NOT NULL,
  row_hash text NOT NULL,
  created_at_utc_iso_ms text NOT NULL,
  PRIMARY KEY (tenant_id, entry_seq)
);

CREATE OR REPLACE FUNCTION ledger.forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_VIOLATION: table %.% is strictly append-only under Act 16 of 2021', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_journals_immutable ON ledger.journals;
CREATE TRIGGER trg_journals_immutable
  BEFORE UPDATE OR DELETE ON ledger.journals
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();

DROP TRIGGER IF EXISTS trg_entries_immutable ON ledger.entries;
CREATE TRIGGER trg_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.forbid_mutation();

CREATE TABLE IF NOT EXISTS ledger.reversal_requests (
  reversal_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  original_journal_id text NOT NULL REFERENCES ledger.journals(journal_id),
  reason_note text NOT NULL,
  requested_by_user_id text NOT NULL,
  requested_by_name text NOT NULL,
  approved_by_user_id text,
  approved_by_name text,
  compensating_journal_id text,
  status text NOT NULL DEFAULT 'PENDING_SECOND_APPROVAL' CHECK (status IN ('PENDING_SECOND_APPROVAL', 'EXECUTED')),
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger.payout_batches (
  batch_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  batch_code text NOT NULL,
  beneficiary_kind text NOT NULL,
  total_amount_paise bigint NOT NULL CHECK (total_amount_paise > 0),
  item_count integer NOT NULL CHECK (item_count > 0),
  status text NOT NULL DEFAULT 'GENERATED_CSV' CHECK (status IN ('GENERATED_CSV', 'RECONCILED_UTR')),
  bank_utr text,
  reconciled_at text,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS sync.client_commands (
  command_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  device_id text NOT NULL,
  command_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('APPLIED', 'QUARANTINED', 'REJECTED')),
  result_ref_id text,
  quarantine_reason text,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS sync.outbox_events (
  event_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS', 'WHATSAPP', 'WEBHOOK')),
  recipient text NOT NULL,
  template_code text NOT NULL,
  payload_json text NOT NULL,
  status text NOT NULL DEFAULT 'DISPATCHED_CONSOLE',
  created_at text NOT NULL
);
