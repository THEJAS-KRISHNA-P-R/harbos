-- HarbourOS Migration 012: Horizontal Scale, DB Idempotency, Outbox Worker, Pilot Masterdata & Privacy (Round 5 v2)

-- 1. Phase 2.3: DB-backed Idempotency Keys (multi-instance safe)
CREATE TABLE IF NOT EXISTS core.idempotency_keys (
  tenant_id text NOT NULL,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('IN_PROGRESS', 'DONE')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (tenant_id, scope, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
  ON core.idempotency_keys (expires_at);

ALTER TABLE core.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.idempotency_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_idempotency_keys ON core.idempotency_keys;
CREATE POLICY tenant_isolation_idempotency_keys ON core.idempotency_keys
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- 2. Phase 2.5: Cross-instance Auth Rate Limits (UNLOGGED table)
CREATE UNLOGGED TABLE IF NOT EXISTS core.auth_rate_limits (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expires_at
  ON core.auth_rate_limits (expires_at);

-- 3. Phase 3.1: Outbox Worker Columns & Poll Index
ALTER TABLE sync.outbox_events ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE sync.outbox_events ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sync.outbox_events ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE sync.outbox_events ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE sync.outbox_events ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS idx_outbox_events_poll
  ON sync.outbox_events (status, next_attempt_at);

-- 4. Phase 3.3 & 3.5: User Preferred Locale, Consent & Erasure Columns
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS preferred_locale text NOT NULL DEFAULT 'en';
ALTER TABLE core.users DROP CONSTRAINT IF EXISTS users_preferred_locale_check;
ALTER TABLE core.users ADD CONSTRAINT users_preferred_locale_check CHECK (preferred_locale IN ('en', 'ml'));
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS consent_version text;
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE core.users ADD COLUMN IF NOT EXISTS erased_at timestamptz;

UPDATE core.users
   SET preferred_locale = 'ml'
 WHERE role IN ('FISHERMAN_BOAT_OWNER', 'WEIGHING_OPERATOR')
   AND preferred_locale = 'en';

-- 5. Phase 3.2: Masterdata Columns, Floor Price History & Erasure Requests
ALTER TABLE harbour.fishermen ADD COLUMN IF NOT EXISTS nfdp_id text;
ALTER TABLE harbour.fishermen ADD COLUMN IF NOT EXISTS bank_account_ref text;
ALTER TABLE harbour.fishermen ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE harbour.fishermen ADD COLUMN IF NOT EXISTS erased_at timestamptz;

ALTER TABLE harbour.vessels ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE harbour.coop_societies ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE harbour.buyers ALTER COLUMN gstin DROP NOT NULL;
ALTER TABLE harbour.buyers ADD COLUMN IF NOT EXISTS bank_guarantee_ref text;
ALTER TABLE harbour.buyers ADD COLUMN IF NOT EXISTS bank_guarantee_paise bigint NOT NULL DEFAULT 0;
ALTER TABLE harbour.buyers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE harbour.buyers ADD COLUMN IF NOT EXISTS erased_at timestamptz;

ALTER TABLE harbour.species ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE harbour.auctioneer_licences ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS harbour.floor_price_history (
  history_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  species_id text NOT NULL REFERENCES harbour.species(species_id),
  previous_floor_paise_per_kg bigint,
  new_floor_paise_per_kg bigint NOT NULL CHECK (new_floor_paise_per_kg > 0),
  changed_by_user_id text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE harbour.floor_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE harbour.floor_price_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_floor_price_history ON harbour.floor_price_history;
CREATE POLICY tenant_isolation_floor_price_history ON harbour.floor_price_history
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

CREATE TABLE IF NOT EXISTS core.erasure_requests (
  request_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  user_id text NOT NULL REFERENCES core.users(user_id),
  target_entity_type text NOT NULL DEFAULT 'USER',
  target_entity_id text NOT NULL,
  status text NOT NULL DEFAULT 'PSEUDONYMIZED_STATUTORY_RETENTION',
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE core.erasure_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.erasure_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_erasure_requests ON core.erasure_requests;
CREATE POLICY tenant_isolation_erasure_requests ON core.erasure_requests
  USING (core.tenant_access_allowed(tenant_id))
  WITH CHECK (core.tenant_access_allowed(tenant_id));

-- 6. Phase 2.2 & Phase 4.2: Keyset Pagination & Hot-Query Indexes
CREATE INDEX IF NOT EXISTS idx_lots_tenant_created_id
  ON auction.lots (tenant_id, created_at DESC, lot_id DESC);

CREATE INDEX IF NOT EXISTS idx_allocations_tenant_created_id
  ON auction.sale_allocations (tenant_id, created_at DESC, allocation_id DESC);

CREATE INDEX IF NOT EXISTS idx_journals_tenant_created_id
  ON ledger.journals (tenant_id, created_at DESC, journal_id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_id
  ON core.audit_logs (tenant_id, created_at DESC, audit_id DESC);

-- 7. Phase 2.11: Hot-Row Storage Tuning (fillfactor = 50 + aggressive autovacuum)
ALTER TABLE ledger.heads SET (fillfactor = 50, autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 50);
ALTER TABLE ledger.accounts SET (fillfactor = 50, autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 50);
ALTER TABLE auction.sessions SET (fillfactor = 50, autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 50);
ALTER TABLE harbour.buyers SET (fillfactor = 50, autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 50);

-- 8. Phase 2.8: Role-Level Timeouts for PgBouncer Transaction-Mode Compatibility
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harbour_app') THEN
    ALTER ROLE harbour_app SET statement_timeout = '5000ms';
    ALTER ROLE harbour_app SET lock_timeout = '3000ms';
    ALTER ROLE harbour_app SET idle_in_transaction_session_timeout = '10000ms';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harbour_platform') THEN
    ALTER ROLE harbour_platform SET statement_timeout = '5000ms';
    ALTER ROLE harbour_platform SET lock_timeout = '3000ms';
    ALTER ROLE harbour_platform SET idle_in_transaction_session_timeout = '10000ms';
  END IF;
EXCEPTION
  WHEN insufficient_privilege OR undefined_table THEN
    NULL;
END
$$;

GRANT USAGE ON SCHEMA core, harbour, auction, ledger, sync TO harbour_app, harbour_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, harbour, auction, ledger, sync TO harbour_app, harbour_platform;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger.entries, ledger.journals FROM harbour_app, harbour_platform, PUBLIC;
REVOKE ALL ON core.otp_challenges, core.refresh_tokens, core.schema_migrations, core.auth_rate_limits FROM harbour_app;
