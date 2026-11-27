import React from 'react';
import { Archive, CheckCircle2, X } from 'lucide-react';

export interface BulkActionToolbarProps {
  selectedCount: number;
  totalCount: number;
  itemNounSingular: string;
  itemNounPlural: string;
  datasetLabel?: string | undefined;
  busy?: boolean | undefined;
  approveLabel?: string | undefined;
  archiveLabel?: string | undefined;
  onSelectAll?: (() => void) | undefined;
  onApproveSelected?: (() => void) | undefined;
  onArchiveSelected?: (() => void) | undefined;
  onClearSelection: () => void;
}

export const BulkActionToolbar: React.FC<BulkActionToolbarProps> = ({
  selectedCount,
  totalCount,
  itemNounSingular,
  itemNounPlural,
  datasetLabel,
  busy = false,
  approveLabel = 'Approve Selected',
  archiveLabel = 'Archive Selected',
  onSelectAll,
  onApproveSelected,
  onArchiveSelected,
  onClearSelection,
}) => {
  if (selectedCount <= 0) return null;

  const noun = selectedCount === 1 ? itemNounSingular : itemNounPlural;

  return (
    <div
      role="region"
      aria-label="Bulk actions toolbar"
      data-testid="bulk-action-toolbar"
      className="sticky top-[56px] sm:top-[62px] z-20 px-3.5 sm:px-4 py-2.5 rounded-[var(--radius-card)] bg-[var(--brand)] text-[var(--brand-fg)] border border-[var(--brand-hover)] shadow-[var(--shadow-overlay)] flex flex-wrap items-center justify-between gap-2.5 animate-utr-row-in no-print"
    >
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
        <span
          data-testid="bulk-selection-count"
          className="h-6 min-w-6 px-2 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] text-[var(--brand)] text-xs font-bold font-mono-code inline-flex items-center justify-center shrink-0"
        >
          {selectedCount}
        </span>
        <span className="text-xs sm:text-sm font-semibold tracking-tight truncate">
          {selectedCount} {noun} selected
        </span>
        {datasetLabel && (
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--brand-hover)] text-[var(--brand-fg)]/90 text-[11px] font-medium">
            {datasetLabel}
          </span>
        )}
        {onSelectAll && selectedCount < totalCount && (
          <button
            type="button"
            disabled={busy}
            data-testid="bulk-action-select-all"
            onClick={onSelectAll}
            className="text-xs font-semibold underline underline-offset-2 text-[var(--brand-fg)]/90 hover:text-[var(--brand-fg)] cursor-pointer disabled:opacity-50"
          >
            Select all {totalCount}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {onApproveSelected && (
          <button
            type="button"
            disabled={busy}
            data-testid="bulk-action-approve"
            onClick={onApproveSelected}
            className="h-8 sm:h-9 px-3 sm:px-3.5 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] text-[var(--brand)] hover:bg-[var(--brand-soft)] font-semibold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{busy ? 'Processing…' : approveLabel}</span>
          </button>
        )}

        {onArchiveSelected && (
          <button
            type="button"
            disabled={busy}
            data-testid="bulk-action-archive"
            onClick={onArchiveSelected}
            className="h-8 sm:h-9 px-3 sm:px-3.5 rounded-[var(--radius-pill)] bg-[var(--brand-hover)] text-[var(--brand-fg)] border border-[var(--brand-fg)]/25 hover:border-[var(--brand-fg)]/60 font-semibold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Archive className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{archiveLabel}</span>
          </button>
        )}

        <button
          type="button"
          disabled={busy}
          data-testid="bulk-action-clear"
          onClick={onClearSelection}
          aria-label="Clear selection"
          title="Clear selection"
          className="h-8 w-8 sm:h-9 sm:w-9 rounded-[var(--radius-pill)] text-[var(--brand-fg)]/85 hover:text-[var(--brand-fg)] hover:bg-[var(--brand-hover)] inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
