import React, { useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Button, Card, Badge, Select, Toast, SkeletonCard, SkeletonList } from '@web/ui/index.tsx';
import { apiRequest, type BootstrapData } from '@web/lib/api.ts';
import { useI18n } from '@web/i18n/index.tsx';

type MasterdataEntityType =
  | 'coop-societies'
  | 'fishermen'
  | 'vessels'
  | 'buyers'
  | 'species'
  | 'licences';

interface CsvImportResponse {
  dryRun: boolean;
  entityType: string;
  totalRows: number;
  validRows: number;
  committed: boolean;
  errors: ReadonlyArray<{ row: number; field: string; message: string }>;
}

const SAMPLE_CSV_TEMPLATES: Record<MasterdataEntityType, string> = {
  'coop-societies':
    'societyId,regNo,nameEn,nameMl\nSOC-PILOT-01,KL-EKM-COOP-901,Azheekode Coastal Society,അഴീക്കോട് തീരദേശ സംഘം',
  fishermen:
    'fishermanId,fullName,phoneE164,welfareBoardNo,coopSocietyId\nFSH-PILOT-01,Rajan Varghese,+919847123456,KFWFB-9001,SOC-MUN-01',
  vessels:
    'vesselId,registrationNo,vesselNameEn,vesselNameMl,ownerFishermanId,hasActiveSocietyLoan\nVSL-PILOT-01,IND-KL-07-MM-901,St. Jude Star,സെന്റ് ജൂഡ് സ്റ്റാർ,FSH-01,false',
  buyers:
    'buyerId,buyerName,paddleNo,gstin,escrowBalancePaise,approvedCreditPaise\nBUY-PILOT-01,Malabar Cold Exports,188,32AAACM3025E1Z5,5000000,10000000',
  species:
    'speciesId,code,nameEn,nameMl,scientificName,floorPricePaisePerKg,exportEligible\nSPC-PILOT-01,POM,Silver Pomfret,ആവോലി,Pampus argenteus,68000,true',
  licences:
    'licenceId,auctioneerUserId,auctioneerName,licenceNo,validFrom,validUntil\nLIC-PILOT-01,USR-AUCT-01,Suresh Nair,KL-AUCT-2026-99,2026-01-01,2026-12-31',
};

export const MasterdataCsvPanel: React.FC<{
  data: BootstrapData;
  token: string;
  onRefresh: () => Promise<void>;
}> = ({ data, token, onRefresh }) => {
  const { t } = useI18n();
  const [entityType, setEntityType] = useState<MasterdataEntityType>('species');
  const [csvText, setCsvText] = useState<string>(SAMPLE_CSV_TEMPLATES.species);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CsvImportResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleEntityChange = (next: MasterdataEntityType): void => {
    setEntityType(next);
    setCsvText(SAMPLE_CSV_TEMPLATES[next]);
    setResult(null);
    setErrorMsg(null);
  };

  const runImport = async (dryRun: boolean): Promise<void> => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<CsvImportResponse>(
        `/api/v1/masterdata/import/${entityType}`,
        {
          method: 'POST',
          token,
          body: { csvText, dryRun },
        }
      );
      setResult(res);
      if (res.committed) {
        await onRefresh();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Masterdata CSV import failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="masterdata-csv-panel">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Species', count: data.species.length },
          { label: 'Vessels', count: data.vessels.length },
          { label: 'Fishermen', count: data.fishermen.length },
          { label: 'Buyers', count: data.buyers.length },
          { label: 'Licences', count: data.licences.length },
          { label: 'Accounts', count: data.accounts.length },
        ].map((item) => (
          <div
            key={item.label}
            className="p-3 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)]"
          >
            <div className="text-xs text-[var(--text-muted)] uppercase font-semibold">
              {item.label}
            </div>
            <div className="text-lg font-bold font-mono-code text-[var(--text-primary)] mt-0.5">
              {item.count}
            </div>
          </div>
        ))}
      </div>

      <Card
        title={t('actions.importMasterdata')}
        subtitle="Dry-run validate CSV rows for GSTIN, phone format, formula-injection, and auctioneer licence rules before atomic commit"
        actions={
          <Button
            variant="outline"
            size="sm"
            icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
            onClick={() => {
              setCsvText(SAMPLE_CSV_TEMPLATES[entityType]);
              setResult(null);
              setErrorMsg(null);
            }}
          >
            Load Sample CSV
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {errorMsg && (
            <Toast
              tone="danger"
              title="Import Error"
              message={errorMsg}
              onDismiss={() => setErrorMsg(null)}
            />
          )}

          <div className="max-w-sm">
            <Select
              label="Target Masterdata Registry"
              value={entityType}
              onChange={(e) => handleEntityChange(e.target.value as MasterdataEntityType)}
              options={[
                { value: 'species', label: 'Species & Floor Prices' },
                { value: 'buyers', label: 'Wholesale Buyers & Credit Limits' },
                { value: 'vessels', label: 'Fishing Vessels & Loan Ties' },
                { value: 'fishermen', label: 'Fishermen & Ledger Accounts' },
                { value: 'coop-societies', label: 'Primary Co-op Societies' },
                { value: 'licences', label: 'Auctioneer Licences' },
              ]}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="masterdata-csv-input"
              className="text-xs font-semibold text-[var(--text-secondary)]"
            >
              CSV Payload (Header + Rows)
            </label>
            <textarea
              id="masterdata-csv-input"
              rows={5}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full p-3 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-strong)] text-xs font-mono-code text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="secondary"
              loading={submitting}
              icon={<CheckCircle2 className="w-4 h-4" />}
              onClick={() => void runImport(true)}
            >
              {t('actions.dryRunValidate')}
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              icon={<Upload className="w-4 h-4" />}
              onClick={() => void runImport(false)}
            >
              {t('actions.atomicCommit')}
            </Button>
          </div>

          {submitting && (
            <SkeletonCard
              showHeader={false}
              testId="csv-import-skeleton"
              label="Validating masterdata CSV rows…"
            >
              <SkeletonList items={3} variant="compact" surface="sunken" />
            </SkeletonCard>
          )}

          {!submitting && result && (
            <div
              data-testid="csv-import-result"
              className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {result.entityType} · {result.validRows}/{result.totalRows} valid rows
                </div>
                <Badge
                  tone={
                    result.errors.length > 0
                      ? 'danger'
                      : result.committed
                      ? 'ok'
                      : 'info'
                  }
                  label={
                    result.errors.length > 0
                      ? `${result.errors.length} ERRORS`
                      : result.committed
                      ? 'ATOMICALLY COMMITTED'
                      : 'DRY-RUN VALID'
                  }
                />
              </div>

              {result.errors.length > 0 && (
                <ul className="space-y-1 text-xs text-[var(--danger)]">
                  {result.errors.map((err, idx) => (
                    <li key={idx} className="flex items-center gap-1.5 font-mono-code">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Row {err.row} [{err.field}]: {err.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
