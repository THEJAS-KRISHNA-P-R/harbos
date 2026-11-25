import React, { useMemo, useState } from 'react';
import {
  Gavel,
  ShieldCheck,
  Timer,
  CheckCircle2,
  ScanLine,
  Printer,
  Minus,
  Plus,
  SlidersHorizontal,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Select,
  Input,
  Keypad,
  DataTable,
  Modal,
  Toast,
  SpeciesGlyph,
  SkeletonCardGrid,
  WorkspaceSkeleton,
  AuctionPitAmphitheatreSvgDecor,
  humanizeCode,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  formatInrFromPaise,
  formatKgFromGrams,
  type BootstrapData,
  type AllocationRow,
} from '@web/lib/api.ts';
import {
  clampBoxCount,
  computePitSalePreview,
  extractManglishName,
} from '@web/lib/ui-formatters.ts';
import type { AuctionMode } from '@shared/ids.ts';
import { useI18n } from '@web/i18n/index.tsx';
import { DocksidePrintSlip } from '@web/shared/DocksidePrintSlip.tsx';
import { BarcodeScannerModal } from '@web/shared/BarcodeScannerModal.tsx';

const AUCTION_MODE_OPTIONS: ReadonlyArray<{ value: AuctionMode; label: string }> = [
  { value: 'PHYSICAL_SHOUT', label: 'Pit shout (voice auction)' },
  { value: 'HYBRID_REMOTE', label: 'Hybrid (floor + remote bidders)' },
  { value: 'DUTCH_CLOCK', label: 'Dutch clock (price falls until taken)' },
  { value: 'COOP_PROCUREMENT', label: 'Co-op procurement (at floor price)' },
  { value: 'HMS_DIRECT_TAKEOVER', label: 'Harbour office direct takeover' },
];

export const PitWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => Promise<void>;
}> = ({ data, token, loading = false, refreshing = false, onRefresh }) => {
  const { t } = useI18n();
  const openLots = useMemo(
    () =>
      data.lots.filter(
        (l) =>
          l.available_boxes > 0 &&
          Boolean(l.inspection_grade) &&
          l.inspection_grade !== 'REJECTED_UNFIT'
      ),
    [data.lots]
  );

  const [selectedLotId, setSelectedLotId] = useState(
    openLots[0]?.lot_id ?? data.lots[0]?.lot_id ?? 'LOT-2026-001'
  );
  const [auctionMode, setAuctionMode] = useState<AuctionMode>('PHYSICAL_SHOUT');
  const [selectedLicenceId, setSelectedLicenceId] = useState(
    data.licences[0]?.licence_id ?? 'LIC-MUN-001'
  );
  const [selectedBuyerId, setSelectedBuyerId] = useState(
    data.buyers[0]?.buyer_id ?? 'BUY-01'
  );
  const [boxesRequested, setBoxesRequested] = useState('2');
  const [bidPriceRupeesPerKg, setBidPriceRupeesPerKg] = useState('740');
  const [fencingToken, setFencingToken] = useState('10');
  const [govPermissionRef, setGovPermissionRef] = useState('GO(Rt) No. 412/2026/F&PD');
  const [submitting, setSubmitting] = useState(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number>(2);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saleSlipAlloc, setSaleSlipAlloc] = useState<AllocationRow | null>(null);
  const [slipFormat, setSlipFormat] = useState<'80mm' | 'A4'>('80mm');
  const [isReprint, setIsReprint] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null>(null);

  const currentLot = data.lots.find((l) => l.lot_id === selectedLotId) ?? data.lots[0];
  const currentVessel = data.vessels.find((v) => v.vessel_id === currentLot?.vessel_id);
  const currentSpecies = data.species.find((s) => s.species_id === currentLot?.species_id);
  const currentLicence = data.licences.find((l) => l.licence_id === selectedLicenceId);
  const currentBuyer = data.buyers.find((b) => b.buyer_id === selectedBuyerId);

  const maxBoxes = Math.max(1, currentLot?.available_boxes ?? 1);
  const numericBoxes = clampBoxCount(Number(boxesRequested) || 1, maxBoxes);

  const salePreview = useMemo(() => {
    if (!currentLot) return null;
    return computePitSalePreview({
      priceRupeesPerKg: Number(bidPriceRupeesPerKg) || 0,
      boxesRequested: numericBoxes,
      lotTotalBoxes: currentLot.total_boxes,
      lotAvailableBoxes: currentLot.available_boxes,
      lotNetGrams: BigInt(currentLot.net_grams),
      floorPricePaisePerKg: BigInt(currentSpecies?.floor_price_paise_per_kg ?? '0'),
    });
  }, [currentLot, currentSpecies, bidPriceRupeesPerKg, numericBoxes]);

  const handleSelectLot = (lotId: string): void => {
    setSelectedLotId(lotId);
    const lot = data.lots.find((l) => l.lot_id === lotId);
    if (!lot) return;
    if (lot.available_boxes > 0 && Number(boxesRequested) > lot.available_boxes) {
      setBoxesRequested(String(lot.available_boxes));
    }
    const sp = data.species.find((s) => s.species_id === lot.species_id);
    if (sp) {
      const floorRupees = Math.ceil(Number(BigInt(sp.floor_price_paise_per_kg) / 100n));
      if (floorRupees > 0) {
        setBidPriceRupeesPerKg(String(floorRupees + 20));
      }
    }
  };

  const handleLotQrScan = (rawCode: string): void => {
    const q = rawCode.trim().toUpperCase();
    const matched = data.lots.find(
      (l) =>
        l.lot_code.toUpperCase() === q ||
        l.lot_id.toUpperCase() === q ||
        q.includes(l.lot_code.toUpperCase())
    );
    if (matched) {
      handleSelectLot(matched.lot_id);
      setFeedback({
        tone: 'ok',
        title: `Lot scanned: ${matched.lot_code}`,
        msg: `Loaded ${matched.lot_code} (${matched.available_boxes}/${matched.total_boxes} boxes available).`,
      });
    } else {
      setFeedback({
        tone: 'warn',
        title: 'Lot QR not found',
        msg: `No landed lot matched "${rawCode}". Tap a lot card below.`,
      });
    }
  };

  const handleConfirmAllocation = async (): Promise<void> => {
    if (!currentLot) return;
    setSubmitting(true);
    setFeedback(null);

    try {
      const pricePerKgPaise = BigInt(Math.round((Number(bidPriceRupeesPerKg) || 0) * 100));
      const res = await apiRequest<{
        allocationId: string;
        journalId: string;
        hammerPaise: string;
        buyerPayablePaise: string;
        fishermanNetPaise: string;
        bonusEscrowPaise: string;
        floorWarningTriggered: boolean;
        remainingBoxes: number;
        serverLatencyMs: number;
      }>(`/api/v1/lots/${currentLot.lot_id}/allocate`, {
        method: 'POST',
        token,
        idempotencyKey: `pit-${currentLot.lot_id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        body: {
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode,
          auctioneerLicenceId: selectedLicenceId,
          buyerId: selectedBuyerId,
          boxesRequested: Math.max(1, Number(boxesRequested) || 1),
          pricePerKgPaise: pricePerKgPaise.toString(),
          fencingToken: Number(fencingToken) || 10,
          governmentPermissionRef:
            auctionMode === 'HMS_DIRECT_TAKEOVER' ? govPermissionRef : undefined,
        },
      });

      setLastLatencyMs(res.serverLatencyMs);
      setFeedback({
        tone: res.floorWarningTriggered ? 'warn' : 'ok',
        title: `Sale confirmed · ${res.allocationId}`,
        msg: `Hammer ${formatInrFromPaise(res.hammerPaise)} · Fisher receives ${formatInrFromPaise(
          res.fishermanNetPaise
        )} · Bonus ${formatInrFromPaise(res.bonusEscrowPaise)} · ${res.remainingBoxes} boxes left.${
          res.floorWarningTriggered ? ' Below floor price: flagged.' : ''
        }`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Sale could not be recorded',
        msg: err instanceof Error ? err.message : 'Allocation failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const allocColumns: ReadonlyArray<DataTableColumn<AllocationRow>> = [
    {
      key: 'id',
      header: t('pit.saleLotHeader'),
      render: (r) => {
        const lot = data.lots.find((l) => l.lot_id === r.lot_id);
        const sp = data.species.find((s) => s.species_id === lot?.species_id);
        return (
          <div className="flex items-center gap-2 min-w-0">
            <SpeciesGlyph code={`${sp?.code ?? ''} ${sp?.name_en ?? ''}`} size={20} />
            <div className="min-w-0">
              <div className="font-semibold font-mono-code truncate">{r.allocation_id}</div>
              <div className="text-xs text-[var(--text-muted)] truncate">
                {lot?.lot_code ?? r.lot_id} · {sp?.name_en ?? 'Catch'}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'mode',
      header: t('pit.modeHeader'),
      render: (r) => <Badge tone="info" label={r.auction_mode} />,
    },
    {
      key: 'boxes',
      header: t('pit.boxesWeightHeader'),
      align: 'right',
      mono: true,
      render: (r) => `${r.boxes_allocated} boxes (${formatKgFromGrams(r.grams_allocated)})`,
    },
    {
      key: 'hammer',
      header: t('pit.saleValueHeader'),
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">{formatInrFromPaise(r.hammer_paise)}</span>,
    },
    {
      key: 'fisherman',
      header: t('pit.fisherReceivesHeader'),
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.fisherman_net_paise),
    },
    {
      key: 'slip',
      header: t('pit.saleSlipHeader'),
      align: 'right',
      render: (r) => (
        <Button
          variant="outline"
          size="sm"
          icon={<Printer className="w-3.5 h-3.5" />}
          onClick={() => {
            setIsReprint(false);
            setSaleSlipAlloc(r);
          }}
        >
          {t('actions.printSaleSlip')}
        </Button>
      ),
    },
  ];

  const isLotBlocked = currentLot?.inspection_grade === 'REJECTED_UNFIT';
  const isLotSoldOut = (currentLot?.available_boxes ?? 0) <= 0;
  const activeModeLabel =
    AUCTION_MODE_OPTIONS.find((m) => m.value === auctionMode)?.label ?? humanizeCode(auctionMode);

  if (loading) {
    return <WorkspaceSkeleton workspace="pit" label={t('workspaces.loadingWorkspace')} />;
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {/* Compact Pit Top Header */}
      <div className="p-3.5 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="hidden sm:block shrink-0">
            <AuctionPitAmphitheatreSvgDecor size={36} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              {t('workspaces.pitTitle')}
            </h1>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {openLots.length} {t('pit.openLotsLabel')} · {activeModeLabel} · {lastLatencyMs} ms
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh auction lots"
            icon={<RefreshCw className="w-4 h-4" />}
            loading={refreshing}
            onClick={() => void onRefresh()}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ScanLine className="w-4 h-4" />}
            onClick={() => setScannerOpen(true)}
          >
            {t('actions.scanLotQr')}
          </Button>
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

      {/* Main Pit Pad: Left = Visual Lot Cards + Buyer Paddle + Box Stepper, Right = Live Spotlight + Keypad + Hammer Confirm */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start">
        <div className="lg:col-span-7 flex flex-col gap-4">
          {/* Step 1: Visual Landed Lot Selector Cards */}
          <Card title={t('workspaces.pitSelectLot')}>
            {refreshing || submitting ? (
              <SkeletonCardGrid
                count={Math.max(2, Math.min(4, data.lots.length))}
                columns={2}
                variant="selectable"
                testId="pit-lot-picker-skeleton"
                label="Refreshing open auction lots…"
              />
            ) : (
            <div
              role="radiogroup"
              aria-label="Landed lots for auction"
              data-testid="pit-lot-picker"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            >
              {data.lots.map((lot) => {
                const sp = data.species.find((s) => s.species_id === lot.species_id);
                const vessel = data.vessels.find((v) => v.vessel_id === lot.vessel_id);
                const selected = lot.lot_id === currentLot?.lot_id;
                const unfit = lot.inspection_grade === 'REJECTED_UNFIT';
                const soldOut = lot.available_boxes <= 0;
                return (
                  <button
                    key={lot.lot_id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSelectLot(lot.lot_id)}
                    className={`min-h-[76px] p-3.5 rounded-[var(--radius-card)] border text-left transition-all cursor-pointer flex flex-col gap-2 active:scale-[0.99] ${
                      selected
                        ? 'bg-[var(--brand-soft)] border-[var(--brand)] ring-2 ring-[var(--brand)]'
                        : unfit
                        ? 'bg-[var(--danger-bg)]/40 border-[var(--danger)]/35 hover:border-[var(--danger)]'
                        : soldOut
                        ? 'bg-[var(--bg-sunken)]/60 border-[var(--border-hair)] opacity-75'
                        : 'bg-[var(--bg-surface)] border-[var(--border-strong)]/60 hover:bg-[var(--bg-tint)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-8 h-8 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] inline-flex items-center justify-center shrink-0">
                          <SpeciesGlyph code={`${sp?.code ?? ''} ${sp?.name_en ?? ''}`} size={20} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                            {sp?.name_en ?? lot.species_id}
                          </div>
                          <div className="text-[11px] font-mono-code text-[var(--text-secondary)] truncate">
                            {lot.lot_code}
                            {sp ? ` · ${extractManglishName(sp.name_ml, sp.code)}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className="text-right shrink-0">
                        <span className="block text-sm font-bold font-mono-code tabular-nums text-[var(--text-primary)]">
                          {lot.available_boxes}/{lot.total_boxes}
                        </span>
                        <span className="block text-[10px] font-semibold text-[var(--text-muted)]">
                          {t('dockside.boxes')}
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-[var(--text-secondary)]">
                      <span className="font-mono-code tabular-nums">
                        {formatKgFromGrams(lot.available_grams)} · {t('pit.floorLabel')}{' '}
                        {formatInrFromPaise(sp?.floor_price_paise_per_kg ?? '0')}/kg
                      </span>
                      <span className="flex items-center gap-1.5">
                        {vessel?.has_active_society_loan && (
                          <span className="font-semibold text-[var(--warning)]">{t('pit.loanTied')}</span>
                        )}
                        {unfit ? (
                          <span className="font-semibold text-[var(--danger-fg)]">
                            {t('pit.rejectedUnfit')}
                          </span>
                        ) : soldOut ? (
                          <span className="font-semibold text-[var(--text-muted)]">{t('pit.soldOut')}</span>
                        ) : !lot.inspection_grade ? (
                          <span className="font-semibold text-[var(--warning)]">{t('pit.awaitingQc')}</span>
                        ) : null}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            )}
          </Card>

          {/* Step 2: Buyer Paddle Cards + Big Box Stepper */}
          <Card title={t('workspaces.pitBuyerPaddle')}>
            <div className="flex flex-col gap-4">
              <div
                role="radiogroup"
                aria-label="Winning buyer paddle"
                data-testid="pit-buyer-picker"
                className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
              >
                {data.buyers.map((b) => {
                  const avail =
                    BigInt(b.escrow_balance_paise) +
                    BigInt(b.approved_credit_paise) -
                    BigInt(b.unsettled_payables_paise) -
                    BigInt(b.active_holds_paise);
                  const selected = b.buyer_id === selectedBuyerId;
                  return (
                    <button
                      key={b.buyer_id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedBuyerId(b.buyer_id)}
                      className={`min-h-[60px] p-3 rounded-[var(--radius-card)] border text-left transition-all cursor-pointer flex items-center justify-between gap-2.5 active:scale-[0.99] ${
                        selected
                          ? 'bg-[var(--brand-soft)] border-[var(--brand)] ring-2 ring-[var(--brand)]'
                          : 'bg-[var(--bg-surface)] border-[var(--border-strong)]/60 hover:bg-[var(--bg-tint)]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`h-10 min-w-[44px] px-2 rounded-[var(--radius-control)] font-mono-code font-bold text-sm inline-flex items-center justify-center shrink-0 ${
                            selected
                              ? 'bg-[var(--brand)] text-[var(--brand-fg)]'
                              : 'bg-[var(--bg-sunken)] text-[var(--text-primary)]'
                          }`}
                        >
                          #{b.paddle_no}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                            {b.buyer_name}
                          </div>
                          <div className="text-xs font-mono-code tabular-nums text-[var(--text-secondary)] truncate">
                            Limit {formatInrFromPaise(avail)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Box Count Stepper */}
              <div className="pt-3 border-t border-[var(--border-hair)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-[var(--text-secondary)]">
                    {t('pit.boxesToAllocate')}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono-code tabular-nums">
                    {currentLot
                      ? `${currentLot.available_boxes} ${t('pit.availableLabel')} · ${formatKgFromGrams(
                          salePreview?.gramsAllocated ?? 0n
                        )} ${t('pit.selectedLabel')}`
                      : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label="Decrease boxes"
                    onClick={() =>
                      setBoxesRequested(String(clampBoxCount(numericBoxes - 1, maxBoxes)))
                    }
                    className="w-11 h-11 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-[var(--text-primary)] inline-flex items-center justify-center cursor-pointer active:scale-95"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    type="number"
                    aria-label="Boxes to allocate"
                    min={1}
                    max={maxBoxes}
                    value={boxesRequested}
                    onChange={(e) => setBoxesRequested(e.target.value)}
                    className="w-16 h-11 text-center font-mono-code text-lg font-bold tabular-nums rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]"
                  />
                  <button
                    type="button"
                    aria-label="Increase boxes"
                    onClick={() =>
                      setBoxesRequested(String(clampBoxCount(numericBoxes + 1, maxBoxes)))
                    }
                    className="w-11 h-11 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-[var(--text-primary)] inline-flex items-center justify-center cursor-pointer active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1.5 ml-1">
                    {[1, 2, maxBoxes]
                      .filter((v, idx, arr) => v >= 1 && arr.indexOf(v) === idx)
                      .map((preset) => (
                        <Button
                          key={preset}
                          size="sm"
                          variant={numericBoxes === preset ? 'primary' : 'outline'}
                          onClick={() => setBoxesRequested(String(preset))}
                        >
                          {preset === maxBoxes && maxBoxes > 2
                            ? `${t('pit.allLabel')} (${maxBoxes})`
                            : `${preset}`}
                        </Button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Secondary / Advanced Pit Options Collapsed by Default */}
          <details
            open={auctionMode === 'HMS_DIRECT_TAKEOVER' || fencingToken !== '10'}
            className="rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] p-4"
          >
            <summary className="cursor-pointer min-h-[44px] flex items-center justify-between gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[var(--brand)]" />
                <span>{t('workspaces.pitMoreOptions')}</span>
              </span>
              <span className="text-xs font-mono-code text-[var(--text-muted)]">
                {currentLicence?.auctioneer_name ?? 'Auctioneer'} · Lease #{fencingToken}
              </span>
            </summary>

            <div className="mt-4 pt-4 border-t border-[var(--border-hair)] flex flex-col gap-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <Select
                  label="Auction mode"
                  dockSize
                  value={auctionMode}
                  onChange={(e) => setAuctionMode(e.target.value as AuctionMode)}
                  options={AUCTION_MODE_OPTIONS}
                />

                <Select
                  label="Licensed auctioneer"
                  dockSize
                  value={selectedLicenceId}
                  onChange={(e) => setSelectedLicenceId(e.target.value)}
                  options={data.licences.map((lic) => ({
                    value: lic.licence_id,
                    label: `${lic.auctioneer_name} (${humanizeCode(lic.status)})`,
                  }))}
                />
              </div>

              {auctionMode === 'HMS_DIRECT_TAKEOVER' && (
                <Input
                  label="Government permission reference"
                  value={govPermissionRef}
                  onChange={(e) => setGovPermissionRef(e.target.value)}
                  mono
                />
              )}

              <div className="p-3.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-2 text-xs">
                <div className="font-bold text-[var(--text-secondary)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[var(--brand)]" />
                  <span>Pre-flight auction checks</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[var(--text-secondary)]">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                    <span>
                      Licence: <strong>{humanizeCode(currentLicence?.status ?? 'ACTIVE')}</strong>{' '}
                      (until {currentLicence?.valid_until})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                    <span>
                      Vessel:{' '}
                      <strong>
                        {currentVessel?.has_active_society_loan
                          ? 'Society loan tied'
                          : 'Free vessel'}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                    <span>
                      Leader lease token: <strong>#{fencingToken}</strong>
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setFencingToken((prev) => (prev === '10' ? '4' : '10'))}
                      className="underline font-semibold text-[var(--brand)] cursor-pointer"
                    >
                      {fencingToken === '10'
                        ? 'Test stale tablet token (#4)'
                        : 'Restore valid leader token (#10)'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>

        {/* Right Column: Active Lot Live Summary + Numeric Keypad + One-Tap Confirm */}
        <div className="lg:col-span-5 flex flex-col gap-3 lg:sticky lg:top-20">
          {currentLot && salePreview && (
            <section
              aria-label="Active lot sale summary"
              data-testid="pit-active-lot-card"
              className="rounded-[var(--radius-card)] bg-[var(--decor-aqua-soft)] border border-[var(--border-hair)] p-4 flex flex-col gap-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-10 h-10 rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-hair)] inline-flex items-center justify-center shrink-0">
                    <SpeciesGlyph
                      code={`${currentSpecies?.code ?? ''} ${currentSpecies?.name_en ?? ''}`}
                      size={24}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="text-base font-bold text-[var(--decor-ink)] truncate">
                      {currentSpecies?.name_en ?? currentLot.species_id}
                    </div>
                    <div className="text-xs font-mono-code text-[var(--text-secondary)] truncate">
                      {currentLot.lot_code} · {currentVessel?.vessel_name_en ?? ''}
                    </div>
                  </div>
                </div>
                <Badge
                  tone={
                    isLotBlocked
                      ? 'danger'
                      : salePreview.floorStatus === 'BELOW'
                      ? 'warn'
                      : 'ok'
                  }
                  label={
                    isLotBlocked
                      ? t('pit.rejectedUnfit')
                      : salePreview.floorStatus === 'BELOW'
                      ? t('workspaces.pitBelowFloor')
                      : salePreview.floorStatus === 'AT'
                      ? t('workspaces.pitAtFloor')
                      : t('workspaces.pitAboveFloor')
                  }
                />
              </div>

              <div className="pt-2 border-t border-[var(--border-hair)] flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[var(--text-secondary)]">
                    {t('workspaces.pitLiveTotal')}
                  </div>
                  <div
                    data-testid="pit-live-hammer-total"
                    className="text-3xl font-bold font-mono-code tabular-nums text-[var(--decor-ink)] leading-tight"
                  >
                    {formatInrFromPaise(salePreview.hammerPaise)}
                  </div>
                </div>
                <div className="text-right text-xs font-mono-code tabular-nums text-[var(--text-secondary)]">
                  <div>
                    {numericBoxes} {numericBoxes === 1 ? 'box' : 'boxes'} · {formatKgFromGrams(salePreview.gramsAllocated)}
                  </div>
                  <div>
                    {t('pit.floorLabel')} {formatInrFromPaise(currentSpecies?.floor_price_paise_per_kg ?? '0')}/kg
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] bg-[var(--bg-surface)]/80 rounded-[var(--radius-control)] px-3 py-2">
                <span>
                  {t('pit.buyerLabel')}: <strong>#{currentBuyer?.paddle_no}</strong> {currentBuyer?.buyer_name}
                </span>
                <span className="font-mono-code tabular-nums font-semibold text-[var(--brand)]">
                  {t('pit.fisherShareLabel')}: {formatInrFromPaise(salePreview.fishermanNetPaise)}
                </span>
              </div>

              {isLotBlocked && (
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--danger-fg)] bg-[var(--danger-bg)] rounded-[var(--radius-control)] px-3 py-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>This lot failed quality inspection and cannot be sold.</span>
                </div>
              )}
            </section>
          )}

          <Card title={t('pit.bidAndConfirmTitle')}>
            <div className="flex flex-col gap-3">
              <Keypad
                value={bidPriceRupeesPerKg}
                onChange={setBidPriceRupeesPerKg}
                onQuickIncrement={(delta) =>
                  setBidPriceRupeesPerKg((prev) => String(Math.max(0, (Number(prev) || 0) + delta)))
                }
              />

              <Button
                variant="primary"
                size="dock"
                data-testid="pit-confirm-hammer-btn"
                loading={submitting}
                disabled={isLotSoldOut}
                icon={<Gavel className="w-5 h-5" />}
                onClick={handleConfirmAllocation}
                className="w-full min-h-[52px]"
              >
                {t('workspaces.pitConfirmBtn')}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Confirmed Allocations Table */}
      <Card
        title={t('workspaces.pitAllocationsTitle')}
        subtitle={t('pit.allocationsSubtitle')}
      >
        <DataTable
          caption="Confirmed Pit Sale Allocations"
          columns={allocColumns}
          rows={data.allocations}
          loading={refreshing || submitting}
          getRowKey={(r) => r.allocation_id}
        />
      </Card>

      <Modal
        open={Boolean(saleSlipAlloc)}
        onClose={() => setSaleSlipAlloc(null)}
        title={t('slips.saleSlip')}
        description="Audited dockside commercial sale memorandum with QR verification"
        footer={
          <>
            <Button variant="outline" onClick={() => setSaleSlipAlloc(null)}>
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
        {saleSlipAlloc &&
          (() => {
            const lot = data.lots.find((l) => l.lot_id === saleSlipAlloc.lot_id);
            const buyer = data.buyers.find((b) => b.buyer_id === saleSlipAlloc.buyer_id);
            const sp = data.species.find((s) => s.species_id === lot?.species_id);
            return (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
                  <div className="flex items-center gap-1.5">
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
                  slipType="BUYER_SALE_SLIP"
                  printFormat={slipFormat}
                  isReprint={isReprint}
                  harbourName={data.tenant?.name_en ?? 'Munambam Harbour'}
                  referenceNo={saleSlipAlloc.allocation_id}
                  timestampIso={saleSlipAlloc.created_at}
                  items={[
                    {
                      label: t('dockside.lotCode'),
                      value: lot?.lot_code ?? saleSlipAlloc.lot_id,
                      highlight: true,
                    },
                    {
                      label: t('dockside.species'),
                      value: sp ? `${sp.name_en} (${extractManglishName(sp.name_ml, sp.code)})` : 'Catch',
                    },
                    {
                      label: t('dockside.buyerPaddle'),
                      value: `#${buyer?.paddle_no ?? '—'} ${buyer?.buyer_name ?? ''}`,
                    },
                    {
                      label: t('dockside.boxes'),
                      value: `${saleSlipAlloc.boxes_allocated} boxes (${formatKgFromGrams(
                        saleSlipAlloc.grams_allocated
                      )})`,
                    },
                    { label: 'Journal', value: saleSlipAlloc.journal_id },
                  ]}
                  summaryRows={[
                    {
                      label: t('dockside.hammerAmount'),
                      value: formatInrFromPaise(saleSlipAlloc.hammer_paise),
                    },
                    {
                      label: 'Buyer Total Payable',
                      value: formatInrFromPaise(saleSlipAlloc.buyer_payable_paise),
                      bold: true,
                    },
                  ]}
                  qrPayload={`HARBOUROS|SALE|${saleSlipAlloc.allocation_id}|${saleSlipAlloc.journal_id}`}
                />
              </div>
            );
          })()}
      </Modal>

      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanSuccess={handleLotQrScan}
        title={t('actions.scanLotQr')}
        placeholder="e.g. LOT-2026-001"
      />
    </div>
  );
};
