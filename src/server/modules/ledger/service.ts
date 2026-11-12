import crypto from 'node:crypto';
import { auditInTx, type DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import {
  buildKeysetPage,
  decodeKeysetCursor,
  normalizeKeysetLimit,
  type KeysetPage,
} from '@server/platform/pagination.ts';
import {
  fetchJournalsKeysetPage,
  fetchPayoutBatchesAndAuditLogs,
  insertReversalRequestInTx,
} from './repo.ts';
import { executeDualKeyReversal } from './posting.ts';

export interface LruCacheStats {
  size: number;
  maxEntries: number;
  ttlMs: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRatioPct: number;
}

export class SimpleLruCache<K, V> {
  private readonly store = new Map<
    K,
    { value: V; expiresAt: number; cachedAtIso: string }
  >();
  public readonly maxEntries: number;
  public readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = Math.max(1, options?.maxEntries ?? 64);
    this.ttlMs = Math.max(100, options?.ttlMs ?? 30_000);
  }

  public get(key: K): { value: V; cachedAtIso: string } | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return { value: entry.value, cachedAtIso: entry.cachedAtIso };
  }

  public set(key: K, value: V): string {
    const nowMs = Date.now();
    const cachedAtIso = new Date(nowMs).toISOString();
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.evictions += 1;
      }
    }
    this.store.set(key, {
      value,
      expiresAt: nowMs + this.ttlMs,
      cachedAtIso,
    });
    return cachedAtIso;
  }

  public invalidate(key: K): boolean {
    return this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public stats(): LruCacheStats {
    const total = this.hits + this.misses;
    const hitRatioPct =
      total > 0 ? Math.round((this.hits / total) * 1000) / 10 : 0;
    return {
      size: this.store.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRatioPct,
    };
  }
}

export interface CachedLedgerAuditPayload {
  auditLogs: ReadonlyArray<Record<string, unknown>>;
  payoutBatches: ReadonlyArray<Record<string, unknown>>;
}

export const ledgerAuditSqlLruCache = new SimpleLruCache<
  string,
  CachedLedgerAuditPayload
>({
  maxEntries: 64,
  ttlMs: 30_000,
});

export function invalidateLedgerAuditSqlLruCache(tenantId?: string): void {
  if (tenantId) {
    ledgerAuditSqlLruCache.invalidate(`${tenantId}:ALL`);
  } else {
    ledgerAuditSqlLruCache.clear();
  }
}

export async function queryAllImportAuditLogsWithLruCache(
  db: DbPort,
  tenantId: string,
  viewFilter = 'ALL'
): Promise<{
  view: string;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  cachedAtIso: string;
  stats: LruCacheStats;
  auditLogs: ReadonlyArray<Record<string, unknown>>;
  payoutBatches: ReadonlyArray<Record<string, unknown>>;
}> {
  const normalizedView = viewFilter.trim().toUpperCase() || 'ALL';
  const cacheKey = `${tenantId}:ALL`;

  if (normalizedView === 'ALL') {
    const hit = ledgerAuditSqlLruCache.get(cacheKey);
    if (hit) {
      return {
        view: normalizedView,
        cacheStatus: 'HIT',
        cachedAtIso: hit.cachedAtIso,
        stats: ledgerAuditSqlLruCache.stats(),
        auditLogs: hit.value.auditLogs,
        payoutBatches: hit.value.payoutBatches,
      };
    }
  }

  const { payoutBatches, auditLogs } = await fetchPayoutBatchesAndAuditLogs(
    db,
    tenantId
  );

  let cachedAtIso = new Date().toISOString();
  let cacheStatus: 'HIT' | 'MISS' | 'BYPASS' = 'BYPASS';
  if (normalizedView === 'ALL') {
    cachedAtIso = ledgerAuditSqlLruCache.set(cacheKey, {
      auditLogs,
      payoutBatches,
    });
    cacheStatus = 'MISS';
  }

  return {
    view: normalizedView,
    cacheStatus,
    cachedAtIso,
    stats: ledgerAuditSqlLruCache.stats(),
    auditLogs,
    payoutBatches,
  };
}

export async function listLedgerJournalsKeyset(
  db: DbPort,
  params: {
    tenantId: string;
    cursor?: string | undefined;
    limit?: number | undefined;
  }
): Promise<KeysetPage<Record<string, unknown>>> {
  const limit = normalizeKeysetLimit(params.limit, 50, 200);
  const cursor = params.cursor ? decodeKeysetCursor(params.cursor) : null;
  const rows = await fetchJournalsKeysetPage(db, {
    tenantId: params.tenantId,
    limitPlusOne: limit + 1,
    cursor,
  });
  return buildKeysetPage(
    rows,
    limit,
    (r) => String(r.created_at),
    (r) => String(r.journal_id)
  );
}

export async function handleLedgerReversalAction(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
    action: 'REQUEST' | 'APPROVE';
    originalJournalId?: string | undefined;
    reasonNote?: string | undefined;
    reversalId?: string | undefined;
  }
): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  if (params.action === 'REQUEST') {
    const originalJournalId = String(params.originalJournalId ?? '').trim();
    const reasonNote = String(params.reasonNote ?? '').trim();
    if (!originalJournalId || reasonNote.length < 5) {
      throw new AppError(
        'VALIDATION_ERROR',
        'originalJournalId and reasonNote (>= 5 chars) required',
        400
      );
    }
    const reversalId = `REV-REQ-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    await db.transaction(async (tx) => {
      await insertReversalRequestInTx(tx, {
        reversalId,
        tenantId: params.tenantId,
        originalJournalId,
        reasonNote,
        requestedByUserId: params.actorUserId,
        requestedByName: params.actorFullName,
        nowIso,
      });
      await auditInTx(tx, {
        tenantId: params.tenantId,
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        actionCode: 'REVERSAL_REQUESTED_KEY1',
        targetType: 'REVERSAL',
        targetId: reversalId,
        details: {
          actorName: params.actorFullName,
          originalJournalId,
          reasonNote,
        },
      });
    });
    return {
      status: 201,
      body: { reversalId, status: 'PENDING_SECOND_APPROVAL' },
    };
  }

  const reversalId = String(params.reversalId ?? '');
  const nowIso = new Date().toISOString();
  const result = await executeDualKeyReversal(db, {
    tenantId: params.tenantId,
    reversalId,
    approverUserId: params.actorUserId,
    approverName: params.actorFullName,
    nowIso,
  });

  await db.transaction((tx) =>
    auditInTx(tx, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionCode: 'DUAL_KEY_REVERSAL_EXECUTED',
      targetType: 'REVERSAL',
      targetId: reversalId,
      details: {
        actorName: params.actorFullName,
        compensatingJournalId: result.compensatingJournalId,
      },
    })
  );

  return {
    status: 200,
    body: result,
  };
}
