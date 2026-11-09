-- HarbourOS Migration 004: Leader Leases, Fencing Tokens & Lot Inventory Oversell Guard (§7 & §8)

CREATE TABLE IF NOT EXISTS auction.leader_leases (
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  session_id text NOT NULL REFERENCES auction.sessions(session_id),
  holder_device_id text NOT NULL,
  holder_user_id text NOT NULL,
  fencing_token integer NOT NULL CHECK (fencing_token >= 1),
  acquired_at text NOT NULL,
  expires_at text NOT NULL,
  PRIMARY KEY (tenant_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_lots_tenant_status ON auction.lots(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_allocations_tenant_lot ON auction.sale_allocations(tenant_id, lot_id, allocation_seq);
CREATE INDEX IF NOT EXISTS idx_entries_tenant_journal ON ledger.entries(tenant_id, journal_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON core.audit_logs(tenant_id, created_at DESC);

-- Trigger to block any allocation if fencing_token < current session fencing_token
CREATE OR REPLACE FUNCTION auction.enforce_fencing_token() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  v_session_token integer;
BEGIN
  SELECT fencing_token INTO v_session_token
  FROM auction.sessions
  WHERE session_id = NEW.session_id AND tenant_id = NEW.tenant_id;

  IF v_session_token IS NOT NULL AND NEW.fencing_token < v_session_token THEN
    RAISE EXCEPTION 'STALE_FENCING_TOKEN: allocation fencing_token (%) is older than session lease token (%)',
      NEW.fencing_token, v_session_token;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allocations_fencing ON auction.sale_allocations;
CREATE TRIGGER trg_allocations_fencing
  BEFORE INSERT ON auction.sale_allocations
  FOR EACH ROW EXECUTE FUNCTION auction.enforce_fencing_token();
