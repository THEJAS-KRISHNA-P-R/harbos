import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import type { WorkspaceExportFormat } from '@web/lib/workspace-export.ts';

export interface WorkspaceExportMenuProps {
  workspaceLabel: string;
  rowCount: number;
  disabled?: boolean | undefined;
  onExport: (format: WorkspaceExportFormat) => void;
}

export const WorkspaceExportMenu: React.FC<WorkspaceExportMenuProps> = ({
  workspaceLabel,
  rowCount,
  disabled = false,
  onExport,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const csvBtnRef = useRef<HTMLButtonElement>(null);
  const pdfBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const activeEl = document.activeElement;
        if (activeEl === csvBtnRef.current) {
          pdfBtnRef.current?.focus();
        } else {
          csvBtnRef.current?.focus();
        }
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelectFormat = (format: WorkspaceExportFormat): void => {
    setOpen(false);
    onExport(format);
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-testid="workspace-export-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Export ${workspaceLabel}`}
        title={`Export ${workspaceLabel} as CSV or PDF`}
        onClick={() => setOpen((prev) => !prev)}
        className={`h-8 sm:h-9 px-2.5 sm:px-3 rounded-[var(--radius-pill)] border inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? 'bg-[var(--brand-soft)] text-[var(--brand-soft-fg)] border-[var(--brand)]'
            : 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-strong)] hover:bg-[var(--bg-tint)]'
        }`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Export</span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Export format for ${workspaceLabel}`}
          data-testid="workspace-export-menu"
          className="absolute right-0 mt-2 w-64 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-strong)] shadow-[var(--shadow-overlay)] p-1.5 z-50 flex flex-col gap-1"
        >
          <div className="px-2.5 py-1.5 border-b border-[var(--border-hair)] flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)] truncate">
              {workspaceLabel}
            </span>
            <span className="text-[11px] font-mono-code text-[var(--text-secondary)] shrink-0">
              {rowCount} {rowCount === 1 ? 'row' : 'rows'}
            </span>
          </div>

          <button
            ref={csvBtnRef}
            type="button"
            role="menuitem"
            data-testid="export-option-csv"
            onClick={() => handleSelectFormat('csv')}
            className="w-full px-2.5 py-2 rounded-[var(--radius-control)] text-left flex items-start gap-2.5 hover:bg-[var(--brand-soft)] focus:bg-[var(--brand-soft)] focus:outline-none transition-colors cursor-pointer"
          >
            <span className="w-8 h-8 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] inline-flex items-center justify-center text-[var(--brand)] shrink-0 mt-0.5">
              <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[var(--text-primary)]">
                Download as CSV
              </span>
              <span className="block text-[11px] text-[var(--text-secondary)]">
                Spreadsheet table (.csv) · UTF-8
              </span>
            </span>
          </button>

          <button
            ref={pdfBtnRef}
            type="button"
            role="menuitem"
            data-testid="export-option-pdf"
            onClick={() => handleSelectFormat('pdf')}
            className="w-full px-2.5 py-2 rounded-[var(--radius-control)] text-left flex items-start gap-2.5 hover:bg-[var(--brand-soft)] focus:bg-[var(--brand-soft)] focus:outline-none transition-colors cursor-pointer"
          >
            <span className="w-8 h-8 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] inline-flex items-center justify-center text-[var(--brand)] shrink-0 mt-0.5">
              <FileText className="w-4 h-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[var(--text-primary)]">
                Download as PDF
              </span>
              <span className="block text-[11px] text-[var(--text-secondary)]">
                Formatted report (.pdf) · Landscape A4
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
