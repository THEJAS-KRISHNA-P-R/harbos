-- ============================================================================
-- HARBOUROS MIGRATION 004: SHA-256 HASH-CHAINED DOUBLE-ENTRY LEDGER & BANK BATCHES
-- PostgreSQL 16+ | Append-Only Immutability | Dual-Key Compensating Reversals
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS ledger;

-- 17. Table: ledger.ledger_heads (Per-Tenant Cryptographic Chain Head)
CREATE TABLE IF NOT EXISTS ledger.ledger_heads (
  tenant_id UUID PRIMARY KEY REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  last_entry_seq BIGINT NOT NULL DEFAULT 0,
  last_row_hash CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 18. Table: ledger.journals (Balanced Double-Entry Journal Header)
CREATE TABLE IF NOT EXISTS ledger.journals (
  journal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  reference_type VARCHAR(32) NOT NULL CHECK (reference_type IN ('SALE_SETTLEMENT', 'BUYER_DEPOSIT', 'BANK_PAYOUT', 'AUTHORIZED_REVERSAL')),
  reference_id VARCHAR(128) NOT NULL,
  reverses_journal_id UUID,
  authorized_by_user1 UUID NOT NULL,
  authorized_by_user2 UUID,
  reason_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, journal_id),
  CONSTRAINT chk_dual_key_reversal CHECK (
    reference_type <> 'AUTHORIZED_REVERSAL'
    OR (authorized_by_user2 IS NOT NULL AND authorized_by_user1 <> authorized_by_user2 AND reason_note IS NOT NULL)
  )
);

-- 19. Table: ledger.ledger_entries (Immutable SHA-256 Hash-Chained Ledger Lines)
CREATE TABLE IF NOT EXISTS ledger.ledger_entries (
  entry_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  entry_seq BIGINT NOT NULL,
  journal_id UUID NOT NULL,
  account_type VARCHAR(32) NOT NULL CHECK (account_type IN (
    'BUYER_RECEIVABLE',
    'FISHERMAN_PAYABLE',
    'FISHERMAN_BONUS_ESCROW',
    'AUCTIONEER_PAYABLE',
    'HMS_PAYABLE',
    'COOP_SOCIETY_PAYABLE',
    'HARBOUROS_REVENUE',
    'GST_TAX_PAYABLE'
  )),
  beneficiary_name VARCHAR(160) NOT NULL,
  direction CHAR(1) NOT NULL CHECK (direction IN ('D', 'C')),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  prev_row_hash CHAR(64) NOT NULL,
  row_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, entry_seq),
  CONSTRAINT fk_entry_journal FOREIGN KEY (tenant_id, journal_id) REFERENCES ledger.journals(tenant_id, journal_id)
);

-- 20. Table: ledger.bank_payout_batches (Corporate Bank NEFT/RTGS/IMPS Files)
CREATE TABLE IF NOT EXISTS ledger.bank_payout_batches (
  batch_id VARCHAR(64) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  generated_by_user_id UUID,
  rail VARCHAR(16) NOT NULL CHECK (rail IN ('NEFT', 'RTGS', 'IMPS')),
  total_records INTEGER NOT NULL CHECK (total_records > 0),
  total_amount_paise BIGINT NOT NULL CHECK (total_amount_paise > 0),
  status VARCHAR(24) NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'RECONCILED', 'PROCESSED')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, batch_id)
);

-- 21. Table: ledger.bank_payout_items (Individual Beneficiary Transfers & UTR Reconciliation)
CREATE TABLE IF NOT EXISTS ledger.bank_payout_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES core.tenants(tenant_id) ON DELETE CASCADE,
  batch_id VARCHAR(64) NOT NULL,
  beneficiary_name VARCHAR(160) NOT NULL,
  account_no VARCHAR(32) NOT NULL,
  ifsc_code VARCHAR(16) NOT NULL,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  beneficiary_type VARCHAR(24) NOT NULL CHECK (beneficiary_type IN ('FISHERMAN', 'AUCTIONEER', 'HMS', 'COOP')),
  utr_number VARCHAR(64),
  reconciled_at TIMESTAMPTZ,
  CONSTRAINT fk_item_batch FOREIGN KEY (tenant_id, batch_id) REFERENCES ledger.bank_payout_batches(tenant_id, batch_id)
);

-- Trigger 1: Strictly Block UPDATE or DELETE on ledger.ledger_entries
CREATE OR REPLACE FUNCTION ledger.fn_prevent_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE LEDGER VIOLATION: UPDATE and DELETE are strictly forbidden on ledger.ledger_entries. Append a Dual-Key AUTHORIZED_REVERSAL journal instead.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON ledger.ledger_entries;
CREATE TRIGGER trg_prevent_ledger_mutation
BEFORE UPDATE OR DELETE ON ledger.ledger_entries
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_ledger_mutation();

-- Trigger 2: Automatically Compute SHA-256 Row Hash and Advance ledger.ledger_heads
CREATE OR REPLACE FUNCTION ledger.fn_compute_ledger_sha256_chain() RETURNS TRIGGER AS $$
DECLARE
  v_head ledger.ledger_heads%ROWTYPE;
  v_payload TEXT;
BEGIN
  -- Lock tenant ledger head
  SELECT * INTO v_head
  FROM ledger.ledger_heads
  WHERE tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO ledger.ledger_heads (tenant_id, last_entry_seq, last_row_hash)
    VALUES (NEW.tenant_id, 0, repeat('0', 64))
    RETURNING * INTO v_head;
  END IF;

  NEW.entry_seq := v_head.last_entry_seq + 1;
  NEW.prev_row_hash := v_head.last_row_hash;

  v_payload := NEW.tenant_id::TEXT || '|' ||
               NEW.prev_row_hash || '|' ||
               NEW.journal_id::TEXT || '|' ||
               NEW.account_type || '|' ||
               NEW.direction || '|' ||
               NEW.amount_paise::TEXT || '|' ||
               to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  NEW.row_hash := encode(digest(v_payload, 'sha256'), 'hex');

  UPDATE ledger.ledger_heads
  SET last_entry_seq = NEW.entry_seq,
      last_row_hash = NEW.row_hash,
      updated_at = NOW()
  WHERE tenant_id = NEW.tenant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compute_ledger_sha256_chain ON ledger.ledger_entries;
CREATE TRIGGER trg_compute_ledger_sha256_chain
BEFORE INSERT ON ledger.ledger_entries
FOR EACH ROW EXECUTE FUNCTION ledger.fn_compute_ledger_sha256_chain();

-- Enable RLS
ALTER TABLE ledger.ledger_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.bank_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.bank_payout_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_heads ON ledger.ledger_heads USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_journals ON ledger.journals USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_entries ON ledger.ledger_entries USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_batches ON ledger.bank_payout_batches USING (tenant_id = core.current_tenant_id());
CREATE POLICY tenant_isolation_batch_items ON ledger.bank_payout_items USING (tenant_id = core.current_tenant_id());
