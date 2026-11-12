import type { DbPort } from '@server/ports/db.ts';

export async function fetchLatestSchemaMigration(
  platformDb: DbPort
): Promise<string> {
  const migRes = await platformDb.query<{ version: string }>(
    `SELECT version FROM core.schema_migrations ORDER BY version DESC LIMIT 1`
  );
  return migRes.rows[0]?.version ?? 'none';
}

export async function fetchAllSchemaMigrations(platformDb: DbPort) {
  const res = await platformDb.query<{
    version: string;
    checksum: string;
    applied_at: string;
  }>(
    `SELECT version, checksum, applied_at::text AS applied_at
     FROM core.schema_migrations
     ORDER BY version ASC`
  );
  return res.rows;
}

export async function fetchJournalBalanceAuditRows(db: DbPort) {
  const res = await db.query<{
    journal_id: string;
    reference_type: string;
    entry_count: string;
    sum_debit_paise: string;
    sum_credit_paise: string;
    is_balanced: boolean;
  }>(
    `SELECT journal_id, reference_type, entry_count::text, sum_debit_paise::text, sum_credit_paise::text, is_balanced
     FROM ledger.v_journal_balance_audit
     ORDER BY journal_id`
  );
  return res.rows;
}

export async function fetchTenantsForBenchmarks(
  db: DbPort,
  tenantId?: string
) {
  if (tenantId) {
    const res = await db.query<{
      tenant_id: string;
      name_en: string;
      centre_type: string;
    }>(
      `SELECT tenant_id, name_en, centre_type FROM core.tenants WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId]
    );
    return res.rows;
  }
  const res = await db.query<{
    tenant_id: string;
    name_en: string;
    centre_type: string;
  }>(
    `SELECT tenant_id, name_en, centre_type FROM core.tenants ORDER BY created_at ASC`
  );
  return res.rows;
}

export async function fetchAuditLogsKeysetPage(
  db: DbPort,
  params: {
    tenantId: string;
    limitPlusOne: number;
    cursor?: { ts: string; id: string } | null;
  }
) {
  if (params.cursor) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT a.audit_id, a.tenant_id, a.actor_user_id, COALESCE(u.full_name, a.actor_user_id) AS actor_name,
              a.actor_role, a.action_code, a.target_type, a.target_id, a.details_json, a.created_at
       FROM core.audit_logs a
       LEFT JOIN core.users u ON u.user_id = a.actor_user_id
       WHERE a.tenant_id = $1
         AND (a.created_at, a.audit_id) < ($2::timestamptz, $3)
       ORDER BY a.created_at DESC, a.audit_id DESC
       LIMIT $4`,
      [params.tenantId, params.cursor.ts, params.cursor.id, params.limitPlusOne]
    );
    return res.rows;
  }
  const res = await db.query<Record<string, unknown>>(
    `SELECT a.audit_id, a.tenant_id, a.actor_user_id, COALESCE(u.full_name, a.actor_user_id) AS actor_name,
            a.actor_role, a.action_code, a.target_type, a.target_id, a.details_json, a.created_at
     FROM core.audit_logs a
     LEFT JOIN core.users u ON u.user_id = a.actor_user_id
     WHERE a.tenant_id = $1
     ORDER BY a.created_at DESC, a.audit_id DESC
     LIMIT $2`,
    [params.tenantId, params.limitPlusOne]
  );
  return res.rows;
}

export async function claimIdempotencyKeyInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    scope: string;
    key: string;
    requestHash: string;
    expiresAtIso: string;
  }
): Promise<boolean> {
  const res = await tx.query<{ key: string }>(
    `INSERT INTO core.idempotency_keys (
       tenant_id, scope, key, request_hash, state, response_status, response_body, created_at, expires_at
     ) VALUES ($1, $2, $3, $4, 'IN_PROGRESS', NULL, NULL, now(), $5)
     ON CONFLICT (tenant_id, scope, key) DO NOTHING
     RETURNING key`,
    [
      params.tenantId,
      params.scope,
      params.key,
      params.requestHash,
      params.expiresAtIso,
    ]
  );
  return res.rows.length > 0;
}

export async function lockExistingIdempotencyKeyInTx<T>(
  tx: DbPort,
  params: {
    tenantId: string;
    scope: string;
    key: string;
  }
) {
  const res = await tx.query<{
    request_hash: string;
    state: 'IN_PROGRESS' | 'DONE';
    response_status: number | null;
    response_body: T | string | null;
    expires_at: string;
  }>(
    `SELECT request_hash, state, response_status, response_body, expires_at::text AS expires_at
     FROM core.idempotency_keys
     WHERE tenant_id = $1 AND scope = $2 AND key = $3
     FOR UPDATE`,
    [params.tenantId, params.scope, params.key]
  );
  return res.rows[0] ?? null;
}

export async function completeIdempotencyKeyInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    scope: string;
    key: string;
    status: number;
    responseBodyJson: string;
  }
): Promise<void> {
  await tx.query(
    `UPDATE core.idempotency_keys
     SET state = 'DONE',
         response_status = $1,
         response_body = $2::jsonb
     WHERE tenant_id = $3 AND scope = $4 AND key = $5`,
    [
      params.status,
      params.responseBodyJson,
      params.tenantId,
      params.scope,
      params.key,
    ]
  );
}

export async function fetchAllTenantIdsInTx(
  tx: DbPort
): Promise<ReadonlyArray<{ tenant_id: string }>> {
  const res = await tx.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM core.tenants ORDER BY tenant_id ASC`
  );
  return res.rows;
}

export async function upsertDailyAnchorInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    anchorDate: string;
    lastEntrySeq: string;
    headHash: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.daily_anchors (tenant_id, anchor_date, last_entry_seq, head_hash, created_at)
     VALUES ($1, $2::date, $3, $4, now())
     ON CONFLICT (tenant_id, anchor_date) DO UPDATE
       SET last_entry_seq = EXCLUDED.last_entry_seq,
           head_hash = EXCLUDED.head_hash,
           created_at = now()`,
    [
      params.tenantId,
      params.anchorDate,
      params.lastEntrySeq,
      params.headHash,
    ]
  );
}

export async function deleteExpiredRetentionRowsInTx(tx: DbPort) {
  const [idemRes, rlRes, otpRes, rtRes] = await Promise.all([
    tx.query(`DELETE FROM core.idempotency_keys WHERE expires_at < now() RETURNING 1`),
    tx.query(`DELETE FROM core.auth_rate_limits WHERE expires_at < now() RETURNING 1`),
    tx.query(
      `DELETE FROM core.otp_challenges WHERE expires_at < now() - interval '24 hours' RETURNING 1`
    ),
    tx.query(
      `DELETE FROM core.refresh_tokens WHERE expires_at < now() - interval '7 days' RETURNING 1`
    ),
  ]);
  return {
    deletedIdempotencyKeys: idemRes.rows.length,
    deletedRateLimitBuckets: rlRes.rows.length,
    deletedOtpChallenges: otpRes.rows.length,
    deletedRefreshTokens: rtRes.rows.length,
  };
}

