import type { DbPort } from '@server/ports/db.ts';

export interface OutboxPollRow {
  event_id: string;
  tenant_id: string;
  channel: string;
  recipient: string;
  template_code: string;
  payload_json: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  created_at: string;
}

export async function claimPendingOutboxEventsInTx(
  tx: DbPort,
  batchLimit: number
): Promise<ReadonlyArray<OutboxPollRow>> {
  const res = await tx.query<OutboxPollRow>(
    `SELECT event_id, tenant_id, channel, recipient, template_code, payload_json,
            status, attempts, next_attempt_at::text AS next_attempt_at,
            last_error, sent_at::text AS sent_at, provider_message_id, created_at::text AS created_at
     FROM sync.outbox_events
     WHERE status = 'PENDING' AND next_attempt_at <= now()
     ORDER BY created_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [batchLimit]
  );
  return res.rows;
}

export async function resolveRecipientPhoneAndLocaleInTx(
  tx: DbPort,
  tenantId: string,
  recipient: string
): Promise<{ phoneE164: string; locale: 'ml' | 'en' }> {
  if (recipient.startsWith('+')) {
    const uRes = await tx.query<{ preferred_locale: 'ml' | 'en' | null }>(
      `SELECT preferred_locale FROM core.users WHERE phone_e164 = $1 AND tenant_id = $2 LIMIT 1`,
      [recipient, tenantId]
    );
    return {
      phoneE164: recipient,
      locale: uRes.rows[0]?.preferred_locale ?? 'ml',
    };
  }

  // Recipient may be a fisherman_id or user_id
  const fRes = await tx.query<{ phone_e164: string }>(
    `SELECT phone_e164 FROM harbour.fishermen WHERE fisherman_id = $1 AND tenant_id = $2 LIMIT 1`,
    [recipient, tenantId]
  );
  const phoneE164 = fRes.rows[0]?.phone_e164 ?? '+919400000000';
  const uRes = await tx.query<{ preferred_locale: 'ml' | 'en' | null }>(
    `SELECT preferred_locale FROM core.users WHERE entity_ref_id = $1 AND tenant_id = $2 LIMIT 1`,
    [recipient, tenantId]
  );
  return {
    phoneE164,
    locale: uRes.rows[0]?.preferred_locale ?? 'ml',
  };
}

export async function countRecentDispatchedSmsInTx(
  tx: DbPort,
  phoneE164: string,
  recipientId: string
): Promise<{
  phonePastHour: number;
  phonePastDay: number;
  globalPastDay: number;
}> {
  const [hourRes, dayRes, globalRes] = await Promise.all([
    tx.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM sync.outbox_events
       WHERE (recipient = $1 OR recipient = $2)
         AND status IN ('DISPATCHED', 'DISPATCHED_CONSOLE')
         AND COALESCE(sent_at, created_at::timestamptz) >= now() - interval '1 hour'`,
      [phoneE164, recipientId]
    ),
    tx.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM sync.outbox_events
       WHERE (recipient = $1 OR recipient = $2)
         AND status IN ('DISPATCHED', 'DISPATCHED_CONSOLE')
         AND COALESCE(sent_at, created_at::timestamptz) >= now() - interval '24 hours'`,
      [phoneE164, recipientId]
    ),
    tx.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM sync.outbox_events
       WHERE status IN ('DISPATCHED', 'DISPATCHED_CONSOLE')
         AND COALESCE(sent_at, created_at::timestamptz) >= now() - interval '24 hours'`
    ),
  ]);

  return {
    phonePastHour: hourRes.rows[0]?.cnt ?? 0,
    phonePastDay: dayRes.rows[0]?.cnt ?? 0,
    globalPastDay: globalRes.rows[0]?.cnt ?? 0,
  };
}

export async function markOutboxEventDispatchedInTx(
  tx: DbPort,
  params: {
    eventId: string;
    providerMessageId: string;
    sentAtIso: string;
  }
): Promise<void> {
  await tx.query(
    `UPDATE sync.outbox_events
     SET status = 'DISPATCHED',
         sent_at = $1,
         provider_message_id = $2,
         last_error = NULL
     WHERE event_id = $3`,
    [params.sentAtIso, params.providerMessageId, params.eventId]
  );
}

export async function markOutboxEventRetryOrDeadLetterInTx(
  tx: DbPort,
  params: {
    eventId: string;
    attempts: number;
    nextAttemptAtIso: string;
    lastError: string;
    deadLetter: boolean;
  }
): Promise<void> {
  await tx.query(
    `UPDATE sync.outbox_events
     SET status = $1,
         attempts = $2,
         next_attempt_at = $3,
         last_error = $4
     WHERE event_id = $5`,
    [
      params.deadLetter ? 'DEAD_LETTER' : 'PENDING',
      params.attempts,
      params.nextAttemptAtIso,
      params.lastError,
      params.eventId,
    ]
  );
}

export async function listTenantOutboxEvents(
  db: DbPort,
  tenantId: string,
  limit: number
) {
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM sync.outbox_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit]
  );
  return res.rows;
}
