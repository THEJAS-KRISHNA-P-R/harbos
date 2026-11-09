import React from 'react';
import {
  Button,
  Card,
  Badge,
  Metric,
  DataTable,
  WorkflowStepStrip,
  HarbourCrestIcon,
  DockScaleIcon,
  AuctionGavelBellIcon,
  BuyerCrateEscrowIcon,
  FisherVesselPassbookIcon,
  ThermometerFishGradeIcon,
  HarbourLedgerVaultIcon,
  StatutorySealIcon,
  PelagicFishIcon,
  TrawlerVesselIcon,
  HarbourQuayDawnSvgDecor,
  DocksideWeighingScaleSvgDecor,
  AuctionPitAmphitheatreSvgDecor,
  StatutoryLedgerWaterfallSvgDecor,
  ColdChainInspectorSvgDecor,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import type { GoldenVectorRow } from '@web/app/components/LedgerInspectorDrawer.tsx';

export interface DesignSystemGalleryScreenProps {
  docksideMobileLayout: boolean;
  onToggleDocksideLayout: () => void;
  onOpenOverlayModal: () => void;
  onOpenProfileDrawer: () => void;
  goldenVectorRows: ReadonlyArray<GoldenVectorRow>;
}

export const DesignSystemGalleryScreen: React.FC<DesignSystemGalleryScreenProps> = ({
  docksideMobileLayout,
  onToggleDocksideLayout,
  onOpenOverlayModal,
  onOpenProfileDrawer,
  goldenVectorRows,
}) => {
  const gvColumns: ReadonlyArray<DataTableColumn<GoldenVectorRow>> = [
    { key: 'mode', header: 'Commercial Mode', render: (r) => <span className="font-semibold">{r.mode}</span> },
    { key: 'f', header: 'Fisherman Net (95%)', align: 'right', mono: true, render: (r) => r.fisherman },
    { key: 'b', header: 'Bonus Escrow (40%)', align: 'right', mono: true, render: (r) => r.bonus },
    { key: 'a', header: 'Auctioneer (20%)', align: 'right', mono: true, render: (r) => r.auctioneer },
    { key: 'h', header: 'HMS Net', align: 'right', mono: true, render: (r) => r.hms },
    { key: 'c', header: 'Co-op Net', align: 'right', mono: true, render: (r) => r.coop },
    { key: 'hos', header: 'HarbourOS / GST', align: 'right', mono: true, render: (r) => r.hos },
    { key: 'p', header: 'Buyer Payable', align: 'right', mono: true, render: (r) => <span className="font-bold">{r.payable}</span> },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
            HarbourOS Design System & Component Gallery (/ui)
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            §11 Navy-on-Off-White specification — Clean rounded pill buttons (--radius-pill: 9999px), 16px cards (--radius-card: 16px), zero green tokens, WCAG 2.1 AA verified.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="secondary" onClick={onToggleDocksideLayout}>
            {docksideMobileLayout ? 'Switch to Desktop AppShell' : 'Preview Mobile DocksideShell'}
          </Button>
          <Button variant="primary" onClick={onOpenOverlayModal}>
            Open Overlay Modal
          </Button>
        </div>
      </div>

      <WorkflowStepStrip
        steps={[
          {
            step: '01 · CONTRAST',
            title: '15.11:1 Primary Ink',
            detail: 'Navy-900 on warm off-white surface',
            done: true,
          },
          {
            step: '02 · GEOMETRY',
            title: 'Pill Controls & 16px Cards',
            detail: 'Single-elevation flat cards with 1px hairlines',
            done: true,
          },
          {
            step: '03 · HYGIENE',
            title: 'Zero Green Tokens',
            detail: 'Semantic state via Navy check + explicit label',
            done: true,
          },
          {
            step: '04 · IDENTITY',
            title: 'HS256 JWT & RLS Profile',
            detail: 'Live operator profile & role persona drawer',
            active: true,
            onClick: onOpenProfileDrawer,
          },
        ]}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric
          featured
          label="Primary Ink Contrast"
          value="15.11 : 1"
          unit="WCAG AAA"
          sublabel="var(--text-primary) on var(--bg-app)"
          formulaCue="Minimum required: 4.5:1 (WCAG 2.1 AA)"
          status={{ tone: 'ok', label: 'VERIFIED' }}
        />
        <Metric
          label="Brand Pill Contrast"
          value="11.57 : 1"
          unit="WCAG AAA"
          sublabel="var(--brand-fg) on var(--brand)"
          formulaCue="--radius-pill: 9999px on all buttons"
          status={{ tone: 'ok', label: 'PILL BUTTON' }}
        />
        <Metric
          label="Control Border Contrast"
          value="3.57 : 1"
          unit="WCAG 1.4.11"
          sublabel="var(--border-strong) on var(--bg-app)"
          formulaCue="Minimum required: 3.0:1 non-text AA"
          status={{ tone: 'info', label: 'NON-TEXT AA' }}
        />
      </div>

      <Card
        stepBadge="§11.2"
        kicker="Interactive Controls"
        title="Clean Rounded Pill Buttons & Status Pills"
        subtitle="All buttons and status pills use --radius-pill (9999px); status is never colour-only"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary Navy Pill</Button>
            <Button variant="secondary">Secondary Soft Pill</Button>
            <Button variant="outline">Outline Strong Pill</Button>
            <Button variant="danger">Danger Pill</Button>
            <Button variant="ghost">Ghost Pill</Button>
            <Button variant="primary" size="dock">
              Dockside 64px+ Touch Target Pill
            </Button>
          </div>
          <div className="pt-4 border-t border-[var(--border-hair)] flex flex-wrap items-center gap-2.5">
            <Badge tone="ok" label="Settled / Done" code="SHA-256" />
            <Badge tone="info" label="Clearing Escrow" code="s.4(5)" />
            <Badge tone="warn" label="Floor Price Warn" code="s.19" />
            <Badge tone="danger" label="Rejected Unfit" code="s.21" />
            <Badge tone="neutral" label="Pending Sync" />
          </div>
        </div>
      </Card>

      <Card
        stepBadge="ASSETS"
        kicker="Maritime Iconography & Illustrations"
        title="Custom Lightweight Maritime Icons + Mellow Contextual Illustrations"
        subtitle="1.5px monoline vector icons and warm Navy-on-Off-White contextual harbour illustrations"
      >
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Harbour Crest', icon: <HarbourCrestIcon size={22} /> },
              { label: 'Dock Scale', icon: <DockScaleIcon size={22} /> },
              { label: 'Auction Gavel', icon: <AuctionGavelBellIcon size={22} /> },
              { label: 'Buyer Escrow', icon: <BuyerCrateEscrowIcon size={22} /> },
              { label: 'Fisher Passbook', icon: <FisherVesselPassbookIcon size={22} /> },
              { label: 's.21 Grade', icon: <ThermometerFishGradeIcon size={22} /> },
              { label: 'HMS Ledger', icon: <HarbourLedgerVaultIcon size={22} /> },
              { label: 'Statutory Seal', icon: <StatutorySealIcon size={22} /> },
              { label: 'Pelagic Fish', icon: <PelagicFishIcon size={22} /> },
              { label: 'Trawler Vessel', icon: <TrawlerVesselIcon size={22} /> },
            ].map((item) => (
              <div
                key={item.label}
                className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex items-center gap-3 text-[var(--brand)]"
              >
                {item.icon}
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="p-4 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <HarbourQuayDawnSvgDecor size={48} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                    Harbour Governance Spot
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">
                    Lighthouse + statutory check coin
                  </div>
                </div>
              </div>
              <Badge tone="ok" label="48×48 SPOT" />
            </div>

            <div className="p-4 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <DocksideWeighingScaleSvgDecor size={48} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                    Dockside Scale & QR Spot
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">
                    Precision dial + QR matrix coin
                  </div>
                </div>
              </div>
              <Badge tone="info" label="BIGINT GRAMS" />
            </div>

            <div className="p-4 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <AuctionPitAmphitheatreSvgDecor size={48} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                    Auction Pit Clearing Spot
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">
                    Gavel + sound block + bid coin
                  </div>
                </div>
              </div>
              <Badge tone="ok" label="s.19 + s.4(8)" />
            </div>

            <div className="p-4 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <StatutoryLedgerWaterfallSvgDecor size={48} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                    Double-Entry Ledger Spot
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">
                    Interlocking coins + shield lock
                  </div>
                </div>
              </div>
              <Badge tone="ok" label="SHA-256" />
            </div>

            <div className="p-4 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <ColdChainInspectorSvgDecor size={48} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                    Cold-Chain s.21 Spot
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">
                    Thermometer + hygiene check coin
                  </div>
                </div>
              </div>
              <Badge tone="info" label="ACT 16 s.21" />
            </div>
          </div>
        </div>
      </Card>

      <Card
        stepBadge="§2"
        kicker="Integer Paise Invariants"
        title="§2 Golden Vectors Verification Table (₹1,00,000 Hammer = 10,000,000 Paise)"
        subtitle="Verified by automated unit & property tests in tests/unit/ and backend-go/internal/domain/settlement_test.go"
      >
        <DataTable
          caption="Section 2 Golden Vectors"
          columns={gvColumns}
          rows={goldenVectorRows}
          getRowKey={(r) => r.mode}
        />
      </Card>
    </div>
  );
};
