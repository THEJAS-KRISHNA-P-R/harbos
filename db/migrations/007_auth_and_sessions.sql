-- HarbourOS Migration 007: DB-Backed OTP Challenges, Rotating Refresh Sessions & Unique Operator Phones (R1)

CREATE TABLE IF NOT EXISTS core.otp_challenges (
  challenge_id text PRIMARY KEY,
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  salt text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_until timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_challenges_phone_created
  ON core.otp_challenges (phone_e164, created_at DESC);

CREATE TABLE IF NOT EXISTS core.sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES core.users(user_id),
  tenant_id text NOT NULL REFERENCES core.tenants(tenant_id),
  refresh_token_hash text NOT NULL UNIQUE,
  family_id text NOT NULL,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON core.sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON core.sessions (family_id);

ALTER TABLE core.users ADD COLUMN IF NOT EXISTS supervisor_pin_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164_unique ON core.users (phone_e164);
