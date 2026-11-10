-- HarbourOS Migration 009: DB-Enforced Double-Entry Balance Trigger, Daily Anchors & Payout Batch Items (R4)

-- Allow BANK_CLEARING account kind & BUYER_RECEIPT journal reference_type
ALTER TABLE ledger.accounts DROP CONSTRAINT IF EXISTS accounts_kind_check;
ALTER TABLE ledger.accounts ADD CONSTRAINT accounts_kind_check CHECK (kind IN (
  'FISHERMAN_PAYABLE',
  'FISHERMAN_BONUS_ESCROW',
  'BUYER_RECEIVABLE',
  'AUCTIONEER_PAYABLE',
  'HMS_FUND',
  'COOP_SOCIETY_FUND',
  'HARBOUROS_REVENUE',
  'GST_PAYABLE',
  'BANK_CLEARING'
));

ALTER TABLE ledger.journals DROP CONSTRAINT IF EXISTS journals_reference_type_check;
ALTER TABLE ledger.journals ADD CONSTRAINT journals_reference_type_check CHECK (reference_type IN (
  'SALE_ALLOCATION',
  'REVERSAL',
  'PAYOUT_BATCH',
  'BONUS_RELEASE',
  'BUYER_RECEIPT'
));

-- Section 21 Inspection Gate: allow NULL inspection_grade while status = WEIGHED_PENDING_INSPECTION
ALTER TABLE auction.lots ALTER COLUMN inspection_grade DROP NOT NULL;

CREATE TABLE IF NOT EXISTS ledger.payout_batch_items (
  item_id text PRIMARY KEY,
  batch_id text NOT NULL REFERENCES ledger.payout_batches(batch_id),
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  fisherman_id text NOT NULL REFERENCES harbour.fishermen(fisherman_id),
  account_id text NOT NULL REFERENCES ledger.accounts(account_id),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger.daily_anchors (
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  anchor_date text NOT NULL,
  last_entry_seq bigint NOT NULL,
  head_hash text NOT NULL,
  anchored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, anchor_date)
);

CREATE TABLE IF NOT EXISTS ledger.verifications (
  verification_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  verified boolean NOT NULL,
  entry_count integer NOT NULL,
  last_entry_seq bigint NOT NULL,
  head_hash text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now()
);

-- Deferred constraint trigger enforcing SUM(D) == SUM(C) and entry_count >= 2 at transaction COMMIT (F19)
CREATE OR REPLACE FUNCTION ledger.enforce_journal_balance_at_commit() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_count bigint;
  v_sum_d bigint;
  v_sum_c bigint;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN direction = 'D' THEN amount_paise ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'C' THEN amount_paise ELSE 0 END), 0)
  INTO v_count, v_sum_d, v_sum_c
  FROM ledger.entries
  WHERE tenant_id = NEW.tenant_id AND journal_id = NEW.journal_id;

  IF v_count < 2 OR v_sum_d <> v_sum_c THEN
    RAISE EXCEPTION 'UNBALANCED_JOURNAL_VIOLATION: journal % has count=%, sum_debit=%, sum_credit=%',
      NEW.journal_id, v_count, v_sum_d, v_sum_c;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_journal_balance ON ledger.entries;
CREATE CONSTRAINT TRIGGER trg_enforce_journal_balance
  AFTER INSERT ON ledger.entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION ledger.enforce_journal_balance_at_commit();
