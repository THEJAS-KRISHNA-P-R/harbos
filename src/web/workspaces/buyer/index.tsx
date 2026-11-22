import React, { useState } from 'react';
import { Gavel, FileDown, Printer } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  DataTable,
  Input,
  Modal,
  Toast,
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
  onRefresh: () => Promise<void>;
}> = ({ data, token, onRefresh }) => {
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
        title: `Remote Bid Won: ${res.allocationId}`,
        msg: `Clearing invoice ${formatInrFromPaise(res.buyerPayablePaise)} charged against available trading limit.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Remote Bid Rejected',
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
      status: 'DRAFT_TEMPLATE_UNVERIFIED (OPEN-05)',
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
      header: 'Lot Code',
      mono: true,
      render: (r) => <span className="font-semibold">{r.lot_code}</span>,
    },
    {
      key: 'species',
      header: 'Species & Grade',
      render: (r) => {
        const sp = data.species.find((s) => s.species_id === r.species_id);
        return (
          <div className="flex items-center gap-2">
            <div>
              <div className="font-medium">{sp?.name_en}</div>
              <div lang="ml" className="text-xs text-[var(--text-secondary)]">
                {sp?.name_ml}
              </div>
            </div>
            <Badge
              tone={r.inspection_grade === 'REJECTED_UNFIT' ? 'danger' : 'ok'}
              label={r.inspection_grade}
            />
          </div>
        );
      },
    },
    {
      key: 'avail',
      header: 'Available Boxes / Weight',
      align: 'right',
      mono: true,
      render: (r) => `${r.available_boxes} boxes (${formatKgFromGrams(r.available_grams)})`,
    },
    {
      key: 'floor',
      header: 's.19 Floor Price',
      align: 'right',
      mono: true,
      render: (r) => {
        const sp = data.species.find((s) => s.species_id === r.species_id);
        return `${formatInrFromPaise(sp?.floor_price_paise_per_kg ?? '0')}/kg`;
      },
    },
    {
      key: 'action',
      header: 'Remote Bid / Stop Clock',
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
      header: 'Invoice / Allocation',
      mono: true,
      render: (r) => <span className="font-semibold">{r.allocation_id}</span>,
    },
    {
      key: 'boxes',
      header: 'Volume',
      align: 'right',
      mono: true,
      render: (r) => `${r.boxes_allocated} boxes (${formatKgFromGrams(r.grams_allocated)})`,
    },
    {
      key: 'hammer',
      header: 'Hammer Value',
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.hammer_paise),
    },
    {
      key: 'payable',
      header: 'Total Payable',
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">{formatInrFromPaise(r.buyer_payable_paise)}</span>,
    },
    {
      key: 'dossier',
      header: 'Sale Slip & Export Dossier',
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

  return (
    <div className="flex flex-col gap-5">
      <div className="p-4 sm:p-5 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <StatutoryLedgerWaterfallSvgDecor size={40} />
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              {t('workspaces.buyerTitle')}
            </h1>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {buyer?.buyer_name} · Paddle #{buyer?.paddle_no} · GSTIN: {buyer?.gstin}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Badge tone="ok" label="CREDIT LINE ACTIVE" code={`PADDLE #${buyer?.paddle_no ?? 101}`} />
        </div>
      </div>

      {feedback && (
        <Toast
          tone={feedback.tone}
          title={feedback.title}
          message={feedback.msg}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Buyer Credit Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <Metric
          featured
          label="Available Trading Limit"
          value={formatInrFromPaise(availablePaise)}
          status={{ tone: 'ok', label: 'LOCKED' }}
        />
        <Metric
          label="Escrow + Credit"
          value={formatInrFromPaise(escrowPaise + creditPaise)}
          sublabel={`Escrow: ${formatInrFromPaise(escrowPaise)}`}
          status={{ tone: 'info', label: 'LIMIT' }}
        />
        <Metric
          label="Unsettled Payables"
          value={formatInrFromPaise(payablesPaise)}
          status={{ tone: 'neutral', label: 'DUE TODAY' }}
        />
      </div>

      {/* Live Watchlist & Remote Bidding */}
      <Card
        title={t('workspaces.buyerWatchlistTitle')}
        actions={
          <div className="flex items-center gap-3">
            <Input
              label="Remote Bid (₹/kg)"
              type="number"
              mono
              value={bidPriceRupees}
              onChange={(e) => setBidPriceRupees(e.target.value)}
            />
            <Input
              label="Boxes"
              type="number"
              mono
              value={bidBoxes}
              onChange={(e) => setBidBoxes(e.target.value)}
            />
          </div>
        }
      >
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
        {slipAlloc && (() => {
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
                harbourName={data.tenant?.name_en ?? 'Munambam Harbour (HMS)'}
                referenceNo={slipAlloc.allocation_id}
                timestampIso={slipAlloc.created_at}
                items={[
                  { label: t('dockside.lotCode'), value: lot?.lot_code ?? slipAlloc.lot_id, highlight: true },
                  { label: t('dockside.species'), value: sp ? `${sp.name_en} / ${sp.name_ml}` : 'Catch' },
                  { label: t('dockside.buyerPaddle'), value: `#${buyer?.paddle_no ?? '—'} ${buyer?.buyer_name ?? ''}` },
                  { label: 'GSTIN', value: buyer?.gstin ?? '—' },
                  { label: t('dockside.boxes'), value: `${slipAlloc.boxes_allocated} boxes (${formatKgFromGrams(slipAlloc.grams_allocated)})` },
                ]}
                summaryRows={[
                  { label: t('dockside.hammerAmount'), value: formatInrFromPaise(slipAlloc.hammer_paise) },
                  { label: 'Total Payable', value: formatInrFromPaise(slipAlloc.buyer_payable_paise), bold: true },
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
