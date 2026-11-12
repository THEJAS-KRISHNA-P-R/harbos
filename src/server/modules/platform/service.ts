import { withPlatform, type DbPort } from '@server/ports/db.ts';
import {
  buildKeysetPage,
  decodeKeysetCursor,
  normalizeKeysetLimit,
  type KeysetPage,
} from '@server/platform/pagination.ts';
import {
  HARBOUROS_SDK_VERSION,
  computeCrossHarbourBenchmarks,
  generateExternalSdkStarterCode,
} from '@shared/sdk/harbouros-sdk.ts';
import {
  fetchAllSchemaMigrations,
  fetchAuditLogsKeysetPage,
  fetchJournalBalanceAuditRows,
  fetchLatestSchemaMigration,
  fetchTenantsForBenchmarks,
} from './repo.ts';

export async function getReadinessStatus(platformDb: DbPort) {
  const migrationVersion = await fetchLatestSchemaMigration(platformDb);
  return {
    status: 'ok' as const,
    service: 'harbouros-api',
    database: {
      status: 'ready' as const,
      migrationVersion,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function getGovernanceMigrations(
  platformDb: DbPort,
  tenantDb: DbPort,
  isSuperAdmin: boolean
) {
  const migrations = await fetchAllSchemaMigrations(platformDb);
  const journalBalanceAudit = isSuperAdmin
    ? await withPlatform(platformDb, (tx) => fetchJournalBalanceAuditRows(tx))
    : await tenantDb.transaction((tx) => fetchJournalBalanceAuditRows(tx));
  return {
    migrations,
    journalBalanceAudit,
  };
}

export async function getHarbourBenchmarks(
  platformDb: DbPort,
  tenantDb: DbPort,
  tenantId: string,
  isSuperAdmin: boolean
) {
  const tenantsRows = isSuperAdmin
    ? await withPlatform(platformDb, (tx) => fetchTenantsForBenchmarks(tx))
    : await fetchTenantsForBenchmarks(tenantDb, tenantId);
  const benchmarks = computeCrossHarbourBenchmarks(tenantsRows);
  return {
    sdkVersion: HARBOUROS_SDK_VERSION,
    sdkStarterCode: generateExternalSdkStarterCode(),
    harbourCount: benchmarks.length,
    benchmarks,
  };
}

export async function listAuditLogsKeyset(
  db: DbPort,
  params: {
    tenantId: string;
    cursor?: string | undefined;
    limit?: number | undefined;
  }
): Promise<KeysetPage<Record<string, unknown>>> {
  const limit = normalizeKeysetLimit(params.limit, 50, 200);
  const cursor = params.cursor ? decodeKeysetCursor(params.cursor) : null;
  const rows = await fetchAuditLogsKeysetPage(db, {
    tenantId: params.tenantId,
    limitPlusOne: limit + 1,
    cursor,
  });
  return buildKeysetPage(
    rows,
    limit,
    (r) => String(r.created_at),
    (r) => String(r.audit_id)
  );
}
