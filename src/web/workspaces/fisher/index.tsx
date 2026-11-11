import React, { useState } from 'react';
import { Volume2, FileDown, CheckCircle2, Anchor } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  DataTable,
  Toast,
  FisherVesselPassbookIcon,
  StatutoryLedgerWaterfallSvgDecor,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  downloadTextFile,
  formatInrFromPaise,
  formatKgFromGrams,
  type BootstrapData,
  type AllocationRow,
} from '@web/lib/api.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';

export const FisherWorkspace: React.FC<{
  data: BootstrapData;
}> = ({ data }) => {
  const fisherman = data.fishermen[0];
  const vessel = data.vessels.find((v) => v.owner_fisherman_id === fisherman?.fisherman_id);
  const payableAccount = data.accounts.find(
    (a) => a.account_id === fisherman?.payable_account_id
  );
  const bonusEscrowAccount = data.accounts.find(
    (a) => a.account_id === fisherman?.bonus_escrow_account_id
  );

  const [speechNotice, setSpeechNotice] = useState<string | null>(null);

  const totalHammerPaise = data.allocations.reduce(
    (acc, a) => acc + BigInt(a.hammer_paise),
    0n
  );
  const totalNetPaise = data.allocations.reduce(
    (acc, a) => acc + BigInt(a.fisherman_net_paise),
    0n
  );
  const totalBonusPaise = data.allocations.reduce(
    (acc, a) => acc + BigInt(a.bonus_escrow_paise),
    0n
  );
  const totalCommissionPaise = totalHammerPaise - totalNetPaise;

  const handleListenMalayalam = (): void => {
    const mlSummary = `ഇന്നത്തെ ലേല തുക ${formatInrFromPaise(
      totalHammerPaise
    )}. അഞ്ച് ശതമാനം കമ്മീഷൻ കഴിഞ്ഞ് നിങ്ങളുടെ അക്കൗണ്ടിൽ ലഭിക്കുന്ന തുക ${formatInrFromPaise(
      totalNetPaise
    )}. വാർഷിക ബോണസ് എസ്ക്രോ ബാലൻസ് ${formatInrFromPaise(totalBonusPaise)}.`;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(mlSummary);
        utterance.lang = 'ml-IN';
        window.speechSynthesis.speak(utterance);
        setSpeechNotice(mlSummary);
        return;
      } catch {
        // Fallback to visible Malayalam text transcript per §10 Workspace 4
      }
    }
    setSpeechNotice(mlSummary);
  };

  const handleExportPassbookCsv = (): void => {
    const headers = [
      'Allocation ID',
      'Journal ID',
      'Boxes Sold',
      'Weight (Grams)',
      'Hammer Price (INR)',
      '5% Statutory Commission (INR)',
      '40% Fisher Bonus Escrow (INR)',
      'Net Fisherman Payout 95% (INR)',
      'Timestamp',
    ];
    const rows = data.allocations.map((a) => {
      const comm = BigInt(a.hammer_paise) - BigInt(a.fisherman_net_paise);
      return [
        a.allocation_id,
        a.journal_id,
        String(a.boxes_allocated),
        a.grams_allocated,
        formatInrFromPaise(a.hammer_paise),
        formatInrFromPaise(comm),
        formatInrFromPaise(a.bonus_escrow_paise),
        formatInrFromPaise(a.fisherman_net_paise),
        a.created_at,
      ].join(',');
    });
    downloadTextFile(
      `HarbourOS-Fisherman-Passbook-${fisherman?.fisherman_id ?? 'FSH-01'}.csv`,
      [headers.join(','), ...rows].join('\n')
    );
  };

  const columns: ReadonlyArray<DataTableColumn<AllocationRow>> = [
    {
      key: 'alloc',
      header: 'Sale Reference',
      mono: true,
      render: (r) => <span className="font-semibold">{r.allocation_id}</span>,
    },
    {
      key: 'weight',
      header: 'Boxes & Weight',
      align: 'right',
      mono: true,
      render: (r) => `${r.boxes_allocated} boxes (${formatKgFromGrams(r.grams_allocated)})`,
    },
    {
      key: 'hammer',
      header: 'Gross Hammer (100%)',
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.hammer_paise),
    },
    {
      key: 'bonus',
      header: 'Your 40% Bonus Escrow (2% GTV)',
      align: 'right',
      mono: true,
      render: (r) => (
        <span className="font-semibold text-[var(--brand)]">
          +{formatInrFromPaise(r.bonus_escrow_paise)}
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Net Payable (95%)',
      align: 'right',
      mono: true,
      render: (r) => (
        <span className="font-bold text-[var(--text-primary)]">
          {formatInrFromPaise(r.fisherman_net_paise)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="p-4 sm:p-5 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <StatutoryLedgerWaterfallSvgDecor size={40} />
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              Fisher Passbook
            </h1>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {fisherman?.full_name} · {vessel?.vessel_name_en} ({vessel?.registration_no})
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            icon={<Volume2 className="w-4 h-4" />}
            onClick={handleListenMalayalam}
          >
            കേൾക്കുക (Listen in Malayalam)
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<FileDown className="w-4 h-4" />}
            onClick={handleExportPassbookCsv}
          >
            Download Passbook CSV
          </Button>
        </div>
      </div>

      {speechNotice && (
        <Toast
          tone="info"
          title="മലയാളം ശബ്ദ വിവരണം (Malayalam Passbook Readout)"
          message={speechNotice}
          onDismiss={() => setSpeechNotice(null)}
        />
      )}

      {/* Passbook Top Balances */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <Metric
          label="Net Payout (95%)"
          value={formatInrFromPaise(payableAccount?.balance_paise ?? totalNetPaise)}
          status={{ tone: 'ok', label: 'SETTLED' }}
        />
        <Metric
          label="Bonus Escrow (40%)"
          value={formatInrFromPaise(bonusEscrowAccount?.balance_paise ?? totalBonusPaise)}
          status={{ tone: 'info', label: 'ESCROW' }}
        />
        <Metric
          label="Gross Hammer Value"
          value={formatInrFromPaise(totalHammerPaise)}
          status={{ tone: 'neutral', label: '100% GTV' }}
        />
      </div>

      {/* Transparent 5% Statutory Deduction Breakdown Card */}
      <Card title="Statutory 95/5 Split Breakdown">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="p-4 rounded-[var(--radius-card)] bg-[var(--brand-soft)] border border-[var(--navy-200)]">
            <div className="text-xs font-bold uppercase text-[var(--brand-soft-fg)]">
              1. Your Net Payout (95%)
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalNetPaise)}
            </div>
            <div className="text-xs text-[var(--text-secondary)] mt-1">
              Credited directly to vessel owner
            </div>
          </div>

          <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-xs font-bold uppercase text-[var(--text-secondary)]">
              2. Your Bonus Escrow (40% of 5%)
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--brand)] mt-1">
              {formatInrFromPaise(totalBonusPaise)}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">
              2.00% of GTV returned annually
            </div>
          </div>

          <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-xs font-bold uppercase text-[var(--text-secondary)]">
              3. Licensed Auctioneer (20% of 5%)
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalCommissionPaise / 5n)}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">1.00% of GTV (Act s.4(5))</div>
          </div>

          <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-xs font-bold uppercase text-[var(--text-secondary)]">
              4. Harbour Society HMS (20% of 5%)
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalCommissionPaise / 5n)}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">1.00% of GTV (Act s.4(5))</div>
          </div>

          <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-xs font-bold uppercase text-[var(--text-secondary)]">
              5. Primary Co-op Society (20% of 5%)
            </div>
            <div className="text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalCommissionPaise / 5n)}
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">1.00% of GTV (Act s.4(5))</div>
          </div>
        </div>
      </Card>

      {/* Today's Catch Sales Table */}
      <Card
        title="Itemized Catch Sales & Escrow Accruals"
        subtitle="Verified against the append-only harbour ledger"
        sunkenFooter={
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-[var(--brand)]" />
              <span>Protected under {ACT_16_2021_CITATIONS.UNAUTHORIZED_DEDUCTION_PROHIBITION}: Zero unauthorized deductions</span>
            </span>
            <span className="flex items-center gap-1 font-mono-code">
              <Anchor className="w-3.5 h-3.5" />
              <span>{vessel?.registration_no}</span>
            </span>
          </div>
        }
      >
        <DataTable
          caption="Fisherman Passbook Sales"
          columns={columns}
          rows={data.allocations}
          getRowKey={(r) => r.allocation_id}
        />
      </Card>
    </div>
  );
};
