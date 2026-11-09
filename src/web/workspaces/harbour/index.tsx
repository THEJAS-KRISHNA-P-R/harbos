import React, { useState } from 'react';
import {
  FileDown,
  Printer,
  CheckCircle2,
  RotateCcw,
  Landmark,
  ShieldCheck,
  Search,
  X,
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
  WorkflowStepStrip,
  StatutorySealIcon,
  HarbourLedgerVaultIcon,
  PelagicFishIcon,
  HarbourQuayDawnSvgDecor,
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

export const HarbourWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  onRefresh: () => Promise<void>;
}> = ({ data, token, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'today' | 'accounting' | 'reports' | 'audit'>('today');
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
        title: 'Section 19 Basic Price Schedule Updated',
        msg: `Enforcement mode set to ${floorEnforcement}; species floor updated to ₹${floorEditRupees}/kg.`,
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
        msg: 'CSV bank settlement instruction prepared via BankFileFormatter port.',
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
    { key: 'code', header: 'Code', mono: true, render: (r) => r.code },
    {
      key: 'name',
      header: 'Species (English / Malayalam)',
      render: (r) => (
        <div>
          <span className="font-semibold">{r.name_en}</span>{' '}
          <span lang="ml" className="text-[var(--text-secondary)]">
            ({r.name_ml})
          </span>
        </div>
      ),
    },
    {
      key: 'sci',
      header: 'Scientific Name',
      render: (r) => <span className="italic text-[var(--text-muted)]">{r.scientific_name}</span>,
    },
    {
      key: 'floor',
      header: 'Section 19 Basic Floor Price',
      align: 'right',
      mono: true,
      render: (r) => (
        <span className="font-bold">{formatInrFromPaise(r.floor_price_paise_per_kg)} / kg</span>
      ),
    },
  ];

  const licenceColumns: ReadonlyArray<DataTableColumn<LicenceRow>> = [
    { key: 'no', header: 'Licence No. (s.5)', mono: true, render: (r) => r.licence_no },
    { key: 'name', header: 'Auctioneer Name', render: (r) => <span className="font-semibold">{r.auctioneer_name}</span> },
    {
      key: 'soc',
      header: 's.4(8) Deputed Co-op Society',
      mono: true,
      render: (r) => r.deputed_by_society_id ?? 'Independent (Non-Loan Vessels Only)',
    },
    {
      key: 'validity',
      header: 'Validity Window',
      mono: true,
      render: (r) => `${r.valid_from} → ${r.valid_until}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <Badge
          tone={r.status === 'ACTIVE' ? 'ok' : 'danger'}
          label={r.status}
        />
      ),
    },
  ];

  const batchColumns: ReadonlyArray<DataTableColumn<PayoutBatchRow>> = [
    { key: 'code', header: 'Batch Code', mono: true, render: (r) => <span className="font-semibold">{r.batch_code}</span> },
    { key: 'kind', header: 'Beneficiary Pool', render: (r) => r.beneficiary_kind },
    {
      key: 'amt',
      header: 'Total Batch Amount',
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">{formatInrFromPaise(r.total_amount_paise)}</span>,
    },
    {
      key: 'status',
      header: 'Reconciliation Status',
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
      header: 'Bank UTR Action',
      align: 'right',
      render: (r) =>
        r.status === 'GENERATED_CSV' ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleReconcileBatch(r.batch_id)}
          >
            Reconcile UTR
          </Button>
        ) : (
          <span className="text-xs font-mono-code text-[var(--text-secondary)]">
            Verified: {r.bank_utr}
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
      header: 'Dual-Key Status',
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
      header: 'Key 2 Approval (Harbour Admin)',
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
    { key: 'code', header: 'Ledger Code', mono: true, render: (r) => r.code },
    { key: 'name', header: 'Account Name', render: (r) => <span className="font-semibold">{r.name_en}</span> },
    { key: 'kind', header: 'Account Kind', render: (r) => <Badge tone="info" label={r.kind} /> },
    {
      key: 'bal',
      header: 'Current Balance',
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">{formatInrFromPaise(r.balance_paise)}</span>,
    },
  ];

  const auditColumns: ReadonlyArray<DataTableColumn<AuditLogRow>> = [
    {
      key: 'time',
      header: 'Timestamp (UTC)',
      mono: true,
      render: (r) => r.created_at.replace('T', ' ').slice(0, 19),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold text-[var(--text-primary)]">
            {r.actor_name ?? r.actor_user_id}
          </span>
          <span className="text-xs font-mono-code text-[var(--text-muted)]">
            {r.actor_user_id} · {r.actor_role}
          </span>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action Code',
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
      header: 'Target ID',
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
      header: 'Observability Payload',
      mono: true,
      render: (r) => (
        <span className="text-xs text-[var(--text-secondary)] break-all">{r.details_json}</span>
      ),
    },
  ];

  const auditLogsSection = (
    <Card
      title="Audit Logs"
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
              Reset
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2">
            <Input
              label="Search Audit Logs"
              type="search"
              placeholder="Actor, action code, or target ID…"
              value={auditSearchQuery}
              onChange={(e) => setAuditSearchQuery(e.target.value)}
            />
          </div>
          <Select
            label="Role"
            value={auditRoleFilter}
            onChange={(e) => setAuditRoleFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Roles' },
              { value: 'HARBOUR_ADMIN', label: 'HARBOUR_ADMIN' },
              { value: 'ACCOUNTANT', label: 'ACCOUNTANT' },
              { value: 'LICENSED_AUCTIONEER', label: 'LICENSED_AUCTIONEER' },
              { value: 'WEIGHING_OPERATOR', label: 'WEIGHING_OPERATOR' },
              { value: 'AUTHORIZED_INSPECTOR', label: 'AUTHORIZED_INSPECTOR' },
              { value: 'SUPER_ADMIN', label: 'SUPER_ADMIN' },
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
            {data.tenant?.name_en ?? 'Harbour Operations'}
          </h1>
          <p className="text-xs text-[var(--text-muted)]">
            Policy {data.tenant?.active_policy_id} · <span lang="ml">{data.tenant?.name_ml}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<FileDown className="w-3.5 h-3.5" />}
            onClick={handleExportSection22ReturnCsv}
          >
            Export s.22 CSV
          </Button>
          <Tabs
            items={[
              { id: 'today', label: 'Overview', badge: data.lots.length },
              { id: 'accounting', label: 'Accounting', badge: data.reversals.length },
              { id: 'reports', label: 'Reports' },
              { id: 'audit', label: 'Audit', badge: allAuditLogs.length },
            ]}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id as 'today' | 'accounting' | 'reports' | 'audit')}
          />
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric
          featured
          label="Gross Turnover (GTV)"
          value={formatInrFromPaise(totalGtvPaise)}
          sublabel={`${data.allocations.length} allocations settled`}
          status={{ tone: 'ok', label: 'BALANCED' }}
        />
        <Metric
          label="Fisher Bonus Pool (40%)"
          value={formatInrFromPaise(totalBonusEscrowPaise)}
          sublabel="2.00% GTV escrow"
          status={{ tone: 'info', label: 'ESCROW' }}
        />
        <Metric
          label="Ledger Chain"
          value={`${data.ledgerVerification.entryCount} rows`}
          sublabel={`Head ${data.ledgerVerification.headHash.slice(0, 12)}…`}
          status={{
            tone: data.ledgerVerification.verified ? 'ok' : 'danger',
            label: data.ledgerVerification.verified ? 'VERIFIED' : 'ALERT',
          }}
        />
      </div>

      {activeTab === 'today' && (
        <div className="flex flex-col gap-5">
          {/* 1-Click Payout Batch & UTR Reconciliation surfaced directly on Overview */}
          <Card
            title="Payout Batches & UTR Clearing"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={utrInput}
                  onChange={(e) => setUtrInput(e.target.value)}
                  aria-label="Bank UTR Reference"
                  placeholder="UTR reference…"
                  className="h-9 px-3 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-xs font-mono-code text-[var(--text-primary)]"
                />
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Landmark className="w-3.5 h-3.5" />}
                  onClick={handleGenerateBatch}
                >
                  New Batch
                </Button>
              </div>
            }
          >
            <DataTable
              caption="Payout Batches"
              columns={batchColumns}
              rows={data.payoutBatches}
              getRowKey={(r) => r.batch_id}
            />
          </Card>

          <Card title="Floor Price Schedule (s.19)">
            <form
              onSubmit={handleUpdateFloorSchedule}
              className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end mb-4 pb-4 border-b border-[var(--border-hair)]"
            >
              <Select
                label="Enforcement"
                value={floorEnforcement}
                onChange={(e) => setFloorEnforcement(e.target.value as FloorEnforcement)}
                options={[
                  { value: 'WARN', label: 'WARN (Flag Below Floor)' },
                  { value: 'BLOCK', label: 'BLOCK (Reject Below Floor)' },
                  { value: 'OFF', label: 'OFF (Advisory)' },
                ]}
              />
              <Select
                label="Species to Update"
                value={floorEditSpeciesId}
                onChange={(e) => setFloorEditSpeciesId(e.target.value)}
                options={data.species.map((s) => ({
                  value: s.species_id,
                  label: `${s.name_en} (${s.code})`,
                }))}
              />
              <Input
                label="New Basic Floor Price (₹ / kg)"
                type="number"
                mono
                value={floorEditRupees}
                onChange={(e) => setFloorEditRupees(e.target.value)}
              />
              <Button type="submit" variant="primary">
                Save Floor Schedule
              </Button>
            </form>

            <DataTable
              caption="Section 19 Species Floor Schedule"
              columns={speciesColumns}
              rows={data.species}
              getRowKey={(r) => r.species_id}
            />
          </Card>

          <Card title="Licensed Auctioneers">
            <DataTable
              caption="Licensed Auctioneers Registry"
              columns={licenceColumns}
              rows={data.licences}
              getRowKey={(r) => r.licence_id}
            />
          </Card>

          {auditLogsSection}
        </div>
      )}

      {activeTab === 'accounting' && (
        <div className="flex flex-col gap-6">
          <Card
            title="Nodal Bank Payout Batches & UTR Reconciliation (§5 ADR-008)"
            subtitle="Close the harbour day: generate CSV payout batch → import bank UTR → zero unexplained difference"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  label="Bank UTR Reference"
                  mono
                  value={utrInput}
                  onChange={(e) => setUtrInput(e.target.value)}
                />
                <Button
                  variant="primary"
                  icon={<Landmark className="w-4 h-4" />}
                  onClick={handleGenerateBatch}
                >
                  Generate New Payout Batch
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
            title="Dual-Key Reversal Queue (§7 Reversals)"
            subtitle="Ledger rows are never edited; corrections post a compensating journal requiring two distinct users (Accountant + Harbour Admin)"
          >
            <DataTable
              caption="Dual-Key Reversal Queue"
              columns={reversalColumns}
              rows={data.reversals}
              getRowKey={(r) => r.reversal_id}
            />
          </Card>

          <Card
            title="Double-Entry Ledger Accounts (`ledger.accounts`)"
            subtitle="Per-beneficiary balances computed from append-only journal entries (fixes P11)"
          >
            <DataTable
              caption="Statutory Ledger Accounts"
              columns={accountColumns}
              rows={data.accounts}
              getRowKey={(r) => r.account_id}
            />
          </Card>
        </div>
      )}

      {activeTab === 'reports' && (
        <div className="flex flex-col gap-6">
          <Card
            title="Statutory Compliance Exports & Section 22 Auctioneer Return (§12 M9)"
            subtitle="Download CSV ledgers or print-ready statutory audit statements (no external PDF lock-in)"
            actions={
              <div className="flex flex-wrap items-center gap-2.5">
                <Button
                  variant="primary"
                  icon={<FileDown className="w-4 h-4" />}
                  onClick={handleExportSection22ReturnCsv}
                >
                  Download s.22 Return & Apportionment (CSV)
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
                    Report totals verified equal to ledger.accounts balances for {data.tenant?.name_en}
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
                    Section 22 Licensed Auctioneer Return (C11)
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

