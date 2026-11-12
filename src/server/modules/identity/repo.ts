import type { DbPort } from '@server/ports/db.ts';
import type { Role } from '@shared/contracts/rbac.ts';

export async function upsertAuthRateLimitBucketInTx(
  tx: DbPort,
  params: { bucketKey: string; windowStartIso: string; expiresAtIso: string }
): Promise<number> {
  const res = await tx.query<{ hit_count: number }>(
    `INSERT INTO core.auth_rate_limits (bucket_key, window_start, hit_count, expires_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (bucket_key) DO UPDATE
       SET hit_count = core.auth_rate_limits.hit_count + 1
     RETURNING hit_count`,
    [params.bucketKey, params.windowStartIso, params.expiresAtIso]
  );
  return Number(res.rows[0]?.hit_count ?? 1);
}

export async function fetchLatestOtpLockout(
  db: DbPort,
  phoneE164: string
): Promise<string | null> {
  const res = await db.query<{ locked_until: string | null }>(
    `SELECT locked_until::text AS locked_until
     FROM core.otp_challenges
     WHERE phone_e164 = $1 AND locked_until IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [phoneE164]
  );
  return res.rows[0]?.locked_until ?? null;
}

export async function consumePriorOtpChallengesAndInsertNew(
  db: DbPort,
  params: {
    challengeId: string;
    phoneE164: string;
    codeHash: string;
    saltHex: string;
    expiresAtIso: string;
    maxAttempts: number;
    nowIso: string;
  }
): Promise<void> {
  await db.query(
    `UPDATE core.otp_challenges SET consumed_at = $2 WHERE phone_e164 = $1 AND consumed_at IS NULL`,
    [params.phoneE164, params.nowIso]
  );
  await db.query(
    `INSERT INTO core.otp_challenges (
      challenge_id, phone_e164, code_hash, salt, expires_at,
      attempts, max_attempts, consumed_at, locked_until, created_at
    ) VALUES ($1, $2, $3, $4, $5, 0, $6, NULL, NULL, $7)`,
    [
      params.challengeId,
      params.phoneE164,
      params.codeHash,
      params.saltHex,
      params.expiresAtIso,
      params.maxAttempts,
      params.nowIso,
    ]
  );
}

export async function fetchLatestOtpChallengeRow(db: DbPort, phoneE164: string) {
  const res = await db.query<{
    challenge_id: string;
    code_hash: string;
    salt: string;
    expires_at: string;
    attempts: number;
    max_attempts: number;
    consumed_at: string | null;
    locked_until: string | null;
  }>(
    `SELECT challenge_id, code_hash, salt, expires_at::text AS expires_at,
            attempts, max_attempts, consumed_at::text AS consumed_at,
            locked_until::text AS locked_until
     FROM core.otp_challenges WHERE phone_e164 = $1 ORDER BY created_at DESC LIMIT 1`,
    [phoneE164]
  );
  return res.rows[0] ?? null;
}

export async function updateOtpChallengeAttemptOrLock(
  db: DbPort,
  params: { challengeId: string; attempts: number; lockedUntilIso?: string }
): Promise<void> {
  if (params.lockedUntilIso) {
    await db.query(
      `UPDATE core.otp_challenges SET attempts = $1, locked_until = $2 WHERE challenge_id = $3`,
      [params.attempts, params.lockedUntilIso, params.challengeId]
    );
    return;
  }
  await db.query(
    `UPDATE core.otp_challenges SET attempts = $1 WHERE challenge_id = $2`,
    [params.attempts, params.challengeId]
  );
}

export async function consumeOtpChallengeRow(
  db: DbPort,
  challengeId: string,
  nowIso: string
): Promise<boolean> {
  const res = await db.query<{ challenge_id: string }>(
    `UPDATE core.otp_challenges SET consumed_at = $1 WHERE challenge_id = $2 AND consumed_at IS NULL RETURNING challenge_id`,
    [nowIso, challengeId]
  );
  return res.rows.length > 0;
}

export async function insertRefreshTokenRowInTx(
  tx: DbPort,
  params: {
    tokenHash: string;
    userId: string;
    tenantId: string;
    familyId: string;
    expiresAtIso: string;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO core.refresh_tokens (
      token_hash, user_id, tenant_id, family_id, expires_at, rotated_at, revoked_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)`,
    [
      params.tokenHash,
      params.userId,
      params.tenantId,
      params.familyId,
      params.expiresAtIso,
      params.nowIso,
    ]
  );
}

export async function lockRefreshTokenByHashInTx(tx: DbPort, tokenHash: string) {
  const res = await tx.query<{
    token_hash: string;
    user_id: string;
    tenant_id: string;
    family_id: string;
    expires_at: string;
    rotated_at: string | null;
    revoked_at: string | null;
  }>(
    `SELECT token_hash, user_id, tenant_id, family_id,
            expires_at::text AS expires_at, rotated_at::text AS rotated_at, revoked_at::text AS revoked_at
     FROM core.refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
    [tokenHash]
  );
  return res.rows[0] ?? null;
}

export async function revokeRefreshTokenFamilyInTx(
  tx: DbPort,
  familyId: string,
  nowIso: string
): Promise<void> {
  await tx.query(
    `UPDATE core.refresh_tokens SET revoked_at = $1 WHERE family_id = $2 AND revoked_at IS NULL`,
    [nowIso, familyId]
  );
}

export async function markRefreshTokenRotatedInTx(
  tx: DbPort,
  tokenHash: string,
  nowIso: string
): Promise<void> {
  await tx.query(
    `UPDATE core.refresh_tokens SET rotated_at = $1 WHERE token_hash = $2`,
    [nowIso, tokenHash]
  );
}

export async function revokeRefreshTokenByHashInTx(
  tx: DbPort,
  tokenHash: string,
  nowIso: string
): Promise<void> {
  await tx.query(
    `UPDATE core.refresh_tokens SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL`,
    [nowIso, tokenHash]
  );
}

export async function revokeAllUserRefreshTokensInTx(
  tx: DbPort,
  userId: string,
  nowIso: string
): Promise<void> {
  await tx.query(
    `UPDATE core.refresh_tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`,
    [nowIso, userId]
  );
}

export async function fetchUserByIdInTx(tx: DbPort, userId: string) {
  const res = await tx.query<{
    user_id: string;
    tenant_id: string;
    phone_e164: string;
    full_name: string;
    role: Role;
    entity_ref_id: string | null;
    is_active: boolean;
  }>(
    `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id, is_active
     FROM core.users WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return res.rows[0] ?? null;
}

export async function fetchUserActiveStatusInTenantTx(
  tx: DbPort,
  tenantId: string,
  userId: string
) {
  const res = await tx.query<{
    user_id: string;
    tenant_id: string;
    role: Role;
    is_active: boolean;
  }>(
    `SELECT user_id, tenant_id, role, is_active FROM core.users WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
    [userId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function findActiveUserByPhoneInTx(tx: DbPort, phoneE164: string) {
  const res = await tx.query<{
    user_id: string;
    tenant_id: string;
    phone_e164: string;
    full_name: string;
    role: Role;
    entity_ref_id: string | null;
  }>(
    `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id
     FROM core.users WHERE phone_e164 = $1 AND is_active = true LIMIT 1`,
    [phoneE164]
  );
  return res.rows[0] ?? null;
}

export async function findActiveUserByRoleInTx(
  tx: DbPort,
  role: Role,
  preferredTenantId: string
) {
  const res = await tx.query<{
    user_id: string;
    tenant_id: string;
    phone_e164: string;
    full_name: string;
    role: Role;
    entity_ref_id: string | null;
  }>(
    `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id
     FROM core.users WHERE role = $1 AND is_active = true ORDER BY tenant_id = $2 DESC LIMIT 1`,
    [role, preferredTenantId]
  );
  return res.rows[0] ?? null;
}

export async function listDemoOperatorsInTx(tx: DbPort, tenantId: string) {
  const res = await tx.query<{
    user_id: string;
    tenant_id: string;
    phone_e164: string;
    full_name: string;
    role: Role;
  }>(
    `SELECT user_id, tenant_id, phone_e164, full_name, role
     FROM core.users WHERE tenant_id = $1 AND is_active = true ORDER BY user_id ASC`,
    [tenantId]
  );
  return res.rows;
}

export async function insertOtpOutboxEventInTx(
  tx: DbPort,
  params: {
    eventId: string;
    tenantId: string;
    recipient: string;
    payloadJson: string;
    status: string;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO sync.outbox_events (event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at)
     VALUES ($1, $2, 'SMS', $3, 'OTP_LOGIN', $4, $5, $6)`,
    [
      params.eventId,
      params.tenantId,
      params.recipient,
      params.payloadJson,
      params.status,
      params.nowIso,
    ]
  );
}

export async function fetchOperatorProfileAndAudit(
  db: DbPort,
  tenantId: string,
  userId: string
) {
  const [uRes, auditRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT u.user_id, u.tenant_id, COALESCE(t.name_en, 'Munambam HMS') AS tenant_name_en,
              COALESCE(t.name_ml, '') AS tenant_name_ml,
              u.phone_e164, u.full_name, u.role, u.entity_ref_id, u.is_active,
              u.preferred_locale, u.consent_version, u.consent_at,
              COALESCE(t.created_at::text, '2026-04-01T00:00:00Z') AS created_at
       FROM core.users u
       LEFT JOIN core.tenants t ON t.tenant_id = u.tenant_id
       WHERE u.user_id = $1 AND u.tenant_id = $2
       LIMIT 1`,
      [userId, tenantId]
    ),
    db.query<Record<string, unknown>>(
      `SELECT audit_id, action_code, target_type, target_id, details_json, created_at
       FROM core.audit_logs
       WHERE actor_user_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT 15`,
      [userId, tenantId]
    ),
  ]);
  return {
    profile: uRes.rows[0] ?? null,
    recentAudit: auditRes.rows,
  };
}

export async function updateOperatorProfileInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    userId: string;
    fullName: string;
    phoneE164: string;
  }
): Promise<void> {
  await tx.query(
    `UPDATE core.users SET full_name = $1, phone_e164 = $2 WHERE user_id = $3 AND tenant_id = $4`,
    [params.fullName, params.phoneE164, params.userId, params.tenantId]
  );
}

export async function updateOperatorLocaleInTx(
  tx: DbPort,
  params: { tenantId: string; userId: string; locale: 'ml' | 'en' }
): Promise<void> {
  await tx.query(
    `UPDATE core.users SET preferred_locale = $1 WHERE user_id = $2 AND tenant_id = $3`,
    [params.locale, params.userId, params.tenantId]
  );
}

export async function updateOperatorConsentInTx(
  tx: DbPort,
  params: { tenantId: string; userId: string; consentVersion: string; nowIso: string }
): Promise<void> {
  await tx.query(
    `UPDATE core.users SET consent_version = $1, consent_at = $2 WHERE user_id = $3 AND tenant_id = $4`,
    [params.consentVersion, params.nowIso, params.userId, params.tenantId]
  );
}

export async function exportCallerPrivacyData(
  db: DbPort,
  params: {
    tenantId: string;
    userId: string;
    entityRefId: string | null;
  }
) {
  const [userRes, fshRes, buyRes, auditRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id, is_active,
              preferred_locale, consent_version, consent_at, erased_at
       FROM core.users WHERE user_id = $1 AND tenant_id = $2`,
      [params.userId, params.tenantId]
    ),
    params.entityRefId
      ? db.query<Record<string, unknown>>(
          `SELECT * FROM harbour.fishermen WHERE fisherman_id = $1 AND tenant_id = $2`,
          [params.entityRefId, params.tenantId]
        )
      : Promise.resolve({ rows: [] }),
    params.entityRefId
      ? db.query<Record<string, unknown>>(
          `SELECT * FROM harbour.buyers WHERE buyer_id = $1 AND tenant_id = $2`,
          [params.entityRefId, params.tenantId]
        )
      : Promise.resolve({ rows: [] }),
    db.query<Record<string, unknown>>(
      `SELECT audit_id, action_code, target_type, target_id, details_json, created_at
       FROM core.audit_logs WHERE actor_user_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 100`,
      [params.userId, params.tenantId]
    ),
  ]);
  return {
    user: userRes.rows[0] ?? null,
    fishermanProfile: fshRes.rows[0] ?? null,
    buyerProfile: buyRes.rows[0] ?? null,
    personalAuditLogs: auditRes.rows,
  };
}

export async function executePersonalDataErasureInTx(
  tx: DbPort,
  params: {
    requestId: string;
    tenantId: string;
    userId: string;
    entityRefId: string | null;
    pseudonymPhone: string;
    pseudonymName: string;
    reason: string;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO core.erasure_requests (
      request_id, tenant_id, user_id, target_entity_type, target_entity_id,
      status, reason, requested_at, processed_at
    ) VALUES ($1, $2, $3, 'USER', $4, 'PSEUDONYMIZED_STATUTORY_RETENTION', $5, $6, $6)`,
    [
      params.requestId,
      params.tenantId,
      params.userId,
      params.entityRefId ?? params.userId,
      params.reason,
      params.nowIso,
    ]
  );

  await tx.query(
    `UPDATE core.users
     SET full_name = $1, phone_e164 = $2, erased_at = $3
     WHERE user_id = $4 AND tenant_id = $5`,
    [
      params.pseudonymName,
      params.pseudonymPhone,
      params.nowIso,
      params.userId,
      params.tenantId,
    ]
  );

  if (params.entityRefId) {
    await tx.query(
      `UPDATE harbour.fishermen
       SET full_name = $1, phone_e164 = $2, nfdp_id = NULL, bank_account_ref = NULL, erased_at = $3
       WHERE fisherman_id = $4 AND tenant_id = $5`,
      [
        `ERASED-${params.entityRefId}`,
        params.pseudonymPhone,
        params.nowIso,
        params.entityRefId,
        params.tenantId,
      ]
    );
    await tx.query(
      `UPDATE harbour.buyers
       SET buyer_name = $1, gstin = NULL, bank_guarantee_ref = NULL, erased_at = $2
       WHERE buyer_id = $3 AND tenant_id = $4`,
      [
        `ERASED-${params.entityRefId}`,
        params.nowIso,
        params.entityRefId,
        params.tenantId,
      ]
    );
  }
}
