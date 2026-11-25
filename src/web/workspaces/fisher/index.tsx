import React, { useState } from 'react';
import { Volume2, FileDown, CheckCircle2, Anchor, Printer } from 'lucide-react';
import {
  Button,
  Card,
  DataTable,
  Modal,
  Toast,
  SkeletonList,
  WorkspaceSkeleton,
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
  loading?: boolean;
  refreshing?: boolean;
}> = ({ data, loading = false, refreshing = false }) => {
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

  const handleListenSummary = (): void => {
    const summary = `Total catch sale value ${formatInrFromPaise(
      totalHammerPaise
    )}. After 5 percent statutory commission, your net payout is ${formatInrFromPaise(
      totalNetPaise
    )}. Annual bonus escrow balance is ${formatInrFromPaise(totalBonusPaise)}.`;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(summary);
        utterance.lang = 'en-IN';
        window.speechSynthesis.speak(utterance);
        setSpeechNotice(summary);
        return;
      } catch (err: unknown) {
        if (err instanceof Error) {
          setSpeechNotice(summary);
        }
      }
    }
    setSpeechNotice(summary);
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
      header: t('fisher.saleRefHeader'),
      mono: true,
      render: (r) => <span className="font-semibold">{r.allocation_id}</span>,
    },
    {
      key: 'weight',
      header: t('fisher.boxesWeightHeader'),
      align: 'right',
      mono: true,
      render: (r) => `${r.boxes_allocated} boxes (${formatKgFromGrams(r.grams_allocated)})`,
    },
    {
      key: 'hammer',
      header: t('fisher.grossHammerHeader'),
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.hammer_paise),
    },
    {
      key: 'bonus',
      header: t('fisher.bonusEscrowHeader'),
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
      header: t('fisher.netPayableHeader'),
      align: 'right',
      mono: true,
      render: (r) => (
        <span className="font-bold text-[var(--text-primary)]">
          {formatInrFromPaise(r.fisherman_net_paise)}
        </span>
      ),
    },
  ];

  if (loading) {
    return <WorkspaceSkeleton workspace="fisher" label={t('workspaces.loadingWorkspace')} />;
  }

  return (
    <div className="flex flex-col gap-3.5 sm:gap-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
            {t('workspaces.fisherTitle')}
          </h1>
          <p className="text-xs text-[var(--text-muted)] truncate">
            {fisherman?.full_name ?? 'Vessel Owner'}
            {vessel ? ` · ${vessel.vessel_name_en} (${vessel.registration_no})` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            icon={<Volume2 className="w-3.5 h-3.5" />}
            onClick={handleListenSummary}
          >
            {t('fisher.listenBtn')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Printer className="w-3.5 h-3.5" />}
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
            icon={<FileDown className="w-3.5 h-3.5" />}
            onClick={handleExportPassbookCsv}
          >
            {t('fisher.passbookCsvBtn')}
          </Button>
        </div>
      </div>

      {speechNotice && (
        <Toast
          tone="info"
          title="Passbook Audio Readout"
          message={speechNotice}
          onDismiss={() => setSpeechNotice(null)}
        />
      )}

      {/* Hero: the one number a fisher cares about */}
      <section
        aria-label={t('workspaces.fisherHeroLabel')}
        className="rounded-[var(--radius-card)] bg-[var(--decor-aqua-soft)] border border-[var(--border-hair)] p-5 sm:p-6"
      >
        <p className="text-sm font-semibold text-[var(--decor-ink)]">
          {t('workspaces.fisherHeroLabel')}
        </p>
        <p
          data-testid="fisher-hero-amount"
          className="mt-1 text-[40px] sm:text-5xl leading-none font-bold font-mono-code tabular-nums text-[var(--decor-ink)]"
        >
          {formatInrFromPaise(payableAccount?.balance_paise ?? totalNetPaise)}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t('workspaces.fisherHeroSub')}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--border-hair)] pt-4">
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">{t('workspaces.fisherGross')}</dt>
            <dd className="mt-0.5 text-base font-bold font-mono-code tabular-nums">
              {formatInrFromPaise(totalHammerPaise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">{t('workspaces.splitBonus')}</dt>
            <dd className="mt-0.5 text-base font-bold font-mono-code tabular-nums text-[var(--brand)]">
              {formatInrFromPaise(bonusEscrowAccount?.balance_paise ?? totalBonusPaise)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Where each sale goes: plain-language split, no statute references */}
      <Card title={t('workspaces.splitTitle')}>
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          {t('workspaces.splitSubtitle')}
        </p>
        <div
          role="img"
          aria-label="95 rupees to you, 2 rupees bonus saved for you, 1 rupee each to auctioneer, harbour office and co-operative society"
          className="flex h-4 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--bg-sunken)]"
        >
          {[
            { w: 95, c: 'var(--brand)' },
            { w: 2, c: 'var(--decor-aqua)' },
            { w: 1, c: 'var(--decor-sun)' },
            { w: 1, c: 'var(--decor-ink)' },
            { w: 1, c: 'var(--decor-sand)' },
          ].map((seg, i) => (
            <span
              key={i}
              style={{ flexBasis: `${seg.w}%`, background: seg.c }}
              className="min-w-[6px] h-full"
            />
          ))}
        </div>
        {refreshing ? (
          <div className="mt-4">
            <SkeletonList
              items={5}
              variant="key-value"
              surface="plain"
              label="Refreshing settlement split…"
            />
          </div>
        ) : (
        <ul className="mt-4 flex flex-col divide-y divide-[var(--border-hair)]">
          {[
            {
              label: t('workspaces.splitYou'),
              rupees: '₹95',
              c: 'var(--brand)',
              amt: totalNetPaise,
              strong: true,
            },
            {
              label: t('workspaces.splitBonus'),
              rupees: '₹2',
              c: 'var(--decor-aqua)',
              amt: totalBonusPaise,
            },
            {
              label: t('workspaces.splitAuctioneer'),
              rupees: '₹1',
              c: 'var(--decor-sun)',
              amt: totalCommissionPaise / 5n,
            },
            {
              label: t('workspaces.splitHarbour'),
              rupees: '₹1',
              c: 'var(--decor-ink)',
              amt: totalCommissionPaise / 5n,
            },
            {
              label: t('workspaces.splitCoop'),
              rupees: '₹1',
              c: 'var(--decor-sand)',
              amt: totalCommissionPaise / 5n,
            },
          ].map((row) => (
            <li key={row.label} className="flex items-center gap-3 py-3 min-h-[52px]">
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: row.c }}
              />
              <span className="flex-1 min-w-0 text-sm text-[var(--text-primary)]">
                {row.label}
              </span>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">{row.rupees}</span>
              <span
                className={`w-28 text-right font-mono-code tabular-nums ${
                  row.strong ? 'font-bold text-base' : 'text-sm'
                }`}
              >
                {formatInrFromPaise(row.amt)}
              </span>
            </li>
          ))}
        </ul>
        )}
      </Card>

      {/* Today's Catch Sales Table */}
      <Card
        title={t('workspaces.fisherSalesTitle')}
        subtitle={t('fisher.salesSubtitle')}
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
          loading={refreshing}
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
