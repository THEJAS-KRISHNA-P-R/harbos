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
    <div className="flex flex-col gap-6">
      <div className="p-5 sm:p-6 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-4 min-w-0">
          <StatutoryLedgerWaterfallSvgDecor size={52} />
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--brand)] mb-1">
              <FisherVesselPassbookIcon size={15} />
              <span>Act 16 s.4(4) & s.4(5)(a) · 95% Net Payout + 40% Bonus Escrow</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Fisherman Passbook & Statutory Deduction Card
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
              {fisherman?.full_name} · Vessel: {vessel?.vessel_name_en} ({vessel?.registration_no}) ·
              Welfare Board: {fisherman?.welfare_board_no}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <Button
            variant="primary"
            size="md"
            icon={<Volume2 className="w-4 h-4" />}
            onClick={handleListenMalayalam}
          >
            കേൾക്കുക (Listen in Malayalam)
          </Button>
          <Button
            variant="outline"
            size="md"
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric
          label="Net Settlement Payable (95%)"
          value={formatInrFromPaise(payableAccount?.balance_paise ?? totalNetPaise)}
          sublabel="Direct T+0 credit to registered bank account"
          status={{ tone: 'ok', label: 'SETTLED' }}
        />
        <Metric
          label="Annual Production Bonus Escrow"
          value={formatInrFromPaise(bonusEscrowAccount?.balance_paise ?? totalBonusPaise)}
          sublabel="40% of 5% commission held in statutory escrow (s.4(5)(a))"
          status={{ tone: 'info', label: 'ESCROW ACCRUED' }}
        />
        <Metric
          label="Gross Hammer Value"
          value={formatInrFromPaise(totalHammerPaise)}
          sublabel="Total catch auctioned across all lots"
          status={{ tone: 'neutral', label: '100% GTV' }}
        />
      </div>

      {/* Transparent 5% Statutory Deduction Breakdown Card (§10 Workspace 4) */}
      <Card
        title="Transparent Act 16 of 2021 Deduction Breakdown (Section 4(4) & 4(5)(a))"
        subtitle="Zero hidden deductions: 95% paid immediately + 2% (40% of commission) accrued in your personal Annual Bonus Escrow"
      >
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
              <span>Protected under Act 16 of 2021 s.4(6): Zero unauthorized deductions</span>
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
