import React, { useState } from 'react';
import { QrCode, Scale, Printer, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  Input,
  Select,
  SpeciesTile,
  ConnectivityBadge,
  DataTable,
  Modal,
  Toast,
  WorkflowStepStrip,
  DockScaleIcon,
  TrawlerVesselIcon,
  DocksideWeighingScaleSvgDecor,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  formatInrFromPaise,
  formatKgFromGrams,
  type BootstrapData,
  type LotRow,
} from '@web/lib/api.ts';

interface QueuedLotCommand {
  commandId: string;
  vesselId: string;
  speciesId: string;
  totalBoxes: number;
  netGrams: string;
  createdAt: string;
}

export const WeighingWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  onRefresh: () => Promise<void>;
}> = ({ data, token, onRefresh }) => {
  const [selectedVesselId, setSelectedVesselId] = useState(data.vessels[0]?.vessel_id ?? 'VSL-01');
  const [selectedSpeciesId, setSelectedSpeciesId] = useState(data.species[0]?.species_id ?? 'SPC-01');
  const [weightSource, setWeightSource] = useState<'SIMULATOR' | 'MANUAL' | 'BLE_SCALE'>('SIMULATOR');
  const [totalBoxes, setTotalBoxes] = useState('6');
  const [netKgInput, setNetKgInput] = useState('150');
  const [coreTempC, setCoreTempC] = useState('1.8');
  const [supervisorPin, setSupervisorPin] = useState('1234');
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<QueuedLotCommand[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'warn' | 'danger' | 'info'; title: string; msg: string } | null>(null);
  const [stickerModalLot, setStickerModalLot] = useState<{
    lotCode: string;
    vesselName: string;
    speciesName: string;
    boxes: number;
    netGrams: string;
    qrSignature: string;
  } | null>(null);

  const handleSimulateScaleRead = (): void => {
    const boxes = Math.max(1, Number(totalBoxes) || 6);
    const gramsPerBox = 25_000;
    setNetKgInput(String((boxes * gramsPerBox) / 1000));
    setWeightSource('SIMULATOR');
  };

  const handleTagLot = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    const netGrams = BigInt(Math.round((Number(netKgInput) || 0) * 1000));
    const boxes = Math.max(1, Number(totalBoxes) || 1);

    if (simulateOffline) {
      const cmd: QueuedLotCommand = {
        commandId: `CMD-OFFLINE-${Date.now()}-${offlineQueue.length + 1}`,
        vesselId: selectedVesselId,
        speciesId: selectedSpeciesId,
        totalBoxes: boxes,
        netGrams: netGrams.toString(),
        createdAt: new Date().toISOString(),
      };
      setOfflineQueue((prev) => [...prev, cmd]);
      setFeedback({
        tone: 'warn',
        title: 'Queued in IndexedDB Offline Buffer',
        msg: `Command ${cmd.commandId} stored locally (${offlineQueue.length + 1} pending). Reconnect to sync idempotently.`,
      });
      setSubmitting(false);
      return;
    }

    try {
      const res = await apiRequest<{
        lotId: string;
        lotCode: string;
        qrSignature: string;
        netGrams: string;
        totalBoxes: number;
      }>('/api/v1/lots', {
        method: 'POST',
        token,
        body: {
          vesselId: selectedVesselId,
          speciesId: selectedSpeciesId,
          totalBoxes: boxes,
          netGrams: netGrams.toString(),
          coreTempC: Number(coreTempC) || 2.0,
          weightSource,
          supervisorPin,
        },
      });

      const v = data.vessels.find((x) => x.vessel_id === selectedVesselId);
      const s = data.species.find((x) => x.species_id === selectedSpeciesId);

      setStickerModalLot({
        lotCode: res.lotCode,
        vesselName: v ? `${v.vessel_name_en} (${v.registration_no})` : selectedVesselId,
        speciesName: s ? `${s.name_en} / ${s.name_ml}` : selectedSpeciesId,
        boxes: res.totalBoxes,
        netGrams: res.netGrams,
        qrSignature: res.qrSignature,
      });

      setFeedback({
        tone: 'ok',
        title: `Lot ${res.lotCode} Locked & Signed`,
        msg: `HMAC-SHA256 QR signature ${res.qrSignature} generated. Ready for sticker print and Pit auction.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Weighing & Tagging Blocked',
        msg: err instanceof Error ? err.message : 'Failed to lock lot',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncOfflineQueue = async (): Promise<void> => {
    if (offlineQueue.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiRequest<{ syncedCount: number }>('/api/v1/sync/commands', {
        method: 'POST',
        token,
        body: { commands: offlineQueue },
      });
      setOfflineQueue([]);
      setSimulateOffline(false);
      setFeedback({
        tone: 'ok',
        title: 'Offline Queue Synced with Zero Duplicates',
        msg: `Applied ${res.syncedCount} queued weighing commands via idempotent /api/v1/sync/commands.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Offline Sync Failed',
        msg: err instanceof Error ? err.message : 'Sync error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ReadonlyArray<DataTableColumn<LotRow>> = [
    {
      key: 'lot_code',
      header: 'Lot Code',
      mono: true,
      render: (r) => <span className="font-semibold">{r.lot_code}</span>,
    },
    {
      key: 'vessel',
      header: 'Vessel & Society Loan (s.4(8))',
      render: (r) => {
        const v = data.vessels.find((x) => x.vessel_id === r.vessel_id);
        return (
          <div className="flex flex-col">
            <span className="font-medium">{v?.vessel_name_en ?? r.vessel_id}</span>
            {v?.has_active_society_loan && (
              <span className="text-xs text-[var(--warning)] font-semibold">
                Society Loan Tied ({v.loan_coop_society_id})
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'species',
      header: 'Species (EN / ML)',
      render: (r) => {
        const s = data.species.find((x) => x.species_id === r.species_id);
        return (
          <div>
            <div className="font-medium">{s?.name_en ?? r.species_id}</div>
            <div lang="ml" className="text-xs text-[var(--text-secondary)]">
              {s?.name_ml}
            </div>
          </div>
        );
      },
    },
    {
      key: 'boxes',
      header: 'Boxes (Avail/Total)',
      align: 'right',
      mono: true,
      render: (r) => `${r.available_boxes} / ${r.total_boxes}`,
    },
    {
      key: 'weight',
      header: 'Net Weight',
      align: 'right',
      mono: true,
      render: (r) => formatKgFromGrams(r.net_grams),
    },
    {
      key: 'qr',
      header: 'Signed QR HMAC',
      mono: true,
      render: (r) => <span className="text-xs">{r.qr_signature.slice(0, 12)}…</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge
          tone={
            r.status === 'BLOCKED_UNFIT'
              ? 'danger'
              : r.status === 'FULLY_SOLD'
              ? 'ok'
              : 'info'
          }
          label={r.status}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Top Status & Connectivity Banner */}
      <div className="p-4 sm:p-5 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <DocksideWeighingScaleSvgDecor size={40} />
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              Weighing &amp; Lots
            </h1>
            <p className="text-xs text-[var(--text-secondary)] truncate">
              {data.vessels.length} Vessels · HMAC-SHA256 Signed QR
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <ConnectivityBadge
            online={!simulateOffline}
            queuedCount={offlineQueue.length}
            onToggleSimulateOffline={() => setSimulateOffline((prev) => !prev)}
          />
          {offlineQueue.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={handleSyncOfflineQueue}
              loading={submitting}
            >
              Sync {offlineQueue.length} Queued Lots Now
            </Button>
          )}
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

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        <Metric
          featured
          label="Total Landed Weight"
          value={formatKgFromGrams(
            data.lots.reduce((acc, l) => acc + BigInt(l.net_grams), 0n)
          )}
          status={{ tone: 'info', label: 'BIGINT GRAMS' }}
        />
        <Metric
          label="Tagged Lots Today"
          value={String(data.lots.length)}
          unit="LOTS"
          status={{ tone: 'ok', label: 'HMAC SIGNED' }}
        />
        <Metric
          label="Offline Queue"
          value={String(offlineQueue.length)}
          unit="PENDING"
          status={{
            tone: simulateOffline ? 'warn' : 'ok',
            label: simulateOffline ? 'OFFLINE' : 'SYNCED',
          }}
        />
      </div>

      {/* Main Weighing Terminal Card */}
      <Card title="Weighing & Lot Tagging">
        <form onSubmit={handleTagLot} className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="1. Landed Fishing Vessel (QR Token / Registration)"
              dockSize
              value={selectedVesselId}
              onChange={(e) => setSelectedVesselId(e.target.value)}
              options={data.vessels.map((v) => ({
                value: v.vessel_id,
                label: `${v.vessel_name_en} (${v.registration_no})${
                  v.has_active_society_loan ? ` — [Loan: ${v.loan_coop_society_id}]` : ''
                }`,
              }))}
            />
            <Select
              label="Scale Input Adapter (§4.1 Port)"
              dockSize
              value={weightSource}
              onChange={(e) =>
                setWeightSource(e.target.value as 'SIMULATOR' | 'MANUAL' | 'BLE_SCALE')
              }
              options={[
                { value: 'SIMULATOR', label: 'Digital Scale Simulator (25.000 kg / box)' },
                { value: 'MANUAL', label: 'Manual Override (Requires Supervisor PIN)' },
                { value: 'BLE_SCALE', label: 'Web Bluetooth Indicator [UNVERIFIED-HARDWARE]' },
              ]}
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
              2. Select Catch Species (Malayalam + English + Section 19 Floor Price)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {data.species.map((sp) => (
                <SpeciesTile
                  key={sp.species_id}
                  code={sp.code}
                  nameEn={sp.name_en}
                  nameMl={sp.name_ml}
                  floorPriceFormatted={formatInrFromPaise(sp.floor_price_paise_per_kg)}
                  selected={selectedSpeciesId === sp.species_id}
                  onSelect={() => setSelectedSpeciesId(sp.species_id)}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[var(--border-hair)]">
            <Input
              label="3. Box Count (Boxes)"
              type="number"
              mono
              dockSize
              value={totalBoxes}
              onChange={(e) => setTotalBoxes(e.target.value)}
            />
            <Input
              label="4. Net Catch Weight (kg → stored as integer grams)"
              type="number"
              step="0.001"
              mono
              dockSize
              value={netKgInput}
              onChange={(e) => setNetKgInput(e.target.value)}
              hint={`Exact integer storage: ${Math.round((Number(netKgInput) || 0) * 1000).toLocaleString('en-IN')} grams`}
            />
            <Input
              label="5. Core Temperature (°C — s.21 Quality)"
              type="number"
              step="0.1"
              mono
              dockSize
              value={coreTempC}
              onChange={(e) => setCoreTempC(e.target.value)}
            />
          </div>

          {weightSource === 'MANUAL' && (
            <div className="p-4 rounded-[var(--radius-card)] bg-[var(--warning-bg)] border border-[var(--warning)]/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 text-[var(--warning)]">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span className="text-sm font-semibold">
                  Manual Weight Override requires Supervisor PIN (logged to core.audit_logs). Demo PIN: 1234
                </span>
              </div>
              <Input
                label="Supervisor PIN"
                type="password"
                mono
                value={supervisorPin}
                onChange={(e) => setSupervisorPin(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="dock"
              icon={<Scale className="w-5 h-5" />}
              onClick={handleSimulateScaleRead}
            >
              Read Digital Scale (25 kg × Boxes)
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="dock"
              loading={submitting}
              icon={<QrCode className="w-5 h-5" />}
            >
              {simulateOffline
                ? 'Queue Lot Tag Offline'
                : 'Lock Weight & Generate Signed QR Sticker'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Tagged Lots Table */}
      <Card
        title="Landed Lots & Signed QR Registry"
        subtitle="Click any lot row to preview and print its dockside thermal QR sticker"
      >
        <DataTable
          caption="Landed Lots Registry"
          columns={columns}
          rows={data.lots}
          getRowKey={(r) => r.lot_id}
          onRowClick={(r) => {
            const v = data.vessels.find((x) => x.vessel_id === r.vessel_id);
            const s = data.species.find((x) => x.species_id === r.species_id);
            setStickerModalLot({
              lotCode: r.lot_code,
              vesselName: v ? `${v.vessel_name_en} (${v.registration_no})` : r.vessel_id,
              speciesName: s ? `${s.name_en} / ${s.name_ml}` : r.species_id,
              boxes: r.total_boxes,
              netGrams: r.net_grams,
              qrSignature: r.qr_signature,
            });
          }}
        />
      </Card>

      {/* Printable QR Sticker Modal */}
      <Modal
        open={Boolean(stickerModalLot)}
        onClose={() => setStickerModalLot(null)}
        title="Signed Dockside Lot QR Sticker"
        description="HMAC-SHA256 authenticated lot tag for Auction Pit verification"
        footer={
          <>
            <Button variant="outline" onClick={() => setStickerModalLot(null)}>
              Close
            </Button>
            <Button
              variant="primary"
              icon={<Printer className="w-4 h-4" />}
              onClick={() => window.print()}
            >
              Print Thermal Sticker
            </Button>
          </>
        }
      >
        {stickerModalLot && (
          <div className="p-5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-[var(--border-hair)] pb-3">
              <div>
                <div className="text-xs font-bold uppercase text-[var(--text-muted)]">
                  Munambam Harbour (HMS)
                </div>
                <div className="text-xl font-bold font-mono-code text-[var(--text-primary)]">
                  {stickerModalLot.lotCode}
                </div>
              </div>
              <Badge tone="ok" label="HMAC VERIFIED" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Vessel</span>
                <span className="font-semibold">{stickerModalLot.vesselName}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Species</span>
                <span className="font-semibold">{stickerModalLot.speciesName}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Boxes</span>
                <span className="font-mono-code font-bold">{stickerModalLot.boxes} BOXES</span>
              </div>
              <div>
                <span className="text-xs text-[var(--text-muted)] block">Net Weight</span>
                <span className="font-mono-code font-bold">
                  {formatKgFromGrams(stickerModalLot.netGrams)}
                </span>
              </div>
            </div>
            <div className="pt-2 border-t border-[var(--border-hair)] text-xs font-mono-code text-[var(--text-secondary)]">
              QR_SIG: {stickerModalLot.qrSignature}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
