import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { ChevronDown, ChevronUp, FileDown, FileUp } from 'lucide-react';
import { Badge, Button } from '@web/ui/index.tsx';
import {
  formatInrFromPaise,
  type BootstrapData,
  type LedgerCsvExportScope,
} from '@web/lib/api.ts';
import type { GoldenVectorRow } from '@web/app/components/LedgerInspectorDrawer.tsx';

export interface LedgerChartsAndJournalsProps {
  bootstrap: BootstrapData;
  goldenVectorRows: ReadonlyArray<GoldenVectorRow>;
  expandedJournalId: string | null;
  onToggleJournal: (journalId: string) => void;
  onOpenCsvImport: (triggerFileDialog?: boolean) => void;
  onDownloadCsv: (scope: LedgerCsvExportScope) => void;
}

export const LedgerChartsAndJournals: React.FC<LedgerChartsAndJournalsProps> = ({
  bootstrap,
  goldenVectorRows,
  expandedJournalId,
  onToggleJournal,
  onOpenCsvImport,
  onDownloadCsv,
}) => {
  return (
    <>
      {/* Recharts Volume Distribution BarChart */}
      <div>
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
          Journal Entry Volume Distribution (₹)
        </h4>
        <p className="text-xs text-[var(--text-secondary)] mb-2.5">
          Visualizes total settlement value per journal entry to spot large transactions quickly
        </p>
        <div className="h-52 w-full p-3 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bootstrap.journals.map((j) => ({
                journalCode: j.journal_id.replace('JRN-ALLOC-', ''),
                fullJournalId: j.journal_id,
                description: j.description,
                amountRupees: Number(BigInt(j.total_amount_paise)) / 100,
                formattedInr: formatInrFromPaise(j.total_amount_paise),
              }))}
              margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hair)" vertical={false} />
              <XAxis
                dataKey="journalCode"
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                axisLine={{ stroke: 'var(--border-strong)' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(val: number) => `₹${(val / 1000).toFixed(0)}k`}
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const item = payload[0]?.payload as
                    | {
                        fullJournalId: string;
                        description: string;
                        formattedInr: string;
                      }
                    | undefined;
                  if (!item) return null;
                  return (
                    <div className="p-3 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-xs flex flex-col gap-1 max-w-xs">
                      <div className="font-semibold text-[var(--text-primary)] tabular-nums">
                        {item.fullJournalId}
                      </div>
                      <div className="text-[var(--text-secondary)]">{item.description}</div>
                      <div className="font-bold text-[var(--brand)] tabular-nums pt-0.5">
                        Total Amount: {item.formattedInr}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="amountRupees"
                name="Total Amount (₹)"
                fill="var(--brand)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Double-Entry Journals with Interactive T-Account Entry Drilldown */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">
              Recent Double-Entry Journals (`ledger.journals`)
            </h4>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Click any journal to inspect its balanced SHA-256 debit/credit lines (`ledger.entries`)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<FileUp className="w-3.5 h-3.5" />}
              onClick={() => onOpenCsvImport(true)}
            >
              Import CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={<FileDown className="w-3.5 h-3.5" />}
              onClick={() => onDownloadCsv('LEDGER_ENTRIES')}
            >
              Download CSV
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {bootstrap.journals.map((j) => {
            const isExpanded = expandedJournalId === j.journal_id;
            const jEntries = bootstrap.entries.filter(
              (e) => e.journal_id === j.journal_id
            );
            return (
              <div
                key={j.journal_id}
                className="rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] overflow-hidden transition-utr-pill"
              >
                <button
                  type="button"
                  onClick={() => onToggleJournal(j.journal_id)}
                  className="w-full p-3 text-left text-xs flex items-center justify-between gap-2 hover:bg-[var(--bg-tint)] cursor-pointer transition-colors"
                >
                  <div>
                    <div className="font-semibold text-[var(--text-primary)] tabular-nums flex items-center gap-2">
                      <span>{j.journal_id}</span>
                      <span className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] text-[10px] font-mono-code text-[var(--text-secondary)] whitespace-nowrap shrink-0 leading-none">
                        {jEntries.length} lines
                      </span>
                    </div>
                    <div className="text-[var(--text-secondary)]">{j.description}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-bold text-[var(--text-primary)] tabular-nums">
                      {formatInrFromPaise(j.total_amount_paise)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-[var(--text-secondary)]" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="p-3 bg-[var(--bg-sunken)] border-t border-[var(--border-hair)] flex flex-col gap-1.5 animate-utr-row-in">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]">
                      T-Account Double-Entry Lines (Σ Debits = Σ Credits)
                    </div>
                    {jEntries.map((ent) => (
                      <div
                        key={ent.entry_seq}
                        className="p-2 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-[11px] font-mono-code flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--text-primary)]">
                            #{ent.entry_seq} · {ent.account_id}
                          </span>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">
                            SHA-256: {ent.row_hash.slice(0, 24)}…
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            tone={ent.direction === 'D' ? 'info' : 'ok'}
                            label={ent.direction === 'D' ? 'DEBIT' : 'CREDIT'}
                          />
                          <span className="font-bold text-[var(--text-primary)]">
                            {formatInrFromPaise(ent.amount_paise)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* §2 Golden Vectors */}
      <div>
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
          §2 Golden Vectors (₹1,00,000 Hammer = 10,000,000 Paise)
        </h4>
        <div className="flex flex-col gap-2.5">
          {goldenVectorRows.map((gv) => (
            <div
              key={gv.mode}
              className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] text-xs flex flex-col gap-1"
            >
              <div className="font-bold text-[var(--text-primary)] flex items-center justify-between">
                <span>{gv.mode}</span>
                <span className="font-mono-code">Payable: {gv.payable}</span>
              </div>
              <div className="text-[var(--text-secondary)] font-mono-code">
                Fisherman: {gv.fisherman} | Bonus: {gv.bonus}
              </div>
              <div className="text-[var(--text-muted)] font-mono-code">
                Auct: {gv.auctioneer} | HMS: {gv.hms} | Co-op: {gv.coop} | HOS: {gv.hos}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
