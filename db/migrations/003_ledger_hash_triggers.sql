-- HarbourOS Migration 003: Canonical SHA-256 SQL Hash Function & Double-Entry Balance Verification (§8)
-- Canonical payload: tenant_id|entry_seq|prev_row_hash|journal_id|account_id|direction|amount_paise|created_at_utc_iso_ms

CREATE OR REPLACE FUNCTION ledger.compute_canonical_payload(
  p_tenant_id text,
  p_entry_seq bigint,
  p_prev_row_hash text,
  p_journal_id text,
  p_account_id text,
  p_direction text,
  p_amount_paise bigint,
  p_created_at_utc_iso_ms text
) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT p_tenant_id || '|' ||
         p_entry_seq::text || '|' ||
         p_prev_row_hash || '|' ||
         p_journal_id || '|' ||
         p_account_id || '|' ||
         p_direction || '|' ||
         p_amount_paise::text || '|' ||
         p_created_at_utc_iso_ms
$$;

CREATE OR REPLACE FUNCTION ledger.compute_canonical_sha256(
  p_tenant_id text,
  p_entry_seq bigint,
  p_prev_row_hash text,
  p_journal_id text,
  p_account_id text,
  p_direction text,
  p_amount_paise bigint,
  p_created_at_utc_iso_ms text
) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT encode(
    sha256(
      convert_to(
        ledger.compute_canonical_payload(
          p_tenant_id,
          p_entry_seq,
          p_prev_row_hash,
          p_journal_id,
          p_account_id,
          p_direction,
          p_amount_paise,
          p_created_at_utc_iso_ms
        ),
        'UTF8'
      )
    ),
    'hex'
  )
$$;

-- Prevent TRUNCATE on append-only ledger tables
DROP TRIGGER IF EXISTS trg_journals_no_truncate ON ledger.journals;
CREATE TRIGGER trg_journals_no_truncate
  BEFORE TRUNCATE ON ledger.journals
  EXECUTE FUNCTION ledger.forbid_mutation();

DROP TRIGGER IF EXISTS trg_entries_no_truncate ON ledger.entries;
CREATE TRIGGER trg_entries_no_truncate
  BEFORE TRUNCATE ON ledger.entries
  EXECUTE FUNCTION ledger.forbid_mutation();

-- Helper view for real-time journal balance verification (SUM(D) == SUM(C) and entry_count >= 2)
CREATE OR REPLACE VIEW ledger.v_journal_balance_audit AS
SELECT
  j.tenant_id,
  j.journal_id,
  j.reference_type,
  j.reference_id,
  j.total_amount_paise,
  COUNT(e.entry_seq) AS entry_count,
  COALESCE(SUM(CASE WHEN e.direction = 'D' THEN e.amount_paise ELSE 0 END), 0)::bigint AS sum_debit_paise,
  COALESCE(SUM(CASE WHEN e.direction = 'C' THEN e.amount_paise ELSE 0 END), 0)::bigint AS sum_credit_paise,
  (
    COUNT(e.entry_seq) >= 2
    AND COALESCE(SUM(CASE WHEN e.direction = 'D' THEN e.amount_paise ELSE 0 END), 0) =
        COALESCE(SUM(CASE WHEN e.direction = 'C' THEN e.amount_paise ELSE 0 END), 0)
  ) AS is_balanced
FROM ledger.journals j
LEFT JOIN ledger.entries e
  ON e.tenant_id = j.tenant_id AND e.journal_id = j.journal_id
GROUP BY j.tenant_id, j.journal_id, j.reference_type, j.reference_id, j.total_amount_paise;
