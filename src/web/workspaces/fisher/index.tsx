import React, { useState } from 'react';
import { Volume2, FileDown, CheckCircle2, Anchor, Printer } from 'lucide-react';
import {
  Button,
  Card,
  Metric,
  DataTable,
  Modal,
  Toast,
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
import { useI18n } from '@web/i18n/index.tsx';
import { DocksidePrintSlip } from '@web/shared/DocksidePrintSlip.tsx';

export const FisherWorkspace: React.FC<{
  data: BootstrapData;
}> = ({ data }) => {
  const { t } = useI18n();
  const fisherman = data.fishermen[0];
  const vessel = data.vessels.find((v) => v.owner_fisherman_id === fisherman?.fisherman_id);
  const payableAccount = data.accounts.find(
    (a) => a.account_id === fisherman?.payable_account_id
  );
  const bonusEscrowAccount = data.accounts.find(
    (a) => a.account_id === fisherman?.bonus_escrow_account_id
  );

  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);
  const [voucherFormat, setVoucherFormat] = useState<'80mm' | 'A4'>('80mm');
  const [isReprint, setIsReprint] = useState(false);

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
      } catch (err: unknown) {
        if (err instanceof Error) {
          setSpeechNotice(mlSummary);
        }
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
    <div className="flex flex-col gap-3.5 sm:gap-5">
      <div className="p-3 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col xl:flex-row xl:items-center justify-between gap-2.5 sm:gap-4">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="hidden sm:block shrink-0">
            <StatutoryLedgerWaterfallSvgDecor size={36} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              {t('workspaces.fisherTitle')}
            </h1>
            <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] truncate">
              {fisherman?.full_name} · {vessel?.vessel_name_en} ({vessel?.registration_no})
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            icon={<Volume2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            onClick={handleListenMalayalam}
          >
            കേൾക്കുക (Listen)
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            onClick={() => {
              setIsReprint(false);
              setVoucherModalOpen(true);
            }}
          >
            {t('actions.printSettlement')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<FileDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
            onClick={handleExportPassbookCsv}
          >
            Passbook CSV
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3.5">
        <div className="col-span-2 sm:col-span-1">
          <Metric
            featured
            label="Net Payout (95%)"
            value={formatInrFromPaise(payableAccount?.balance_paise ?? totalNetPaise)}
            status={{ tone: 'ok', label: 'SETTLED' }}
          />
        </div>
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
      <Card title={t('workspaces.fisherBreakdownTitle')}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-4">
          <div className="col-span-2 lg:col-span-1 p-3 sm:p-4 rounded-[var(--radius-card)] bg-[var(--brand-soft)] border border-[var(--navy-200)]">
            <div className="text-[11px] sm:text-xs font-bold uppercase text-[var(--brand-soft-fg)]">
              1. Your Net Payout (95%)
            </div>
            <div className="text-base sm:text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalNetPaise)}
            </div>
            <div className="text-[11px] sm:text-xs text-[var(--text-secondary)] mt-0.5 sm:mt-1">
              Credited directly to vessel owner
            </div>
          </div>

          <div className="p-3 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-[11px] sm:text-xs font-bold uppercase text-[var(--text-secondary)]">
              2. Bonus Escrow (40%)
            </div>
            <div className="text-base sm:text-xl font-bold font-mono-code text-[var(--brand)] mt-1">
              {formatInrFromPaise(totalBonusPaise)}
            </div>
            <div className="text-[11px] sm:text-xs text-[var(--text-muted)] mt-0.5 sm:mt-1">
              2.00% GTV annual return
            </div>
          </div>

          <div className="p-3 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-[11px] sm:text-xs font-bold uppercase text-[var(--text-secondary)]">
              3. Auctioneer (20%)
            </div>
            <div className="text-base sm:text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalCommissionPaise / 5n)}
            </div>
            <div className="text-[11px] sm:text-xs text-[var(--text-muted)] mt-0.5 sm:mt-1">1.00% GTV (Act s.4(5))</div>
          </div>

          <div className="p-3 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-[11px] sm:text-xs font-bold uppercase text-[var(--text-secondary)]">
              4. Harbour HMS (20%)
            </div>
            <div className="text-base sm:text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalCommissionPaise / 5n)}
            </div>
            <div className="text-[11px] sm:text-xs text-[var(--text-muted)] mt-0.5 sm:mt-1">1.00% GTV (Act s.4(5))</div>
          </div>

          <div className="p-3 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
            <div className="text-[11px] sm:text-xs font-bold uppercase text-[var(--text-secondary)]">
              5. Primary Co-op (20%)
            </div>
            <div className="text-base sm:text-xl font-bold font-mono-code text-[var(--text-primary)] mt-1">
              {formatInrFromPaise(totalCommissionPaise / 5n)}
            </div>
            <div className="text-[11px] sm:text-xs text-[var(--text-muted)] mt-0.5 sm:mt-1">1.00% GTV (Act s.4(5))</div>
          </div>
        </div>
      </Card>

      {/* Today's Catch Sales Table */}
      <Card
        title={t('workspaces.fisherSalesTitle')}
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

      <Modal
        open={voucherModalOpen}
        onClose={() => setVoucherModalOpen(false)}
        title={t('slips.settlementSlip')}
        description="Statutory 95% net proceeds & 40% annual bonus escrow settlement voucher"
        footer={
          <>
            <Button variant="outline" onClick={() => setVoucherModalOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              icon={<Printer className="w-4 h-4" />}
              onClick={() => window.print()}
            >
              {t('actions.printSlip')} ({voucherFormat})
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={voucherFormat === '80mm' ? 'primary' : 'outline'}
                onClick={() => setVoucherFormat('80mm')}
              >
                80mm
              </Button>
              <Button
                size="sm"
                variant={voucherFormat === 'A4' ? 'primary' : 'outline'}
                onClick={() => setVoucherFormat('A4')}
              >
                A4
              </Button>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={isReprint}
                onChange={(e) => setIsReprint(e.target.checked)}
              />
              <span>{t('actions.reprint')}</span>
            </label>
          </div>
          <DocksidePrintSlip
            slipType="FISHERMAN_SETTLEMENT_SLIP"
            printFormat={voucherFormat}
            isReprint={isReprint}
            harbourName={data.tenant?.name_en ?? 'Munambam Harbour (HMS)'}
            referenceNo={`SET-${fisherman?.fisherman_id ?? 'FSH-01'}-${data.allocations.length}`}
            timestampIso={new Date().toISOString()}
            items={[
              { label: t('dockside.fisherman'), value: fisherman?.full_name ?? 'Vessel Owner', highlight: true },
              { label: t('dockside.vessel'), value: `${vessel?.vessel_name_en ?? ''} (${vessel?.registration_no ?? ''})` },
              { label: 'Welfare ID', value: fisherman?.welfare_board_no ?? '—' },
              { label: 'Sales Count', value: `${data.allocations.length} allocations` },
            ]}
            summaryRows={[
              { label: 'Gross Hammer (100%)', value: formatInrFromPaise(totalHammerPaise) },
              { label: '5% Statutory Commission', value: `-${formatInrFromPaise(totalCommissionPaise)}` },
              { label: '40% Bonus Escrow (2% GTV)', value: `+${formatInrFromPaise(totalBonusPaise)}` },
              { label: 'Net Payable (95%)', value: formatInrFromPaise(totalNetPaise), bold: true },
            ]}
            qrPayload={`HARBOUROS|SETTLEMENT|${fisherman?.fisherman_id ?? 'FSH-01'}|${totalNetPaise.toString()}|${data.ledgerVerification.headHash.slice(0, 16)}`}
          />
        </div>
      </Modal>
    </div>
  );
};
