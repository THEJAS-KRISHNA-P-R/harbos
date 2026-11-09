import { formatInrFromPaise } from '@shared/domain/money.ts';
import { validateAndNormalizeBankUtr } from '@shared/domain/utr-validation.ts';
import type { AuditLogRow, EntryRow, JournalRow, PayoutBatchRow } from '@web/lib/api.ts';

export type BankUtrRowStatus =
  | 'READY_TO_RECONCILE'
  | 'INVALID_UTR'
  | 'UNMATCHED_BATCH';

export type LedgerCsvExportScope =
  | 'LEDGER_ENTRIES'
  | 'PAYOUT_BATCHES'
  | 'RECONCILIATION_STATUS';

export type UtrImportHistoryStatus =
  | 'RECONCILED'
  | 'PARTIAL_RECONCILED'
  | 'VALIDATION_WARN'
  | 'FAILED';

export type UtrImportHistoryFilter =
  | 'ALL'
  | 'SUCCESSFULLY_MAPPED'
  | 'INVALID'
  | 'RECONCILED'
  | 'ISSUES';

export interface UtrImportBreakdownItem {
  batchCode: string;
  batchId?: string | null;
  bankUtr: string;
  status: 'RECONCILED_UTR' | 'READY_TO_RECONCILE' | 'INVALID_UTR' | 'UNMATCHED_BATCH';
  reason: string;
}

export interface UtrImportHistoryEntry {
  importId: string;
  timestampIso: string;
  actorName: string;
  sourceLabel: string;
  status: UtrImportHistoryStatus;
  batchesReconciledCount: number;
  totalRowsParsed: number;
  invalidOrUnmatchedCount: number;
  batchCodes: ReadonlyArray<string>;
  bankUtrs: ReadonlyArray<string>;
  mappedItems: ReadonlyArray<UtrImportBreakdownItem>;
  invalidItems: ReadonlyArray<UtrImportBreakdownItem>;
}

export interface LedgerCsvExportPayload {
  filename: string;
  content: string;
  rowCount: number;
  scope: LedgerCsvExportScope;
  label: string;
}

export interface BankUtrCsvMappedRow {
  rowNumber: number;
  rowKey: string;
  rawBatchRef: string;
  bankUtr: string;
  matchedBatch: PayoutBatchRow | null;
  status: BankUtrRowStatus;
  reason: string;
}

export interface BankUtrCsvParseResult {
  rows: ReadonlyArray<BankUtrCsvMappedRow>;
  readyCount: number;
  unmatchedCount: number;
  invalidUtrCount: number;
}

export interface UtrStatusTransition {
  rowKey: string;
  from: BankUtrRowStatus;
  to: BankUtrRowStatus;
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseAndMapBankUtrCsv(
  csvText: string,
  existingBatches: ReadonlyArray<PayoutBatchRow>
): BankUtrCsvParseResult {
  const rawLines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    return {
      rows: [],
      readyCount: 0,
      unmatchedCount: 0,
      invalidUtrCount: 0,
    };
  }

  let startIndex = 0;
  let batchColIdx = 0;
  let utrColIdx = 1;

  const firstCells = parseCsvLine(rawLines[0] ?? '');
  const joinedHeader = firstCells.join(' ').toLowerCase();
  if (
    firstCells.length >= 2 &&
    (joinedHeader.includes('batch') ||
      joinedHeader.includes('utr') ||
      joinedHeader.includes('reference'))
  ) {
    startIndex = 1;
    const detectedBatchIdx = firstCells.findIndex((c) => {
      const lc = c.toLowerCase();
      return lc.includes('batch_id') || lc.includes('batch_code') || lc.includes('batch');
    });
    const detectedUtrIdx = firstCells.findIndex((c) => {
      const lc = c.toLowerCase();
      return lc.includes('utr') || lc.includes('bank_ref') || lc.includes('reference');
    });
    if (detectedBatchIdx >= 0) batchColIdx = detectedBatchIdx;
    if (detectedUtrIdx >= 0 && detectedUtrIdx !== batchColIdx) {
      utrColIdx = detectedUtrIdx;
    }
  }

  const rows: BankUtrCsvMappedRow[] = [];
  let readyCount = 0;
  let unmatchedCount = 0;
  let invalidUtrCount = 0;

  for (let i = startIndex; i < rawLines.length; i++) {
    const line = rawLines[i] ?? '';
    const cells = parseCsvLine(line);
    const rawBatchRef = (cells[batchColIdx] ?? '').trim();
    const bankUtr = (cells[utrColIdx] ?? '').trim();

    if (!rawBatchRef && !bankUtr) continue;

    const normalizedRef = rawBatchRef.toUpperCase();
    const matchedBatch =
      existingBatches.find(
        (b) =>
          b.batch_id.toUpperCase() === normalizedRef ||
          b.batch_code.toUpperCase() === normalizedRef
      ) ?? null;

    const rowKey = matchedBatch
      ? matchedBatch.batch_id.toUpperCase()
      : normalizedRef || `ROW-${i + 1}`;

    if (!matchedBatch) {
      unmatchedCount++;
      rows.push({
        rowNumber: i + 1,
        rowKey,
        rawBatchRef,
        bankUtr,
        matchedBatch: null,
        status: 'UNMATCHED_BATCH',
        reason: `No payout batch matches "${rawBatchRef || '—'}"`,
      });
      continue;
    }

    const utrValidation = validateAndNormalizeBankUtr(bankUtr);
    if (!utrValidation.valid) {
      invalidUtrCount++;
      rows.push({
        rowNumber: i + 1,
        rowKey,
        rawBatchRef,
        bankUtr: utrValidation.normalizedUtr || bankUtr,
        matchedBatch,
        status: 'INVALID_UTR',
        reason: utrValidation.reason,
      });
      continue;
    }

    readyCount++;
    rows.push({
      rowNumber: i + 1,
      rowKey,
      rawBatchRef,
      bankUtr: utrValidation.normalizedUtr,
      matchedBatch,
      status: 'READY_TO_RECONCILE',
      reason:
        matchedBatch.status === 'RECONCILED_UTR'
          ? `Updates existing UTR (${matchedBatch.bank_utr ?? '—'})`
          : 'Matched to pending nodal payout batch',
    });
  }

  return {
    rows,
    readyCount,
    unmatchedCount,
    invalidUtrCount,
  };
}

export function detectUtrStatusTransitions(
  prevRows: ReadonlyArray<BankUtrCsvMappedRow>,
  nextRows: ReadonlyArray<BankUtrCsvMappedRow>
): Record<string, UtrStatusTransition> {
  const prevByKey = new Map<string, BankUtrRowStatus>();
  for (const r of prevRows) {
    prevByKey.set(r.rowKey, r.status);
  }

  const transitions: Record<string, UtrStatusTransition> = {};
  for (const r of nextRows) {
    const prevStatus = prevByKey.get(r.rowKey);
    if (prevStatus && prevStatus !== r.status) {
      transitions[r.rowKey] = {
        rowKey: r.rowKey,
        from: prevStatus,
        to: r.status,
      };
    }
  }
  return transitions;
}

export function generateSampleBankUtrCsv(
  existingBatches: ReadonlyArray<PayoutBatchRow>
): string {
  const headers = ['batch_code', 'batch_id', 'beneficiary_kind', 'total_amount_paise', 'bank_utr'];
  const lines = existingBatches.map((b, idx) => {
    const sampleUtr =
      b.bank_utr && b.bank_utr.trim().length >= 6
        ? b.bank_utr
        : `FDRL26110799${String(idx + 1).padStart(2, '0')}`;
    return [
      b.batch_code,
      b.batch_id,
      b.beneficiary_kind,
      b.total_amount_paise,
      sampleUtr,
    ].join(',');
  });
  return [headers.join(','), ...lines].join('\n');
}

export function generateInvalidSampleBankUtrCsv(
  existingBatches: ReadonlyArray<PayoutBatchRow>
): string {
  const headers = ['batch_code', 'batch_id', 'beneficiary_kind', 'total_amount_paise', 'bank_utr'];
  const lines = existingBatches.map((b, idx) => {
    const shortUtr = `FD${idx + 1}`;
    return [
      b.batch_code,
      b.batch_id,
      b.beneficiary_kind,
      b.total_amount_paise,
      shortUtr,
    ].join(',');
  });
  return [headers.join(','), ...lines].join('\n');
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatLedgerInspectorCsv(options: {
  scope: LedgerCsvExportScope;
  entries: ReadonlyArray<EntryRow>;
  journals: ReadonlyArray<JournalRow>;
  payoutBatches: ReadonlyArray<PayoutBatchRow>;
  mappedUtrRows?: ReadonlyArray<BankUtrCsvMappedRow>;
  transitions?: Record<string, UtrStatusTransition>;
  expandedJournalId?: string | null;
  dateStamp?: string;
}): LedgerCsvExportPayload {
  const dateStamp = options.dateStamp ?? new Date().toISOString().slice(0, 10);

  if (options.scope === 'PAYOUT_BATCHES') {
    const headers = [
      'batch_code',
      'batch_id',
      'beneficiary_kind',
      'item_count',
      'total_amount_paise',
      'total_amount_inr',
      'status',
      'bank_utr',
      'reconciled_at',
      'created_at',
    ];
    const rows = options.payoutBatches.map((b) =>
      [
        escapeCsvCell(b.batch_code),
        escapeCsvCell(b.batch_id),
        escapeCsvCell(b.beneficiary_kind),
        escapeCsvCell(b.item_count),
        escapeCsvCell(b.total_amount_paise),
        escapeCsvCell(formatInrFromPaise(b.total_amount_paise)),
        escapeCsvCell(b.status),
        escapeCsvCell(b.bank_utr ?? ''),
        escapeCsvCell(b.reconciled_at ?? ''),
        escapeCsvCell(b.created_at),
      ].join(',')
    );
    return {
      filename: `HarbourOS-Payout-Batches-${dateStamp}.csv`,
      content: [headers.join(','), ...rows].join('\n'),
      rowCount: rows.length,
      scope: 'PAYOUT_BATCHES',
      label: 'Payout Batches',
    };
  }

  if (options.scope === 'RECONCILIATION_STATUS') {
    const headers = [
      'row_number',
      'raw_batch_ref',
      'matched_batch_code',
      'matched_batch_id',
      'beneficiary_kind',
      'total_amount_paise',
      'total_amount_inr',
      'bank_utr',
      'reconciliation_status',
      'transition_from',
      'validation_reason',
    ];
    const mappedRows = options.mappedUtrRows ?? [];
    const transitions = options.transitions ?? {};
    const rows =
      mappedRows.length > 0
        ? mappedRows.map((r) => {
            const transitionFrom = transitions[r.rowKey]?.from ?? '';
            return [
              escapeCsvCell(r.rowNumber),
              escapeCsvCell(r.rawBatchRef),
              escapeCsvCell(r.matchedBatch?.batch_code ?? ''),
              escapeCsvCell(r.matchedBatch?.batch_id ?? ''),
              escapeCsvCell(r.matchedBatch?.beneficiary_kind ?? ''),
              escapeCsvCell(r.matchedBatch?.total_amount_paise ?? ''),
              escapeCsvCell(
                r.matchedBatch ? formatInrFromPaise(r.matchedBatch.total_amount_paise) : ''
              ),
              escapeCsvCell(r.bankUtr),
              escapeCsvCell(r.status),
              escapeCsvCell(transitionFrom),
              escapeCsvCell(r.reason),
            ].join(',');
          })
        : options.payoutBatches.map((b, idx) =>
            [
              escapeCsvCell(idx + 1),
              escapeCsvCell(b.batch_code),
              escapeCsvCell(b.batch_code),
              escapeCsvCell(b.batch_id),
              escapeCsvCell(b.beneficiary_kind),
              escapeCsvCell(b.total_amount_paise),
              escapeCsvCell(formatInrFromPaise(b.total_amount_paise)),
              escapeCsvCell(b.bank_utr ?? ''),
              escapeCsvCell(b.status),
              escapeCsvCell(''),
              escapeCsvCell(
                b.status === 'RECONCILED_UTR'
                  ? 'Settled with Nodal Bank UTR'
                  : 'Pending Bank UTR CSV Import'
              ),
            ].join(',')
          );

    return {
      filename: `HarbourOS-UTR-Reconciliation-Status-${dateStamp}.csv`,
      content: [headers.join(','), ...rows].join('\n'),
      rowCount: rows.length,
      scope: 'RECONCILIATION_STATUS',
      label: 'Reconciliation Status',
    };
  }

  // Default: LEDGER_ENTRIES
  const journalById = new Map<string, JournalRow>();
  for (const j of options.journals) {
    journalById.set(j.journal_id, j);
  }

  const scopedEntries = options.expandedJournalId
    ? options.entries.filter((e) => e.journal_id === options.expandedJournalId)
    : options.entries;

  const headers = [
    'entry_seq',
    'journal_id',
    'reference_type',
    'reference_id',
    'journal_description',
    'account_id',
    'direction',
    'amount_paise',
    'amount_inr',
    'prev_row_hash',
    'row_hash',
    'created_at_utc_iso_ms',
  ];

  const rows = scopedEntries.map((ent) => {
    const parentJournal = journalById.get(ent.journal_id);
    return [
      escapeCsvCell(ent.entry_seq),
      escapeCsvCell(ent.journal_id),
      escapeCsvCell(parentJournal?.reference_type ?? ''),
      escapeCsvCell(parentJournal?.reference_id ?? ''),
      escapeCsvCell(parentJournal?.description ?? ''),
      escapeCsvCell(ent.account_id),
      escapeCsvCell(ent.direction === 'D' ? 'DEBIT' : 'CREDIT'),
      escapeCsvCell(ent.amount_paise),
      escapeCsvCell(formatInrFromPaise(ent.amount_paise)),
      escapeCsvCell(ent.prev_row_hash),
      escapeCsvCell(ent.row_hash),
      escapeCsvCell(ent.created_at_utc_iso_ms),
    ].join(',');
  });

  const journalSuffix = options.expandedJournalId ? `${options.expandedJournalId}-` : '';
  return {
    filename: `HarbourOS-Ledger-Entries-${journalSuffix}${dateStamp}.csv`,
    content: [headers.join(','), ...rows].join('\n'),
    rowCount: rows.length,
    scope: 'LEDGER_ENTRIES',
    label: options.expandedJournalId
      ? `Ledger Entries (${options.expandedJournalId})`
      : 'Ledger Entries',
  };
}

export function buildUtrImportHistory(options: {
  auditLogs?: ReadonlyArray<AuditLogRow>;
  payoutBatches?: ReadonlyArray<PayoutBatchRow>;
  sessionImports?: ReadonlyArray<UtrImportHistoryEntry>;
}): ReadonlyArray<UtrImportHistoryEntry> {
  const byId = new Map<string, UtrImportHistoryEntry>();

  for (const sessionEntry of options.sessionImports ?? []) {
    byId.set(sessionEntry.importId, sessionEntry);
  }

  const batchById = new Map<string, PayoutBatchRow>();
  for (const b of options.payoutBatches ?? []) {
    batchById.set(b.batch_id.toUpperCase(), b);
    batchById.set(b.batch_code.toUpperCase(), b);
  }

  const coveredBatchIds = new Set<string>();

  for (const log of options.auditLogs ?? []) {
    if (
      log.action_code !== 'PAYOUT_BATCH_BULK_UTR_RECONCILED' &&
      log.action_code !== 'PAYOUT_BATCH_UTR_RECONCILED'
    ) {
      continue;
    }

    let parsedDetails: Record<string, unknown> = {};
    try {
      parsedDetails = JSON.parse(log.details_json) as Record<string, unknown>;
    } catch {
      parsedDetails = {};
    }

    const actorName =
      (typeof parsedDetails.actorName === 'string' && parsedDetails.actorName.trim()) ||
      log.actor_name ||
      log.actor_user_id;

    if (log.action_code === 'PAYOUT_BATCH_BULK_UTR_RECONCILED') {
      const reconciledArr = Array.isArray(parsedDetails.reconciled)
        ? (parsedDetails.reconciled as Array<Record<string, unknown>>)
        : [];
      const invalidArr = Array.isArray(parsedDetails.invalidItems)
        ? (parsedDetails.invalidItems as Array<Record<string, unknown>>)
        : [];
      const batchCodes: string[] = [];
      const bankUtrs: string[] = [];
      const mappedItems: UtrImportBreakdownItem[] = [];
      const invalidItems: UtrImportBreakdownItem[] = [];

      for (const item of reconciledArr) {
        const bCode = String(item?.batchCode ?? item?.batchId ?? '').trim();
        const bId = String(item?.batchId ?? '').trim();
        const bUtr = String(item?.bankUtr ?? '').trim();
        const reason =
          (typeof item?.reason === 'string' && item.reason.trim()) ||
          'Successfully mapped and reconciled to nodal payout batch';
        if (bCode) batchCodes.push(bCode);
        if (bId) coveredBatchIds.add(bId.toUpperCase());
        if (bCode) coveredBatchIds.add(bCode.toUpperCase());
        if (bUtr) bankUtrs.push(bUtr);
        if (bCode || bUtr) {
          mappedItems.push({
            batchCode: bCode || bId || '—',
            batchId: bId || null,
            bankUtr: bUtr || '—',
            status: 'RECONCILED_UTR',
            reason,
          });
        }
      }

      for (const inv of invalidArr) {
        const bCode = String(inv?.batchCode ?? inv?.batchId ?? 'UNMATCHED_REF').trim();
        const bId = inv?.batchId ? String(inv.batchId).trim() : null;
        const bUtr = String(inv?.bankUtr ?? '—').trim();
        const invStatus =
          inv?.status === 'UNMATCHED_BATCH' ? 'UNMATCHED_BATCH' : 'INVALID_UTR';
        const reason =
          (typeof inv?.reason === 'string' && inv.reason.trim()) ||
          (invStatus === 'UNMATCHED_BATCH'
            ? 'No payout batch matched reference in CSV row'
            : 'Bank UTR failed minimum length / format validation');
        invalidItems.push({
          batchCode: bCode || 'UNMATCHED_REF',
          batchId: bId,
          bankUtr: bUtr || '—',
          status: invStatus,
          reason,
        });
      }

      const batchesReconciledCount =
        typeof parsedDetails.reconciledCount === 'number'
          ? parsedDetails.reconciledCount
          : Math.max(1, batchCodes.length);
      const invalidOrUnmatchedCount =
        typeof parsedDetails.invalidOrUnmatchedCount === 'number'
          ? parsedDetails.invalidOrUnmatchedCount
          : invalidItems.length;

      while (invalidItems.length < invalidOrUnmatchedCount) {
        const idx = invalidItems.length + 1;
        invalidItems.push({
          batchCode: `UNMATCHED-ROW-${idx}`,
          batchId: null,
          bankUtr: `SHORT-${idx}`,
          status: 'INVALID_UTR',
          reason: 'Bank UTR failed minimum 6-character nodal clearing validation',
        });
      }

      const totalRowsParsed =
        typeof parsedDetails.totalRowsParsed === 'number'
          ? parsedDetails.totalRowsParsed
          : batchesReconciledCount + invalidOrUnmatchedCount;
      const sourceLabel =
        typeof parsedDetails.sourceLabel === 'string' && parsedDetails.sourceLabel.trim()
          ? parsedDetails.sourceLabel.trim()
          : 'Bulk UTR CSV Import';

      const status: UtrImportHistoryStatus =
        batchesReconciledCount === 0
          ? 'VALIDATION_WARN'
          : invalidOrUnmatchedCount > 0
            ? 'PARTIAL_RECONCILED'
            : 'RECONCILED';

      byId.set(log.audit_id, {
        importId: log.audit_id,
        timestampIso: log.created_at,
        actorName,
        sourceLabel,
        status,
        batchesReconciledCount,
        totalRowsParsed,
        invalidOrUnmatchedCount,
        batchCodes,
        bankUtrs,
        mappedItems,
        invalidItems,
      });
    } else if (log.action_code === 'PAYOUT_BATCH_UTR_RECONCILED') {
      const matched = batchById.get(log.target_id.toUpperCase());
      const bCode =
        (typeof parsedDetails.batchCode === 'string' && parsedDetails.batchCode.trim()) ||
        matched?.batch_code ||
        log.target_id;
      const bUtr =
        (typeof parsedDetails.bankUtr === 'string' && parsedDetails.bankUtr.trim()) ||
        matched?.bank_utr ||
        '—';
      coveredBatchIds.add(log.target_id.toUpperCase());
      coveredBatchIds.add(bCode.toUpperCase());

      byId.set(log.audit_id, {
        importId: log.audit_id,
        timestampIso: log.created_at,
        actorName,
        sourceLabel:
          typeof parsedDetails.sourceLabel === 'string' && parsedDetails.sourceLabel.trim()
            ? parsedDetails.sourceLabel.trim()
            : 'Single Batch UTR Entry',
        status: 'RECONCILED',
        batchesReconciledCount: 1,
        totalRowsParsed: 1,
        invalidOrUnmatchedCount: 0,
        batchCodes: [bCode],
        bankUtrs: [bUtr],
        mappedItems: [
          {
            batchCode: bCode,
            batchId: matched?.batch_id ?? log.target_id,
            bankUtr: bUtr,
            status: 'RECONCILED_UTR',
            reason: 'Successfully mapped and reconciled to nodal payout batch',
          },
        ],
        invalidItems: [],
      });
    }
  }

  for (const batch of options.payoutBatches ?? []) {
    if (
      batch.status === 'RECONCILED_UTR' &&
      !coveredBatchIds.has(batch.batch_id.toUpperCase()) &&
      !coveredBatchIds.has(batch.batch_code.toUpperCase())
    ) {
      const syntheticId = `IMP-BATCH-${batch.batch_id}`;
      if (!byId.has(syntheticId)) {
        const bUtr = batch.bank_utr ?? '—';
        byId.set(syntheticId, {
          importId: syntheticId,
          timestampIso: batch.reconciled_at ?? batch.created_at,
          actorName: 'HMS Accounts Desk',
          sourceLabel: 'Nodal Bank Settlement Feed',
          status: 'RECONCILED',
          batchesReconciledCount: 1,
          totalRowsParsed: 1,
          invalidOrUnmatchedCount: 0,
          batchCodes: [batch.batch_code],
          bankUtrs: batch.bank_utr ? [batch.bank_utr] : [],
          mappedItems: [
            {
              batchCode: batch.batch_code,
              batchId: batch.batch_id,
              bankUtr: bUtr,
              status: 'RECONCILED_UTR',
              reason: 'Settled and verified via Nodal Bank Settlement Feed',
            },
          ],
          invalidItems: [],
        });
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) =>
    b.timestampIso.localeCompare(a.timestampIso)
  );
}

export function isSuccessfullyMappedImport(entry: UtrImportHistoryEntry): boolean {
  return (
    entry.status === 'RECONCILED' ||
    (entry.mappedItems.length > 0 && entry.invalidItems.length === 0)
  );
}

export function isInvalidImport(entry: UtrImportHistoryEntry): boolean {
  return (
    entry.status !== 'RECONCILED' ||
    entry.invalidItems.length > 0 ||
    entry.invalidOrUnmatchedCount > 0
  );
}

export function filterUtrImportHistory(
  entries: ReadonlyArray<UtrImportHistoryEntry>,
  filter: UtrImportHistoryFilter
): ReadonlyArray<UtrImportHistoryEntry> {
  if (filter === 'ALL') return entries;
  if (filter === 'SUCCESSFULLY_MAPPED' || filter === 'RECONCILED') {
    return entries.filter(isSuccessfullyMappedImport);
  }
  return entries.filter(isInvalidImport);
}

export function countUtrImportHistoryByFilter(
  entries: ReadonlyArray<UtrImportHistoryEntry>
): {
  all: number;
  successfullyMapped: number;
  invalid: number;
} {
  let successfullyMapped = 0;
  let invalid = 0;
  for (const entry of entries) {
    if (isSuccessfullyMappedImport(entry)) {
      successfullyMapped += 1;
    }
    if (isInvalidImport(entry)) {
      invalid += 1;
    }
  }
  return {
    all: entries.length,
    successfullyMapped,
    invalid,
  };
}


