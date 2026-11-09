import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileDown,
  FileUp,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import {
  Button,
  Badge,
  Drawer,
  Toast,
  StatutoryLedgerWaterfallSvgDecor,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  downloadTextFile,
  formatInrFromPaise,
  formatLedgerInspectorCsv,
  generateSampleBankUtrCsv,
  generateInvalidSampleBankUtrCsv,
  parseAndMapBankUtrCsv,
  detectUtrStatusTransitions,
  buildUtrImportHistory,
  filterUtrImportHistory,
  type BankUtrCsvMappedRow,
  type UtrStatusTransition,
  type LedgerCsvExportScope,
  type UtrImportBreakdownItem,
  type UtrImportHistoryEntry,
  type UtrImportHistoryFilter,
  type BootstrapData,
} from '@web/lib/api.ts';

import { UtrBulkHistoryTable } from '@web/app/components/ledger-inspector/UtrBulkHistoryTable.tsx';
import { LedgerChartsAndJournals } from '@web/app/components/ledger-inspector/LedgerChartsAndJournals.tsx';

export interface GoldenVectorRow {
  mode: string;
  fisherman: string;
  bonus: string;
  auctioneer: string;
  hms: string;
  coop: string;
  hos: string;
  payable: string;
}

export interface LedgerInspectorDrawerProps {
  open: boolean;
  onClose: () => void;
  bootstrap: BootstrapData | null;
  token: string | null;
  goldenVectorRows: ReadonlyArray<GoldenVectorRow>;
  onRefresh: () => Promise<void>;
  autoOpenUtrMapperSignal?: number;
}

export const LedgerInspectorDrawer: React.FC<LedgerInspectorDrawerProps> = ({
  open,
  onClose,
  bootstrap,
  token,
  goldenVectorRows,
  onRefresh,
  autoOpenUtrMapperSignal = 0,
}) => {
  const [utrImportPanelOpen, setUtrImportPanelOpen] = useState(false);
  const [utrCsvText, setUtrCsvText] = useState('');
  const [utrSourceLabel, setUtrSourceLabel] = useState('Inline Bank UTR CSV');
  const [utrReconciling, setUtrReconciling] = useState(false);
  const [utrFeedback, setUtrFeedback] = useState<{
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null>(null);
  const [parseEpoch, setParseEpoch] = useState(0);
  const [transitions, setTransitions] = useState<Record<string, UtrStatusTransition>>({});
  const [expandedJournalId, setExpandedJournalId] = useState<string | null>(null);
  const [csvExportScope, setCsvExportScope] =
    useState<LedgerCsvExportScope>('LEDGER_ENTRIES');
  const [sessionImportHistory, setSessionImportHistory] = useState<
    ReadonlyArray<UtrImportHistoryEntry>
  >([]);
  const [historyFilter, setHistoryFilter] = useState<UtrImportHistoryFilter>('ALL');
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const utrCsvInputRef = useRef<HTMLInputElement | null>(null);
  const prevRowsRef = useRef<ReadonlyArray<BankUtrCsvMappedRow>>([]);

  const parsedUtrCsv = parseAndMapBankUtrCsv(
    utrCsvText,
    bootstrap?.payoutBatches ?? []
  );

  const importHistoryEntries = useMemo(
    () =>
      buildUtrImportHistory({
        auditLogs: bootstrap?.auditLogs ?? [],
        payoutBatches: bootstrap?.payoutBatches ?? [],
        sessionImports: sessionImportHistory,
      }),
    [bootstrap?.auditLogs, bootstrap?.payoutBatches, sessionImportHistory]
  );

  const filteredHistoryEntries = useMemo(
    () => filterUtrImportHistory(importHistoryEntries, historyFilter),
    [importHistoryEntries, historyFilter]
  );

  const totalHistoricalBatchesReconciled = useMemo(
    () =>
      importHistoryEntries.reduce(
        (sum, item) => sum + item.batchesReconciledCount,
        0
      ),
    [importHistoryEntries]
  );

  // Track status transitions (e.g., INVALID_UTR -> READY_TO_RECONCILE) whenever CSV rows update
  useEffect(() => {
    const detected = detectUtrStatusTransitions(prevRowsRef.current, parsedUtrCsv.rows);
    if (Object.keys(detected).length > 0) {
      setTransitions((prev) => ({ ...prev, ...detected }));
    }
    prevRowsRef.current = parsedUtrCsv.rows;
    setParseEpoch((n) => n + 1);
  }, [utrCsvText, bootstrap?.payoutBatches]);

  useEffect(() => {
    if (autoOpenUtrMapperSignal > 0 && bootstrap) {
      setUtrImportPanelOpen(true);
      setCsvExportScope('RECONCILIATION_STATUS');
      if (!utrCsvText.trim() && bootstrap.payoutBatches.length > 0) {
        setUtrCsvText(generateSampleBankUtrCsv(bootstrap.payoutBatches));
      }
    }
  }, [autoOpenUtrMapperSignal, bootstrap]);

  const handleOpenUtrCsvImport = (triggerFileDialog = true): void => {
    setUtrImportPanelOpen(true);
    setCsvExportScope('RECONCILIATION_STATUS');
    setUtrFeedback(null);
    if (!utrCsvText.trim() && bootstrap && bootstrap.payoutBatches.length > 0) {
      setUtrCsvText(generateSampleBankUtrCsv(bootstrap.payoutBatches));
    }
    if (triggerFileDialog && utrCsvInputRef.current) {
      utrCsvInputRef.current.value = '';
      utrCsvInputRef.current.click();
    }
  };

  const handleUtrCsvFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setUtrCsvText(content);
      setUtrSourceLabel(file.name);
      setUtrImportPanelOpen(true);
      setCsvExportScope('RECONCILIATION_STATUS');
      const preview = parseAndMapBankUtrCsv(
        content,
        bootstrap?.payoutBatches ?? []
      );
      const invalidOrUnmatched = preview.invalidUtrCount + preview.unmatchedCount;
      if (preview.readyCount === 0 && preview.rows.length > 0) {
        const newId = `IMP-FILE-${Date.now()}`;
        const invalidRows: UtrImportBreakdownItem[] = preview.rows
          .filter((r) => r.status !== 'READY_TO_RECONCILE')
          .map((r) => ({
            batchCode: r.matchedBatch?.batch_code ?? (r.rawBatchRef || 'UNMATCHED_REF'),
            batchId: r.matchedBatch?.batch_id ?? null,
            bankUtr: r.bankUtr || '—',
            status: r.status === 'UNMATCHED_BATCH' ? 'UNMATCHED_BATCH' : 'INVALID_UTR',
            reason: r.reason,
          }));
        setSessionImportHistory((prev) => [
          {
            importId: newId,
            timestampIso: new Date().toISOString(),
            actorName: 'Current Operator (CSV Upload)',
            sourceLabel: file.name,
            status: 'VALIDATION_WARN',
            batchesReconciledCount: 0,
            totalRowsParsed: preview.rows.length,
            invalidOrUnmatchedCount: invalidOrUnmatched,
            batchCodes: preview.rows
              .map((r) => r.matchedBatch?.batch_code ?? r.rawBatchRef)
              .filter(Boolean),
            bankUtrs: preview.rows.map((r) => r.bankUtr).filter(Boolean),
            mappedItems: [],
            invalidItems: invalidRows,
          },
          ...prev,
        ]);
        setExpandedHistoryId(newId);
      }
      setUtrFeedback({
        tone: preview.readyCount > 0 ? 'info' : 'warn',
        title: `Loaded ${file.name}`,
        msg: `Parsed ${preview.rows.length} CSV row(s): ${preview.readyCount} READY_TO_RECONCILE, ${preview.invalidUtrCount} INVALID_UTR, ${preview.unmatchedCount} UNMATCHED_BATCH.`,
      });
    } catch (err) {
      setUtrFeedback({
        tone: 'danger',
        title: 'CSV File Read Error',
        msg: err instanceof Error ? err.message : 'Could not read CSV file',
      });
    }
  };

  const handleBulkReconcileUtrCsv = async (): Promise<void> => {
    if (!token) return;
    const readyRows = parsedUtrCsv.rows.filter(
      (r) => r.status === 'READY_TO_RECONCILE' && r.matchedBatch
    );
    if (readyRows.length === 0) return;

    const invalidOrUnmatchedCount =
      parsedUtrCsv.invalidUtrCount + parsedUtrCsv.unmatchedCount;
    const invalidBreakdownItems: UtrImportBreakdownItem[] = parsedUtrCsv.rows
      .filter((r) => r.status !== 'READY_TO_RECONCILE')
      .map((r) => ({
        batchCode: r.matchedBatch?.batch_code ?? (r.rawBatchRef || 'UNMATCHED_REF'),
        batchId: r.matchedBatch?.batch_id ?? null,
        bankUtr: r.bankUtr || '—',
        status: r.status === 'UNMATCHED_BATCH' ? 'UNMATCHED_BATCH' : 'INVALID_UTR',
        reason: r.reason,
      }));

    setUtrReconciling(true);
    setUtrFeedback(null);
    try {
      const res = await apiRequest<{
        auditId?: string;
        timestampIso?: string;
        sourceLabel?: string;
        reconciledCount: number;
        reconciled: ReadonlyArray<{
          batchId: string;
          batchCode: string;
          status: string;
          bankUtr: string;
        }>;
      }>('/api/v1/payout-batches/bulk-reconcile', {
        method: 'POST',
        token,
        idempotencyKey: `IDEM-UTR-${Date.now()}`,
        body: {
          sourceLabel: utrSourceLabel,
          totalRowsParsed: parsedUtrCsv.rows.length,
          invalidOrUnmatchedCount,
          items: readyRows.map((r) => ({
            batchId: r.matchedBatch!.batch_id,
            bankUtr: r.bankUtr,
          })),
          invalidItems: invalidBreakdownItems,
        },
      });
      const recordedAuditId = res.auditId ?? `IMP-BULK-${Date.now()}`;
      const mappedBreakdownItems: UtrImportBreakdownItem[] = res.reconciled.map((b) => ({
        batchCode: b.batchCode,
        batchId: b.batchId,
        bankUtr: b.bankUtr,
        status: 'RECONCILED_UTR',
        reason: 'Successfully mapped and reconciled to nodal payout batch',
      }));
      setSessionImportHistory((prev) => [
        {
          importId: recordedAuditId,
          timestampIso: res.timestampIso ?? new Date().toISOString(),
          actorName: 'Deepa Krishnan (HMS Chief Accountant)',
          sourceLabel: res.sourceLabel ?? utrSourceLabel,
          status:
            invalidOrUnmatchedCount > 0 ? 'PARTIAL_RECONCILED' : 'RECONCILED',
          batchesReconciledCount: res.reconciledCount,
          totalRowsParsed: parsedUtrCsv.rows.length,
          invalidOrUnmatchedCount,
          batchCodes: res.reconciled.map((b) => b.batchCode),
          bankUtrs: res.reconciled.map((b) => b.bankUtr),
          mappedItems: mappedBreakdownItems,
          invalidItems: invalidBreakdownItems,
        },
        ...prev.filter((item) => item.importId !== recordedAuditId),
      ]);
      setExpandedHistoryId(recordedAuditId);
      await onRefresh();
      const codes = res.reconciled.map((b) => `${b.batchCode} → ${b.bankUtr}`).join(', ');
      setUtrFeedback({
        tone: 'ok',
        title: `Reconciled ${res.reconciledCount} Nodal Payout Batch(es)`,
        msg: `Updated ledger.payout_batches to RECONCILED_UTR in PostgreSQL: ${codes}`,
      });
    } catch (err) {
      setSessionImportHistory((prev) => [
        {
          importId: `IMP-ERR-${Date.now()}`,
          timestampIso: new Date().toISOString(),
          actorName: 'Current Operator',
          sourceLabel: utrSourceLabel,
          status: 'FAILED',
          batchesReconciledCount: 0,
          totalRowsParsed: parsedUtrCsv.rows.length,
          invalidOrUnmatchedCount: parsedUtrCsv.rows.length,
          batchCodes: readyRows.map((r) => r.matchedBatch!.batch_code),
          bankUtrs: readyRows.map((r) => r.bankUtr),
          mappedItems: [],
          invalidItems: parsedUtrCsv.rows.map((r) => ({
            batchCode: r.matchedBatch?.batch_code ?? (r.rawBatchRef || 'UNMATCHED_REF'),
            batchId: r.matchedBatch?.batch_id ?? null,
            bankUtr: r.bankUtr || '—',
            status: r.status === 'UNMATCHED_BATCH' ? 'UNMATCHED_BATCH' : 'INVALID_UTR',
            reason: r.reason,
          })),
        },
        ...prev,
      ]);
      setUtrFeedback({
        tone: 'danger',
        title: 'Bulk UTR Reconciliation Failed',
        msg: err instanceof Error ? err.message : 'Error reconciling payout batches',
      });
    } finally {
      setUtrReconciling(false);
    }
  };

  const handleDownloadCsv = (overrideScope?: LedgerCsvExportScope): void => {
    if (!bootstrap) return;
    const targetScope = overrideScope ?? csvExportScope;
    if (overrideScope) {
      setCsvExportScope(overrideScope);
    }
    const payload = formatLedgerInspectorCsv({
      scope: targetScope,
      entries: bootstrap.entries,
      journals: bootstrap.journals,
      payoutBatches: bootstrap.payoutBatches,
      mappedUtrRows: parsedUtrCsv.rows,
      transitions,
      expandedJournalId,
    });
    downloadTextFile(payload.filename, payload.content);
    setUtrFeedback({
      tone: 'ok',
      title: `Exported ${payload.label} CSV`,
      msg: `Downloaded ${payload.filename} (${payload.rowCount} formatted row${payload.rowCount === 1 ? '' : 's'}).`,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Statutory Ledger & Golden Vectors Inspector"
      subtitle="Real-time SHA-256 hash chain, Nodal Bank UTR CSV Reconciliation & Act 16 of 2021 verification"
      footer={
        <div className="w-full flex flex-wrap items-center justify-between gap-2">
          <div
            role="group"
            aria-label="CSV Export View Scope"
            className="inline-flex items-center p-0.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]"
          >
            {(
              [
                { id: 'LEDGER_ENTRIES', label: 'Entries' },
                { id: 'PAYOUT_BATCHES', label: 'Batches' },
                { id: 'RECONCILIATION_STATUS', label: 'UTR Status' },
              ] as const
            ).map((opt) => {
              const active = csvExportScope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCsvExportScope(opt.id)}
                  className={`px-2.5 py-1 rounded-[calc(var(--radius-control)-2px)] text-xs font-semibold whitespace-nowrap shrink-0 leading-none cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              icon={<FileUp className="w-4 h-4" />}
              disabled={!bootstrap}
              onClick={() => handleOpenUtrCsvImport(true)}
            >
              Import CSV
            </Button>
            <Button
              variant="secondary"
              icon={<FileDown className="w-4 h-4" />}
              disabled={!bootstrap}
              onClick={() => handleDownloadCsv()}
            >
              Download CSV
            </Button>
            <Button variant="primary" onClick={onClose}>
              Close Inspector
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <input
          ref={utrCsvInputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Upload Bank UTR CSV file"
          className="hidden"
          onChange={(e) => void handleUtrCsvFileChange(e)}
        />

        <div className="p-4 rounded-[var(--radius-card)] bg-[var(--brand-soft)] border border-[var(--navy-200)] flex items-start gap-3.5">
          <StatutoryLedgerWaterfallSvgDecor size={44} />
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase text-[var(--brand-soft-fg)]">
                SHA-256 Chain Status
              </span>
              <Badge
                tone={bootstrap?.ledgerVerification.verified ? 'ok' : 'danger'}
                label={bootstrap?.ledgerVerification.verified ? 'VERIFIED' : 'FAILED'}
              />
            </div>
            <div className="text-xs font-mono-code text-[var(--text-primary)] break-all">
              Head Hash: {bootstrap?.ledgerVerification.headHash ?? '—'}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              Verified Entries: {bootstrap?.ledgerVerification.entryCount ?? 0} (Last Seq #
              {bootstrap?.ledgerVerification.lastEntrySeq ?? '0'})
            </div>
          </div>
        </div>

        {utrFeedback && (
          <Toast
            tone={utrFeedback.tone}
            title={utrFeedback.title}
            message={utrFeedback.msg}
            onDismiss={() => setUtrFeedback(null)}
          />
        )}

        {bootstrap && (
          <div className="flex flex-col gap-4">
            {/* Nodal Bank UTR CSV Reconciliation Card */}
            <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]">
                    Nodal Bank Clearing · T+0 Settlement
                  </div>
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                    Payout Batch Bank UTR Reconciliation (`ledger.payout_batches`)
                  </h4>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<FileUp className="w-3.5 h-3.5" />}
                    onClick={() => handleOpenUtrCsvImport(true)}
                  >
                    Import CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<FileDown className="w-3.5 h-3.5" />}
                    onClick={() =>
                      handleDownloadCsv(
                        utrImportPanelOpen ? 'RECONCILIATION_STATUS' : 'PAYOUT_BATCHES'
                      )
                    }
                  >
                    Download CSV
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!utrCsvText.trim()) {
                        setUtrCsvText(generateSampleBankUtrCsv(bootstrap.payoutBatches));
                      }
                      setUtrImportPanelOpen((prev) => {
                        const next = !prev;
                        setCsvExportScope(
                          next ? 'RECONCILIATION_STATUS' : 'PAYOUT_BATCHES'
                        );
                        return next;
                      });
                    }}
                  >
                    {utrImportPanelOpen ? 'Hide Mapper' : 'Map UTR CSV'}
                  </Button>
                </div>
              </div>

              {utrImportPanelOpen && (
                <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-3 animate-utr-row-in">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      Bulk Upload or Paste Bank UTR CSV (`batch_code,bank_utr`)
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (utrCsvInputRef.current) {
                            utrCsvInputRef.current.value = '';
                            utrCsvInputRef.current.click();
                          }
                        }}
                      >
                        Choose .CSV File
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTransitions({});
                          setCsvExportScope('RECONCILIATION_STATUS');
                          setUtrSourceLabel('Simulated-Invalid-UTR.csv');
                          const invalidContent = generateInvalidSampleBankUtrCsv(
                            bootstrap.payoutBatches
                          );
                          setUtrCsvText(invalidContent);
                          const invalidPreview = parseAndMapBankUtrCsv(
                            invalidContent,
                            bootstrap.payoutBatches
                          );
                          const valImportId = `IMP-VAL-${Date.now()}`;
                          setSessionImportHistory((prev) => [
                            {
                              importId: valImportId,
                              timestampIso: new Date().toISOString(),
                              actorName: 'Current Operator (Validation Check)',
                              sourceLabel: 'Simulated-Invalid-UTR.csv',
                              status: 'VALIDATION_WARN',
                              batchesReconciledCount: 0,
                              totalRowsParsed: invalidPreview.rows.length,
                              invalidOrUnmatchedCount:
                                invalidPreview.invalidUtrCount +
                                invalidPreview.unmatchedCount,
                              batchCodes: invalidPreview.rows
                                .map((r) => r.matchedBatch?.batch_code ?? r.rawBatchRef)
                                .filter(Boolean),
                              bankUtrs: invalidPreview.rows
                                .map((r) => r.bankUtr)
                                .filter(Boolean),
                              mappedItems: [],
                              invalidItems: invalidPreview.rows.map((r) => ({
                                batchCode:
                                  r.matchedBatch?.batch_code ??
                                  (r.rawBatchRef || 'UNMATCHED_REF'),
                                batchId: r.matchedBatch?.batch_id ?? null,
                                bankUtr: r.bankUtr || '—',
                                status:
                                  r.status === 'UNMATCHED_BATCH'
                                    ? 'UNMATCHED_BATCH'
                                    : 'INVALID_UTR',
                                reason: r.reason,
                              })),
                            },
                            ...prev,
                          ]);
                          setExpandedHistoryId(valImportId);
                        }}
                      >
                        Simulate INVALID_UTR
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Sparkles className="w-3.5 h-3.5" />}
                        onClick={() => {
                          setCsvExportScope('RECONCILIATION_STATUS');
                          setUtrSourceLabel('Nodal-Bank-Verified-UTR.csv');
                          setUtrCsvText(generateSampleBankUtrCsv(bootstrap.payoutBatches));
                        }}
                      >
                        Fix to READY_TO_RECONCILE
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        icon={<FileDown className="w-3.5 h-3.5" />}
                        onClick={() => handleDownloadCsv('RECONCILIATION_STATUS')}
                      >
                        Download Status CSV
                      </Button>
                    </div>
                  </div>

                  <textarea
                    aria-label="Bank UTR CSV Input"
                    rows={3}
                    value={utrCsvText}
                    onChange={(e) => {
                      setCsvExportScope('RECONCILIATION_STATUS');
                      setUtrCsvText(e.target.value);
                    }}
                    placeholder={'batch_code,bank_utr\nMUN-PAY-20261106-01,HDFC000261106991'}
                    className="w-full p-2.5 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-xs font-mono-code text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={parsedUtrCsv.readyCount > 0 ? 'ok' : 'neutral'}
                        label={`${parsedUtrCsv.readyCount} READY_TO_RECONCILE`}
                      />
                      {parsedUtrCsv.invalidUtrCount > 0 && (
                        <Badge
                          tone="warn"
                          label={`${parsedUtrCsv.invalidUtrCount} INVALID_UTR`}
                        />
                      )}
                      {parsedUtrCsv.unmatchedCount > 0 && (
                        <Badge
                          tone="danger"
                          label={`${parsedUtrCsv.unmatchedCount} UNMATCHED_BATCH`}
                        />
                      )}
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={parsedUtrCsv.readyCount === 0 || utrReconciling}
                      onClick={() => void handleBulkReconcileUtrCsv()}
                    >
                      {utrReconciling
                        ? 'Reconciling...'
                        : `Reconcile ${parsedUtrCsv.readyCount} Matched Batch${parsedUtrCsv.readyCount === 1 ? '' : 'es'}`}
                    </Button>
                  </div>

                  {parsedUtrCsv.rows.length > 0 && (
                    <div
                      key={`utr-preview-${parseEpoch}`}
                      className="flex flex-col gap-2 max-h-56 overflow-y-auto"
                      aria-live="polite"
                    >
                      {parsedUtrCsv.rows.map((row, idx) => {
                        const rowTransition = transitions[row.rowKey];
                        const upgradedFromInvalid =
                          rowTransition?.from === 'INVALID_UTR' &&
                          row.status === 'READY_TO_RECONCILE';
                        return (
                          <div
                            key={`${row.rowKey}-${row.rowNumber}`}
                            style={{ animationDelay: `${idx * 45}ms` }}
                            className={`p-3 rounded-[var(--radius-control)] border text-xs flex flex-col gap-1.5 animate-utr-row-in transition-utr-pill ${
                              upgradedFromInvalid
                                ? 'bg-[var(--brand-soft)] border-[var(--brand)]'
                                : 'bg-[var(--bg-surface)] border-[var(--border-hair)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold font-mono-code text-[var(--text-primary)] truncate">
                                  {row.matchedBatch
                                    ? `${row.matchedBatch.batch_code} (${row.matchedBatch.batch_id})`
                                    : row.rawBatchRef || `Row #${row.rowNumber}`}
                                </div>
                                <div className="text-[11px] text-[var(--text-secondary)]">
                                  {row.matchedBatch
                                    ? `${formatInrFromPaise(row.matchedBatch.total_amount_paise)} · ${row.reason}`
                                    : row.reason}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono-code font-bold text-[var(--brand)]">
                                  {row.bankUtr || '—'}
                                </span>
                                <span
                                  key={`${row.rowKey}-${row.status}`}
                                  className="inline-flex animate-utr-status-flip transition-utr-pill"
                                >
                                  <Badge
                                    tone={
                                      row.status === 'READY_TO_RECONCILE'
                                        ? 'ok'
                                        : row.status === 'INVALID_UTR'
                                          ? 'warn'
                                          : 'danger'
                                    }
                                    label={row.status}
                                  />
                                </span>
                              </div>
                            </div>

                            {upgradedFromInvalid && (
                              <div className="pt-1.5 border-t border-[var(--navy-200)] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-code text-[var(--brand-soft-fg)] animate-utr-row-in">
                                <span className="inline-flex items-center gap-1.5 font-semibold whitespace-nowrap">
                                  <span>Transition:</span>
                                  <span className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--warning-bg)] text-[var(--warning)] whitespace-nowrap shrink-0 leading-none">
                                    INVALID_UTR
                                  </span>
                                  <ArrowRight className="w-3 h-3 shrink-0" />
                                  <span className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] whitespace-nowrap shrink-0 leading-none">
                                    READY_TO_RECONCILE
                                  </span>
                                </span>
                                <span className="whitespace-nowrap text-[var(--text-secondary)]">
                                  UTR Verified ({row.bankUtr.length} chars)
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                {bootstrap.payoutBatches.map((b) => (
                  <div
                    key={b.batch_id}
                    className="p-2.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] text-xs flex items-center justify-between gap-2 transition-utr-pill"
                  >
                    <div>
                      <div className="font-semibold font-mono-code text-[var(--text-primary)]">
                        {b.batch_code}{' '}
                        <span className="text-[var(--text-muted)] font-normal">
                          ({b.batch_id})
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] font-mono-code">
                        UTR: {b.bank_utr ?? 'Pending CSV Import'} · Amount:{' '}
                        {formatInrFromPaise(b.total_amount_paise)}
                      </div>
                    </div>
                    <Badge
                      tone={b.status === 'RECONCILED_UTR' ? 'ok' : 'warn'}
                      label={b.status}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Recent CSV Bulk Import History Table */}
            <UtrBulkHistoryTable
              importHistoryEntries={importHistoryEntries}
              filteredHistoryEntries={filteredHistoryEntries}
              totalHistoricalBatchesReconciled={totalHistoricalBatchesReconciled}
              historyFilter={historyFilter}
              onFilterChange={setHistoryFilter}
              expandedHistoryId={expandedHistoryId}
              onToggleExpand={(importId) =>
                setExpandedHistoryId((prev) => (prev === importId ? null : importId))
              }
            />

            {/* Charts, Double-Entry Journals, and §2 Golden Vectors */}
            <LedgerChartsAndJournals
              bootstrap={bootstrap}
              goldenVectorRows={goldenVectorRows}
              expandedJournalId={expandedJournalId}
              onToggleJournal={(journalId) => {
                setCsvExportScope('LEDGER_ENTRIES');
                setExpandedJournalId((prev) => (prev === journalId ? null : journalId));
              }}
              onOpenCsvImport={handleOpenUtrCsvImport}
              onDownloadCsv={handleDownloadCsv}
            />
          </div>
        )}
      </div>
    </Drawer>
  );
};
