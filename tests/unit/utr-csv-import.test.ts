import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAndMapBankUtrCsv,
  generateSampleBankUtrCsv,
  generateInvalidSampleBankUtrCsv,
  detectUtrStatusTransitions,
  formatLedgerInspectorCsv,
  buildUtrImportHistory,
  filterUtrImportHistory,
  countUtrImportHistoryByFilter,
  validateAndNormalizeBankUtr,
  sanitizeBulkReconcilePayload,
  filterAuditLogsByActionOrTarget,
  buildCommandPaletteItems,
  formatCentralizedLogsCsv,
  formatObservabilityBundleJson,
  resolveGlobalKeyboardShortcut,
  signBankNodalWebhookPayload,
  verifyBankNodalWebhookSignature,
  generateDeterministicIdempotencyKey,
  computeSdkBackoffMs,
  buildStatutorySettlementVoucher,
  computeCrossHarbourBenchmarks,
  type AuditLogRow,
  type EntryRow,
  type JournalRow,
  type PayoutBatchRow,
} from '../../src/web/lib/api.ts';
import { executeWithStatementTimeout } from '../../src/server/adapters/db-pg.ts';
import {
  formatPrometheusMetrics,
  getObservabilitySnapshot,
  recordQueryExecution,
  recordRateLimitEvent,
} from '../../src/server/platform/observability.ts';
import {
  SimpleLruCache,
  queryAllImportAuditLogsWithLruCache,
  invalidateLedgerAuditSqlLruCache,
  resolveClientIp,
} from '../../src/server/app.ts';
import type { Request } from 'express';
import type { DbPort } from '../../src/server/ports/db.ts';

const MOCK_BATCHES: ReadonlyArray<PayoutBatchRow> = [
  {
    batch_id: 'BATCH-20261106-01',
    batch_code: 'MUN-PAY-20261106-01',
    beneficiary_kind: 'FISHERMAN_NET_SETTLEMENT',
    total_amount_paise: '16473000',
    item_count: 3,
    status: 'RECONCILED_UTR',
    bank_utr: 'HDFC000261106991',
    reconciled_at: '2026-11-06T08:30:00.000Z',
    created_at: '2026-11-06T08:00:00.000Z',
  },
  {
    batch_id: 'BATCH-20261106-02',
    batch_code: 'MUN-PAY-20261106-02',
    beneficiary_kind: 'FISHERMAN_PAYABLE',
    total_amount_paise: '9500000',
    item_count: 2,
    status: 'GENERATED_CSV',
    bank_utr: null,
    reconciled_at: null,
    created_at: '2026-11-06T09:15:00.000Z',
  },
];

const MOCK_JOURNALS: ReadonlyArray<JournalRow> = [
  {
    journal_id: 'JRN-ALLOC-0001',
    reference_type: 'LOT_ALLOCATION',
    reference_id: 'ALLOC-0001',
    description: 'Hammer settlement for Lot #MUN-LOT-01',
    reverses_journal_id: null,
    authorized_by_user_1: 'USR-AUCT-01',
    authorized_by_user_2: null,
    reason_note: null,
    total_amount_paise: '10000000',
    created_at: '2026-11-06T07:00:00.000Z',
  },
];

const MOCK_ENTRIES: ReadonlyArray<EntryRow> = [
  {
    entry_seq: '101',
    journal_id: 'JRN-ALLOC-0001',
    account_id: 'ACC-BUYER-ESCROW-01',
    direction: 'D',
    amount_paise: '10000000',
    prev_row_hash: '0000000000000000',
    row_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    created_at_utc_iso_ms: '2026-11-06T07:00:00.123Z',
  },
  {
    entry_seq: '102',
    journal_id: 'JRN-ALLOC-0001',
    account_id: 'ACC-FISHER-PAYABLE-01',
    direction: 'C',
    amount_paise: '9500000',
    prev_row_hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    row_hash: 'f0e1d2c3b4a5968778695a4b3c2d1e0f',
    created_at_utc_iso_ms: '2026-11-06T07:00:00.124Z',
  },
];

test('parseAndMapBankUtrCsv maps both batch_code and batch_id with header detection', () => {
  const csv = [
    'batch_code,bank_utr',
    'MUN-PAY-20261106-02,FDRL261107008812',
    'BATCH-20261106-01,"SBIN000261107999"',
  ].join('\n');

  const res = parseAndMapBankUtrCsv(csv, MOCK_BATCHES);
  assert.equal(res.readyCount, 2);
  assert.equal(res.unmatchedCount, 0);
  assert.equal(res.invalidUtrCount, 0);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0]?.matchedBatch?.batch_id, 'BATCH-20261106-02');
  assert.equal(res.rows[0]?.bankUtr, 'FDRL261107008812');
  assert.equal(res.rows[0]?.status, 'READY_TO_RECONCILE');
  assert.equal(res.rows[1]?.matchedBatch?.batch_id, 'BATCH-20261106-01');
  assert.equal(res.rows[1]?.bankUtr, 'SBIN000261107999');
});

test('parseAndMapBankUtrCsv flags unmatched batches and short UTRs accurately', () => {
  const csv = [
    'Batch Reference,Bank UTR Reference',
    'MUN-PAY-99999999-99,FDRL261107111111',
    'MUN-PAY-20261106-02,123',
  ].join('\n');

  const res = parseAndMapBankUtrCsv(csv, MOCK_BATCHES);
  assert.equal(res.readyCount, 0);
  assert.equal(res.unmatchedCount, 1);
  assert.equal(res.invalidUtrCount, 1);
  assert.equal(res.rows[0]?.status, 'UNMATCHED_BATCH');
  assert.equal(res.rows[1]?.status, 'INVALID_UTR');
});

test('detectUtrStatusTransitions detects INVALID_UTR to READY_TO_RECONCILE transitions', () => {
  const invalidCsv = generateInvalidSampleBankUtrCsv(MOCK_BATCHES);
  const prevParsed = parseAndMapBankUtrCsv(invalidCsv, MOCK_BATCHES);
  assert.equal(prevParsed.invalidUtrCount, 2);

  const validCsv = generateSampleBankUtrCsv(MOCK_BATCHES);
  const nextParsed = parseAndMapBankUtrCsv(validCsv, MOCK_BATCHES);
  assert.equal(nextParsed.readyCount, 2);

  const transitions = detectUtrStatusTransitions(prevParsed.rows, nextParsed.rows);
  assert.equal(transitions['BATCH-20261106-01']?.from, 'INVALID_UTR');
  assert.equal(transitions['BATCH-20261106-01']?.to, 'READY_TO_RECONCILE');
  assert.equal(transitions['BATCH-20261106-02']?.from, 'INVALID_UTR');
  assert.equal(transitions['BATCH-20261106-02']?.to, 'READY_TO_RECONCILE');
});

test('formatLedgerInspectorCsv exports ledger entries, payout batches, and reconciliation status', () => {
  const entriesCsv = formatLedgerInspectorCsv({
    scope: 'LEDGER_ENTRIES',
    entries: MOCK_ENTRIES,
    journals: MOCK_JOURNALS,
    payoutBatches: MOCK_BATCHES,
    dateStamp: '2026-11-08',
  });
  assert.equal(entriesCsv.filename, 'HarbourOS-Ledger-Entries-2026-11-08.csv');
  assert.equal(entriesCsv.rowCount, 2);
  assert.ok(entriesCsv.content.includes('entry_seq,journal_id,reference_type'));
  assert.ok(entriesCsv.content.includes('ACC-BUYER-ESCROW-01,DEBIT,10000000'));
  assert.ok(entriesCsv.content.includes('ACC-FISHER-PAYABLE-01,CREDIT,9500000'));

  const batchesCsv = formatLedgerInspectorCsv({
    scope: 'PAYOUT_BATCHES',
    entries: MOCK_ENTRIES,
    journals: MOCK_JOURNALS,
    payoutBatches: MOCK_BATCHES,
    dateStamp: '2026-11-08',
  });
  assert.equal(batchesCsv.filename, 'HarbourOS-Payout-Batches-2026-11-08.csv');
  assert.equal(batchesCsv.rowCount, 2);
  assert.ok(batchesCsv.content.includes('MUN-PAY-20261106-01,BATCH-20261106-01'));
  assert.ok(batchesCsv.content.includes('HDFC000261106991'));

  const parsedUtr = parseAndMapBankUtrCsv(generateSampleBankUtrCsv(MOCK_BATCHES), MOCK_BATCHES);
  const reconCsv = formatLedgerInspectorCsv({
    scope: 'RECONCILIATION_STATUS',
    entries: MOCK_ENTRIES,
    journals: MOCK_JOURNALS,
    payoutBatches: MOCK_BATCHES,
    mappedUtrRows: parsedUtr.rows,
    dateStamp: '2026-11-08',
  });
  assert.equal(reconCsv.filename, 'HarbourOS-UTR-Reconciliation-Status-2026-11-08.csv');
  assert.equal(reconCsv.rowCount, 2);
  assert.ok(reconCsv.content.includes('reconciliation_status,transition_from,validation_reason'));
  assert.ok(reconCsv.content.includes('READY_TO_RECONCILE'));
});

test('buildUtrImportHistory aggregates audit logs, reconciled batches, and session imports with filtering', () => {
  const mockAudits: ReadonlyArray<AuditLogRow> = [
    {
      audit_id: 'AUD-BULK-UTR-100',
      tenant_id: 'munambam-demo',
      actor_user_id: 'USR-ACCT-01',
      actor_name: 'Deepa Krishnan',
      actor_role: 'ACCOUNTANT',
      action_code: 'PAYOUT_BATCH_BULK_UTR_RECONCILED',
      target_type: 'PAYOUT_BATCH',
      target_id: 'BULK-2-BATCHES',
      details_json: JSON.stringify({
        actorName: 'Deepa Krishnan (HMS Chief Accountant)',
        sourceLabel: 'FederalBank-Nodal-Evening-261105.csv',
        reconciledCount: 2,
        totalRowsParsed: 2,
        invalidOrUnmatchedCount: 0,
        reconciled: [
          {
            batchId: 'BATCH-20261105-02',
            batchCode: 'MUN-PAY-20261105-02',
            status: 'RECONCILED_UTR',
            bankUtr: 'FDRL261105884201',
          },
          {
            batchId: 'BATCH-20261105-03',
            batchCode: 'MUN-PAY-20261105-03',
            status: 'RECONCILED_UTR',
            bankUtr: 'FDRL261105884202',
          },
        ],
      }),
      created_at: '2026-11-05T18:42:10.000Z',
    },
    {
      audit_id: 'AUD-BULK-UTR-099',
      tenant_id: 'munambam-demo',
      actor_user_id: 'USR-ACCT-01',
      actor_name: 'Deepa Krishnan',
      actor_role: 'ACCOUNTANT',
      action_code: 'PAYOUT_BATCH_BULK_UTR_RECONCILED',
      target_type: 'PAYOUT_BATCH',
      target_id: 'BULK-1-BATCHES',
      details_json: JSON.stringify({
        actorName: 'Deepa Krishnan (HMS Chief Accountant)',
        sourceLabel: 'SBI-Nodal-Morning-261105.csv',
        reconciledCount: 1,
        totalRowsParsed: 2,
        invalidOrUnmatchedCount: 1,
        reconciled: [
          {
            batchId: 'BATCH-20261105-01',
            batchCode: 'MUN-PAY-20261105-01',
            status: 'RECONCILED_UTR',
            bankUtr: 'SBIN000261105719',
          },
        ],
        invalidItems: [
          {
            batchCode: 'MUN-PAY-20261105-02',
            batchId: 'BATCH-20261105-02',
            bankUtr: 'SB09',
            status: 'INVALID_UTR',
            reason: 'Bank UTR must be at least 6 characters (received 4 chars)',
          },
        ],
      }),
      created_at: '2026-11-05T11:20:45.000Z',
    },
  ];

  const history = buildUtrImportHistory({
    auditLogs: mockAudits,
    payoutBatches: MOCK_BATCHES,
  });

  // Includes 2 audit logs + 1 uncovered RECONCILED_UTR batch from MOCK_BATCHES (BATCH-20261106-01)
  assert.equal(history.length, 3);
  assert.equal(history[0]?.importId, 'IMP-BATCH-BATCH-20261106-01');
  assert.equal(history[0]?.batchesReconciledCount, 1);
  assert.equal(history[0]?.status, 'RECONCILED');
  assert.equal(history[0]?.mappedItems.length, 1);
  assert.equal(history[0]?.mappedItems[0]?.bankUtr, 'HDFC000261106991');
  assert.equal(history[0]?.invalidItems.length, 0);

  assert.equal(history[1]?.importId, 'AUD-BULK-UTR-100');
  assert.equal(history[1]?.batchesReconciledCount, 2);
  assert.equal(history[1]?.sourceLabel, 'FederalBank-Nodal-Evening-261105.csv');
  assert.equal(history[1]?.status, 'RECONCILED');
  assert.equal(history[1]?.mappedItems.length, 2);
  assert.equal(history[1]?.invalidItems.length, 0);

  assert.equal(history[2]?.importId, 'AUD-BULK-UTR-099');
  assert.equal(history[2]?.batchesReconciledCount, 1);
  assert.equal(history[2]?.totalRowsParsed, 2);
  assert.equal(history[2]?.status, 'PARTIAL_RECONCILED');
  assert.equal(history[2]?.mappedItems.length, 1);
  assert.equal(history[2]?.mappedItems[0]?.batchCode, 'MUN-PAY-20261105-01');
  assert.equal(history[2]?.mappedItems[0]?.bankUtr, 'SBIN000261105719');
  assert.equal(history[2]?.invalidItems.length, 1);
  assert.equal(history[2]?.invalidItems[0]?.batchCode, 'MUN-PAY-20261105-02');
  assert.equal(history[2]?.invalidItems[0]?.bankUtr, 'SB09');
  assert.equal(history[2]?.invalidItems[0]?.status, 'INVALID_UTR');

  const counts = countUtrImportHistoryByFilter(history);
  assert.equal(counts.all, 3);
  assert.equal(counts.successfullyMapped, 2);
  assert.equal(counts.invalid, 1);

  const mappedOnly = filterUtrImportHistory(history, 'SUCCESSFULLY_MAPPED');
  assert.equal(mappedOnly.length, 2);

  const invalidOnly = filterUtrImportHistory(history, 'INVALID');
  assert.equal(invalidOnly.length, 1);
  assert.equal(invalidOnly[0]?.importId, 'AUD-BULK-UTR-099');

  const reconciledOnly = filterUtrImportHistory(history, 'RECONCILED');
  assert.equal(reconciledOnly.length, 2);

  const issuesOnly = filterUtrImportHistory(history, 'ISSUES');
  assert.equal(issuesOnly.length, 1);
  assert.equal(issuesOnly[0]?.importId, 'AUD-BULK-UTR-099');
});

test('validateAndNormalizeBankUtr and sanitizeBulkReconcilePayload enforce strict statutory guards and deduplication', () => {
  const validRes = validateAndNormalizeBankUtr('  fdrl261108009911 ');
  assert.equal(validRes.valid, true);
  assert.equal(validRes.normalizedUtr, 'FDRL261108009911');

  const shortRes = validateAndNormalizeBankUtr('SB09');
  assert.equal(shortRes.valid, false);
  assert.equal(shortRes.errorCode, 'UTR_TOO_SHORT');

  const placeholderRes = validateAndNormalizeBankUtr('TEST123456');
  assert.equal(placeholderRes.valid, false);
  assert.equal(placeholderRes.errorCode, 'UTR_PLACEHOLDER_REJECTED');

  const payload = sanitizeBulkReconcilePayload(
    {
      sourceLabel: 'FederalBank-Bulk-Test.csv',
      items: [
        { batchId: 'BATCH-20261106-01', bankUtr: 'FDRL261108001111' },
        { batchId: 'BATCH-20261106-01', bankUtr: 'FDRL261108002222' }, // duplicate batchId
        { batchId: 'BATCH-20261106-02', bankUtr: 'FDRL261108001111' }, // duplicate bankUtr
        { batchId: 'BATCH-20261106-03', bankUtr: '123' }, // invalid short UTR
      ],
    },
    'IDEM-KEY-001'
  );
  assert.equal(payload.idempotencyKey, 'IDEM-KEY-001');
  assert.equal(payload.validItems.length, 1);
  assert.equal(payload.duplicatesSkipped, 2);
  assert.equal(payload.rejectedItems.length, 3);
  assert.equal(payload.totalRowsParsed, 4);
});

test('buildCommandPaletteItems filters quick actions and workspaces cleanly', () => {
  const allItems = buildCommandPaletteItems(null, '');
  assert.ok(allItems.length >= 6);
  const utrFiltered = buildCommandPaletteItems(null, 'UTR CSV');
  assert.equal(utrFiltered.length, 1);
  assert.equal(utrFiltered[0]?.id, 'act-utr-import');
});

test('filterAuditLogsByActionOrTarget filters audit logs in real-time by action_code or target_id', () => {
  const mockLogs: ReadonlyArray<AuditLogRow> = [
    {
      audit_id: 'AUD-01',
      tenant_id: 'munambam-demo',
      actor_user_id: 'USR-ACCT-01',
      actor_name: 'Deepa Krishnan',
      actor_role: 'ACCOUNTANT',
      action_code: 'PAYOUT_BATCH_BULK_UTR_RECONCILED',
      target_type: 'PAYOUT_BATCH',
      target_id: 'BULK-2-BATCHES',
      details_json: '{}',
      created_at: '2026-11-08T10:00:00.000Z',
    },
    {
      audit_id: 'AUD-02',
      tenant_id: 'munambam-demo',
      actor_user_id: 'USR-AUCT-01',
      actor_name: 'K. V. Pavithran',
      actor_role: 'AUCTIONEER',
      action_code: 'LOT_HAMMER_ALLOCATED',
      target_type: 'LOT',
      target_id: 'LOT-20261106-01',
      details_json: '{}',
      created_at: '2026-11-08T09:30:00.000Z',
    },
  ];

  assert.equal(filterAuditLogsByActionOrTarget(mockLogs, '').length, 2);
  const byAction = filterAuditLogsByActionOrTarget(mockLogs, 'payout_batch_bulk');
  assert.equal(byAction.length, 1);
  assert.equal(byAction[0]?.audit_id, 'AUD-01');

  const byTarget = filterAuditLogsByActionOrTarget(mockLogs, 'LOT-20261106-01');
  assert.equal(byTarget.length, 1);
  assert.equal(byTarget[0]?.audit_id, 'AUD-02');

  const noMatch = filterAuditLogsByActionOrTarget(mockLogs, 'NON_EXISTENT_CODE');
  assert.equal(noMatch.length, 0);
});

test('executeWithStatementTimeout enforces global statement timeout and aborts slow queries', async () => {
  const fastResult = await executeWithStatementTimeout(
    'SELECT 1',
    200,
    async () => ({ rows: [{ ok: 1 }] })
  );
  assert.equal(fastResult.rows[0]?.ok, 1);

  await assert.rejects(
    async () => {
      await executeWithStatementTimeout('SELECT pg_sleep(10)', 25, async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { rows: [] };
      });
    },
    /Query exceeded global statement_timeout of 25ms/
  );
});

test('getObservabilitySnapshot and formatPrometheusMetrics expose real SQL query and rate-limit counters', () => {
  recordQueryExecution({ sql: 'SELECT 1', durationMs: 1.5, timedOut: false });
  recordRateLimitEvent({ scope: 'API', allowed: true, clientIp: '127.0.0.1', path: '/api/v1/bootstrap' });
  const baseSnap = getObservabilitySnapshot();
  assert.ok(baseSnap.scaleProfile.registeredUsers >= 1);
  assert.equal(baseSnap.dbProtection.statementTimeoutMs, 5000);
  assert.ok(baseSnap.queryExecutionSeries.length >= 1);
  assert.ok(baseSnap.alerts.length >= 3);

  recordQueryExecution({
    sql: 'SELECT pg_sleep(10)',
    durationMs: 5000,
    timedOut: true,
    error: 'statement_timeout',
  });
  const afterTimeoutSnap = getObservabilitySnapshot();
  assert.ok(
    afterTimeoutSnap.dbProtection.statementTimeoutsAborted >
      baseSnap.dbProtection.statementTimeoutsAborted
  );

  const promText = formatPrometheusMetrics();
  assert.ok(promText.includes('harbouros_sql_queries_total'));
  assert.ok(promText.includes('harbouros_sql_statement_timeouts_total'));
});

test('SimpleLruCache and queryAllImportAuditLogsWithLruCache cache All import view SQL queries and evict LRU entries', async () => {
  const lru = new SimpleLruCache<string, number>({ maxEntries: 2, ttlMs: 10_000 });
  lru.set('k1', 100);
  lru.set('k2', 200);
  // Access k1 so k2 becomes Least Recently Used
  assert.equal(lru.get('k1')?.value, 100);
  // Adding k3 should evict k2
  lru.set('k3', 300);
  assert.equal(lru.get('k2'), undefined);
  assert.equal(lru.get('k1')?.value, 100);
  assert.equal(lru.get('k3')?.value, 300);
  assert.equal(lru.stats().evictions, 1);

  let sqlCalls = 0;
  const mockDb: DbPort = {
    async query<T = Record<string, unknown>>() {
      sqlCalls += 1;
      return { rows: [{ id: `row-${sqlCalls}` } as unknown as T] };
    },
    async exec() {
      // no-op
    },
    async transaction<T>(fn: (tx: DbPort) => Promise<T>): Promise<T> {
      return fn(mockDb);
    },
  };

  invalidateLedgerAuditSqlLruCache('tenant-lru-test');

  // First 'ALL' view query -> cache MISS (executes 2 SQL queries: payout_batches + audit_logs)
  const firstRes = await queryAllImportAuditLogsWithLruCache(mockDb, 'tenant-lru-test', 'ALL');
  assert.equal(firstRes.cacheStatus, 'MISS');
  assert.equal(sqlCalls, 2);

  // Second 'ALL' view query -> cache HIT (0 new SQL queries executed!)
  const secondRes = await queryAllImportAuditLogsWithLruCache(mockDb, 'tenant-lru-test', 'ALL');
  assert.equal(secondRes.cacheStatus, 'HIT');
  assert.equal(sqlCalls, 2);
  assert.deepEqual(secondRes.auditLogs, firstRes.auditLogs);

  // Non-'ALL' view query -> BYPASS
  const bypassRes = await queryAllImportAuditLogsWithLruCache(mockDb, 'tenant-lru-test', 'INVALID');
  assert.equal(bypassRes.cacheStatus, 'BYPASS');
  assert.equal(sqlCalls, 4);

  // Invalidate tenant cache -> next 'ALL' view query is a MISS again
  invalidateLedgerAuditSqlLruCache('tenant-lru-test');
  const afterInvalidate = await queryAllImportAuditLogsWithLruCache(
    mockDb,
    'tenant-lru-test',
    'ALL'
  );
  assert.equal(afterInvalidate.cacheStatus, 'MISS');
  assert.equal(sqlCalls, 6);
});

test('formatCentralizedLogsCsv, formatObservabilityBundleJson, and resolveGlobalKeyboardShortcut work deterministically', () => {
  const csv = formatCentralizedLogsCsv([
    {
      id: 'LOG-01',
      timestampIso: '2026-11-09T09:00:00.000Z',
      level: 'info',
      service: 'db-pg-pool',
      actionCode: 'SQL_STATEMENT_TIMEOUT_SET',
      durationMs: 1.8,
      traceId: 'trc-001',
      message: 'Configured statement_timeout=5000ms, pool=20',
    },
  ]);
  assert.ok(csv.includes('log_id,timestamp_iso,level,service,action_code,duration_ms,trace_id,message'));
  assert.ok(csv.includes('LOG-01,2026-11-09T09:00:00.000Z,info,db-pg-pool,SQL_STATEMENT_TIMEOUT_SET,1.8,trc-001,"Configured statement_timeout=5000ms, pool=20"'));

  const bundleJson = formatObservabilityBundleJson(
    { registeredUsers: 8 },
    '2026-11-09T09:30:00.000Z'
  );
  const parsed = JSON.parse(bundleJson) as {
    bundleVersion: string;
    exportedAtIso: string;
    registeredUsers: number;
  };
  assert.equal(parsed.bundleVersion, 'harbouros-observability-v1');
  assert.equal(parsed.exportedAtIso, '2026-11-09T09:30:00.000Z');
  assert.equal(parsed.registeredUsers, 8);

  // Global keyboard shortcuts
  assert.deepEqual(
    resolveGlobalKeyboardShortcut({
      key: 'l',
      isEditableTarget: false,
      ledgerDrawerOpen: false,
    }),
    { type: 'TOGGLE_LEDGER_DRAWER' }
  );
  assert.deepEqual(
    resolveGlobalKeyboardShortcut({
      key: 'l',
      isEditableTarget: true,
      ledgerDrawerOpen: false,
    }),
    { type: 'NONE' }
  );
  assert.deepEqual(
    resolveGlobalKeyboardShortcut({
      key: '/',
      isEditableTarget: false,
      ledgerDrawerOpen: true,
    }),
    { type: 'FOCUS_AUDIT_FILTER' }
  );
  assert.deepEqual(
    resolveGlobalKeyboardShortcut({
      key: '2',
      isEditableTarget: false,
      ledgerDrawerOpen: false,
    }),
    { type: 'SWITCH_WORKSPACE', workspaceIndex: 1 }
  );
});

test('resolveClientIp extracts client IP from RFC 7239 Forwarded, X-Forwarded-For, or fallback ip', () => {
  const reqForwarded = {
    headers: {
      forwarded: 'for=203.0.113.195;proto=https;by=203.0.113.43',
      'x-forwarded-for': '198.51.100.17',
    },
    ip: '127.0.0.1',
  } as unknown as Request;
  assert.equal(resolveClientIp(reqForwarded), '203.0.113.195');

  const reqXff = {
    headers: {
      'x-forwarded-for': '198.51.100.17, 70.41.3.18',
    },
    ip: '127.0.0.1',
  } as unknown as Request;
  assert.equal(resolveClientIp(reqXff), '198.51.100.17');

  const reqDirect = {
    headers: {},
    ip: '10.0.0.8',
  } as unknown as Request;
  assert.equal(resolveClientIp(reqDirect), '10.0.0.8');
});

test('@harbouros/sdk signs & verifies Bank Nodal Webhooks, builds settlement vouchers, and computes benchmarks', () => {
  const secret = 'statutory-nodal-secret-2026';
  const nowSec = 1762680000;
  const envelope = signBankNodalWebhookPayload(
    {
      eventId: 'EVT-NODAL-001',
      bankCode: 'FDRL-NODAL-KOCHI',
      tenantId: 'munambam-demo',
      timestampSec: nowSec,
      settlements: [
        {
          batchCodeOrId: 'MUN-PAY-20261106-01',
          bankUtr: 'FDRL261109998877',
          channel: 'ISO20022_CAMT054',
        },
      ],
    },
    secret
  );

  assert.equal(envelope.signatureHex.length, 64);
  const validCheck = verifyBankNodalWebhookSignature({
    payload: envelope.payload,
    signatureHeader: envelope.headers['X-HarbourOS-Webhook-Signature'],
    timestampHeader: envelope.headers['X-HarbourOS-Webhook-Timestamp'],
    webhookSecret: secret,
    nowSec: nowSec + 15,
  });
  assert.equal(validCheck.valid, true);

  // Replay window protection rejects expired timestamps (> 300s)
  const expiredCheck = verifyBankNodalWebhookSignature({
    payload: envelope.payload,
    signatureHeader: envelope.headers['X-HarbourOS-Webhook-Signature'],
    timestampHeader: envelope.headers['X-HarbourOS-Webhook-Timestamp'],
    webhookSecret: secret,
    nowSec: nowSec + 900,
  });
  assert.equal(expiredCheck.valid, false);

  // Tampered secret is rejected
  const tamperedCheck = verifyBankNodalWebhookSignature({
    payload: envelope.payload,
    signatureHeader: envelope.headers['X-HarbourOS-Webhook-Signature'],
    timestampHeader: envelope.headers['X-HarbourOS-Webhook-Timestamp'],
    webhookSecret: 'wrong-secret',
    nowSec,
  });
  assert.equal(tamperedCheck.valid, false);

  const idemKey = generateDeterministicIdempotencyKey({
    tenantId: 'munambam-demo',
    operation: 'WEBHOOK',
    resourceId: 'EVT-NODAL-001',
    payloadSummary: envelope.signatureHex,
  });
  assert.ok(idemKey.startsWith('IDEM-'));
  assert.equal(computeSdkBackoffMs(0, 150, 4000), 150);
  assert.equal(computeSdkBackoffMs(2, 150, 4000), 600);

  const voucher = buildStatutorySettlementVoucher({
    tenantId: 'munambam-demo',
    tenantNameEn: 'Munambam Fishing Harbour (HMS)',
    chainHeadHash: 'a'.repeat(64),
    chainVerified: true,
    entryCount: 16,
    batches: MOCK_BATCHES,
    issuedAtIso: '2026-11-09T10:00:00.000Z',
  });
  assert.ok(voucher.voucherId.startsWith('VCH-'));
  assert.equal(voucher.voucherProofSha256.length, 64);
  assert.equal(voucher.reconciledBatchesCount, 1);
  assert.equal(voucher.pendingBatchesCount, 1);

  const benchmarks = computeCrossHarbourBenchmarks([
    {
      tenant_id: 'custom-harbour-01',
      name_en: 'Custom Coastal Harbour',
      centre_type: 'KERALA_HARBOUR',
    },
  ]);
  assert.equal(benchmarks.length, 7);
  assert.equal(benchmarks[6]?.tenantId, 'custom-harbour-01');
});


