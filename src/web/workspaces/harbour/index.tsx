import React, { useState } from 'react';
import {
  FileDown,
  Printer,
  CheckCircle2,
  RotateCcw,
  Landmark,
  ShieldCheck,
  X,
  ArrowRight,
  Clock,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  Tabs,
  DataTable,
  Input,
  Select,
  Toast,
  SpeciesGlyph,
  WorkspaceSkeleton,
  humanizeCode,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  downloadTextFile,
  filterAuditLogs,
  formatInrFromPaise,
  formatKgFromGrams,
  type BootstrapData,
  type SpeciesRow,
  type LicenceRow,
  type PayoutBatchRow,
  type ReversalRow,
  type AccountRow,
  type AuditLogRow,
} from '@web/lib/api.ts';
import type { FloorEnforcement } from '@shared/ids.ts';
import { useI18n } from '@web/i18n/index.tsx';
import { MasterdataCsvPanel } from './MasterdataCsvPanel.tsx';
import { ReportsShadowPanel } from './ReportsShadowPanel.tsx';

export const HarbourWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  loading?: boolean;
  onRefresh: () => Promise<void>;
}> = ({ data, token, loading = false, onRefresh }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'today' | 'masterdata' | 'accounting' | 'reports' | 'audit'>('today');
  const [utrInput, setUtrInput] = useState('UTR-FEDB-20261106-994182');
  const [floorEditSpeciesId, setFloorEditSpeciesId] = useState(
    data.species[0]?.species_id ?? 'SPC-01'
  );
  const [floorEditRupees, setFloorEditRupees] = useState('700');
  const [floorEnforcement, setFloorEnforcement] = useState<FloorEnforcement>(
    data.tenant?.floor_enforcement ?? 'WARN'
  );
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [auditRoleFilter, setAuditRoleFilter] = useState('ALL');
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null>(null);

  const allAuditLogs = data.auditLogs ?? [];
  const filteredAuditLogs = filterAuditLogs(allAuditLogs, auditSearchQuery, auditRoleFilter);
  const pendingBatchesCount = data.payoutBatches.filter(
    (b) => b.status === 'GENERATED_CSV'
  ).length;

  const totalGtvPaise = data.allocations.reduce(
    (acc, a) => acc + BigInt(a.hammer_paise),
    0n
  );
  const totalBonusEscrowPaise = data.allocations.reduce(
    (acc, a) => acc + BigInt(a.bonus_escrow_paise),
    0n
  );

  const handleUpdateFloorSchedule = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      const floorPaise = BigInt(Math.round((Number(floorEditRupees) || 0) * 100));
      await apiRequest('/api/v1/floor-prices', {
        method: 'POST',
        token,
        body: {
          floorEnforcement,
          speciesId: floorEditSpeciesId,
          floorPricePaisePerKg: floorPaise.toString(),
        },
      });
      setFeedback({
        tone: 'ok',
        title: 'Floor price schedule updated',
        msg: `Enforcement mode set to ${humanizeCode(floorEnforcement)}; species floor updated to ₹${floorEditRupees}/kg.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Update Failed',
        msg: err instanceof Error ? err.message : 'Error updating floor price',
      });
    }
  };

  const handleGenerateBatch = async (): Promise<void> => {
    try {
      const res = await apiRequest<{ batchCode: string }>('/api/v1/payout-batches', {
        method: 'POST',
        token,
      });
      setFeedback({
        tone: 'ok',
        title: `Payout Batch ${res.batchCode} Generated`,
        msg: 'CSV bank settlement instruction prepared for nodal bank upload.',
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Batch Generation Failed',
        msg: err instanceof Error ? err.message : 'Error',
      });
    }
  };

  const handleReconcileBatch = async (batchId: string): Promise<void> => {
    try {
      await apiRequest(`/api/v1/payout-batches/${batchId}/reconcile`, {
        method: 'POST',
        token,
        body: { bankUtr: utrInput },
      });
      setFeedback({
        tone: 'ok',
        title: 'Bank UTR Reconciled',
        msg: `Batch ${batchId} reconciled with UTR ${utrInput} — zero unexplained difference.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'UTR Reconciliation Failed',
        msg: err instanceof Error ? err.message : 'Error',
      });
    }
  };

  const handleApproveDualKeyReversal = async (reversalId: string): Promise<void> => {
    try {
      const res = await apiRequest<{ compensatingJournalId: string }>(
        '/api/v1/ledger/reversals',
        {
          method: 'POST',
          token,
          body: { action: 'APPROVE', reversalId },
        }
      );
      setFeedback({
        tone: 'ok',
        title: `Dual-Key Reversal Executed: ${res.compensatingJournalId}`,
        msg: 'Compensating journal posted with two distinct authorizing users (Accountant + Harbour Admin).',
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Dual-Key Guardrail Blocked Approval',
        msg:
          err instanceof Error
            ? err.message
            : 'Approver must be a different user than requester',
      });
    }
  };

  const handleExportSection22ReturnCsv = (): void => {
    const headers = [
      'Tenant Harbour',
      'Statutory Basis',
      'Allocation ID',
      'Auctioneer Licence ID',
      'Lot Code',
      'Boxes Sold',
      'Weight Grams',
      'Hammer Price (INR)',
      'Fisherman Net 95% (INR)',
      'Auctioneer 20% Share (INR)',
      'HMS 20% Share (INR)',
      'Fisher Bonus 40% Escrow (INR)',
      'Co-op 20% Share (INR)',
      'Journal ID',
      'Timestamp',
    ];
    const rows = data.allocations.map((a) => {
      const lot = data.lots.find((l) => l.lot_id === a.lot_id);
      return [
        `"${data.tenant?.name_en ?? 'Munambam HMS'}"`,
        '"Kerala Act 16 of 2021 Section 22 Return"',
        a.allocation_id,
        a.auctioneer_licence_id,
        lot?.lot_code ?? a.lot_id,
        String(a.boxes_allocated),
        a.grams_allocated,
        formatInrFromPaise(a.hammer_paise),
        formatInrFromPaise(a.fisherman_net_paise),
        formatInrFromPaise(a.auctioneer_paise),
        formatInrFromPaise(a.hms_net_paise),
        formatInrFromPaise(a.bonus_escrow_paise),
        formatInrFromPaise(a.coop_net_paise),
        a.journal_id,
        a.created_at,
      ].join(',');
    });
    downloadTextFile(
      `HarbourOS-Section22-Statutory-Return-${new Date().toISOString().slice(0, 10)}.csv`,
      [headers.join(','), ...rows].join('\n')
    );
  };

  const speciesColumns: ReadonlyArray<DataTableColumn<SpeciesRow>> = [
    { key: 'code', header: t('harbour.code'), mono: true, render: (r) => r.code },
    {
      key: 'name',
      header: t('harbour.species'),
      render: (r) => (
        <div className="flex items-center gap-2 min-w-0">
          <SpeciesGlyph code={`${r.code} ${r.name_en}`} size={20} className="shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold">{r.name_en}</span>{' '}
            <span lang="ml" className="text-[var(--text-secondary)]">
              ({r.name_ml})
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'sci',
      header: t('harbour.scientificName'),
      render: (r) => <span className="italic text-[var(--text-muted)]">{r.scientific_name}</span>,
    },
    {
      key: 'floor',
      header: t('harbour.floorPrice'),
      align: 'right',
      mono: true,
      render: (r) => (
        <span className="font-bold">{formatInrFromPaise(r.floor_price_paise_per_kg)} / kg</span>
      ),
    },
  ];

  const licenceColumns: ReadonlyArray<DataTableColumn<LicenceRow>> = [
    { key: 'no', header: t('harbour.licenceNo'), mono: true, render: (r) => r.licence_no },
    { key: 'name', header: t('harbour.auctioneerName'), render: (r) => <span className="font-semibold">{r.auctioneer_name}</span> },
    {
      key: 'soc',
      header: t('harbour.coopSociety'),
      mono: true,
      render: (r) => r.deputed_by_society_id ?? 'Independent (Non-Loan Vessels Only)',
    },
    {
      key: 'validity',
      header: t('harbour.validityWindow'),
      mono: true,
      render: (r) => `${r.valid_from} → ${r.valid_until}`,
    },
    {
      key: 'status',
      header: t('harbour.status'),
      render: (r) => (
        <Badge
          tone={r.status === 'ACTIVE' ? 'ok' : 'danger'}
          label={r.status}
        />
      ),
    },
  ];

  const batchColumns: ReadonlyArray<DataTableColumn<PayoutBatchRow>> = [
    {
      key: 'code',
      header: t('harbour.batchCode'),
      render: (r) => (
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-semibold font-mono-code text-xs sm:text-sm">{r.batch_code}</span>
          <span className="text-xs text-[var(--text-secondary)]">{humanizeCode(r.beneficiary_kind)}</span>
        </div>
      ),
    },
    {
      key: 'amt',
      header: t('harbour.totalAmount'),
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold whitespace-nowrap">{formatInrFromPaise(r.total_amount_paise)}</span>,
    },
    {
      key: 'status',
      header: t('harbour.reconciliationStatus'),
      render: (r) => (
        <Badge
          tone={r.status === 'RECONCILED_UTR' ? 'ok' : 'warn'}
          label={r.status}
          code={r.bank_utr ?? undefined}
        />
      ),
    },
    {
      key: 'action',
      header: t('harbour.bankUtrAction'),
      align: 'right',
      render: (r) =>
        r.status === 'GENERATED_CSV' ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleReconcileBatch(r.batch_id)}
          >
            {t('harbour.reconcileUtr')}
          </Button>
        ) : (
          <span className="text-xs font-mono-code text-[var(--text-secondary)]">
            {t('harbour.verifiedUtr')}: {r.bank_utr}
          </span>
        ),
    },
  ];

  const reversalColumns: ReadonlyArray<DataTableColumn<ReversalRow>> = [
    { key: 'id', header: 'Reversal ID', mono: true, render: (r) => r.reversal_id },
    { key: 'orig', header: 'Original Journal', mono: true, render: (r) => r.original_journal_id },
    { key: 'reason', header: 'Mandatory Reason', render: (r) => r.reason_note },
    { key: 'req', header: 'Key 1 (Requested By)', render: (r) => r.requested_by_name },
    {
      key: 'status',
      header: t('harbour.status'),
      render: (r) => (
        <Badge
          tone={r.status === 'EXECUTED' ? 'ok' : 'warn'}
          label={r.status}
          code={r.compensating_journal_id ?? undefined}
        />
      ),
    },
    {
      key: 'act',
      header: 'Key 2 Approval',
      align: 'right',
      render: (r) =>
        r.status === 'PENDING_SECOND_APPROVAL' ? (
          <Button
            variant="primary"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={() => handleApproveDualKeyReversal(r.reversal_id)}
          >
            Approve 2nd Key & Post Reversal
          </Button>
        ) : (
          <span className="text-xs text-[var(--text-secondary)]">
            Approved by {r.approved_by_name}
          </span>
        ),
    },
  ];

  const accountColumns: ReadonlyArray<DataTableColumn<AccountRow>> = [
    { key: 'code', header: t('harbour.ledgerCode'), mono: true, render: (r) => r.code },
    { key: 'name', header: t('harbour.accountName'), render: (r) => <span className="font-semibold">{r.name_en}</span> },
    { key: 'kind', header: t('harbour.accountKind'), render: (r) => <Badge tone="info" label={r.kind} /> },
    {
      key: 'bal',
      header: t('harbour.currentBalance'),
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">{formatInrFromPaise(r.balance_paise)}</span>,
    },
  ];

  const auditColumns: ReadonlyArray<DataTableColumn<AuditLogRow>> = [
    {
      key: 'time',
      header: t('harbour.timestamp'),
      mono: true,
      render: (r) => r.created_at.replace('T', ' ').slice(0, 19),
    },
    {
      key: 'actor',
      header: t('harbour.actor'),
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-[var(--text-primary)]">
            {r.actor_name ?? r.actor_user_id}
          </span>
          <span className="text-xs font-mono-code text-[var(--text-muted)]">
            {r.actor_user_id} · {humanizeCode(r.actor_role)}
          </span>
        </div>
      ),
    },
    {
      key: 'action',
      header: t('harbour.actionCode'),
      render: (r) => (
        <Badge
          tone={
            r.action_code.includes('REJECTED')
              ? 'danger'
              : r.action_code.includes('REVERSAL')
              ? 'warn'
              : 'ok'
          }
          label={r.action_code}
        />
      ),
    },
    {
      key: 'target',
      header: t('harbour.targetId'),
      mono: true,
      render: (r) => (
        <div>
          <span className="font-semibold text-[var(--text-primary)]">{r.target_id}</span>
          <span className="text-xs text-[var(--text-muted)] ml-1.5">({r.target_type})</span>
        </div>
      ),
    },
    {
      key: 'details',
      header: t('harbour.details'),
      mono: true,
      render: (r) => (
        <span className="text-xs text-[var(--text-secondary)] break-all">{r.details_json}</span>
      ),
    },
  ];

  const auditLogsSection = (
    <Card
      title={t('harbour.auditLogsTitle')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone="info"
            label={`${filteredAuditLogs.length} / ${allAuditLogs.length}`}
          />
          {(auditSearchQuery.trim() !== '' || auditRoleFilter !== 'ALL') && (
            <Button
              variant="outline"
              size="sm"
              icon={<X className="w-3.5 h-3.5" />}
              onClick={() => {
                setAuditSearchQuery('');
                setAuditRoleFilter('ALL');
              }}
            >
              {t('harbour.reset')}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <Input
              label={t('harbour.searchAuditLogs')}
              type="search"
              placeholder="Actor, action code, or target ID…"
              value={auditSearchQuery}
              onChange={(e) => setAuditSearchQuery(e.target.value)}
            />
          </div>
          <Select
            label={t('harbour.roleFilter')}
            value={auditRoleFilter}
            onChange={(e) => setAuditRoleFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All roles' },
              { value: 'HARBOUR_ADMIN', label: 'Harbour admin' },
              { value: 'ACCOUNTANT', label: 'Accountant' },
              { value: 'LICENSED_AUCTIONEER', label: 'Licensed auctioneer' },
              { value: 'WEIGHING_OPERATOR', label: 'Weighing operator' },
              { value: 'AUTHORIZED_INSPECTOR', label: 'Quality inspector' },
              { value: 'SUPER_ADMIN', label: 'Platform admin' },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { label: 'All', query: '' },
            { label: 'Allocations', query: 'LOT_ALLOCATED' },
            { label: 'Rejections', query: 'REJECTED_S21' },
            { label: 'Reversals', query: 'REVERSAL' },
            { label: 'Batches', query: 'PAYOUT_BATCH' },
          ].map((preset) => (
            <Button
              key={preset.label}
              variant={auditSearchQuery === preset.query ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setAuditSearchQuery(preset.query)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <DataTable
          caption="Statutory Harbour Audit Logs"
          columns={auditColumns}
          rows={filteredAuditLogs}
          getRowKey={(r) => r.audit_id}
          emptyTitle="No matching audit log entries"
          emptyDescription="No audit records matched your actor, action code, or target ID query. Try clearing the search filter."
        />
      </div>
    </Card>
  );

  if (loading) {
    return <WorkspaceSkeleton workspace="harbour" label={t('workspaces.loadingWorkspace')} />;
  }

  return (
    <div className="flex flex-col gap-3.5 sm:gap-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
            {data.tenant?.name_en ?? 'Harbour Operations'}
          </h1>
          <p className="text-[11px] sm:text-xs text-[var(--text-muted)] truncate">
            Policy {data.tenant?.active_policy_id} · <span lang="ml">{data.tenant?.name_ml}</span>
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto min-w-0">
          <Button
            variant="secondary"
            size="sm"
            icon={<FileDown className="w-3.5 h-3.5" />}
            onClick={handleExportSection22ReturnCsv}
            className="self-start sm:self-auto"
          >
            {t('harbour.exportReturnCsv')}
          </Button>
          <div className="w-full sm:w-auto min-w-0">
            <Tabs
              items={[
                { id: 'today', label: t('workspaces.harbourTabOverview'), badge: data.lots.length },
                { id: 'masterdata', label: t('workspaces.harbourTabMasterdata'), badge: data.vessels.length },
                { id: 'accounting', label: t('workspaces.harbourTabAccounting'), badge: data.reversals.length },
                { id: 'reports', label: t('workspaces.harbourTabReports') },
                { id: 'audit', label: t('workspaces.harbourTabAudit'), badge: allAuditLogs.length },
              ]}
              activeId={activeTab}
              onChange={(id) =>
                setActiveTab(id as 'today' | 'masterdata' | 'accounting' | 'reports' | 'audit')
              }
            />
          </div>
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

      {/* Compact 3-Metric Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4">
        <div className="col-span-2 sm:col-span-1">
          <Metric
            featured
            label={t('harbour.gtv')}
            value={formatInrFromPaise(totalGtvPaise)}
            sublabel={`${data.allocations.length} ${t('harbour.allocationsSettled')}`}
            status={{ tone: 'ok', label: 'BALANCED' }}
          />
        </div>
        <Metric
          label={t('harbour.fisherBonus')}
          value={formatInrFromPaise(totalBonusEscrowPaise)}
          sublabel={t('harbour.bonusSub')}
          status={{ tone: 'info', label: 'ESCROW' }}
        />
        <Metric
          label={t('harbour.ledger')}
          value={`${data.ledgerVerification.entryCount} ${t('harbour.ledgerRows')}`}
          sublabel={`Head ${data.ledgerVerification.headHash.slice(0, 12)}…`}
          status={{
            tone: data.ledgerVerification.verified ? 'ok' : 'danger',
            label: data.ledgerVerification.verified ? 'VERIFIED' : 'ALERT',
          }}
        />
      </div>

      {activeTab === 'today' && (
        <div
          data-testid="harbour-office-grid"
          className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-5 items-start"
        >
          {/* Main Office Column: Clearing Table, Floor Schedule Table, Licensed Auctioneers */}
          <div className="xl:col-span-8 flex flex-col gap-4 sm:gap-5 min-w-0">
            <Card
              title={t('harbour.payoutBatchesTitle')}
              actions={
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Landmark className="w-3.5 h-3.5" />}
                  onClick={handleGenerateBatch}
                >
                  {t('harbour.newBatch')}
                </Button>
              }
            >
              <DataTable
                caption="Payout Batches"
                columns={batchColumns}
                rows={data.payoutBatches}
                getRowKey={(r) => r.batch_id}
              />
            </Card>

            <Card
              title={t('harbour.floorScheduleTitle')}
              actions={
                <Badge
                  tone={floorEnforcement === 'BLOCK' ? 'warn' : 'info'}
                  label={floorEnforcement}
                />
              }
            >
              <DataTable
                caption="Species Floor Schedule"
                columns={speciesColumns}
                rows={data.species}
                getRowKey={(r) => r.species_id}
              />
            </Card>

            <Card title={t('harbour.licensedAuctioneersTitle')}>
              <DataTable
                caption="Licensed Auctioneers Registry"
                columns={licenceColumns}
                rows={data.licences}
                getRowKey={(r) => r.licence_id}
              />
            </Card>
          </div>

          {/* Sticky Desktop Office Side Panel: Quick Clearing, Quick Floor Price Update & Recent Activity */}
          <aside className="xl:col-span-4 flex flex-col gap-4 xl:sticky xl:top-20 min-w-0">
            <Card
              title={t('harbour.utrClearingPanelTitle')}
              subtitle={t('harbour.utrClearingPanelSub')}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-secondary)]">
                    {t('harbour.pendingBatches')}
                  </span>
                  <Badge
                    tone={pendingBatchesCount > 0 ? 'warn' : 'ok'}
                    label={String(pendingBatchesCount)}
                  />
                </div>
                <Input
                  label={t('harbour.bankUtrReference')}
                  mono
                  value={utrInput}
                  onChange={(e) => setUtrInput(e.target.value)}
                  placeholder="UTR reference…"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Landmark className="w-3.5 h-3.5" />}
                  onClick={handleGenerateBatch}
                  className="w-full"
                >
                  {t('harbour.newBatch')}
                </Button>
              </div>
            </Card>

            <Card
              title={t('harbour.quickFloorTitle')}
              subtitle={t('harbour.quickFloorSubtitle')}
            >
              <form onSubmit={handleUpdateFloorSchedule} className="flex flex-col gap-3">
                <Select
                  label={t('harbour.enforcementLabel')}
                  value={floorEnforcement}
                  onChange={(e) => setFloorEnforcement(e.target.value as FloorEnforcement)}
                  options={[
                    { value: 'WARN', label: 'Warn — flag sales below floor' },
                    { value: 'BLOCK', label: 'Block — reject sales below floor' },
                    { value: 'OFF', label: 'Off — advisory only' },
                  ]}
                />
                <Select
                  label={t('harbour.speciesToUpdate')}
                  value={floorEditSpeciesId}
                  onChange={(e) => setFloorEditSpeciesId(e.target.value)}
                  options={data.species.map((s) => ({
                    value: s.species_id,
                    label: `${s.name_en} (${s.code})`,
                  }))}
                />
                <Input
                  label={t('harbour.newFloorPrice')}
                  type="number"
                  mono
                  value={floorEditRupees}
                  onChange={(e) => setFloorEditRupees(e.target.value)}
                />
                <Button type="submit" variant="primary" className="w-full">
                  {t('harbour.saveFloorSchedule')}
                </Button>
              </form>
            </Card>

            <Card
              title={t('harbour.recentActivityTitle')}
              actions={
                <Badge tone="info" label={String(allAuditLogs.length)} />
              }
            >
              <div className="flex flex-col gap-2.5">
                {allAuditLogs.slice(0, 5).map((log) => (
                  <div
                    key={log.audit_id}
                    className="p-2.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--text-primary)] truncate">
                        {humanizeCode(log.action_code)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono-code text-[11px] text-[var(--text-muted)] shrink-0">
                        <Clock className="w-3 h-3" />
                        {log.created_at.slice(11, 16)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--text-secondary)] truncate">
                      {log.actor_name ?? log.actor_user_id} · {humanizeCode(log.actor_role)} ·{' '}
                      <span className="font-mono-code">{log.target_id}</span>
                    </div>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                  onClick={() => setActiveTab('audit')}
                  className="w-full mt-1"
                >
                  {t('harbour.openFullAudit')}
                </Button>
              </div>
            </Card>
          </aside>
        </div>
      )}

      {activeTab === 'masterdata' && (
        <MasterdataCsvPanel data={data} token={token} onRefresh={onRefresh} />
      )}

      {activeTab === 'accounting' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          <div className="xl:col-span-7 flex flex-col gap-5 min-w-0">
            <Card
              title={t('harbour.payoutBatchesTitle')}
              subtitle="Close the harbour day: generate CSV payout batch → import bank UTR → zero unexplained difference"
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    label={t('harbour.bankUtrReference')}
                    mono
                    value={utrInput}
                    onChange={(e) => setUtrInput(e.target.value)}
                  />
                  <Button
                    variant="primary"
                    icon={<Landmark className="w-4 h-4" />}
                    onClick={handleGenerateBatch}
                  >
                    {t('harbour.newBatch')}
                  </Button>
                </div>
              }
            >
              <DataTable
                caption="Payout Batches and UTR Reconciliation"
                columns={batchColumns}
                rows={data.payoutBatches}
                getRowKey={(r) => r.batch_id}
              />
            </Card>

            <Card
              title={t('harbour.dualKeyReversalsTitle')}
              subtitle={t('harbour.dualKeyReversalsSub')}
            >
              <DataTable
                caption="Dual-Key Reversal Queue"
                columns={reversalColumns}
                rows={data.reversals}
                getRowKey={(r) => r.reversal_id}
              />
            </Card>
          </div>

          <div className="xl:col-span-5 xl:sticky xl:top-20 min-w-0">
            <Card
              title={t('harbour.ledgerAccountsTitle')}
              subtitle={t('harbour.ledgerAccountsSub')}
            >
              <DataTable
                caption="Statutory Ledger Accounts"
                columns={accountColumns}
                rows={data.accounts}
                getRowKey={(r) => r.account_id}
              />
            </Card>
          </div>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="flex flex-col gap-6">
          <ReportsShadowPanel data={data} token={token} />
          <Card
            title="Statutory Compliance Exports & Auctioneer Return"
            subtitle="Download CSV ledgers or print-ready statutory audit statements"
            actions={
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  variant="primary"
                  icon={<FileDown className="w-4 h-4" />}
                  onClick={handleExportSection22ReturnCsv}
                >
                  Download Auctioneer Return (CSV)
                </Button>
                <Button
                  variant="secondary"
                  icon={<Printer className="w-4 h-4" />}
                  onClick={() => window.print()}
                >
                  Print Statutory PDF Report
                </Button>
              </div>
            }
            sunkenFooter={
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-[var(--brand)]" />
                  <span>
                    Report totals verified equal to ledger balances for {data.tenant?.name_en}
                  </span>
                </span>
                <span className="font-mono-code">Generated at {new Date().toISOString()}</span>
              </div>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">
                    Licensed Auctioneer Return
                  </span>
                  <Badge tone="ok" label="READY" />
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  Itemizes every lot auctioned, vessel registration, winning buyer, gross hammer value, and the 5% statutory apportionment for submission to the Authorised Officer.
                </p>
                <div className="text-xs font-mono-code text-[var(--text-muted)] pt-1">
                  Total Volume:{' '}
                  {formatKgFromGrams(
                    data.allocations.reduce((acc, a) => acc + BigInt(a.grams_allocated), 0n)
                  )}{' '}
                  across {data.allocations.length} allocations
                </div>
              </div>

              <div className="p-5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">
                    HMS Daily Apportionment & Escrow Certificate
                  </span>
                  <Badge tone="ok" label="SHA-256 ANCHORED" />
                </div>
                <p className="text-sm text-[var(--text-secondary)]">
                  Reconciles 95% Fisherman Net Payables, 20% Auctioneer, 20% HMS, 40% Fisher Annual Bonus Escrow, and 20% Primary Co-op Society shares to the paisa.
                </p>
                <div className="text-xs font-mono-code text-[var(--text-muted)] pt-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[var(--brand)]" />
                  <span>Head Hash: {data.ledgerVerification.headHash.slice(0, 24)}…</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'audit' && <div className="flex flex-col gap-6">{auditLogsSection}</div>}
    </div>
  );
};
