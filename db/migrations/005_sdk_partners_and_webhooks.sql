-- HarbourOS Migration 005: Partner SDK API Keys (SHA-256 Hashed) & Signed Webhook Outbox (§9 & §12 M10)

CREATE TABLE IF NOT EXISTS core.sdk_api_keys (
  key_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  partner_name text NOT NULL,
  key_prefix text NOT NULL,
  key_sha256_hash text NOT NULL UNIQUE,
  scopes text NOT NULL DEFAULT 'lots:read,allocations:read,webhooks:subscribe',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_by_user_id text NOT NULL,
  created_at text NOT NULL,
  revoked_at text
);

CREATE TABLE IF NOT EXISTS sync.webhook_deliveries (
  delivery_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  event_id text NOT NULL REFERENCES sync.outbox_events(event_id),
  target_url text NOT NULL,
  hmac_sha256_signature text NOT NULL,
  http_status integer NOT NULL DEFAULT 200,
  attempt_count integer NOT NULL DEFAULT 1,
  delivered_at text NOT NULL
);
