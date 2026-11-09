import React, { useState } from 'react';
import { ShieldCheck, Sparkles, ThermometerSnowflake } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Metric,
  Select,
  Input,
  DataTable,
  Toast,
  ThermometerFishGradeIcon,
  ColdChainInspectorSvgDecor,
  type DataTableColumn,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  formatKgFromGrams,
  type BootstrapData,
  type LotRow,
} from '@web/lib/api.ts';
import type { InspectionGrade } from '@shared/ids.ts';

export const InspectorWorkspace: React.FC<{
  data: BootstrapData;
  token: string;
  onRefresh: () => Promise<void>;
}> = ({ data, token, onRefresh }) => {
  const [selectedLotId, setSelectedLotId] = useState(
    data.lots[0]?.lot_id ?? 'LOT-2026-001'
  );
  const [grade, setGrade] = useState<InspectionGrade>('A_EXPORT');
  const [coreTempC, setCoreTempC] = useState('1.8');
  const [notes, setNotes] = useState(
    'Clear cornea, bright red gills, firm elastic flesh, core temp <= 2.5C (Act 16 s.21)'
  );
  const [submitting, setSubmitting] = useState(false);
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

  const selectedLot = data.lots.find((l) => l.lot_id === selectedLotId);
  const selectedSpecies = data.species.find(
    (s) => s.species_id === selectedLot?.species_id
  );

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
      setFeedback({
        tone: res.grade === 'REJECTED_UNFIT' ? 'danger' : 'ok',
        title: `Lot ${selectedLot.lot_code} Certified: ${res.grade}`,
        msg:
          res.grade === 'REJECTED_UNFIT'
            ? 'Lot marked BLOCKED_UNFIT under Section 21. Any auction allocation attempt will be rejected by the server.'
            : `Lot certified for ${res.grade} sale under Section 21.`,
      });
      await onRefresh();
    } catch (err) {
      setFeedback({
        tone: 'danger',
        title: 'Inspection Update Failed',
        msg: err instanceof Error ? err.message : 'Error saving inspection',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestAiAssist = async (): Promise<void> => {
    if (!selectedLot) return;
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
  };

  const columns: ReadonlyArray<DataTableColumn<LotRow>> = [
    {
      key: 'code',
      header: 'Lot Code',
      mono: true,
      render: (r) => <span className="font-semibold">{r.lot_code}</span>,
    },
    {
      key: 'species',
      header: 'Species',
      render: (r) => {
        const sp = data.species.find((s) => s.species_id === r.species_id);
        return (
          <div>
            <div className="font-medium">{sp?.name_en}</div>
            <div lang="ml" className="text-xs text-[var(--text-secondary)]">
              {sp?.name_ml}
            </div>
          </div>
        );
      },
    },
    {
      key: 'temp',
      header: 'Core Temp (°C)',
      align: 'right',
      mono: true,
      render: (r) => `${r.core_temp_c}°C`,
    },
    {
      key: 'weight',
      header: 'Net Weight',
      align: 'right',
      mono: true,
      render: (r) => formatKgFromGrams(r.net_grams),
    },
    {
      key: 'grade',
      header: 's.21 Quality Grade',
      render: (r) => (
        <Badge
          tone={
            r.inspection_grade === 'REJECTED_UNFIT'
              ? 'danger'
              : r.inspection_grade === 'A_EXPORT'
              ? 'ok'
              : 'info'
          }
          label={r.inspection_grade}
        />
      ),
    },
    {
      key: 'notes',
      header: 'Inspector Notes',
      render: (r) => <span className="text-xs text-[var(--text-secondary)]">{r.inspection_notes}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="p-5 sm:p-6 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-4 min-w-0">
          <ColdChainInspectorSvgDecor size={52} />
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--brand)] mb-1">
              <ThermometerFishGradeIcon size={15} />
              <span>Kerala Act 16 s.21 · Organoleptic & Cold-Chain Hygiene Gate</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Section 21 Quality Inspection & Hygiene Certification
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-0.5">
              Authorized Inspector terminal — Lots graded REJECTED_UNFIT are hard-blocked from pit auction allocation.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Badge tone="ok" label="ACT 16 s.21 AUTHORITY" />
          <Badge tone="info" label="COLD-CHAIN <= 2.5°C" />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Metric
          label="Export Grade Lots (A_EXPORT)"
          value={String(
            data.lots.filter((l) => l.inspection_grade === 'A_EXPORT').length
          )}
          unit="LOTS"
          sublabel="EU / MPEDA cold-chain compliant"
          status={{ tone: 'ok', label: 'CERTIFIED' }}
        />
        <Metric
          label="Domestic / Processing Lots"
          value={String(
            data.lots.filter(
              (l) =>
                l.inspection_grade === 'A_DOMESTIC' ||
                l.inspection_grade === 'B_PROCESS'
            ).length
          )}
          unit="LOTS"
          sublabel="Cleared for domestic wholesale"
          status={{ tone: 'info', label: 'CLEARED' }}
        />
        <Metric
          label="Rejected Unfit (s.21 Block)"
          value={String(
            data.lots.filter((l) => l.inspection_grade === 'REJECTED_UNFIT').length
          )}
          unit="BLOCKED"
          sublabel="Cannot be allocated in Pit or Remote Bid"
          status={{ tone: 'danger', label: 'QUARANTINED' }}
        />
      </div>

      <Card
        title="Inspect & Certify Landed Lot (Section 21)"
        subtitle="Human-confirmed grading with optional advisory AI assist (ADR-009)"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Sparkles className="w-4 h-4" />}
            onClick={handleRequestAiAssist}
          >
            Request Optional AI Assist (ADR-009)
          </Button>
        }
      >
        <form onSubmit={handleSaveInspection} className="flex flex-col gap-5">
          {aiAdvisory && (
            <div className="p-4 rounded-[var(--radius-card)] bg-[var(--info-bg)] border border-[var(--info)]/40 text-[var(--info)] flex flex-col gap-1">
              <div className="text-xs font-bold uppercase tracking-wide">
                {aiAdvisory.advisoryDisclaimer}
              </div>
              {aiAdvisory.available ? (
                <p className="text-sm font-medium">
                  Suggested Grade: <strong>{aiAdvisory.suggestedGrade}</strong> —{' '}
                  {aiAdvisory.confidenceNote}
                </p>
              ) : (
                <p className="text-xs">
                  Advisory LLM is disabled by default (`LLM_PROVIDER=none`). Zero fabricated fallback data is returned (§3 P7). Inspector must grade directly.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select
              label="Select Lot to Inspect"
              dockSize
              value={selectedLotId}
              onChange={(e) => setSelectedLotId(e.target.value)}
              options={data.lots.map((l) => ({
                value: l.lot_id,
                label: `${l.lot_code} (${l.inspection_grade}) — ${formatKgFromGrams(l.net_grams)}`,
              }))}
            />

            <Select
              label="Section 21 Quality Grade"
              dockSize
              value={grade}
              onChange={(e) => setGrade(e.target.value as InspectionGrade)}
              options={[
                { value: 'A_EXPORT', label: 'A_EXPORT (Prime Ice-Chilled Export)' },
                { value: 'A_DOMESTIC', label: 'A_DOMESTIC (Standard Wholesale)' },
                { value: 'B_PROCESS', label: 'B_PROCESS (Curing / Meal Processing)' },
                { value: 'REJECTED_UNFIT', label: 'REJECTED_UNFIT (Block Sale under s.21)' },
              ]}
            />

            <Input
              label="Core Flesh Temperature (°C)"
              type="number"
              step="0.1"
              mono
              dockSize
              value={coreTempC}
              onChange={(e) => setCoreTempC(e.target.value)}
            />
          </div>

          <Input
            label="Organoleptic & Hygiene Inspection Remarks"
            dockSize
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <div className="flex items-center justify-end gap-3">
            <Button
              type="submit"
              variant={grade === 'REJECTED_UNFIT' ? 'danger' : 'primary'}
              size="dock"
              loading={submitting}
              icon={
                grade === 'REJECTED_UNFIT' ? (
                  <ThermometerSnowflake className="w-5 h-5" />
                ) : (
                  <ShieldCheck className="w-5 h-5" />
                )
              }
            >
              {grade === 'REJECTED_UNFIT'
                ? 'Quarantine & Block Lot (REJECTED_UNFIT)'
                : `Confirm ${grade} Certification`}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Harbour Quality Inspection Log" subtitle="Click any lot to load into inspector form">
        <DataTable
          caption="Quality Inspection Log"
          columns={columns}
          rows={data.lots}
          getRowKey={(r) => r.lot_id}
          onRowClick={(r) => {
            setSelectedLotId(r.lot_id);
            setGrade(r.inspection_grade);
            setCoreTempC(String(r.core_temp_c));
            setNotes(r.inspection_notes);
          }}
        />
      </Card>
    </div>
  );
};
