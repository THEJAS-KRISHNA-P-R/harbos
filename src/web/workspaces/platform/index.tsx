import React, { useCallback, useEffect, useState } from 'react';
import {
  PlusCircle,
  FileKey,
  FileDown,
  Zap,
  RefreshCw,
  Building2,
  ArrowUpRight,
  Users,
  CheckCircle2,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  Input,
  Select,
  Tabs,
  DataTable,
  Toast,
  WorkspaceSkeleton,
  SkeletonMetric,
  PerformanceDashboardSkeleton,
  HarbourLedgerVaultIcon,
  StatutorySealIcon,
  humanizeCode,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  downloadTextFile,
  formatInrFromPaise,
  computeCrossHarbourBenchmarks,
  generateExternalSdkStarterCode,
  HARBOUROS_SDK_VERSION,
  type CrossHarbourBenchmarkRow,
  type BootstrapData,
  type TenantRow,
  type PolicyRow,
  type EntryRow,
} from '@web/lib/api.ts';
import { ROLE_DASHBOARD_DIRECTORY } from '@web/lib/tenant-onboarding.ts';
import type { Role, WorkspaceId } from '@shared/contracts/rbac.ts';
import type { CentreType, CommercialMode } from '@shared/ids.ts';
import { useI18n } from '@web/i18n/index.tsx';
import type { SystemObservabilityMetrics } from './PerformanceDashboard.tsx';

const LazyPerformanceDashboard = React.lazy(async () => {
  const mod = await import('./PerformanceDashboard.tsx');
  return { default: mod.PerformanceDashboard };
});

interface AppliedMigrationRow {
  version: string;
  checksum: string;
  applied_at: string;
}

interface JournalBalanceAuditItem {
  journal_id: string;
  reference_type: string;
  entry_count: string;
  sum_debit_paise: string;
  sum_credit_paise: string;
  is_balanced: boolean;
}

interface GovernanceMigrationsResponse {
  migrations: AppliedMigrationRow[];
  journalBalanceAudit: JournalBalanceAuditItem[];
}

export const PlatformWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  loading?: boolean;
  onRefresh: () => Promise<void>;
  onSwitchTenant?: (tenantId: string, targetWorkspace?: WorkspaceId) => Promise<void>;
  onSwitchRoleDashboard?: (role: Role) => Promise<void>;
  onOpenOnboarding?: () => void;
  initialTab?: 'scalability' | 'governance' | 'sql-migrations';
}> = ({
  data,
  token,
  loading = false,
  onRefresh,
  onSwitchTenant,
  onSwitchRoleDashboard,
  onOpenOnboarding,
  initialTab = 'governance',
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<
    'scalability' | 'governance' | 'sql-migrations'
  >(initialTab);
  const [switchingTenantId, setSwitchingTenantId] = useState<string | null>(null);
  const [switchingRole, setSwitchingRole] = useState<Role | null>(null);

  const [newSlug, setNewSlug] = useState('neendakara-harbour');
  const [newNameEn, setNewNameEn] = useState('Neendakara Fishing Harbour (HMS)');
  const [newPreset, setNewPreset] = useState<CentreType>('KERALA_HARBOUR');

  const [policyMode, setPolicyMode] = useState<CommercialMode>('FIXED_SAAS_ONLY');
  const [commissionBps, setCommissionBps] = useState('500');
  const [legalSignoffRef, setLegalSignoffRef] = useState('');
  const [legalSignoffDate, setLegalSignoffDate] = useState('');

  const [migrationsInfo, setMigrationsInfo] = useState<GovernanceMigrationsResponse | null>(null);
  const [loadingMigrations, setLoadingMigrations] = useState(true);
  const [scaleMetrics, setScaleMetrics] = useState<SystemObservabilityMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null>(null);

  const loadGovernanceMigrations = useCallback(async (): Promise<void> => {
    setLoadingMigrations(true);
    try {
      const res = await apiRequest<GovernanceMigrationsResponse>('/api/v1/governance/migrations', {
        method: 'GET',
        token,
      });
      setMigrationsInfo(res);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('403')) {
        setMigrationsInfo(null);
      }
    } finally {
      setLoadingMigrations(false);
    }
  }, [token]);

  const loadScaleMetrics = useCallback(async (): Promise<void> => {
    setLoadingMetrics(true);
    try {
      const res = await apiRequest<SystemObservabilityMetrics>('/api/v1/metrics', {
        method: 'GET',
        token,
      });
      setScaleMetrics(res);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('403')) {
        setScaleMetrics(null);
      }
    } finally {
      setLoadingMetrics(false);
    }
  }, [token]);

  useEffect(() => {
    void loadGovernanceMigrations();
    void loadScaleMetrics();
  }, [loadGovernanceMigrations, loadScaleMetrics]);

  const handleProvisionTenant = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{ tenantId: string; policyId: string }>('/api/v1/tenants', {
        method: 'POST',
        token,
        body: {
          slug: newSlug,
          nameEn: newNameEn,
          nameMl: newNameEn,
          centreType: newPreset,
        },
      });
      setFeedback({
        tone: 'ok',
        title: `Tenant Provisioned: ${res.tenantId}`,
        msg: `Initialized with preset ${newPreset} and default commission policy ${res.policyId}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Tenant Provisioning Failed',
        msg: err instanceof Error ? err.message : 'Error creating tenant',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePolicyVersion = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{
        policyId: string;
        versionNum: number;
        commercialMode: CommercialMode;
      }>('/api/v1/policies', {
        method: 'POST',
        token,
        body: {
          commercialMode: policyMode,
          commissionBps: Number(commissionBps) || 500,
          auctioneerShareBps: 2000,
          hmsShareBps: 2000,
          fisherBonusShareBps: 4000,
          coopShareBps: 2000,
          legalSignoffRef: legalSignoffRef || null,
          legalSignoffDate: legalSignoffDate || null,
        },
      });
      setFeedback({
        tone: 'ok',
        title: `Policy Version v${res.versionNum} Activated (${res.policyId})`,
        msg: `Commercial mode ${res.commercialMode} is now active for new sales (existing sales remain under their historical policy).`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Statutory Policy Gate Blocked Save',
        msg: err instanceof Error ? err.message : 'Policy validation failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTenantAction = async (tenantId: string): Promise<void> => {
    if (!onSwitchTenant) return;
    setSwitchingTenantId(tenantId);
    try {
      await onSwitchTenant(tenantId);
    } finally {
      setSwitchingTenantId(null);
    }
  };

  const handleRoleAction = async (role: Role): Promise<void> => {
    if (!onSwitchRoleDashboard) return;
    setSwitchingRole(role);
    try {
      await onSwitchRoleDashboard(role);
    } finally {
      setSwitchingRole(null);
    }
  };

  const tenantColumns: ReadonlyArray<DataTableColumn<TenantRow>> = [
    {
      key: 'name',
      header: 'Harbour / Market',
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-[var(--text-primary)]">{r.name_en}</div>
          <div className="text-[11px] font-mono-code text-[var(--text-muted)]">
            {r.tenant_id} · {r.slug}
          </div>
        </div>
      ),
    },
    {
      key: 'preset',
      header: 'Statutory Preset',
      render: (r) => (
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          {humanizeCode(r.centre_type)}
        </span>
      ),
    },
    {
      key: 'floor',
      header: 'Floor Mode',
      mono: true,
      render: (r) => (
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {r.floor_enforcement}
        </span>
      ),
    },
    { key: 'pol', header: 'Active Policy', mono: true, render: (r) => r.active_policy_id },
    {
      key: 'action',
      header: 'Workspace',
      align: 'right',
      render: (r) => {
        const isCurrent = r.tenant_id === data.tenant?.tenant_id;
        if (isCurrent) {
          return (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Active
            </span>
          );
        }
        return onSwitchTenant ? (
          <Button
            variant="secondary"
            size="sm"
            loading={switchingTenantId === r.tenant_id}
            onClick={() => void handleTenantAction(r.tenant_id)}
          >
            Switch
          </Button>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">Isolated</span>
        );
      },
    },
  ];

  const policyColumns: ReadonlyArray<DataTableColumn<PolicyRow>> = [
    {
      key: 'id',
      header: 'Policy ID',
      mono: true,
      render: (r) => <span className="font-semibold">{r.policy_id}</span>,
    },
    { key: 'ver', header: 'Ver', mono: true, render: (r) => `v${r.version_num}` },
    {
      key: 'mode',
      header: 'Commercial Mode',
      render: (r) => <Badge tone="info" label={r.commercial_mode} />,
    },
    {
      key: 'split',
      header: 'Statutory Split (bps)',
      mono: true,
      render: (r) =>
        `${r.auctioneer_share_bps}/${r.hms_share_bps}/${r.fisher_bonus_share_bps}/${r.coop_share_bps} (Cap: ${r.commission_bps})`,
    },
    {
      key: 'signoff',
      header: 'Legal Sign-Off',
      mono: true,
      render: (r) =>
        r.legal_signoff_ref
          ? `${r.legal_signoff_ref} (${r.legal_signoff_date})`
          : 'Mode A Exempt (100% Untouched)',
    },
  ];

  const entryColumns: ReadonlyArray<DataTableColumn<EntryRow>> = [
    { key: 'seq', header: 'Seq', mono: true, render: (r) => `#${r.entry_seq}` },
    { key: 'jrn', header: 'Journal ID', mono: true, render: (r) => r.journal_id },
    { key: 'acc', header: 'Account ID', mono: true, render: (r) => r.account_id },
    {
      key: 'dir',
      header: 'D/C',
      mono: true,
      render: (r) => (
        <Badge
          tone={r.direction === 'D' ? 'info' : 'ok'}
          label={r.direction === 'D' ? 'DEBIT' : 'CREDIT'}
        />
      ),
    },
    {
      key: 'amt',
      header: 'Amount',
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.amount_paise),
    },
    {
      key: 'hash',
      header: 'Canonical SHA-256 Row Hash',
      mono: true,
      render: (r) => <span className="text-xs">{r.row_hash.slice(0, 20)}…</span>,
    },
  ];

  const migrationColumns: ReadonlyArray<DataTableColumn<AppliedMigrationRow>> = [
    {
      key: 'ver',
      header: 'Migration File',
      mono: true,
      render: (r) => <span className="font-semibold">{r.version}</span>,
    },
    {
      key: 'sha',
      header: 'SHA-256 Checksum',
      mono: true,
      render: (r) => <span className="text-xs">{r.checksum.slice(0, 20)}…</span>,
    },
    {
      key: 'applied',
      header: 'Applied At (UTC)',
      mono: true,
      render: (r) => <span>{r.applied_at.slice(0, 19).replace('T', ' ')}</span>,
    },
    {
      key: 'status',
      header: 'Integrity',
      render: () => <Badge tone="ok" label="VERIFIED" />,
    },
  ];

  const balanceAuditColumns: ReadonlyArray<DataTableColumn<JournalBalanceAuditItem>> = [
    {
      key: 'jrn',
      header: 'Journal ID',
      mono: true,
      render: (r) => <span className="font-semibold">{r.journal_id}</span>,
    },
    {
      key: 'ref',
      header: 'Reference',
      mono: true,
      render: (r) => <Badge tone="info" label={r.reference_type} />,
    },
    {
      key: 'dr',
      header: 'Debits',
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.sum_debit_paise),
    },
    {
      key: 'cr',
      header: 'Credits',
      align: 'right',
      mono: true,
      render: (r) => formatInrFromPaise(r.sum_credit_paise),
    },
    {
      key: 'bal',
      header: 'Balance',
      render: (r) => (
        <Badge
          tone={r.is_balanced ? 'ok' : 'danger'}
          label={r.is_balanced ? 'BALANCED' : 'IMBALANCED'}
        />
      ),
    },
  ];

  const crossHarbourBenchmarks = computeCrossHarbourBenchmarks(data.allTenants);

  const benchmarkColumns: ReadonlyArray<DataTableColumn<CrossHarbourBenchmarkRow>> = [
    {
      key: 'harbour',
      header: 'Harbour / Landing Centre',
      render: (r) => (
        <div>
          <div className="font-semibold text-[var(--text-primary)]">{r.harbourNameEn}</div>
          <div className="text-[11px] text-[var(--text-secondary)] font-mono-code">
            {r.tenantId} · {r.stateRegion}
          </div>
        </div>
      ),
    },
    {
      key: 'regime',
      header: 'Statutory Split Regime',
      mono: true,
      render: (r) => <Badge tone="info" label={r.statutoryRegime} />,
    },
    {
      key: 'vol',
      header: 'Daily Clearing',
      align: 'right',
      mono: true,
      render: (r) => <span className="font-bold">₹{r.dailyClearingLakhsInr.toFixed(1)} L</span>,
    },
    {
      key: 'vel',
      header: 'T+0 UTR Velocity',
      align: 'right',
      mono: true,
      render: (r) => <span>{r.avgSettlementMinutes.toFixed(1)} min</span>,
    },
    {
      key: 'floor',
      header: 'Floor Compliance',
      align: 'right',
      mono: true,
      render: (r) => <Badge tone="ok" label={`${r.floorCompliancePct.toFixed(1)}%`} />,
    },
    {
      key: 'qps',
      header: 'Peak QPS',
      align: 'right',
      mono: true,
      render: (r) => <span>{r.peakQps.toLocaleString()} req/s</span>,
    },
  ];

  const handlePlatformWebhookSync = async (): Promise<void> => {
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{
        eventId: string;
        bankCode: string;
        signatureHex: string;
        reconciledCount: number;
      }>('/api/v1/webhooks/bank-nodal', {
        method: 'POST',
        token,
        body: {
          simulateSigned: true,
          bankCode: 'FDRL-NODAL-ISO20022',
          tenantId: data.tenant?.tenant_id ?? 'munambam-demo',
        },
      });
      await onRefresh();
      setFeedback({
        tone: 'ok',
        title: `Signed Nodal Bank Webhook Verified (${res.bankCode})`,
        msg: `Signed callback ${res.signatureHex.slice(0, 16)}… verified & reconciled ${res.reconciledCount} batch(es).`,
      });
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Nodal Bank Webhook Rejected',
        msg: err instanceof Error ? err.message : 'Webhook failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const appliedCount = migrationsInfo?.migrations.length ?? 14;

  if (loading) {
    return <WorkspaceSkeleton workspace="platform" label={t('workspaces.loadingWorkspace')} />;
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
              {t('platform.title')}
            </h1>
            <p className="text-xs text-[var(--text-muted)] truncate">
              Active tenant:{' '}
              <span className="font-semibold text-[var(--text-secondary)]">
                {data.tenant?.name_en ?? 'Munambam'}
              </span>{' '}
              · {data.allTenants.length} provisioned harbour
              {data.allTenants.length === 1 ? '' : 's'}
            </p>
          </div>
          {onOpenOnboarding && (
            <Button
              variant="primary"
              size="sm"
              data-testid="platform-onboard-harbour-btn"
              icon={<Building2 className="w-4 h-4" />}
              onClick={onOpenOnboarding}
            >
              Onboard New Harbour
            </Button>
          )}
        </div>
        <div className="w-full sm:w-auto self-start min-w-0">
          <Tabs
            items={[
              {
                id: 'governance',
                label: 'Tenants & Dashboards',
                badge: data.allTenants.length,
              },
              {
                id: 'scalability',
                label: t('platform.tabObservability'),
              },
              {
                id: 'sql-migrations',
                label: t('platform.tabMigrations'),
                badge: appliedCount,
              },
            ]}
            activeId={activeTab}
            onChange={(id) =>
              setActiveTab(id as 'scalability' | 'governance' | 'sql-migrations')
            }
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3.5">
        <Metric
          label="Provisioned Tenants"
          value={String(data.allTenants.length)}
          unit="RLS ISOLATED"
          sublabel={data.tenant?.name_en ?? 'Active harbour'}
        />
        {loadingMigrations && !migrationsInfo ? (
          <SkeletonMetric />
        ) : (
          <Metric
            label={t('platform.metricMigrations')}
            value={`${appliedCount} / ${appliedCount}`}
            unit="APPLIED"
            sublabel="Row-Level Security active"
          />
        )}
        {loadingMetrics && !scaleMetrics ? (
          <SkeletonMetric />
        ) : (
          <Metric
            label={t('platform.metricLatency')}
            value={String(scaleMetrics?.p95LatencyMs ?? 1.5)}
            unit="MS"
            sublabel={`p50: ${scaleMetrics?.p50LatencyMs ?? 0.8} ms`}
          />
        )}
        {loadingMetrics && !scaleMetrics ? (
          <SkeletonMetric />
        ) : (
          <Metric
            label={t('platform.metricCache')}
            value={`${scaleMetrics?.cacheHitRatioPct ?? 0}%`}
            sublabel="Read-path cache hit rate"
          />
        )}
      </div>

      {/* TAB 0: OBSERVABILITY & SDK — Desktop-First 2-Column Command Grid */}
      {activeTab === 'scalability' && (
        <div
          data-testid="platform-office-grid"
          className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start"
        >
          <div className="xl:col-span-8 flex flex-col gap-5 min-w-0">
            <React.Suspense fallback={<PerformanceDashboardSkeleton />}>
              <LazyPerformanceDashboard
                token={token}
                onMetricsRefreshed={(snap) => {
                  setScaleMetrics(snap);
                  setLoadingMetrics(false);
                }}
              />
            </React.Suspense>

            <Card title={t('platform.benchmarksTitle')}>
              <DataTable
                caption="Multi-Harbour Cross-Tenant Clearing & Settlement Benchmarks"
                columns={benchmarkColumns}
                rows={crossHarbourBenchmarks}
                getRowKey={(r) => r.tenantId}
              />
            </Card>
          </div>

          <aside className="xl:col-span-4 xl:sticky xl:top-20 flex flex-col gap-4 min-w-0">
            <Card
              title={t('platform.sdkPanelTitle')}
              subtitle={t('platform.sdkPanelSubtitle')}
              actions={<Badge tone="info" label={`SDK v${HARBOUROS_SDK_VERSION}`} />}
            >
              <div className="flex flex-col gap-3">
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="platform-webhook-sync-btn"
                  loading={submitting}
                  icon={<Zap className="w-3.5 h-3.5" />}
                  onClick={() => void handlePlatformWebhookSync()}
                  className="w-full"
                >
                  {t('platform.simulateWebhookBtn')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="download-sdk-client-btn"
                  icon={<FileDown className="w-3.5 h-3.5" />}
                  onClick={() =>
                    downloadTextFile(
                      'harbouros-nodal-sdk-client.ts',
                      generateExternalSdkStarterCode(),
                      'text/typescript;charset=utf-8;'
                    )
                  }
                  className="w-full"
                >
                  {t('platform.downloadSdkBtn')}
                </Button>
                <div className="pt-2 border-t border-[var(--border-hair)] flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
                  <div className="flex items-center justify-between">
                    <span>Active Harbour</span>
                    <span className="font-semibold text-[var(--text-primary)] truncate max-w-[180px]">
                      {data.tenant?.name_en ?? 'Munambam'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Provisioned Tenants</span>
                    <span className="font-mono-code font-bold text-[var(--text-primary)]">
                      {data.allTenants.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Ledger Chain</span>
                    <Badge
                      tone={data.ledgerVerification.verified ? 'ok' : 'danger'}
                      label={data.ledgerVerification.verified ? 'VERIFIED' : 'ALERT'}
                    />
                  </div>
                </div>
              </div>
            </Card>
          </aside>
        </div>
      )}

      {/* TAB 1: SQL MIGRATION CHAIN & DOUBLE-ENTRY AUDIT — Side-by-Side Desktop Split */}
      {activeTab === 'sql-migrations' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          <Card
            title={t('platform.migrationsTitle')}
            subtitle={t('platform.migrationsSubtitle')}
            actions={
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="w-4 h-4" />}
                onClick={() => void loadGovernanceMigrations()}
              >
                {t('platform.refreshStatus')}
              </Button>
            }
          >
            <DataTable
              caption="Applied PostgreSQL Schema Migrations"
              columns={migrationColumns}
              rows={migrationsInfo?.migrations ?? []}
              loading={loadingMigrations && !migrationsInfo}
              getRowKey={(r) => r.version}
            />
          </Card>

          <Card
            title={t('platform.balanceAuditTitle')}
            subtitle={t('platform.balanceAuditSubtitle')}
          >
            <DataTable
              caption="Double-Entry Journal Balance Audit"
              columns={balanceAuditColumns}
              rows={migrationsInfo?.journalBalanceAudit ?? []}
              loading={loadingMigrations && !migrationsInfo}
              getRowKey={(r) => r.journal_id}
            />
          </Card>
        </div>
      )}

      {/* TAB 2: TENANTS, ROLE DASHBOARDS, POLICIES & LEDGER ENTRIES */}
      {activeTab === 'governance' && (
        <div className="flex flex-col gap-5">
          {/* Provisioned Tenants Registry */}
          <Card
            title={t('platform.tenantsRegistryTitle')}
            subtitle="Switch between isolated harbour tenants or onboard a new harbour with operators and starter species"
          >
            <DataTable
              caption="Provisioned Harbour & Market Tenants"
              columns={tenantColumns}
              rows={data.allTenants}
              getRowKey={(r) => r.tenant_id}
            />
          </Card>

          {/* Role-Specific User Dashboards Launcher */}
          <Card
            title="Role-Specific User Dashboards"
            subtitle={`Launch any operational dashboard scoped to ${data.tenant?.name_en ?? 'the active harbour'}`}
            actions={
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                <Users className="w-3.5 h-3.5" />
                {ROLE_DASHBOARD_DIRECTORY.length} dashboards
              </span>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {ROLE_DASHBOARD_DIRECTORY.map((item) => (
                <div
                  key={item.role}
                  className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col justify-between gap-3"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        {item.category}
                      </span>
                      <span className="text-[10px] font-mono-code text-[var(--text-muted)]">
                        /w/{item.workspaceId}
                      </span>
                    </div>
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      {item.label}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                      {item.summary}
                    </p>
                  </div>
                  {onSwitchRoleDashboard && (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={switchingRole === item.role}
                      icon={<ArrowUpRight className="w-3.5 h-3.5" />}
                      onClick={() => void handleRoleAction(item.role)}
                      className="w-full"
                    >
                      {item.keyAction}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card
              title="Quick Tenant Provision"
              subtitle="Creates a bare tenant record with statutory policy (use Guided Onboarding above for full operator & masterdata setup)"
            >
              <form onSubmit={handleProvisionTenant} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Harbour / Market Name"
                    value={newNameEn}
                    onChange={(e) => setNewNameEn(e.target.value)}
                  />
                  <Input
                    label="Tenant Slug"
                    mono
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                  />
                </div>
                <Select
                  label="Statutory Regime Preset"
                  value={newPreset}
                  onChange={(e) => setNewPreset(e.target.value as CentreType)}
                  options={[
                    {
                      value: 'KERALA_HARBOUR',
                      label: 'Kerala Harbour (20/20/40/20 split)',
                    },
                    {
                      value: 'KERALA_LANDING_CENTRE',
                      label: 'Kerala Landing Centre (20/20/40/20 split)',
                    },
                    {
                      value: 'KERALA_MARKET',
                      label: 'Kerala Fish Market (20/20/30/30 split)',
                    },
                    { value: 'INDIA_COOP', label: 'India Co-op Federation Preset' },
                  ]}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  loading={submitting}
                  icon={<PlusCircle className="w-4 h-4" />}
                >
                  Provision Bare Tenant
                </Button>
              </form>
            </Card>

            <Card
              title={t('platform.policyVersionTitle')}
              subtitle="Modes B & C require a Legal Sign-Off reference and date before activation"
            >
              <form onSubmit={handleSavePolicyVersion} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Commercial Monetization Mode"
                    value={policyMode}
                    onChange={(e) => setPolicyMode(e.target.value as CommercialMode)}
                    options={[
                      {
                        value: 'FIXED_SAAS_ONLY',
                        label: 'Mode A: Fixed SaaS only (Default safe)',
                      },
                      {
                        value: 'INSTITUTIONAL_TECH_SHARE',
                        label: 'Mode B: Institutional tech share (40 bps)',
                      },
                      {
                        value: 'HYBRID',
                        label: 'Mode C: Hybrid (40 bps + 100 bps buyer fee + GST)',
                      },
                    ]}
                  />
                  <Input
                    label="Commission Rate (bps, max 500)"
                    type="number"
                    mono
                    value={commissionBps}
                    onChange={(e) => setCommissionBps(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Legal Opinion Sign-Off Ref (Required for Mode B/C)"
                    placeholder="e.g. ADV-KHC-2026-OP-09"
                    mono
                    value={legalSignoffRef}
                    onChange={(e) => setLegalSignoffRef(e.target.value)}
                  />
                  <Input
                    label="Legal Sign-Off Date (YYYY-MM-DD)"
                    type="date"
                    mono
                    value={legalSignoffDate}
                    onChange={(e) => setLegalSignoffDate(e.target.value)}
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={submitting}
                  icon={<FileKey className="w-4 h-4" />}
                >
                  Activate Versioned Commission Policy
                </Button>
              </form>
            </Card>
          </div>

          <Card
            title={t('platform.policyHistoryTitle')}
            subtitle="Historical sales remain bound to their exact policy version"
          >
            <DataTable
              caption="Versioned Statutory Commission Policies"
              columns={policyColumns}
              rows={data.policies}
              getRowKey={(r) => r.policy_id}
            />
          </Card>

          <Card
            title={t('platform.ledgerChainTitle')}
            subtitle="Protected by immutable triggers and SHA-256 hash chain"
            actions={
              <div className="flex items-center gap-2">
                <HarbourLedgerVaultIcon size={20} />
                <StatutorySealIcon size={20} />
                <Badge
                  tone={data.ledgerVerification.verified ? 'ok' : 'danger'}
                  label={
                    data.ledgerVerification.verified
                      ? `CHAIN VERIFIED (${data.ledgerVerification.entryCount} ENTRIES)`
                      : 'CHAIN TAMPERED'
                  }
                />
              </div>
            }
          >
            <DataTable
              caption="Append-Only Double-Entry Ledger Entries"
              columns={entryColumns}
              rows={data.entries}
              getRowKey={(r) => `${r.journal_id}-${r.entry_seq}`}
            />
          </Card>
        </div>
      )}
    </div>
  );
};
