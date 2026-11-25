import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  Rocket,
  Trash2,
  Users,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { Button, Input, Select, Modal, Toast } from '@web/ui/index.tsx';
import { apiRequest, formatInrFromPaise, type SessionUser, type TenantRow } from '@web/lib/api.ts';
import {
  STARTER_COASTAL_SPECIES,
  buildDefaultOperatorsForSlug,
  buildStarterMasterdataPlan,
  deriveShortCode,
  slugifyHarbourName,
  validateOnboardingOperators,
  validateOnboardingStep1,
  type OnboardingMasterdataOptions,
  type OnboardingOperatorDraft,
  type TenantIdentityDraft,
} from '@web/lib/tenant-onboarding.ts';
import type { Role, WorkspaceId } from '@shared/contracts/rbac.ts';
import type { CentreType, FloorEnforcement } from '@shared/ids.ts';

interface ProvisionStepStatus {
  id: string;
  label: string;
  state: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
}

export interface TenantOnboardingWizardProps {
  open: boolean;
  onClose: () => void;
  token: string | null;
  currentUserRole: Role | null;
  existingTenants: ReadonlyArray<TenantRow>;
  onProvisionComplete: (result: {
    accessToken: string;
    user: SessionUser;
    tenantId: string;
    tenantName: string;
    targetWorkspace: WorkspaceId;
  }) => Promise<void>;
}

const ROLE_OPTIONS: ReadonlyArray<{ value: Role; label: string }> = [
  { value: 'HARBOUR_ADMIN', label: 'Harbour Admin (HMS Secretary)' },
  { value: 'ACCOUNTANT', label: 'Chief Accountant' },
  { value: 'WEIGHING_OPERATOR', label: 'Weighing Desk Operator' },
  { value: 'LICENSED_AUCTIONEER', label: 'Licensed Pit Auctioneer' },
  { value: 'AUTHORIZED_INSPECTOR', label: 'Quality Inspector' },
  { value: 'WHOLESALE_BUYER', label: 'Wholesale Buyer' },
  { value: 'FISHERMAN_BOAT_OWNER', label: 'Vessel Owner / Fisher' },
];

export const TenantOnboardingWizard: React.FC<TenantOnboardingWizardProps> = ({
  open,
  onClose,
  token,
  currentUserRole,
  existingTenants,
  onProvisionComplete,
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [slugTouched, setSlugTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);

  const [identity, setIdentity] = useState<TenantIdentityDraft>({
    nameEn: '',
    slug: '',
    shortCode: '',
    centreType: 'KERALA_HARBOUR',
    floorEnforcement: 'WARN',
  });

  const [operators, setOperators] = useState<OnboardingOperatorDraft[]>(() =>
    buildDefaultOperatorsForSlug('new-harbour')
  );
  const [operatorsCustomized, setOperatorsCustomized] = useState(false);

  const [masterdata, setMasterdata] = useState<OnboardingMasterdataOptions>({
    seedStarterSpecies: true,
    seedStarterOperations: true,
    societyName: '',
    vesselName: 'Sea Star I',
    vesselRegNo: 'IND-KL-07-HRB-101',
    fishermanName: 'Varghese Joseph',
    fishermanPhone: '+919847990011',
    buyerName: 'Coastal Marine Exports',
    buyerPaddleNo: 101,
  });

  const [validationErrors, setValidationErrors] = useState<ReadonlyArray<string>>([]);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionSteps, setProvisionSteps] = useState<ProvisionStepStatus[]>([]);
  const [completedSession, setCompletedSession] = useState<{
    accessToken: string;
    user: SessionUser;
    tenantId: string;
    tenantName: string;
  } | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const existingSlugs = useMemo(
    () => existingTenants.map((t) => t.slug),
    [existingTenants]
  );

  const resetWizard = (): void => {
    setStep(1);
    setSlugTouched(false);
    setCodeTouched(false);
    setOperatorsCustomized(false);
    setIdentity({
      nameEn: '',
      slug: '',
      shortCode: '',
      centreType: 'KERALA_HARBOUR',
      floorEnforcement: 'WARN',
    });
    setOperators(buildDefaultOperatorsForSlug('new-harbour'));
    setMasterdata({
      seedStarterSpecies: true,
      seedStarterOperations: true,
      societyName: '',
      vesselName: 'Sea Star I',
      vesselRegNo: 'IND-KL-07-HRB-101',
      fishermanName: 'Varghese Joseph',
      fishermanPhone: '+919847990011',
      buyerName: 'Coastal Marine Exports',
      buyerPaddleNo: 101,
    });
    setValidationErrors([]);
    setProvisioning(false);
    setProvisionSteps([]);
    setCompletedSession(null);
    setFatalError(null);
  };

  const handleClose = (): void => {
    if (provisioning) return;
    resetWizard();
    onClose();
  };

  const handleNameChange = (nameEn: string): void => {
    const autoSlug = slugifyHarbourName(nameEn);
    const nextSlug = slugTouched ? identity.slug : autoSlug;
    const nextCode = codeTouched ? identity.shortCode : deriveShortCode(nameEn, nextSlug);
    setIdentity((prev) => ({
      ...prev,
      nameEn,
      slug: nextSlug,
      shortCode: nextCode,
    }));
    if (!operatorsCustomized && nextSlug.length >= 3) {
      setOperators(buildDefaultOperatorsForSlug(nextSlug));
    }
    if (!masterdata.societyName.trim() || masterdata.societyName.endsWith('Co-op Society')) {
      setMasterdata((prev) => ({
        ...prev,
        societyName: nameEn.trim() ? `${nameEn.trim()} Co-op Society` : '',
        vesselRegNo: `IND-KL-07-${nextCode || 'HRB'}-101`,
      }));
    }
  };

  const handleNext = (): void => {
    setValidationErrors([]);
    if (step === 1) {
      const check = validateOnboardingStep1(identity, existingSlugs);
      if (!check.valid) {
        setValidationErrors(check.errors);
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const check = validateOnboardingOperators(operators);
      if (!check.valid) {
        setValidationErrors(check.errors);
        return;
      }
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    }
  };

  const handleAddOperator = (): void => {
    setOperatorsCustomized(true);
    const idx = operators.length + 1;
    setOperators((prev) => [
      ...prev,
      {
        id: `op-${Date.now()}-${idx}`,
        fullName: '',
        phoneE164: `+919847${String(400000 + idx * 137).slice(0, 6)}`,
        role: 'ACCOUNTANT',
        pinCode: '1234',
      },
    ]);
  };

  const handleRemoveOperator = (id: string): void => {
    setOperatorsCustomized(true);
    setOperators((prev) => prev.filter((op) => op.id !== id));
  };

  const updateStepStatus = (
    id: string,
    patch: Partial<Pick<ProvisionStepStatus, 'state' | 'detail'>>
  ): void => {
    setProvisionSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    );
  };

  const handleRunProvisioning = async (): Promise<void> => {
    setFatalError(null);
    setProvisioning(true);

    const stepsList: ProvisionStepStatus[] = [
      { id: 'auth', label: 'Verify platform administrator session', state: 'pending' },
      { id: 'tenant', label: `Create isolated tenant "${identity.nameEn.trim()}"`, state: 'pending' },
      { id: 'users', label: `Provision ${operators.length} role operator account(s)`, state: 'pending' },
      { id: 'context', label: 'Switch active RLS session into new harbour', state: 'pending' },
      ...(masterdata.seedStarterSpecies
        ? [{ id: 'species', label: `Load ${STARTER_COASTAL_SPECIES.length} coastal species & floor prices`, state: 'pending' as const }]
        : []),
      ...(masterdata.seedStarterOperations
        ? [{ id: 'ops', label: 'Configure starter co-op society, vessel, buyer & open session', state: 'pending' as const }]
        : []),
    ];
    setProvisionSteps(stepsList);

    try {
      // 1. Ensure SUPER_ADMIN token
      updateStepStatus('auth', { state: 'running' });
      let adminToken = token;
      if (!adminToken || currentUserRole !== 'SUPER_ADMIN') {
        if (!import.meta.env.PROD) {
          const switched = await apiRequest<{ accessToken: string; user: SessionUser }>(
            '/api/v1/auth/persona-switch',
            { method: 'POST', body: { role: 'SUPER_ADMIN' } }
          );
          adminToken = switched.accessToken;
        } else {
          throw new Error('Platform Super Admin sign-in is required to provision new tenants.');
        }
      }
      updateStepStatus('auth', { state: 'done', detail: 'Verified' });

      // 2. Provision tenant
      updateStepStatus('tenant', { state: 'running' });
      const cleanSlug = slugifyHarbourName(identity.slug);
      const cleanShortCode = identity.shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const createdTenant = await apiRequest<{
        tenantId: string;
        slug: string;
        shortCode?: string;
        policyId: string;
      }>('/api/v1/tenants', {
        method: 'POST',
        token: adminToken,
        body: {
          slug: cleanSlug,
          shortCode: cleanShortCode,
          nameEn: identity.nameEn.trim(),
          nameMl: identity.nameEn.trim(),
          centreType: identity.centreType,
          floorEnforcement: identity.floorEnforcement,
        },
      });
      updateStepStatus('tenant', {
        state: 'done',
        detail: `${createdTenant.tenantId} · ${createdTenant.policyId}`,
      });

      // 3. Provision operators
      updateStepStatus('users', { state: 'running' });
      for (const op of operators) {
        await apiRequest(`/api/v1/tenants/${createdTenant.tenantId}/users`, {
          method: 'POST',
          token: adminToken,
          body: {
            fullName: op.fullName.trim(),
            phoneE164: op.phoneE164.replace(/\s+/g, ''),
            role: op.role,
            pinCode: op.pinCode.trim(),
            preferredLocale: 'en',
          },
        });
      }
      updateStepStatus('users', {
        state: 'done',
        detail: `${operators.length} accounts active`,
      });

      // 4. Switch SUPER_ADMIN context to the new tenant
      updateStepStatus('context', { state: 'running' });
      const switchedCtx = await apiRequest<{
        accessToken: string;
        user: SessionUser;
      }>('/api/v1/auth/tenant-switch', {
        method: 'POST',
        token: adminToken,
        body: { tenantId: createdTenant.tenantId },
      });
      const tenantToken = switchedCtx.accessToken;
      updateStepStatus('context', { state: 'done', detail: 'RLS scoped' });

      // 5. Starter species
      if (masterdata.seedStarterSpecies) {
        updateStepStatus('species', { state: 'running' });
        for (const sp of STARTER_COASTAL_SPECIES) {
          await apiRequest('/api/v1/masterdata/species', {
            method: 'POST',
            token: tenantToken,
            body: {
              code: sp.code,
              nameEn: sp.nameEn,
              nameMl: sp.manglishName,
              scientificName: sp.scientificName,
              floorPricePaisePerKg: sp.floorPricePaisePerKg,
              exportEligible: sp.exportEligible,
            },
          });
        }
        updateStepStatus('species', {
          state: 'done',
          detail: `${STARTER_COASTAL_SPECIES.length} species ready`,
        });
      }

      // 6. Starter operations (society, fisherman, vessel, buyer, session)
      if (masterdata.seedStarterOperations) {
        updateStepStatus('ops', { state: 'running' });
        const plan = buildStarterMasterdataPlan(
          createdTenant.shortCode ?? cleanShortCode,
          masterdata
        );
        await apiRequest('/api/v1/masterdata/coop-societies', {
          method: 'POST',
          token: tenantToken,
          body: plan.society,
        });
        await apiRequest('/api/v1/masterdata/fishermen', {
          method: 'POST',
          token: tenantToken,
          body: plan.fisherman,
        });
        await apiRequest('/api/v1/masterdata/vessels', {
          method: 'POST',
          token: tenantToken,
          body: plan.vessel,
        });
        await apiRequest('/api/v1/masterdata/buyers', {
          method: 'POST',
          token: tenantToken,
          body: plan.buyer,
        });
        await apiRequest('/api/v1/masterdata/sessions', {
          method: 'POST',
          token: tenantToken,
          body: plan.session,
        });
        updateStepStatus('ops', { state: 'done', detail: 'Dockside & pit ready' });
      }

      setCompletedSession({
        accessToken: tenantToken,
        user: switchedCtx.user,
        tenantId: createdTenant.tenantId,
        tenantName: identity.nameEn.trim(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Onboarding failed';
      setFatalError(msg);
      setProvisionSteps((prev) =>
        prev.map((s) => (s.state === 'running' ? { ...s, state: 'error', detail: msg } : s))
      );
    } finally {
      setProvisioning(false);
    }
  };

  const handleLaunch = async (targetWorkspace: WorkspaceId): Promise<void> => {
    if (!completedSession) return;
    await onProvisionComplete({
      ...completedSession,
      targetWorkspace,
    });
    resetWizard();
    onClose();
  };

  const stepsMeta = [
    { num: 1 as const, label: 'Identity', icon: <Building2 className="w-3.5 h-3.5" /> },
    { num: 2 as const, label: 'Operators', icon: <Users className="w-3.5 h-3.5" /> },
    { num: 3 as const, label: 'Catalog', icon: <Layers className="w-3.5 h-3.5" /> },
    { num: 4 as const, label: 'Launch', icon: <Rocket className="w-3.5 h-3.5" /> },
  ];

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Onboard New Harbour Tenant"
      description="Provision an isolated harbour workspace with statutory commission policy, operator accounts, and starter catalog."
      footer={
        completedSession ? (
          <div className="flex flex-wrap items-center justify-end gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => void handleLaunch('weighing')}
            >
              Open Weighing Desk
            </Button>
            <Button
              variant="primary"
              icon={<Rocket className="w-4 h-4" />}
              onClick={() => void handleLaunch('harbour')}
            >
              Enter Harbour Dashboard
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 w-full">
            <div>
              {step > 1 && !provisioning && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<ArrowLeft className="w-4 h-4" />}
                  onClick={() => {
                    setValidationErrors([]);
                    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : 1));
                  }}
                >
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleClose} disabled={provisioning}>
                Cancel
              </Button>
              {step < 4 ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<ArrowRight className="w-4 h-4" />}
                  onClick={handleNext}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  loading={provisioning}
                  icon={<Rocket className="w-4 h-4" />}
                  onClick={() => void handleRunProvisioning()}
                >
                  Provision & Launch Harbour
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5" data-testid="tenant-onboarding-wizard">
        {/* Clean Step Indicator */}
        <ol className="grid grid-cols-4 gap-2 border-b border-[var(--border-hair)] pb-4">
          {stepsMeta.map((s) => {
            const active = step === s.num;
            const done = step > s.num || Boolean(completedSession);
            return (
              <li
                key={s.num}
                className={`flex items-center gap-2 text-xs font-semibold ${
                  active
                    ? 'text-[var(--brand)]'
                    : done
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)]'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full inline-flex items-center justify-center text-[11px] font-mono-code shrink-0 border ${
                    active
                      ? 'bg-[var(--brand)] text-[var(--brand-fg)] border-[var(--brand)]'
                      : done
                      ? 'bg-[var(--brand-soft)] text-[var(--brand)] border-[var(--brand)]'
                      : 'bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-hair)]'
                  }`}
                >
                  {done && !active ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.num}
                </span>
                <span className="truncate hidden sm:inline">{s.label}</span>
              </li>
            );
          })}
        </ol>

        {validationErrors.length > 0 && (
          <Toast
            tone="danger"
            title="Check required fields"
            message={validationErrors.join(' ')}
            onDismiss={() => setValidationErrors([])}
          />
        )}

        {fatalError && (
          <Toast
            tone="danger"
            title="Provisioning interrupted"
            message={fatalError}
            onDismiss={() => setFatalError(null)}
          />
        )}

        {/* STEP 1: HARBOUR IDENTITY & STATUTORY PRESET */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <Input
              label="Harbour or Fish Market Name"
              placeholder="e.g. Kochi Vypeen Fishing Harbour"
              value={identity.nameEn}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Tenant URL Slug"
                mono
                placeholder="kochi-vypeen"
                value={identity.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  const nextSlug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                  setIdentity((prev) => ({ ...prev, slug: nextSlug }));
                }}
                hint={`Tenant ID: ten-${slugifyHarbourName(identity.slug) || '...'}`}
              />
              <Input
                label="Lot Prefix Short Code"
                mono
                maxLength={6}
                placeholder="KVFH"
                value={identity.shortCode}
                onChange={(e) => {
                  setCodeTouched(true);
                  setIdentity((prev) => ({
                    ...prev,
                    shortCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                  }));
                }}
                hint="2–6 letters used on dockside QR tags"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Statutory Regime Preset"
                value={identity.centreType}
                onChange={(e) =>
                  setIdentity((prev) => ({ ...prev, centreType: e.target.value as CentreType }))
                }
                options={[
                  { value: 'KERALA_HARBOUR', label: 'Kerala Harbour (20/20/40/20 split)' },
                  { value: 'KERALA_LANDING_CENTRE', label: 'Kerala Landing Centre (20/20/40/20)' },
                  { value: 'KERALA_MARKET', label: 'Kerala Fish Market (20/20/30/30 split)' },
                  { value: 'INDIA_COOP', label: 'India Co-op Federation Preset' },
                ]}
              />
              <Select
                label="Section 19 Floor Enforcement"
                value={identity.floorEnforcement}
                onChange={(e) =>
                  setIdentity((prev) => ({
                    ...prev,
                    floorEnforcement: e.target.value as FloorEnforcement,
                  }))
                }
                options={[
                  { value: 'WARN', label: 'Warn on below-floor bids' },
                  { value: 'BLOCK', label: 'Hard block below-floor bids' },
                  { value: 'OFF', label: 'Advisory off' },
                ]}
              />
            </div>
          </div>
        )}

        {/* STEP 2: INITIAL TEAM & ROLE DASHBOARDS */}
        {step === 2 && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-[var(--text-secondary)]">
                Create the initial operators for this harbour. Each role automatically receives its tailored dashboard.
              </p>
              <Button
                variant="outline"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={handleAddOperator}
              >
                Add Operator
              </Button>
            </div>
            <div className="flex flex-col gap-3 max-h-[340px] overflow-y-auto pr-1">
              {operators.map((op, index) => (
                <div
                  key={op.id}
                  className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-secondary)]">
                      Operator #{index + 1}
                    </span>
                    {operators.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove operator ${index + 1}`}
                        onClick={() => handleRemoveOperator(op.id)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Full Name"
                      value={op.fullName}
                      onChange={(e) => {
                        setOperatorsCustomized(true);
                        const val = e.target.value;
                        setOperators((prev) =>
                          prev.map((item) => (item.id === op.id ? { ...item, fullName: val } : item))
                        );
                      }}
                    />
                    <Select
                      label="Dashboard Role"
                      value={op.role}
                      onChange={(e) => {
                        setOperatorsCustomized(true);
                        const val = e.target.value as Role;
                        setOperators((prev) =>
                          prev.map((item) => (item.id === op.id ? { ...item, role: val } : item))
                        );
                      }}
                      options={ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label }))}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Mobile (E.164)"
                      mono
                      value={op.phoneE164}
                      onChange={(e) => {
                        setOperatorsCustomized(true);
                        const val = e.target.value;
                        setOperators((prev) =>
                          prev.map((item) => (item.id === op.id ? { ...item, phoneE164: val } : item))
                        );
                      }}
                    />
                    <Input
                      label="Supervisor PIN"
                      mono
                      value={op.pinCode}
                      onChange={(e) => {
                        setOperatorsCustomized(true);
                        const val = e.target.value;
                        setOperators((prev) =>
                          prev.map((item) => (item.id === op.id ? { ...item, pinCode: val } : item))
                        );
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 3: STARTER SPECIES & DOCKSIDE CATALOG */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <label className="p-3.5 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={masterdata.seedStarterSpecies}
                onChange={(e) =>
                  setMasterdata((prev) => ({ ...prev, seedStarterSpecies: e.target.checked }))
                }
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  Load 8 Kerala Coastal Species with Floor Prices
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Pre-populates English names and Manglish local names (Avoli, Neymeen, Naran Chemmeen, Karimeen, Choora, Koonthal, Ayala, Mathi).
                </p>
                {masterdata.seedStarterSpecies && (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {STARTER_COASTAL_SPECIES.map((sp) => (
                      <div
                        key={sp.code}
                        className="px-2.5 py-1.5 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] text-xs"
                      >
                        <div className="flex items-center justify-between gap-1 text-[10px] text-[var(--text-muted)]">
                          <span className="truncate font-semibold">{sp.manglishName}</span>
                          <span className="font-mono-code shrink-0">
                            {formatInrFromPaise(sp.floorPricePaisePerKg)}
                          </span>
                        </div>
                        <div className="font-semibold text-[var(--text-primary)] truncate">
                          {sp.nameEn}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </label>

            <label className="p-3.5 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={masterdata.seedStarterOperations}
                onChange={(e) =>
                  setMasterdata((prev) => ({ ...prev, seedStarterOperations: e.target.checked }))
                }
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  Configure Starter Vessel, Co-op Society, Buyer & Open Auction Session
                </div>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Makes Weighing, Quality Inspection, and Auction Pit workspaces ready immediately after launch.
                </p>
              </div>
            </label>

            {masterdata.seedStarterOperations && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)]">
                <Input
                  label="Co-op Society Name"
                  value={masterdata.societyName}
                  onChange={(e) =>
                    setMasterdata((prev) => ({ ...prev, societyName: e.target.value }))
                  }
                />
                <Input
                  label="First Landed Vessel Name"
                  value={masterdata.vesselName}
                  onChange={(e) =>
                    setMasterdata((prev) => ({ ...prev, vesselName: e.target.value }))
                  }
                />
                <Input
                  label="Vessel Registration No."
                  mono
                  value={masterdata.vesselRegNo}
                  onChange={(e) =>
                    setMasterdata((prev) => ({ ...prev, vesselRegNo: e.target.value }))
                  }
                />
                <Input
                  label="First Wholesale Buyer"
                  value={masterdata.buyerName}
                  onChange={(e) =>
                    setMasterdata((prev) => ({ ...prev, buyerName: e.target.value }))
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* STEP 4: REVIEW & LIVE PROVISIONING PROGRESS */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            {provisionSteps.length === 0 ? (
              <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-3 text-sm">
                <div className="flex items-center justify-between border-b border-[var(--border-hair)] pb-2.5">
                  <div>
                    <div className="font-bold text-[var(--text-primary)]">{identity.nameEn}</div>
                    <div className="text-xs font-mono-code text-[var(--text-secondary)]">
                      ten-{slugifyHarbourName(identity.slug)} · Prefix {identity.shortCode}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[var(--brand)]">
                    {identity.centreType.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-[var(--text-muted)]">Floor Policy</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                      {identity.floorEnforcement}
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Operators</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                      {operators.length} accounts
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--text-muted)]">Starter Catalog</div>
                    <div className="font-semibold text-[var(--text-primary)] mt-0.5">
                      {masterdata.seedStarterSpecies ? '8 species' : 'Empty'}{' '}
                      {masterdata.seedStarterOperations ? '+ vessel & buyer' : ''}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-2" aria-live="polite">
                {provisionSteps.map((st) => (
                  <li
                    key={st.id}
                    className="px-3.5 py-2.5 rounded-[var(--radius-control)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      {st.state === 'running' ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--brand)] shrink-0" />
                      ) : st.state === 'done' ? (
                        <CheckCircle2 className="w-4 h-4 text-[var(--brand)] shrink-0" />
                      ) : st.state === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-[var(--danger)] shrink-0" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-[var(--border-strong)] shrink-0" />
                      )}
                      <span className="font-medium text-[var(--text-primary)] truncate">
                        {st.label}
                      </span>
                    </span>
                    {st.detail && (
                      <span className="font-mono-code text-[11px] text-[var(--text-muted)] shrink-0">
                        {st.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {completedSession && (
              <div className="p-4 rounded-[var(--radius-card)] bg-[var(--brand-soft)] border border-[var(--brand)]/40 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[var(--brand)] shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)]">
                    {completedSession.tenantName} is live and isolated
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Ledger head, institutional accounts, operator logins, and starter catalog are ready under tenant{' '}
                    <span className="font-mono-code">{completedSession.tenantId}</span>.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
