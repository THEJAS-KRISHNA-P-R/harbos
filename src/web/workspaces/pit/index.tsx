import React, { useState } from 'react';
import { Gavel, ShieldCheck, Timer, CheckCircle2 } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  Select,
  Input,
  Keypad,
  DataTable,
  Toast,
  WorkflowStepStrip,
  AuctionGavelBellIcon,
  StatutorySealIcon,
  AuctionPitAmphitheatreSvgDecor,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  formatInrFromPaise,
  formatKgFromGrams,
  type BootstrapData,
  type AllocationRow,
} from '@web/lib/api.ts';
import type { AuctionMode } from '@shared/ids.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';

export const PitWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  onRefresh: () => Promise<void>;
}> = ({ data, token, onRefresh }) => {
  const openLots = data.lots.filter((l) => l.available_boxes > 0);
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
        title: `Sale Confirmed: ${res.allocationId} (${res.serverLatencyMs} ms)`,
        msg: `Hammer: ${formatInrFromPaise(res.hammerPaise)} | Fisherman Net (95%): ${formatInrFromPaise(
          res.fishermanNetPaise
        )} | Bonus Escrow: ${formatInrFromPaise(res.bonusEscrowPaise)} | Journal ${
          res.journalId
        } SHA-256 chained.${
          res.floorWarningTriggered ? ' [Section 19 Floor Price WARN Flagged]' : ''
        }`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Statutory Allocation Rejected by Server',
        msg: err instanceof Error ? err.message : 'Allocation failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const allocColumns: ReadonlyArray<DataTableColumn<AllocationRow>> = [
    {
      key: 'id',
      header: 'Allocation / Journal',
      mono: true,
      render: (r) => (
        <div>
          <div className="font-semibold">{r.allocation_id}</div>
          <div className="text-xs text-[var(--text-muted)]">{r.journal_id}</div>
        </div>
      ),
    },
    {
      key: 'mode',
      header: 'Auction Mode',
      render: (r) => <Badge tone="info" label={r.auction_mode} />,
    },
    {
      key: 'boxes',
      header: 'Boxes / Weight',
      align: 'right',
      mono: true,
      render: (r) => `${r.boxes_allocated} boxes (${formatKgFromGrams(r.grams_allocated)})`,
    },
    {
      key: 'hammer',
      header: 'Hammer Value',
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">{formatInrFromPaise(r.hammer_paise)}</span>,
    },
    {
      key: 'fisherman',
      header: 'Fisherman Net (95%)',
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.fisherman_net_paise),
    },
    {
      key: 'latency',
      header: 'Server Latency',
      align: 'right',
      mono: true,
      render: (r) => `${r.server_latency_ms} ms`,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="p-4 sm:p-5 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <AuctionPitAmphitheatreSvgDecor size={40} />
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              Auction Pit Pad
            </h1>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {openLots.length} Open Lots · Atomic Ledger Post
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Badge tone="ok" label="LEADER LEASE ACTIVE" code={`FENCE #${fencingToken}`} />
          <Badge tone="info" label={`P50: ${lastLatencyMs} MS`} />
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

      {/* Current Lot Status Metrics */}
      {currentLot && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <Metric
            featured
            label={`Current Lot: ${currentLot.lot_code}`}
            value={`${currentLot.available_boxes} / ${currentLot.total_boxes}`}
            unit="BOXES"
            sublabel={formatKgFromGrams(currentLot.available_grams)}
            status={{
              tone:
                currentLot.inspection_grade === 'REJECTED_UNFIT'
                  ? 'danger'
                  : currentLot.available_boxes > 0
                  ? 'ok'
                  : 'neutral',
              label: currentLot.inspection_grade,
            }}
          />
          <Metric
            label="Floor Price (s.19)"
            value={formatInrFromPaise(currentSpecies?.floor_price_paise_per_kg ?? '0')}
            unit="/ KG"
            sublabel={currentSpecies?.name_en ?? ''}
            status={{
              tone: 'info',
              label: `MODE: ${data.tenant?.floor_enforcement ?? 'WARN'}`,
            }}
          />
          <Metric
            label="Vessel Loan (s.4(8))"
            value={currentVessel?.has_active_society_loan ? 'LOAN TIED' : 'FREE VESSEL'}
            sublabel={currentVessel?.vessel_name_en ?? ''}
            status={{
              tone: currentVessel?.has_active_society_loan ? 'warn' : 'ok',
              label: currentVessel?.has_active_society_loan ? 'DEPUTED ONLY' : 'OPEN',
            }}
          />
        </div>
      )}

      {/* Pit Allocation Grid: Left = Lot & Statutory Controls, Right = Keypad */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 flex flex-col gap-4">
          <Card title="Lot, Mode & Licence Selection">
            <div className="flex flex-col gap-4">
              <Select
                label="Select Landed Lot (Includes Open, Society-Loan & Unfit s.21 Lots)"
                dockSize
                value={selectedLotId}
                onChange={(e) => setSelectedLotId(e.target.value)}
                options={data.lots.map((l) => {
                  const sp = data.species.find((s) => s.species_id === l.species_id);
                  const v = data.vessels.find((x) => x.vessel_id === l.vessel_id);
                  return {
                    value: l.lot_id,
                    label: `${l.lot_code} — ${sp?.name_en ?? ''} (${l.available_boxes}/${l.total_boxes} boxes) [${
                      l.inspection_grade
                    }]${v?.has_active_society_loan ? ' [s.4(8) Loan]' : ''}`,
                  };
                })}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Auction Mode (§7)"
                  dockSize
                  value={auctionMode}
                  onChange={(e) => setAuctionMode(e.target.value as AuctionMode)}
                  options={[
                    { value: 'PHYSICAL_SHOUT', label: 'PHYSICAL_SHOUT (Pit Shout)' },
                    { value: 'HYBRID_REMOTE', label: 'HYBRID_REMOTE (Floor + SSE)' },
                    { value: 'DUTCH_CLOCK', label: 'DUTCH_CLOCK (Descending Clock)' },
                    { value: 'COOP_PROCUREMENT', label: 'COOP_PROCUREMENT (s.19(2) Floor Price)' },
                    { value: 'HMS_DIRECT_TAKEOVER', label: 'HMS_DIRECT_TAKEOVER (s.10 Proviso)' },
                  ]}
                />

                <Select
                  label="Licensed Auctioneer (s.5 & s.4(8))"
                  dockSize
                  value={selectedLicenceId}
                  onChange={(e) => setSelectedLicenceId(e.target.value)}
                  options={data.licences.map((lic) => ({
                    value: lic.licence_id,
                    label: `${lic.auctioneer_name} [${lic.status}]`,
                  }))}
                />
              </div>

              {auctionMode === 'HMS_DIRECT_TAKEOVER' && (
                <Input
                  label={`Government Permission Reference (Required by ${ACT_16_2021_CITATIONS.HMS_DIRECT_TAKEOVER_PROVISO})`}
                  value={govPermissionRef}
                  onChange={(e) => setGovPermissionRef(e.target.value)}
                  mono
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <Select
                    label="Winning Wholesale Buyer Paddle (§7 Check 6 Credit Lock)"
                    dockSize
                    value={selectedBuyerId}
                    onChange={(e) => setSelectedBuyerId(e.target.value)}
                    options={data.buyers.map((b) => {
                      const avail =
                        BigInt(b.escrow_balance_paise) +
                        BigInt(b.approved_credit_paise) -
                        BigInt(b.unsettled_payables_paise) -
                        BigInt(b.active_holds_paise);
                      return {
                        value: b.buyer_id,
                        label: `Paddle #${b.paddle_no} — ${b.buyer_name} (Avail: ${formatInrFromPaise(
                          avail
                        )})`,
                      };
                    })}
                  />
                </div>
                <Input
                  label="Boxes to Allocate"
                  type="number"
                  mono
                  dockSize
                  value={boxesRequested}
                  onChange={(e) => setBoxesRequested(e.target.value)}
                />
              </div>

              {/* Pre-flight Statutory Validation Banner */}
              <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-2 text-xs">
                <div className="font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[var(--brand)]" />
                  <span>Live Statutory Pre-Flight Checks (§7)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[var(--text-secondary)]">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                    <span>
                      Licence: <strong>{currentLicence?.status}</strong> (until{' '}
                      {currentLicence?.valid_until})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                    <span>
                      Buyer Paddle: <strong>#{currentBuyer?.paddle_no}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Timer className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                    <span>
                      Fencing Token: <strong>#{fencingToken}</strong> (Stale &lt; 10 rejected)
                    </span>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => setFencingToken((prev) => (prev === '10' ? '4' : '10'))}
                      className="underline font-semibold text-[var(--brand)] cursor-pointer"
                    >
                      {fencingToken === '10'
                        ? 'Simulate Stale Tablet Token (#4)'
                        : 'Restore Valid Leader Token (#10)'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Numeric Keypad & Hammer Drop Button */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <Card
            title="2. Pit Numeric Keypad & Hammer Drop"
            subtitle="Large >= 64px keys for rapid one-handed tablet bidding"
          >
            <div className="flex flex-col gap-4">
              <Keypad
                value={bidPriceRupeesPerKg}
                onChange={setBidPriceRupeesPerKg}
                onQuickIncrement={(delta) =>
                  setBidPriceRupeesPerKg((prev) => String((Number(prev) || 0) + delta))
                }
              />

              <Button
                variant="primary"
                size="dock"
                loading={submitting}
                icon={<Gavel className="w-5 h-5" />}
                onClick={handleConfirmAllocation}
                className="w-full"
              >
                Confirm Hammer Drop & Post Ledger Journal
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* Confirmed Allocations Table */}
      <Card
        title="Confirmed Pit Sale Allocations (Immutable)"
        subtitle="Corrections require a Dual-Key Reversal Journal authorized by Accountant + Harbour Admin"
      >
        <DataTable
          caption="Confirmed Pit Sale Allocations"
          columns={allocColumns}
          rows={data.allocations}
          getRowKey={(r) => r.allocation_id}
        />
      </Card>
    </div>
  );
};
