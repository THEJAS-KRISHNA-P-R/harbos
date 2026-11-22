import React, { useState } from 'react';
import { FileDown, FileCheck2, Scale } from 'lucide-react';
import { Button, Card, Badge, Select, Toast } from '@web/ui/index.tsx';
import { apiRequest, downloadTextFile, type BootstrapData } from '@web/lib/api.ts';
import { useI18n } from '@web/i18n/index.tsx';

type ReportType =
  | 'daily-auction'
  | 'fisherman-statement'
  | 'statutory-apportionment'
  | 'buyer-ledger'
  | 'payout-reconciliation';

interface StatutoryReportPayload {
  reportType: string;
  generatedAt: string;
  statutoryCitation: string;
  summary: Record<string, unknown>;
  headers: ReadonlyArray<string>;
  rows: ReadonlyArray<Record<string, unknown>>;
}

interface ShadowDiffPayload {
  zeroPaiseDivergence: boolean;
  totalCompared: number;
  totalDivergentRows: number;
  diffs: ReadonlyArray<{
    lotCode: string;
    matched: boolean;
    paperHammerPaise: string;
    systemHammerPaise: string;
    hammerDeltaPaise: string;
    paperFishermanNetPaise: string;
    systemFishermanNetPaise: string;
    fishermanNetDeltaPaise: string;
    paperCommissionPaise: string;
    systemCommissionPaise: string;
    commissionDeltaPaise: string;
  }>;
}

function buildBaselineShadowCsv(data: BootstrapData): string {
  const byLot = new Map<string, { hammer: bigint; net: bigint; comm: bigint }>();
  for (const a of data.allocations) {
    const lot = data.lots.find((l) => l.lot_id === a.lot_id);
    const code = (lot?.lot_code ?? a.lot_id).toUpperCase();
    const cur = byLot.get(code) ?? { hammer: 0n, net: 0n, comm: 0n };
    const h = BigInt(a.hammer_paise);
    const fn = BigInt(a.fisherman_net_paise);
    byLot.set(code, {
      hammer: cur.hammer + h,
      net: cur.net + fn,
      comm: cur.comm + (h - fn),
    });
  }
  const lines = ['lotCode,hammerPaise,fishermanNetPaise,commissionPaise'];
  for (const [lotCode, v] of byLot.entries()) {
    lines.push(`${lotCode},${v.hammer.toString()},${v.net.toString()},${v.comm.toString()}`);
  }
  return lines.join('\n');
}

export const ReportsShadowPanel: React.FC<{
  data: BootstrapData;
  token: string;
}> = ({ data, token }) => {
  const { t } = useI18n();
  const [reportType, setReportType] = useState<ReportType>('statutory-apportionment');
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportData, setReportData] = useState<StatutoryReportPayload | null>(null);
  const [shadowCsv, setShadowCsv] = useState<string>(() => buildBaselineShadowCsv(data));
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffResult, setDiffResult] = useState<ShadowDiffPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLoadReport = async (): Promise<void> => {
    setLoadingReport(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<StatutoryReportPayload>(`/api/v1/reports/${reportType}`, {
        method: 'GET',
        token,
      });
      setReportData(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load statutory report');
    } finally {
      setLoadingReport(false);
    }
  };

  const handleDownloadReportCsv = async (): Promise<void> => {
    setLoadingReport(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/v1/reports/${reportType}?format=csv`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`CSV export failed (${res.status})`);
      }
      const text = await res.text();
      downloadTextFile(
        `HarbourOS-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`,
        text
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to download CSV');
    } finally {
      setLoadingReport(false);
    }
  };

  const handleRunShadowDiff = async (): Promise<void> => {
    setLoadingDiff(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<ShadowDiffPayload>('/api/v1/reports/shadow-diff', {
        method: 'POST',
        token,
        body: { csvText: shadowCsv },
      });
      setDiffResult(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Shadow-pilot diff failed');
    } finally {
      setLoadingDiff(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="reports-shadow-panel">
      {errorMsg && (
        <Toast
          tone="danger"
          title="Reporting Error"
          message={errorMsg}
          onDismiss={() => setErrorMsg(null)}
        />
      )}

      <Card
        title="5 Statutory Harbour Reports (JSON Preview + RFC 4180 CSV)"
        subtitle="Direct ledger-reconciled queries against live PostgreSQL tables under Kerala Act 16 of 2021"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[260px] flex-1 max-w-md">
              <Select
                label="Statutory Report"
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
                options={[
                  { value: 'daily-auction', label: '1. Daily Auction Register (daily-auction)' },
                  { value: 'fisherman-statement', label: '2. Fisherman Statement (fisherman-statement)' },
                  { value: 'statutory-apportionment', label: '3. Statutory 95/5 Apportionment (statutory-apportionment)' },
                  { value: 'buyer-ledger', label: '4. Buyer Clearing Ledger (buyer-ledger)' },
                  { value: 'payout-reconciliation', label: '5. Payout UTR Reconciliation (payout-reconciliation)' },
                ]}
              />
            </div>
            <Button
              variant="primary"
              loading={loadingReport}
              icon={<FileCheck2 className="w-4 h-4" />}
              onClick={() => void handleLoadReport()}
            >
              Load Live Report
            </Button>
            <Button
              variant="secondary"
              loading={loadingReport}
              icon={<FileDown className="w-4 h-4" />}
              onClick={() => void handleDownloadReportCsv()}
            >
              {t('actions.downloadCsv')}
            </Button>
          </div>

          {reportData && (
            <div
              data-testid="statutory-report-preview"
              className="flex flex-col gap-3 p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[var(--text-primary)]">
                  {reportData.reportType} · {reportData.statutoryCitation}
                </div>
                <Badge tone="ok" label={`${reportData.rows.length} ROWS`} />
              </div>

              <div className="md:hidden divide-y divide-[var(--border-hair)] rounded-[var(--radius-control)] border border-[var(--border-hair)] bg-[var(--bg-surface)] overflow-hidden">
                {reportData.rows.slice(0, 15).map((row, idx) => (
                  <div key={idx} className="p-2.5 flex flex-col gap-1">
                    {reportData.headers.map((h) => (
                      <div key={h} className="flex items-baseline justify-between gap-2 text-xs min-w-0">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] shrink-0">
                          {h}
                        </span>
                        <span className="font-mono-code text-right text-[var(--text-primary)] break-words min-w-0">
                          {String(row[h] ?? '')}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-strong)] text-left text-[var(--text-secondary)]">
                      {reportData.headers.map((h) => (
                        <th key={h} className="py-1.5 pr-3 font-mono-code font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.rows.slice(0, 15).map((row, idx) => (
                      <tr key={idx} className="border-b border-[var(--border-hair)]">
                        {reportData.headers.map((h) => (
                          <td key={h} className="py-1.5 pr-3 font-mono-code text-[var(--text-primary)]">
                            {String(row[h] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Shadow-Pilot Paper Register Diff (0-Paise Parity Gate)"
        subtitle="Compare paper auction slip totals (paise) against HarbourOS double-entry ledger totals per lot"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShadowCsv(buildBaselineShadowCsv(data));
              setDiffResult(null);
            }}
          >
            Prefill From Live Lots
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="shadow-diff-csv-input"
              className="text-xs font-semibold text-[var(--text-secondary)]"
            >
              Paper Register CSV (lotCode,hammerPaise,fishermanNetPaise,commissionPaise)
            </label>
            <textarea
              id="shadow-diff-csv-input"
              rows={4}
              value={shadowCsv}
              onChange={(e) => setShadowCsv(e.target.value)}
              className="w-full p-3 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-xs font-mono-code text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
            />
          </div>

          <div>
            <Button
              variant="primary"
              loading={loadingDiff}
              icon={<Scale className="w-4 h-4" />}
              onClick={() => void handleRunShadowDiff()}
            >
              {t('actions.runShadowDiff')}
            </Button>
          </div>

          {diffResult && (
            <div
              data-testid="shadow-diff-result"
              className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Compared {diffResult.totalCompared} lots · {diffResult.totalDivergentRows} divergent
                </span>
                <Badge
                  tone={diffResult.zeroPaiseDivergence ? 'ok' : 'danger'}
                  label={
                    diffResult.zeroPaiseDivergence
                      ? 'ZERO-PAISE PARITY'
                      : `${diffResult.totalDivergentRows} DIVERGENT`
                  }
                />
              </div>

              <div className="md:hidden divide-y divide-[var(--border-hair)] rounded-[var(--radius-control)] border border-[var(--border-hair)] bg-[var(--bg-surface)] overflow-hidden">
                {diffResult.diffs.map((d) => (
                  <div key={d.lotCode} className="p-2.5 flex flex-col gap-1.5 text-xs font-mono-code">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--text-primary)] truncate">{d.lotCode}</span>
                      <Badge tone={d.matched ? 'ok' : 'danger'} label={d.matched ? 'EXACT' : 'DIFF'} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[var(--border-hair)] text-[11px]">
                      <div>
                        <span className="block text-[10px] text-[var(--text-muted)]">Hammer Δ</span>
                        <span>{d.hammerDeltaPaise} p</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-[var(--text-muted)]">Net Δ</span>
                        <span>{d.fishermanNetDeltaPaise} p</span>
                      </div>
                      <div className="text-right">
                        <span className="block text-[10px] text-[var(--text-muted)]">Comm Δ</span>
                        <span>{d.commissionDeltaPaise} p</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-xs border-collapse font-mono-code">
                  <thead>
                    <tr className="border-b border-[var(--border-strong)] text-left text-[var(--text-secondary)]">
                      <th className="py-1.5 pr-3">Lot Code</th>
                      <th className="py-1.5 pr-3">Status</th>
                      <th className="py-1.5 pr-3">Hammer Δ</th>
                      <th className="py-1.5 pr-3">Net Δ</th>
                      <th className="py-1.5 pr-3">Comm Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffResult.diffs.map((d) => (
                      <tr key={d.lotCode} className="border-b border-[var(--border-hair)]">
                        <td className="py-1.5 pr-3 font-semibold">{d.lotCode}</td>
                        <td className="py-1.5 pr-3">
                          <Badge tone={d.matched ? 'ok' : 'danger'} label={d.matched ? 'EXACT' : 'DIFF'} />
                        </td>
                        <td className="py-1.5 pr-3">{d.hammerDeltaPaise} p</td>
                        <td className="py-1.5 pr-3">{d.fishermanNetDeltaPaise} p</td>
                        <td className="py-1.5 pr-3">{d.commissionDeltaPaise} p</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
