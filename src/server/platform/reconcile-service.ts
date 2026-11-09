import type { DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import {
  sanitizeBulkReconcilePayload,
  validateAndNormalizeBankUtr,
  type SanitizedBulkInvalidItem,
} from '@shared/domain/utr-validation.ts';

export interface ReconciledBatchSummary {
  batchId: string;
  batchCode: string;
  status: string;
  bankUtr: string;
}

export interface BulkReconcileResult {
  auditId: string;
  timestampIso: string;
  sourceLabel: string;
  reconciledCount: number;
  totalRowsParsed: number;
  invalidOrUnmatchedCount: number;
  duplicatesSkipped: number;
  idempotentReplay: boolean;
  reconciled: ReadonlyArray<ReconciledBatchSummary>;
  invalidItems: ReadonlyArray<SanitizedBulkInvalidItem>;
}

const MAX_IDEMPOTENCY_ENTRIES = 512;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

interface CachedReconcileEntry {
  expiresAtMs: number;
  result: BulkReconcileResult;
}

const idempotencyCache = new Map<string, CachedReconcileEntry>();

function pruneIdempotencyCache(nowMs: number): void {
  if (idempotencyCache.size < MAX_IDEMPOTENCY_ENTRIES) return;
  for (const [key, entry] of idempotencyCache.entries()) {
    if (entry.expiresAtMs <= nowMs) {
      idempotencyCache.delete(key);
    }
  }
  while (idempotencyCache.size >= MAX_IDEMPOTENCY_ENTRIES) {
    const oldestKey = idempotencyCache.keys().next().value;
    if (!oldestKey) break;
    idempotencyCache.delete(oldestKey);
  }
}

export async function reconcileSinglePayoutBatch(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
    batchId: string;
    rawBankUtr: unknown;
  }
): Promise<ReconciledBatchSummary> {
  const batchRef = params.batchId.trim();
  if (!batchRef) {
    throw new AppError('VALIDATION_ERROR', 'Payout batch ID is required', 400);
  }

  const utrCheck = validateAndNormalizeBankUtr(params.rawBankUtr);
  if (!utrCheck.valid) {
    throw new AppError('VALIDATION_ERROR', utrCheck.reason, 400);
  }

  const nowIso = new Date().toISOString();
  const updRes = await db.query<{
    batch_id: string;
    batch_code: string;
    status: string;
    bank_utr: string;
  }>(
    `UPDATE ledger.payout_batches
     SET status = 'RECONCILED_UTR', bank_utr = $1, reconciled_at = $2
     WHERE tenant_id = $3 AND (UPPER(batch_id) = UPPER($4) OR UPPER(batch_code) = UPPER($4))
     RETURNING batch_id, batch_code, status, bank_utr`,
    [utrCheck.normalizedUtr, nowIso, params.tenantId, batchRef]
  );

  const row = updRes.rows[0];
  if (!row) {
    throw new AppError(
      'NOT_FOUND',
      `Payout batch "${batchRef}" not found for tenant`,
      404
    );
  }

  await db.query(
    `INSERT INTO core.audit_logs (audit_id, tenant_id, actor_user_id, actor_role, action_code, target_type, target_id, details_json, created_at)
     VALUES ($1, $2, $3, $4, 'PAYOUT_BATCH_UTR_RECONCILED', 'PAYOUT_BATCH', $5, $6, $7)`,
    [
      `AUD-UTR-${Date.now()}`,
      params.tenantId,
      params.actorUserId,
      params.actorRole,
      row.batch_id,
      JSON.stringify({
        actorName: params.actorFullName,
        batchCode: row.batch_code,
        bankUtr: row.bank_utr,
      }),
      nowIso,
    ]
  );

  return {
    batchId: row.batch_id,
    batchCode: row.batch_code,
    status: row.status,
    bankUtr: row.bank_utr,
  };
}

export async function executeRobustBulkUtrReconcile(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
    rawBody: Record<string, unknown> | null | undefined;
    headerIdempotencyKey?: string | null;
  }
): Promise<BulkReconcileResult> {
  const sanitized = sanitizeBulkReconcilePayload(
    params.rawBody,
    params.headerIdempotencyKey
  );

  if (
    sanitized.validItems.length === 0 &&
    sanitized.rejectedItems.length === 0 &&
    sanitized.clientInvalidItems.length === 0
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      'At least one mapped payout batch UTR row is required',
      400
    );
  }

  const nowMs = Date.now();
  const cacheKey = sanitized.idempotencyKey
    ? `${params.tenantId}:${sanitized.idempotencyKey}`
    : null;

  if (cacheKey) {
    const cached = idempotencyCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) {
      return {
        ...cached.result,
        idempotentReplay: true,
      };
    }
  }

  const nowIso = new Date(nowMs).toISOString();
  const reconciled: ReconciledBatchSummary[] = [];
  const invalidItems: SanitizedBulkInvalidItem[] = [
    ...sanitized.clientInvalidItems,
    ...sanitized.rejectedItems,
  ];

  for (const item of sanitized.validItems) {
    const updRes = await db.query<{
      batch_id: string;
      batch_code: string;
      status: string;
      bank_utr: string;
    }>(
      `UPDATE ledger.payout_batches
       SET status = 'RECONCILED_UTR', bank_utr = $1, reconciled_at = $2
       WHERE tenant_id = $3 AND (UPPER(batch_id) = UPPER($4) OR UPPER(batch_code) = UPPER($4))
       RETURNING batch_id, batch_code, status, bank_utr`,
      [item.bankUtr, nowIso, params.tenantId, item.batchId]
    );

    const row = updRes.rows[0];
    if (row) {
      reconciled.push({
        batchId: row.batch_id,
        batchCode: row.batch_code,
        status: row.status,
        bankUtr: row.bank_utr,
      });
    } else {
      invalidItems.push({
        batchCode: item.batchId,
        batchId: null,
        bankUtr: item.bankUtr,
        status: 'UNMATCHED_BATCH',
        reason: `No payout batch matched "${item.batchId}" in tenant ledger`,
      });
    }
  }

  if (reconciled.length === 0) {
    const firstReason =
      invalidItems[0]?.reason ?? 'No matching payout batches were found to reconcile';
    throw new AppError('VALIDATION_ERROR', firstReason, 422);
  }

  const invalidOrUnmatchedCount = Math.max(
    invalidItems.length,
    Number(params.rawBody?.invalidOrUnmatchedCount ?? 0)
  );
  const totalRowsParsed = Math.max(
    reconciled.length + invalidOrUnmatchedCount,
    sanitized.totalRowsParsed
  );
  const auditId = `AUD-BULK-UTR-${nowMs}`;

  await db.query(
    `INSERT INTO core.audit_logs (audit_id, tenant_id, actor_user_id, actor_role, action_code, target_type, target_id, details_json, created_at)
     VALUES ($1, $2, $3, $4, 'PAYOUT_BATCH_BULK_UTR_RECONCILED', 'PAYOUT_BATCH', $5, $6, $7)`,
    [
      auditId,
      params.tenantId,
      params.actorUserId,
      params.actorRole,
      `BULK-${reconciled.length}-BATCHES`,
      JSON.stringify({
        actorName: params.actorFullName,
        sourceLabel: sanitized.sourceLabel,
        reconciledCount: reconciled.length,
        totalRowsParsed,
        invalidOrUnmatchedCount,
        duplicatesSkipped: sanitized.duplicatesSkipped,
        reconciled,
        invalidItems,
      }),
      nowIso,
    ]
  );

  const result: BulkReconcileResult = {
    auditId,
    timestampIso: nowIso,
    sourceLabel: sanitized.sourceLabel,
    reconciledCount: reconciled.length,
    totalRowsParsed,
    invalidOrUnmatchedCount,
    duplicatesSkipped: sanitized.duplicatesSkipped,
    idempotentReplay: false,
    reconciled,
    invalidItems,
  };

  if (cacheKey) {
    pruneIdempotencyCache(nowMs);
    idempotencyCache.set(cacheKey, {
      expiresAtMs: nowMs + IDEMPOTENCY_TTL_MS,
      result,
    });
  }

  return result;
}
