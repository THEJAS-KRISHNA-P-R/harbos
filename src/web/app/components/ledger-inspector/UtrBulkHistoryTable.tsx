import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, History, Search } from 'lucide-react';
import { Badge, Button } from '@web/ui/index.tsx';
import {
  countUtrImportHistoryByFilter,
  filterAuditLogsByActionOrTarget,
  type AuditLogRow,
  type UtrImportHistoryEntry,
  type UtrImportHistoryFilter,
} from '@web/lib/api.ts';

function formatUtcTimestampCompact(iso: string): string {
  const cleaned = iso.replace('T', ' ').replace('Z', '');
  return cleaned.length >= 19 ? cleaned.slice(0, 19) : cleaned;
}

export interface SqlLruCacheBadgeInfo {
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS';
  hits: number;
  misses: number;
  hitRatioPct: number;
  cachedAtIso: string;
}

export interface UtrBulkHistoryTableProps {
  auditLogs?: ReadonlyArray<AuditLogRow>;
  importHistoryEntries: ReadonlyArray<UtrImportHistoryEntry>;
  filteredHistoryEntries: ReadonlyArray<UtrImportHistoryEntry>;
  totalHistoricalBatchesReconciled: number;
  historyFilter: UtrImportHistoryFilter;
  onFilterChange: (filter: UtrImportHistoryFilter) => void;
  expandedHistoryId: string | null;
  onToggleExpand: (importId: string) => void;
  lruCacheInfo?: SqlLruCacheBadgeInfo | null;
}

export const UtrBulkHistoryTable: React.FC<UtrBulkHistoryTableProps> = ({
  auditLogs = [],
  importHistoryEntries,
  filteredHistoryEntries,
  totalHistoricalBatchesReconciled,
  historyFilter,
  onFilterChange,
  expandedHistoryId,
  onToggleExpand,
  lruCacheInfo = null,
}) => {
  const [auditFilterText, setAuditFilterText] = useState('');
  const counts = countUtrImportHistoryByFilter(importHistoryEntries);

  const filteredAuditLogs = useMemo(
    () => filterAuditLogsByActionOrTarget(auditLogs, auditFilterText),
    [auditLogs, auditFilterText]
  );

  const filterTabs: ReadonlyArray<{
    id: UtrImportHistoryFilter;
    label: string;
  }> = [
    { id: 'ALL', label: `All (${counts.all})` },
    {
      id: 'SUCCESSFULLY_MAPPED',
      label: `Successfully Mapped (${counts.successfullyMapped})`,
    },
    { id: 'INVALID', label: `Invalid (${counts.invalid})` },
  ];

  return (
    <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--brand)] flex flex-wrap items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            <span>Reconciliation History</span>
            {historyFilter === 'ALL' && lruCacheInfo && (
              <span data-testid="all-imports-lru-cache-badge" className="inline-flex">
                <Badge
                  tone={lruCacheInfo.cacheStatus === 'HIT' ? 'ok' : 'info'}
                  label={`SQL LRU ${lruCacheInfo.cacheStatus} · ${lruCacheInfo.hits} HITS`}
                />
              </span>
            )}
          </div>
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">
            Recent CSV Bulk Import History ({totalHistoricalBatchesReconciled} batches)
          </h4>
        </div>

        <div
          role="group"
          aria-label="Filter CSV Import History"
          className="inline-flex flex-wrap items-center p-0.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]"
        >
          {filterTabs.map((tab) => {
            const active =
              historyFilter === tab.id ||
              (tab.id === 'SUCCESSFULLY_MAPPED' && historyFilter === 'RECONCILED') ||
              (tab.id === 'INVALID' && historyFilter === 'ISSUES');
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange(tab.id)}
                className={`px-2.5 py-1 rounded-[calc(var(--radius-control)-2px)] text-xs font-semibold whitespace-nowrap shrink-0 leading-none cursor-pointer transition-colors ${
                  active
                    ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {filteredHistoryEntries.length === 0 ? (
        <div className="p-4 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] text-xs text-[var(--text-secondary)] flex items-center justify-between gap-2">
          <span>No CSV bulk import records match the selected filter.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onFilterChange('ALL')}
          >
            Show All Imports
          </Button>
        </div>
      ) : (
        <div className="rounded-[var(--radius-control)] border border-[var(--border-hair)] overflow-hidden">
          <table
            aria-label="Recent CSV Bulk Import History"
            className="w-full table-fixed border-collapse text-left text-xs"
          >
            <thead>
              <tr className="bg-[var(--bg-sunken)] border-b border-[var(--border-hair)]">
                <th className="w-[44%] px-2.5 py-2 font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Timestamp & CSV Source
                </th>
                <th className="w-[26%] px-2.5 py-2 font-semibold uppercase tracking-wider text-[var(--text-secondary)] text-right">
                  Batches Reconciled
                </th>
                <th className="w-[30%] px-2.5 py-2 font-semibold uppercase tracking-wider text-[var(--text-secondary)] text-right">
                  Status & Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hair)] bg-[var(--bg-surface)]">
              {filteredHistoryEntries.map((entry) => {
                const isExpanded = expandedHistoryId === entry.importId;
                return (
                  <React.Fragment key={entry.importId}>
                    <tr
                      className={`hover:bg-[var(--bg-tint)] transition-colors animate-utr-row-in ${
                        isExpanded ? 'bg-[var(--bg-tint)]' : ''
                      }`}
                    >
                      <td className="px-2.5 py-2.5 align-top min-w-0">
                        <div className="font-mono-code tabular-nums font-semibold text-[var(--text-primary)] truncate">
                          {formatUtcTimestampCompact(entry.timestampIso)}
                        </div>
                        <div
                          className="font-semibold text-[var(--brand)] font-mono-code truncate"
                          title={entry.sourceLabel}
                        >
                          {entry.sourceLabel}
                        </div>
                        <div
                          className="text-[11px] text-[var(--text-secondary)] truncate"
                          title={`${entry.actorName}${
                            entry.bankUtrs.length > 0
                              ? ` · UTR: ${entry.bankUtrs.join(', ')}`
                              : ''
                          }`}
                        >
                          {entry.bankUtrs.length > 0
                            ? `UTR: ${entry.bankUtrs.join(', ')}`
                            : entry.actorName}
                        </div>
                      </td>
                      <td className="px-2.5 py-2.5 align-top text-right font-mono-code tabular-nums min-w-0">
                        <div className="font-bold text-[var(--text-primary)] whitespace-nowrap">
                          {entry.batchesReconciledCount} / {entry.totalRowsParsed}{' '}
                          {entry.totalRowsParsed === 1 ? 'batch' : 'batches'}
                        </div>
                        <div
                          className="text-[11px] text-[var(--text-secondary)] truncate"
                          title={entry.batchCodes.join(', ')}
                        >
                          {entry.invalidItems.length > 0
                            ? `${entry.mappedItems.length} mapped · ${entry.invalidItems.length} invalid`
                            : entry.batchCodes.length > 0
                              ? entry.batchCodes.join(', ')
                              : '0 matched'}
                        </div>
                      </td>
                      <td className="px-2.5 py-2.5 align-top text-right whitespace-nowrap">
                        <div className="flex flex-col items-end gap-1.5">
                          <Badge
                            tone={
                              entry.status === 'RECONCILED'
                                ? 'ok'
                                : entry.status === 'PARTIAL_RECONCILED'
                                  ? 'info'
                                  : entry.status === 'VALIDATION_WARN'
                                    ? 'warn'
                                    : 'danger'
                            }
                            label={
                              entry.status === 'PARTIAL_RECONCILED'
                                ? 'PARTIAL'
                                : entry.status === 'VALIDATION_WARN'
                                  ? 'INVALID_UTR'
                                  : entry.status
                            }
                          />
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${
                              isExpanded ? 'Hide details' : 'View details'
                            } for ${entry.sourceLabel}`}
                            onClick={() => onToggleExpand(entry.importId)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-control)] border border-[var(--border-hair)] bg-[var(--bg-sunken)] hover:bg-[var(--brand-soft)] text-[11px] font-semibold text-[var(--brand)] whitespace-nowrap shrink-0 leading-none cursor-pointer transition-colors"
                          >
                            <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-[var(--bg-sunken)] animate-utr-row-in">
                        <td colSpan={3} className="p-3">
                          <div
                            role="region"
                            aria-label={`UTR Breakdown for ${entry.sourceLabel}`}
                            className="flex flex-col gap-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-[var(--border-hair)]">
                              <div>
                                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]">
                                  UTR Reconciliation Breakdown · {entry.sourceLabel}
                                </span>
                                <div className="text-[11px] text-[var(--text-secondary)]">
                                  Operator: {entry.actorName} · Audit ID:{' '}
                                  <span className="font-mono-code">
                                    {entry.importId}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  tone="ok"
                                  label={`${entry.mappedItems.length} MAPPED`}
                                />
                                <Badge
                                  tone={
                                    entry.invalidItems.length > 0 ? 'warn' : 'neutral'
                                  }
                                  label={`${entry.invalidItems.length} INVALID`}
                                />
                              </div>
                            </div>

                            {/* Successfully Mapped UTRs Section */}
                            <div className="flex flex-col gap-1.5">
                              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center justify-between">
                                <span>
                                  Successfully Mapped UTRs ({entry.mappedItems.length})
                                </span>
                              </div>
                              {entry.mappedItems.length === 0 ? (
                                <div className="p-2 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-[11px] text-[var(--text-secondary)]">
                                  0 UTRs were mapped in this import run because all rows failed validation.
                                </div>
                              ) : (
                                <div className="flex flex-col gap-1.5">
                                  {entry.mappedItems.map((item, idx) => (
                                    <div
                                      key={`mapped-${entry.importId}-${item.batchCode}-${idx}`}
                                      className="p-2 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex items-start justify-between gap-2"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="font-mono-code font-semibold text-xs text-[var(--text-primary)] break-words">
                                          {item.batchCode}{' '}
                                          <span className="text-[var(--brand)]">
                                            → UTR: {item.bankUtr}
                                          </span>
                                        </div>
                                        <div className="text-[11px] text-[var(--text-secondary)]">
                                          {item.reason}
                                        </div>
                                      </div>
                                      <Badge tone="ok" label={item.status} />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Invalid / Unmatched UTRs Section */}
                            <div className="flex flex-col gap-1.5">
                              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center justify-between">
                                <span>
                                  Invalid / Unmatched UTRs ({entry.invalidItems.length})
                                </span>
                              </div>
                              {entry.invalidItems.length === 0 ? (
                                <div className="p-2 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-[11px] text-[var(--text-secondary)]">
                                  0 invalid UTRs — all rows in this CSV import passed nodal clearing validation.
                                </div>
                              ) : (
                                <div className="flex flex-col gap-1.5">
                                  {entry.invalidItems.map((item, idx) => (
                                    <div
                                      key={`invalid-${entry.importId}-${item.batchCode}-${idx}`}
                                      className="p-2 rounded-[var(--radius-control)] bg-[var(--status-warn-bg)] border border-[var(--amber-500)] flex items-start justify-between gap-2"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="font-mono-code font-semibold text-xs text-[var(--text-primary)] break-words">
                                          {item.batchCode}{' '}
                                          <span className="text-[var(--status-warn-fg)]">
                                            → UTR: {item.bankUtr}
                                          </span>
                                        </div>
                                        <div className="text-[11px] text-[var(--status-warn-fg)]">
                                          {item.reason}
                                        </div>
                                      </div>
                                      <Badge
                                        tone={
                                          item.status === 'UNMATCHED_BATCH'
                                            ? 'danger'
                                            : 'warn'
                                        }
                                        label={item.status}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Real-Time Audit Log Filter by action_code or target_id */}
      <div className="pt-3 border-t border-[var(--border-hair)] flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              Real-Time Audit Log Filter (`action_code` / `target_id`)
            </h5>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Showing {filteredAuditLogs.length} of {auditLogs.length} statutory audit log entries
            </p>
          </div>
          {auditFilterText.trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAuditFilterText('')}
            >
              Clear Filter
            </Button>
          )}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={auditFilterText}
            onChange={(e) => setAuditFilterText(e.target.value)}
            aria-label="Filter audit logs by action_code or target_id"
            placeholder="Filter audit logs by action_code or target_id (e.g. PAYOUT_BATCH, LOT-2026)…"
            className="w-full pl-8 pr-3 py-1.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-xs font-mono-code text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </div>

        <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-0.5">
          {filteredAuditLogs.length === 0 ? (
            <div className="p-2.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] text-xs text-[var(--text-secondary)]">
              No audit log entries match &ldquo;{auditFilterText}&rdquo;.
            </div>
          ) : (
            filteredAuditLogs.slice(0, 8).map((log) => (
              <div
                key={log.audit_id}
                className="p-2 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono-code font-semibold text-[var(--text-primary)] truncate">
                    {log.action_code}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] font-mono-code truncate">
                    Target: {log.target_id} ({log.target_type}) ·{' '}
                    {formatUtcTimestampCompact(log.created_at)}
                  </div>
                </div>
                <Badge tone="info" label={log.actor_role} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
