import React, { useState } from 'react';
import {
  ShieldCheck,
  Sparkles,
  ThermometerSnowflake,
  Minus,
  Plus,
  OctagonAlert,
  CheckCircle2,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  Input,
  DataTable,
  Toast,
  SpeciesGlyph,
  Skeleton,
  SkeletonCardGrid,
  WorkspaceSkeleton,
  humanizeCode,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  formatKgFromGrams,
  type BootstrapData,
  type LotRow,
} from '@web/lib/api.ts';
import { extractManglishName, stepTemperatureC } from '@web/lib/ui-formatters.ts';
import type { InspectionGrade } from '@shared/ids.ts';
import { useI18n } from '@web/i18n/index.tsx';

const GRADE_CHOICES: ReadonlyArray<{
  value: InspectionGrade;
  titleKey: string;
  detailKey: string;
  danger?: boolean;
}> = [
  {
    value: 'A_EXPORT',
    titleKey: 'inspector.gradeExportTitle',
    detailKey: 'inspector.gradeExportDetail',
  },
  {
    value: 'A_DOMESTIC',
    titleKey: 'inspector.gradeDomesticTitle',
    detailKey: 'inspector.gradeDomesticDetail',
  },
  {
    value: 'B_PROCESS',
    titleKey: 'inspector.gradeProcessTitle',
    detailKey: 'inspector.gradeProcessDetail',
  },
  {
    value: 'REJECTED_UNFIT',
    titleKey: 'inspector.gradeUnfitTitle',
    detailKey: 'inspector.gradeUnfitDetail',
    danger: true,
  },
];

export const InspectorWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  loading?: boolean;
  refreshing?: boolean;
  onRefresh: () => Promise<void>;
}> = ({ data, token, loading = false, refreshing = false, onRefresh }) => {
  const { t } = useI18n();
  const [selectedLotId, setSelectedLotId] = useState(
    data.lots[0]?.lot_id ?? 'LOT-2026-001'
  );
  const [grade, setGrade] = useState<InspectionGrade>('A_EXPORT');
  const [coreTempC, setCoreTempC] = useState('1.8');
  const [notes, setNotes] = useState(
    'Clear cornea, bright red gills, firm elastic flesh, core temp <= 2.5°C'
  );
  const [submitting, setSubmitting] = useState(false);
  const [loadingAiAssist, setLoadingAiAssist] = useState(false);
  const [aiAdvisory, setAiAdvisory] = useState<{
    available: boolean;
    suggestedGrade?: string;
    confidenceNote?: string;
    advisoryDisclaimer: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null>(null);

  const selectedLot = data.lots.find((l) => l.lot_id === selectedLotId) ?? data.lots[0];
  const selectedSpecies = data.species.find(
    (s) => s.species_id === selectedLot?.species_id
  );

  const tempNumber = Number(coreTempC);
  const isTempWarm = Number.isFinite(tempNumber) && tempNumber > 2.5;

  const handleSelectLot = (lot: LotRow): void => {
    setSelectedLotId(lot.lot_id);
    setGrade(lot.inspection_grade ?? 'A_DOMESTIC');
    setCoreTempC(String(lot.core_temp_c ?? 2.0));
    setNotes(lot.inspection_notes || 'Clear cornea, bright red gills, firm flesh');
  };

  const handleSaveInspection = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!selectedLot) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiRequest<{
        lotId: string;
        grade: InspectionGrade;
        status: string;
      }>(`/api/v1/lots/${selectedLot.lot_id}/inspect`, {
        method: 'POST',
        token,
        body: {
          grade,
          coreTempC: Number(coreTempC) || 2.0,
          notes,
        },
      });
      const readableGrade = humanizeCode(res.grade);
      setFeedback({
        tone: res.grade === 'REJECTED_UNFIT' ? 'danger' : 'ok',
        title: `Lot ${selectedLot.lot_code} certified: ${readableGrade}`,
        msg:
          res.grade === 'REJECTED_UNFIT'
            ? 'Lot quarantined and blocked from auction. Any sale attempt will be rejected.'
            : `Lot cleared for auction under ${readableGrade}.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Inspection update failed',
        msg: err instanceof Error ? err.message : 'Error saving inspection',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestAiAssist = async (): Promise<void> => {
    if (!selectedLot) return;
    setLoadingAiAssist(true);
    try {
      const res = await apiRequest<{
        available: boolean;
        suggestedGrade?: string;
        confidenceNote?: string;
        advisoryDisclaimer: string;
      }>(`/api/v1/lots/${selectedLot.lot_id}/ai-assist`, {
        method: 'POST',
        token,
        body: {
          speciesNameEn: selectedSpecies?.name_en ?? 'Marine Catch',
          coreTempC: Number(coreTempC) || 2.0,
          inspectorNotes: notes,
        },
      });
      setAiAdvisory(res);
    } catch (err) {
      setFeedback({
        tone: 'warn',
        title: 'Advisory service unavailable',
        msg: err instanceof Error ? err.message : 'Unable to fetch advisory grading suggestion',
      });
    } finally {
      setLoadingAiAssist(false);
    }
  };

  const columns: ReadonlyArray<DataTableColumn<LotRow>> = [
    {
      key: 'code',
      header: t('inspector.lotCodeHeader'),
      mono: true,
      render: (r) => <span className="font-semibold">{r.lot_code}</span>,
    },
    {
      key: 'species',
      header: t('inspector.speciesHeader'),
      render: (r) => {
        const sp = data.species.find((s) => s.species_id === r.species_id);
        const manglish = extractManglishName(sp?.name_ml, sp?.code);
        return (
          <div className="flex items-center gap-2">
            <SpeciesGlyph code={`${sp?.code ?? ''} ${sp?.name_en ?? ''}`} size={18} />
            <div>
              <div className="font-medium">{sp?.name_en}</div>
              {manglish && (
                <div className="text-xs text-[var(--text-muted)]">{manglish}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'temp',
      header: t('inspector.coreTempHeader'),
      align: 'right',
      mono: true,
      render: (r) => `${r.core_temp_c}°C`,
    },
    {
      key: 'weight',
      header: t('inspector.netWeightHeader'),
      align: 'right',
      mono: true,
      render: (r) => formatKgFromGrams(r.net_grams),
    },
    {
      key: 'grade',
      header: t('inspector.gradeHeader'),
      render: (r) => (
        <Badge
          tone={
            !r.inspection_grade
              ? 'neutral'
              : r.inspection_grade === 'REJECTED_UNFIT'
              ? 'danger'
              : r.inspection_grade === 'A_EXPORT'
              ? 'ok'
              : 'info'
          }
          label={r.inspection_grade ?? 'Pending'}
        />
      ),
    },
    {
      key: 'notes',
      header: t('inspector.notesHeader'),
      render: (r) => (
        <span className="text-xs text-[var(--text-secondary)]">{r.inspection_notes}</span>
      ),
    },
  ];

  if (loading) {
    return <WorkspaceSkeleton workspace="inspector" label={t('workspaces.loadingWorkspace')} />;
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight truncate">
            {t('workspaces.inspectorTitle')}
          </h1>
          <p className="text-xs text-[var(--text-muted)] truncate">
            {t('workspaces.inspectorSubtitle')} · Cold-chain target ≤ 2.5°C
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={loadingAiAssist}
          icon={<Sparkles className="w-4 h-4" />}
          onClick={handleRequestAiAssist}
        >
          {t('inspector.optionalAiAssist')}
        </Button>
      </div>

      {feedback && (
        <Toast
          tone={feedback.tone}
          title={feedback.title}
          message={feedback.msg}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <Metric
            label={t('inspector.exportGradeA')}
            value={String(data.lots.filter((l) => l.inspection_grade === 'A_EXPORT').length)}
            unit="LOTS"
            sublabel="Export certified"
          />
        </div>
        <Metric
          label={t('inspector.domesticProcessing')}
          value={String(
            data.lots.filter(
              (l) =>
                l.inspection_grade === 'A_DOMESTIC' || l.inspection_grade === 'B_PROCESS'
            ).length
          )}
          unit="LOTS"
          sublabel="Cleared for auction"
        />
        <Metric
          label={t('inspector.rejectedUnfit')}
          value={String(
            data.lots.filter((l) => l.inspection_grade === 'REJECTED_UNFIT').length
          )}
          unit="BLOCKED"
          sublabel="Quarantined unfit"
        />
      </div>

      <Card title={t('workspaces.inspectorCard')}>
        <form onSubmit={handleSaveInspection} className="flex flex-col gap-5">
          {loadingAiAssist ? (
            <div
              role="status"
              aria-busy="true"
              aria-label="Fetching advisory quality grade…"
              data-testid="ai-assist-skeleton"
              className="p-3.5 rounded-[var(--radius-card)] bg-[var(--info-bg)]/60 border border-[var(--info)]/30 flex flex-col gap-2"
            >
              <Skeleton className="h-3.5 w-48" />
              <Skeleton variant="text" lines={2} />
            </div>
          ) : (
            aiAdvisory && (
              <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--info-bg)] border border-[var(--info)]/40 text-[var(--info)] flex flex-col gap-1">
                <div className="text-xs font-bold tracking-wide">
                  {aiAdvisory.advisoryDisclaimer}
                </div>
                {aiAdvisory.available ? (
                  <p className="text-sm font-medium">
                    Suggested grade:{' '}
                    <strong>{humanizeCode(aiAdvisory.suggestedGrade ?? '')}</strong> —{' '}
                    {aiAdvisory.confidenceNote}
                  </p>
                ) : (
                  <p className="text-xs">
                    Advisory AI is disabled on this server. No fabricated suggestion is shown — grade the lot directly below.
                  </p>
                )}
              </div>
            )
          )}

          {/* 1. Tap a lot card */}
          <div>
            <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">
              {t('workspaces.inspectorSelectLot')}
            </div>
            {refreshing || submitting ? (
              <SkeletonCardGrid
                count={Math.max(3, Math.min(6, data.lots.length))}
                columns={3}
                variant="alert"
                testId="inspector-lots-skeleton"
                label="Refreshing landed lots…"
              />
            ) : (
            <div
              role="radiogroup"
              aria-label="Lots to inspect"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5"
            >
              {data.lots.map((lot) => {
                const sp = data.species.find((s) => s.species_id === lot.species_id);
                const active = lot.lot_id === selectedLot?.lot_id;
                return (
                  <button
                    key={lot.lot_id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => handleSelectLot(lot)}
                    className={`min-h-[68px] p-3 rounded-[var(--radius-card)] border text-left transition-all cursor-pointer flex items-center justify-between gap-2.5 ${
                      active
                        ? 'bg-[var(--brand-soft)] border-[var(--brand)] ring-2 ring-[var(--brand)]'
                        : 'bg-[var(--bg-surface)] border-[var(--border-strong)]/60 hover:bg-[var(--bg-tint)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <SpeciesGlyph code={`${sp?.code ?? ''} ${sp?.name_en ?? ''}`} size={22} />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                          {lot.lot_code}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] truncate">
                          {sp?.name_en ?? lot.species_id} · {formatKgFromGrams(lot.net_grams)}
                        </div>
                      </div>
                    </div>
                    <Badge
                      tone={
                        !lot.inspection_grade
                          ? 'neutral'
                          : lot.inspection_grade === 'REJECTED_UNFIT'
                          ? 'danger'
                          : lot.inspection_grade === 'A_EXPORT'
                          ? 'ok'
                          : 'info'
                      }
                      label={lot.inspection_grade ?? 'Pending'}
                    />
                  </button>
                );
              })}
            </div>
            )}
          </div>

          {/* 2. Big 4-Choice Grade Selector */}
          <div>
            <div className="text-xs font-semibold text-[var(--text-secondary)] mb-2.5">
              {t('workspaces.inspectorGradeChoice')}
            </div>
            <div
              role="radiogroup"
              aria-label="Quality grade"
              data-testid="inspector-grade-picker"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5"
            >
              {GRADE_CHOICES.map((choice) => {
                const selected = grade === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setGrade(choice.value)}
                    className={`min-h-[72px] p-3.5 rounded-[var(--radius-card)] border text-left transition-all cursor-pointer flex flex-col justify-between gap-1 ${
                      selected
                        ? choice.danger
                          ? 'bg-[var(--danger-bg)] border-[var(--danger)] ring-2 ring-[var(--danger)] text-[var(--danger-fg)]'
                          : 'bg-[var(--brand-soft)] border-[var(--brand)] ring-2 ring-[var(--brand)] text-[var(--brand-soft-fg)]'
                        : 'bg-[var(--bg-surface)] border-[var(--border-strong)]/60 hover:bg-[var(--bg-tint)] text-[var(--text-primary)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-sm font-bold">{t(choice.titleKey)}</span>
                      {selected &&
                        (choice.danger ? (
                          <OctagonAlert className="w-4 h-4 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                        ))}
                    </div>
                    <span className="text-xs opacity-85">{t(choice.detailKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Core Temperature Stepper + Remarks */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="inspector-core-temp"
                  className="text-xs font-semibold text-[var(--text-secondary)]"
                >
                  {t('inspector.coreTempLabel')}
                </label>
                <span
                  className={`text-xs font-semibold ${
                    isTempWarm ? 'text-[var(--warning)]' : 'text-[var(--brand)]'
                  }`}
                >
                  {isTempWarm ? t('inspector.tempWarm') : t('inspector.coldChainOk')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Decrease temperature by 0.5 degrees"
                  onClick={() => setCoreTempC((prev) => stepTemperatureC(prev, -0.5))}
                  className="w-11 h-11 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-[var(--text-primary)] inline-flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  id="inspector-core-temp"
                  type="number"
                  step="0.1"
                  value={coreTempC}
                  onChange={(e) => setCoreTempC(e.target.value)}
                  className="flex-1 min-w-0 h-11 text-center font-mono-code text-base font-bold tabular-nums rounded-[var(--radius-control)] bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  aria-label="Increase temperature by 0.5 degrees"
                  onClick={() => setCoreTempC((prev) => stepTemperatureC(prev, 0.5))}
                  className="w-11 h-11 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-[var(--text-primary)] inline-flex items-center justify-center cursor-pointer shrink-0"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="md:col-span-8">
              <Input
                label={t('inspector.remarksLabel')}
                dockSize
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <Button
              type="submit"
              variant={grade === 'REJECTED_UNFIT' ? 'danger' : 'primary'}
              size="dock"
              loading={submitting}
              className="w-full sm:w-auto"
              icon={
                grade === 'REJECTED_UNFIT' ? (
                  <ThermometerSnowflake className="w-5 h-5" />
                ) : (
                  <ShieldCheck className="w-5 h-5" />
                )
              }
            >
              {grade === 'REJECTED_UNFIT'
                ? t('inspector.quarantineBtn')
                : `${t('inspector.confirmPrefix')} ${humanizeCode(grade)}`}
            </Button>
          </div>
        </form>
      </Card>

      <Card
        title={t('inspector.logTitle')}
        subtitle={t('inspector.logSubtitle')}
      >
        <DataTable
          caption="Quality Inspection Log"
          columns={columns}
          rows={data.lots}
          loading={refreshing || submitting}
          getRowKey={(r) => r.lot_id}
          onRowClick={handleSelectLot}
        />
      </Card>
    </div>
  );
};
