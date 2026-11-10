import React from 'react';
import {
  UserCheck,
  ArrowRight,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Input,
  Select,
  Toast,
  MaritimeCrestSvgEmblem,
  HarbourQuayDawnSvgDecor,
} from '@web/ui/index.tsx';
import {
  formatOperatorInitials,
  getRoleDisplayMeta,
  type OperatorRow,
  type SessionUser,
} from '@web/lib/api.ts';
import type { Role } from '@shared/contracts/rbac.ts';

export interface LoginPortalScreenProps {
  user: SessionUser | null;
  phoneInput: string;
  onChangePhoneInput: (val: string) => void;
  otpInput: string;
  onChangeOtpInput: (val: string) => void;
  devEchoOtp: string | null;
  authError: string | null;
  onDismissAuthError: () => void;
  authSuccess: string | null;
  onDismissAuthSuccess: () => void;
  onRequestOtp: (e: React.FormEvent) => Promise<void>;
  onVerifyOtp: (e: React.FormEvent) => Promise<void>;
  displayedOperators: ReadonlyArray<OperatorRow>;
  onPersonaSwitch: (role: Role) => Promise<void>;
  onBackToWorkspace: () => void;
  onOpenActiveProfile: () => void;
}

const DEMO_SANDBOX_PERSONAS: ReadonlyArray<OperatorRow> = [
  {
    user_id: 'USR-HADMIN-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000006',
    full_name: 'Capt. Mathew Thomas',
    role: 'HARBOUR_ADMIN',
    entity_ref_id: null,
    is_active: true,
    entity_summary: 'HMS Secretary & Statutory Custodian',
  },
  {
    user_id: 'USR-ACCT-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000007',
    full_name: 'Deepa Krishnan',
    role: 'ACCOUNTANT',
    entity_ref_id: null,
    is_active: true,
    entity_summary: 'Chief Accountant · Dual-Key Authority',
  },
  {
    user_id: 'USR-WEIGH-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000001',
    full_name: 'Sajeev K.',
    role: 'WEIGHING_OPERATOR',
    entity_ref_id: null,
    is_active: true,
    entity_summary: 'Dockside Scale & QR Terminal',
  },
  {
    user_id: 'USR-AUCT-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000002',
    full_name: 'K. Balakrishnan Nair',
    role: 'LICENSED_AUCTIONEER',
    entity_ref_id: 'LIC-MUN-001',
    is_active: true,
    entity_summary: 'Licence KL-HMS-MUN-AUCT-2024-01 (ACTIVE)',
  },
  {
    user_id: 'USR-BUYER-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000003',
    full_name: 'Ramesh Menon',
    role: 'WHOLESALE_BUYER',
    entity_ref_id: 'BUY-01',
    is_active: true,
    entity_summary: 'Paddle #101 · Apex Marine Exports',
  },
  {
    user_id: 'USR-FISHER-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000004',
    full_name: 'Antony Varghese',
    role: 'FISHERMAN_BOAT_OWNER',
    entity_ref_id: 'FSH-01',
    is_active: true,
    entity_summary: 'Welfare #KFWFB-EKM-8821',
  },
  {
    user_id: 'USR-INSP-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000005',
    full_name: 'Dr. Lekshmi R.',
    role: 'AUTHORIZED_INSPECTOR',
    entity_ref_id: null,
    is_active: true,
    entity_summary: 'Act 16 s.21 Hygiene & Cold-Chain Authority',
  },
  {
    user_id: 'USR-SUPER-01',
    tenant_id: 'munambam-demo',
    phone_e164: '+919447000008',
    full_name: 'Thejas R.',
    role: 'SUPER_ADMIN',
    entity_ref_id: null,
    is_active: true,
    entity_summary: 'Multi-Harbour Platform Governance',
  },
];

export const LoginPortalScreen: React.FC<LoginPortalScreenProps> = ({
  user,
  phoneInput,
  onChangePhoneInput,
  otpInput,
  onChangeOtpInput,
  devEchoOtp,
  authError,
  onDismissAuthError,
  authSuccess,
  onDismissAuthSuccess,
  onRequestOtp,
  onVerifyOtp,
  displayedOperators,
  onPersonaSwitch,
  onBackToWorkspace,
  onOpenActiveProfile,
}) => {
  const isDevSandbox = !import.meta.env.PROD;
  const operators =
    displayedOperators.length > 0 ? displayedOperators : DEMO_SANDBOX_PERSONAS;

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] py-8 px-4 sm:px-6 lg:px-10 flex flex-col items-center justify-center">
      <div className="w-full max-w-[1160px] flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--border-hair)]">
          <div className="flex items-center gap-3.5">
            <MaritimeCrestSvgEmblem size={44} className="shrink-0" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg sm:text-xl font-bold text-[var(--text-primary)] tracking-tight">
                  HarbourOS Operator Identity &amp; Sign-In Portal
                </span>
                <Badge tone="ok" label="HS256 JWT + RLS" />
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021) · Node.js 22 + PostgreSQL 16
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {user && (
              <Button
                variant="secondary"
                size="sm"
                icon={<UserCheck className="w-4 h-4" />}
                onClick={onOpenActiveProfile}
              >
                Active: {user.fullName}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<ArrowRight className="w-4 h-4" />}
              onClick={onBackToWorkspace}
            >
              Back to Workspace
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className={isDevSandbox ? 'lg:col-span-6 flex flex-col gap-5' : 'lg:col-span-8 lg:col-start-3 flex flex-col gap-5'}>
            <div className="p-4 rounded-[var(--radius-card)] border border-[var(--border-hair)] bg-[var(--bg-surface)] flex items-start gap-3.5">
              <HarbourQuayDawnSvgDecor size={48} />
              <div className="flex flex-col gap-1 min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--brand)]">
                  Munambam Fishing Harbour (HMS)
                </div>
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  Passwordless Mobile OTP &amp; Role-Scoped Access
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  Every operator token carries cryptographically signed <code>tenantId</code>, <code>role</code>, and <code>entityRefId</code> claims enforced by PostgreSQL Row-Level Security.
                </p>
              </div>
            </div>

            {authError && (
              <Toast
                tone="danger"
                title="Authentication Error"
                message={authError}
                onDismiss={onDismissAuthError}
              />
            )}

            {authSuccess && (
              <Toast
                tone="ok"
                title="OTP Challenge Issued"
                message={authSuccess}
                onDismiss={onDismissAuthSuccess}
              />
            )}

            <Card
              stepBadge="ADR-003"
              kicker="Passwordless Operator Authentication"
              title="Sign In via Registered Mobile OTP"
              subtitle="Enter your registered E.164 mobile number to receive a single-use 6-digit OTP challenge"
              icon={<KeyRound className="w-5 h-5" />}
            >
              <div className="flex flex-col gap-5">
                <form onSubmit={(e) => void onRequestOtp(e)} className="flex flex-col gap-3.5">
                  {isDevSandbox && (
                    <Select
                      label="Step 1: Select Sandbox Harbour Operator Phone"
                      value={phoneInput}
                      onChange={(e) => onChangePhoneInput(e.target.value)}
                      options={[
                        { value: '+919447000006', label: '+91 94470 00006 — Capt. Mathew Thomas (HARBOUR_ADMIN)' },
                        { value: '+919447000007', label: '+91 94470 00007 — Deepa Krishnan (ACCOUNTANT)' },
                        { value: '+919447000001', label: '+91 94470 00001 — Sajeev K. (WEIGHING_OPERATOR)' },
                        { value: '+919447000002', label: '+91 94470 00002 — K. Balakrishnan Nair (LICENSED_AUCTIONEER)' },
                        { value: '+919447000003', label: '+91 94470 00003 — Ramesh Menon (WHOLESALE_BUYER)' },
                        { value: '+919447000004', label: '+91 94470 00004 — Antony Varghese (FISHERMAN_BOAT_OWNER)' },
                        { value: '+919447000005', label: '+91 94470 00005 — Dr. Lekshmi R. (AUTHORIZED_INSPECTOR)' },
                        { value: '+919447000008', label: '+91 94470 00008 — Thejas R. (SUPER_ADMIN)' },
                      ]}
                    />
                  )}
                  <Input
                    label="Registered E.164 Mobile Number"
                    mono
                    value={phoneInput}
                    onChange={(e) => onChangePhoneInput(e.target.value)}
                    hint="Format: +91XXXXXXXXXX (verified against core.otp_challenges)"
                  />
                  <Button type="submit" variant="secondary" className="w-full">
                    1. Request 6-Digit OTP Challenge
                  </Button>
                </form>

                {devEchoOtp && isDevSandbox && (
                  <div className="p-4 rounded-[var(--radius-card)] bg-[var(--info-bg)] border border-[var(--info)]/40 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-[var(--info)]">
                        OTP_DEV_ECHO Active (Sandbox Mode)
                      </span>
                      <Badge tone="info" label={`CODE: ${devEchoOtp}`} />
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Single-use CSPRNG 6-digit OTP code auto-filled below. Production builds refuse to boot if <code>OTP_DEV_ECHO=true</code>.
                    </p>
                  </div>
                )}

                <form
                  onSubmit={(e) => void onVerifyOtp(e)}
                  className="flex flex-col gap-3.5 pt-4 border-t border-[var(--border-hair)]"
                >
                  <Input
                    label="Step 2: Enter 6-Digit OTP Code"
                    mono
                    placeholder="Enter 6-digit OTP"
                    value={otpInput}
                    onChange={(e) => onChangeOtpInput(e.target.value)}
                  />
                  <Button type="submit" variant="primary" className="w-full">
                    2. Verify OTP &amp; Sign In with HS256 JWT
                  </Button>
                </form>
              </div>
            </Card>
          </div>

          {isDevSandbox && (
            <div className="lg:col-span-6 flex flex-col gap-4">
              <Card
                stepBadge="SANDBOX PERSONAS"
                kicker="Development Demo Mode"
                title="Statutory Harbour Operator Personas"
                subtitle="Switch between the 8 statutory Act 16 roles in development mode or pre-fill their phone for OTP verification"
                icon={<ShieldCheck className="w-5 h-5" />}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {operators.map((op) => {
                    const meta = getRoleDisplayMeta(op.role);
                    const isCurrent = user?.userId === op.user_id || user?.role === op.role;
                    return (
                      <div
                        key={op.user_id}
                        className={`p-4 rounded-[var(--radius-card)] border flex flex-col justify-between gap-3 transition-all ${
                          isCurrent
                            ? 'bg-[var(--brand-soft)] border-[var(--brand)]'
                            : 'bg-[var(--bg-sunken)]/70 border-[var(--border-hair)] hover:border-[var(--border-strong)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-9 h-9 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] text-xs font-bold font-mono-code inline-flex items-center justify-center shrink-0">
                              {formatOperatorInitials(op.full_name)}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                                {op.full_name}
                              </div>
                              <div className="text-xs font-mono-code text-[var(--text-secondary)]">
                                {op.phone_e164}
                              </div>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-[10px] font-bold font-mono-code text-[var(--brand)] whitespace-nowrap shrink-0 leading-none">
                            {meta.shortBadge}
                          </span>
                        </div>

                        <div className="text-xs text-[var(--text-secondary)]">
                          <div className="font-semibold text-[var(--text-primary)]">
                            {op.entity_summary ?? meta.statutoryRef}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">
                            {meta.description}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => void onPersonaSwitch(op.role)}
                            className="flex-1"
                          >
                            Switch Role
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              onChangePhoneInput(op.phone_e164);
                            }}
                          >
                            Use Phone
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
