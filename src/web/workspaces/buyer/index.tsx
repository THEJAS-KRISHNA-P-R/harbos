import React, { useState } from 'react';
import { Gavel, FileDown, Printer, Minus, Plus } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  DataTable,
  Modal,
  Toast,
  SpeciesGlyph,
  WorkspaceSkeleton,
  StatutoryLedgerWaterfallSvgDecor,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  downloadTextFile,
  formatInrFromPaise,
  formatKgFromGrams,
  type BootstrapData,
  type LotRow,
  type AllocationRow,
} from '@web/lib/api.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import { useI18n } from '@web/i18n/index.tsx';
import { DocksidePrintSlip } from '@web/shared/DocksidePrintSlip.tsx';

export const BuyerWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  loading?: boolean;
  onRefresh: () => Promise<void>;
}> = ({ data, token, loading = false, onRefresh }) => {
  const { t } = useI18n();
  const buyer = data.buyers[0];
  const [bidPriceRupees, setBidPriceRupees] = useState('760');
  const [bidBoxes, setBidBoxes] = useState('2');
  const [submittingLotId, setSubmittingLotId] = useState<string | null>(null);
  const [slipAlloc, setSlipAlloc] = useState<AllocationRow | null>(null);
  const [slipFormat, setSlipFormat] = useState<'80mm' | 'A4'>('80mm');
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null>(null);

  const escrowPaise = BigInt(buyer?.escrow_balance_paise ?? '0');
  const creditPaise = BigInt(buyer?.approved_credit_paise ?? '0');
  const payablesPaise = BigInt(buyer?.unsettled_payables_paise ?? '0');
  const holdsPaise = BigInt(buyer?.active_holds_paise ?? '0');
  const availablePaise = escrowPaise + creditPaise - payablesPaise - holdsPaise;

  const handleRemoteBid = async (lot: LotRow): Promise<void> => {
    if (!buyer) return;
    setSubmittingLotId(lot.lot_id);
    setFeedback(null);
    try {
      const pricePaise = BigInt(Math.round((Number(bidPriceRupees) || 500) * 100));
      const res = await apiRequest<{
        allocationId: string;
        buyerPayablePaise: string;
      }>(`/api/v1/lots/${lot.lot_id}/allocate`, {
        method: 'POST',
        token,
        idempotencyKey: `buyer-${lot.lot_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        body: {
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode: 'HYBRID_REMOTE',
          auctioneerLicenceId: 'LIC-MUN-001',
          buyerId: buyer.buyer_id,
          boxesRequested: Math.min(lot.available_boxes, Math.max(1, Number(bidBoxes) || 1)),
          pricePerKgPaise: pricePaise.toString(),
          fencingToken: 10,
        },
      });
      setFeedback({
        tone: 'ok',
        title: `Remote bid won · ${res.allocationId}`,
        msg: `Invoice ${formatInrFromPaise(res.buyerPayablePaise)} charged against your trading limit.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Remote bid rejected',
        msg: err instanceof Error ? err.message : 'Bid failed',
      });
    } finally {
      setSubmittingLotId(null);
    }
  };

  const handleDownloadDossier = (alloc: AllocationRow): void => {
    const lot = data.lots.find((l) => l.lot_id === alloc.lot_id);
    const vessel = data.vessels.find((v) => v.vessel_id === lot?.vessel_id);
    const species = data.species.find((s) => s.species_id === lot?.species_id);
    const dossier = {
      status: 'DRAFT_TEMPLATE_UNVERIFIED',
      generatedAt: new Date().toISOString(),
      harbour: data.tenant?.name_en,
      statutoryBasis: `${ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE} Quality & Traceability Record`,
      buyer: {
        name: buyer?.buyer_name,
        gstin: buyer?.gstin,
        mpedaExportReg: buyer?.export_reg_no,
      },
      allocation: {
        allocationId: alloc.allocation_id,
        journalId: alloc.journal_id,
        boxes: alloc.boxes_allocated,
        grams: alloc.grams_allocated,
        hammerPaise: alloc.hammer_paise,
        buyerPayablePaise: alloc.buyer_payable_paise,
      },
      traceability: {
        lotCode: lot?.lot_code,
        qrSignature: lot?.qr_signature,
        vesselRegistration: vessel?.registration_no,
        vesselName: vessel?.vessel_name_en,
        speciesEn: species?.name_en,
        speciesScientific: species?.scientific_name,
        coreTempC: lot?.core_temp_c,
        inspectionGrade: lot?.inspection_grade,
      },
    };
    downloadTextFile(
      `HarbourOS-Export-Dossier-${alloc.allocation_id}.json`,
      JSON.stringify(dossier, null, 2),
      'application/json'
    );
  };

  const lotColumns: ReadonlyArray<DataTableColumn<LotRow>> = [
    {
      key: 'code',
      header: t('buyer.lotHeader'),
      mono: true,
      render: (r) => <span className="font-semibold">{r.lot_code}</span>,
    },
    {
      key: 'species',
      header: t('buyer.speciesGradeHeader'),
      render: (r) => {
        const sp = data.species.find((s) => s.species_id === r.species_id);
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <SpeciesGlyph code={`${sp?.code ?? ''} ${sp?.name_en ?? ''}`} size={20} />
            <div>
              <div className="font-medium">{sp?.name_en}</div>
              <div lang="ml" className="text-xs text-[var(--text-secondary)]">
                {sp?.name_ml}
              </div>
            </div>
            <Badge
              tone={
                !r.inspection_grade
                  ? 'neutral'
                  : r.inspection_grade === 'REJECTED_UNFIT'
                  ? 'danger'
                  : 'ok'
              }
              label={r.inspection_grade ?? 'Pending'}
            />
          </div>
        );
      },
    },
    {
      key: 'avail',
      header: t('buyer.availableHeader'),
      align: 'right',
      mono: true,
      render: (r) => `${r.available_boxes} boxes (${formatKgFromGrams(r.available_grams)})`,
    },
    {
      key: 'floor',
      header: t('buyer.floorPriceHeader'),
      align: 'right',
      mono: true,
      render: (r) => {
        const sp = data.species.find((s) => s.species_id === r.species_id);
        return `${formatInrFromPaise(sp?.floor_price_paise_per_kg ?? '0')}/kg`;
      },
    },
    {
      key: 'action',
      header: t('buyer.remoteBidHeader'),
      align: 'right',
      render: (r) =>
        r.available_boxes > 0 && r.inspection_grade !== 'REJECTED_UNFIT' ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Gavel className="w-3.5 h-3.5" />}
            loading={submittingLotId === r.lot_id}
            onClick={() => handleRemoteBid(r)}
          >
            Bid ₹{bidPriceRupees}/kg ({Math.min(r.available_boxes, Number(bidBoxes) || 1)} box)
          </Button>
        ) : (
          <Badge tone="neutral" label={r.status} />
        ),
    },
  ];

  const purchaseColumns: ReadonlyArray<DataTableColumn<AllocationRow>> = [
    {
      key: 'alloc',
      header: t('buyer.invoiceHeader'),
      mono: true,
      render: (r) => <span className="font-semibold">{r.allocation_id}</span>,
    },
    {
      key: 'boxes',
      header: t('buyer.volumeHeader'),
      align: 'right',
      mono: true,
      render: (r) => `${r.boxes_allocated} boxes (${formatKgFromGrams(r.grams_allocated)})`,
    },
    {
      key: 'hammer',
      header: t('buyer.saleValueHeader'),
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.hammer_paise),
    },
    {
      key: 'payable',
      header: t('buyer.totalPayableHeader'),
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">{formatInrFromPaise(r.buyer_payable_paise)}</span>,
    },
    {
      key: 'dossier',
      header: t('buyer.documentsHeader'),
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Printer className="w-3.5 h-3.5" />}
            onClick={() => setSlipAlloc(r)}
          >
            {t('actions.printSaleSlip')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<FileDown className="w-3.5 h-3.5" />}
            onClick={() => handleDownloadDossier(r)}
          >
            JSON
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <WorkspaceSkeleton workspace="buyer" label={t('workspaces.loadingWorkspace')} />;
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="p-3.5 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:block shrink-0">
            <StatutoryLedgerWaterfallSvgDecor size={36} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              {t('workspaces.buyerTitle')}
            </h1>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {buyer?.buyer_name} · Paddle #{buyer?.paddle_no} · GSTIN {buyer?.gstin}
            </p>
          </div>
        </div>
        <span className="text-xs font-mono-code font-bold text-[var(--brand)] shrink-0">
          Paddle #{buyer?.paddle_no ?? 101}
        </span>
      </div>

      {feedback && (
        <Toast
          tone={feedback.tone}
          title={feedback.title}
          message={feedback.msg}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Hero: Buyer Available Trading Limit */}
      <section
        aria-label={t('workspaces.buyerLimitHero')}
        className="rounded-[var(--radius-card)] bg-[var(--decor-aqua-soft)] border border-[var(--border-hair)] p-5 sm:p-6"
      >
        <p className="text-sm font-semibold text-[var(--decor-ink)]">
          {t('workspaces.buyerLimitHero')}
        </p>
        <p
          data-testid="buyer-limit-amount"
          className="mt-1 text-[38px] sm:text-5xl leading-none font-bold font-mono-code tabular-nums text-[var(--decor-ink)]"
        >
          {formatInrFromPaise(availablePaise)}
        </p>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t('workspaces.buyerLimitSub')}
        </p>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 border-t border-[var(--border-hair)] pt-4">
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">{t('buyer.escrowBalance')}</dt>
            <dd className="mt-0.5 text-base font-bold font-mono-code tabular-nums">
              {formatInrFromPaise(escrowPaise)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--text-secondary)]">{t('buyer.approvedCredit')}</dt>
            <dd className="mt-0.5 text-base font-bold font-mono-code tabular-nums">
              {formatInrFromPaise(creditPaise)}
            </dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-xs text-[var(--text-secondary)]">{t('buyer.dueToday')}</dt>
            <dd className="mt-0.5 text-base font-bold font-mono-code tabular-nums text-[var(--brand)]">
              {formatInrFromPaise(payablesPaise)}
            </dd>
          </div>
        </dl>
      </section>

      {/* Live Watchlist & Quick Remote Bid Controls */}
      <Card title={t('workspaces.buyerWatchlistTitle')}>
        <div className="mb-4 p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{t('buyer.bidPriceLabel')}</span>
            <button
              type="button"
              aria-label="Decrease remote bid by 10 rupees"
              onClick={() =>
                setBidPriceRupees((prev) => String(Math.max(50, (Number(prev) || 500) - 10)))
              }
              className="w-10 h-10 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] border border-[var(--border-strong)] inline-flex items-center justify-center cursor-pointer"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number"
              aria-label="Remote bid rupees per kg"
              value={bidPriceRupees}
              onChange={(e) => setBidPriceRupees(e.target.value)}
              className="w-24 h-10 text-center font-mono-code text-sm font-bold tabular-nums rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]"
            />
            <button
              type="button"
              aria-label="Increase remote bid by 10 rupees"
              onClick={() =>
                setBidPriceRupees((prev) => String((Number(prev) || 500) + 10))
              }
              className="w-10 h-10 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] border border-[var(--border-strong)] inline-flex items-center justify-center cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{t('buyer.boxesLabel')}</span>
            <button
              type="button"
              aria-label="Decrease remote bid boxes"
              onClick={() =>
                setBidBoxes((prev) => String(Math.max(1, (Number(prev) || 1) - 1)))
              }
              className="w-10 h-10 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] border border-[var(--border-strong)] inline-flex items-center justify-center cursor-pointer"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number"
              aria-label="Remote bid boxes"
              min={1}
              value={bidBoxes}
              onChange={(e) => setBidBoxes(e.target.value)}
              className="w-16 h-10 text-center font-mono-code text-sm font-bold tabular-nums rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]"
            />
            <button
              type="button"
              aria-label="Increase remote bid boxes"
              onClick={() =>
                setBidBoxes((prev) => String((Number(prev) || 1) + 1))
              }
              className="w-10 h-10 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] border border-[var(--border-strong)] inline-flex items-center justify-center cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <DataTable
          caption="Live Harbour Lot Watchlist"
          columns={lotColumns}
          rows={data.lots}
          getRowKey={(r) => r.lot_id}
        />
      </Card>

      {/* Purchases & Export Dossiers */}
      <Card title={t('workspaces.buyerPurchasesTitle')}>
        <DataTable
          caption="Buyer Purchases and Export Dossiers"
          columns={purchaseColumns}
          rows={data.allocations}
          getRowKey={(r) => r.allocation_id}
        />
      </Card>

      <Modal
        open={Boolean(slipAlloc)}
        onClose={() => setSlipAlloc(null)}
        title={t('slips.saleSlip')}
        description="Commercial sale memorandum with QR verification hash"
        footer={
          <>
            <Button variant="outline" onClick={() => setSlipAlloc(null)}>
              Close
            </Button>
            <Button
              variant="primary"
              icon={<Printer className="w-4 h-4" />}
              onClick={() => window.print()}
            >
              {t('actions.printSlip')} ({slipFormat})
            </Button>
          </>
        }
      >
        {slipAlloc &&
          (() => {
            const lot = data.lots.find((l) => l.lot_id === slipAlloc.lot_id);
            const sp = data.species.find((s) => s.species_id === lot?.species_id);
            return (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5 print:hidden">
                  <Button
                    size="sm"
                    variant={slipFormat === '80mm' ? 'primary' : 'outline'}
                    onClick={() => setSlipFormat('80mm')}
                  >
                    80mm
                  </Button>
                  <Button
                    size="sm"
                    variant={slipFormat === 'A4' ? 'primary' : 'outline'}
                    onClick={() => setSlipFormat('A4')}
                  >
                    A4
                  </Button>
                </div>
                <DocksidePrintSlip
                  slipType="BUYER_SALE_SLIP"
                  printFormat={slipFormat}
                  harbourName={data.tenant?.name_en ?? 'Munambam Harbour'}
                  referenceNo={slipAlloc.allocation_id}
                  timestampIso={slipAlloc.created_at}
                  items={[
                    {
                      label: t('dockside.lotCode'),
                      value: lot?.lot_code ?? slipAlloc.lot_id,
                      highlight: true,
                    },
                    {
                      label: t('dockside.species'),
                      value: sp ? `${sp.name_en} / ${sp.name_ml}` : 'Catch',
                    },
                    {
                      label: t('dockside.buyerPaddle'),
                      value: `#${buyer?.paddle_no ?? '—'} ${buyer?.buyer_name ?? ''}`,
                    },
                    { label: 'GSTIN', value: buyer?.gstin ?? '—' },
                    {
                      label: t('dockside.boxes'),
                      value: `${slipAlloc.boxes_allocated} boxes (${formatKgFromGrams(
                        slipAlloc.grams_allocated
                      )})`,
                    },
                  ]}
                  summaryRows={[
                    {
                      label: t('dockside.hammerAmount'),
                      value: formatInrFromPaise(slipAlloc.hammer_paise),
                    },
                    {
                      label: 'Total Payable',
                      value: formatInrFromPaise(slipAlloc.buyer_payable_paise),
                      bold: true,
                    },
                  ]}
                  qrPayload={`HARBOUROS|BUYER|${slipAlloc.allocation_id}|${slipAlloc.journal_id}`}
                />
              </div>
            );
          })()}
      </Modal>
    </div>
  );
};
