import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '@server/config.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { withPlatform, type DbPort } from '@server/ports/db.ts';
import { logger } from '@server/platform/logger.ts';
import { verifyTenantLedgerChain } from '@server/modules/ledger/index.ts';
import {
  deleteExpiredRetentionRowsInTx,
  fetchAllTenantIdsInTx,
  upsertDailyAnchorInTx,
} from '@server/modules/platform/index.ts';

export async function runDailyLedgerAnchorJob(
  platformDb: DbPort,
  options?: { anchorDate?: string; sinkDir?: string }
): Promise<
  ReadonlyArray<{
    tenantId: string;
    anchorDate: string;
    lastEntrySeq: string;
    headHash: string;
    entryCount: number;
    hmacSha256: string;
  }>
> {
  const anchorDate =
    options?.anchorDate ?? new Date().toISOString().slice(0, 10);
  const sinkDir = path.resolve(
    process.cwd(),
    options?.sinkDir ?? config.ANCHOR_SINK_DIR
  );
  fs.mkdirSync(sinkDir, { recursive: true });
  const sinkFile = path.join(sinkDir, `ledger-anchors-${anchorDate}.jsonl`);

  return withPlatform(platformDb, async (tx) => {
    const tenants = await fetchAllTenantIdsInTx(tx);
    const anchors: Array<{
      tenantId: string;
      anchorDate: string;
      lastEntrySeq: string;
      headHash: string;
      entryCount: number;
      hmacSha256: string;
    }> = [];

    for (const t of tenants) {
      const verification = await verifyTenantLedgerChain(tx, t.tenant_id, {
        useLatestAnchor: false,
      });
      if (!verification.verified) {
        throw new Error(
          `LEDGER_CHAIN_TAMPERED: Tenant ${t.tenant_id} failed verification at seq ${verification.failedAtSeq}: ${verification.failureReason}`
        );
      }

      await upsertDailyAnchorInTx(tx, {
        tenantId: t.tenant_id,
        anchorDate,
        lastEntrySeq: verification.lastEntrySeq,
        headHash: verification.headHash,
      });

      const canonical = `${t.tenant_id}|${anchorDate}|${verification.lastEntrySeq}|${verification.headHash}|${verification.entryCount}`;
      const hmacSha256 = crypto
        .createHmac('sha256', config.QR_HMAC_SECRET)
        .update(canonical)
        .digest('hex');

      const record = {
        tenantId: t.tenant_id,
        anchorDate,
        lastEntrySeq: verification.lastEntrySeq,
        headHash: verification.headHash,
        entryCount: verification.entryCount,
        hmacSha256,
        anchoredAt: new Date().toISOString(),
      };
      anchors.push(record);
      fs.appendFileSync(sinkFile, `${JSON.stringify(record)}\n`, 'utf8');

      if (config.ANCHOR_WEBHOOK_URL) {
        await fetch(config.ANCHOR_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(record),
          signal: AbortSignal.timeout(5_000),
        });
      }
    }

    return anchors;
  });
}

export async function runVerifyAllTenantLedgersJob(
  platformDb: DbPort,
  targetTenantId?: string
): Promise<
  ReadonlyArray<{
    tenantId: string;
    verified: boolean;
    entryCount: number;
    lastEntrySeq: string;
    headHash: string;
    resumedFromAnchorSeq?: string;
    failedAtSeq?: string;
    failureReason?: string;
  }>
> {
  return withPlatform(platformDb, async (tx) => {
    const tenants = targetTenantId
      ? [{ tenant_id: targetTenantId }]
      : await fetchAllTenantIdsInTx(tx);

    const results = [];
    for (const t of tenants) {
      const ver = await verifyTenantLedgerChain(tx, t.tenant_id);
      results.push({
        tenantId: t.tenant_id,
        ...ver,
      });
    }
    return results;
  });
}

export async function runRetentionCleanupJob(platformDb: DbPort) {
  return withPlatform(platformDb, (tx) => deleteExpiredRetentionRowsInTx(tx));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const jobName = process.argv[2] ?? 'verify-ledger';
  const dbUrl = config.DATABASE_PLATFORM_URL || config.DATABASE_URL;
  const platformDb = dbUrl
    ? new PgPoolAdapter(dbUrl)
    : new PGliteAdapter('memory://');

  void (async () => {
    try {
      if (jobName === 'anchor-ledger') {
        const anchors = await runDailyLedgerAnchorJob(platformDb);
        logger.info('Completed daily ledger anchor job', {
          tenantCount: anchors.length,
          anchors,
        });
      } else if (jobName === 'verify-ledger') {
        const tenantArg = process.argv[3];
        const results = await runVerifyAllTenantLedgersJob(
          platformDb,
          tenantArg
        );
        const failed = results.filter((r) => !r.verified);
        logger.info('Completed ledger chain verification job', {
          tenantCount: results.length,
          failedCount: failed.length,
          results,
        });
        if (failed.length > 0) {
          process.exitCode = 1;
        }
      } else if (jobName === 'cleanup') {
        const stats = await runRetentionCleanupJob(platformDb);
        logger.info('Completed retention cleanup job', stats);
      } else {
        throw new Error(`Unknown job "${jobName}". Valid: anchor-ledger | verify-ledger | cleanup`);
      }
    } finally {
      if (platformDb.close) await platformDb.close();
    }
  })().catch((err: unknown) => {
    logger.error('Job execution failed', {
      jobName,
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
