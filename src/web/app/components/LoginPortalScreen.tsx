import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, MessageSquareText, ShieldCheck } from 'lucide-react';
import {
  Button,
  Input,
  Toast,
  MaritimeCrestSvgEmblem,
  DawnHarbourHeroScene,
} from '@web/ui/index.tsx';
import { useI18n } from '@web/i18n/index.tsx';
import {
  apiRequest,
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
  onOpenOnboarding?: () => void;
}

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
  onOpenOnboarding,
}) => {
  const isDevSandbox = !import.meta.env.PROD;
  const { t } = useI18n();
  const [editingNumber, setEditingNumber] = useState(false);
  const otpStep = (Boolean(authSuccess) || Boolean(devEchoOtp)) && !editingNumber;
  const [fetchedDemoOperators, setFetchedDemoOperators] = useState<ReadonlyArray<OperatorRow>>([]);

  useEffect(() => {
    if (!isDevSandbox || displayedOperators.length > 0) return;
    let active = true;
    void apiRequest<{
      operators: ReadonlyArray<{
        userId: string;
        tenantId: string;
        phoneE164: string;
        fullName: string;
        role: Role;
      }>;
    }>('/api/v1/demo/operators')
      .then((res) => {
        if (!active || !Array.isArray(res.operators)) return;
        setFetchedDemoOperators(
          res.operators.map((op) => ({
            user_id: op.userId,
            tenant_id: op.tenantId,
            phone_e164: op.phoneE164,
            full_name: op.fullName,
            role: op.role,
            entity_ref_id: null,
            is_active: true,
          }))
        );
      })
      .catch(() => {
        // Production or DEMO_MODE=false returns 404
      });
    return () => {
      active = false;
    };
  }, [isDevSandbox, displayedOperators.length]);

  const operators =
    displayedOperators.length > 0 ? displayedOperators : fetchedDemoOperators;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* Hero: brand, language toggle, illustration, promise */}
      <header className="bg-[var(--decor-aqua-soft)] rounded-b-[32px] px-5 pt-[calc(16px+env(safe-area-inset-top))] pb-14 sm:pb-16 flex flex-col items-center">
        <div className="w-full max-w-[460px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <MaritimeCrestSvgEmblem size={34} />
            <span className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
              HarbourOS
            </span>
          </div>
          {onOpenOnboarding && isDevSandbox && (
            <Button
              variant="outline"
              size="sm"
              icon={<Building2 className="w-3.5 h-3.5" />}
              onClick={onOpenOnboarding}
            >
              Onboard Harbour
            </Button>
          )}
        </div>
        <DawnHarbourHeroScene className="mt-5 w-[min(300px,78vw)]" />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
          {t('login.harbour')}
        </p>
        <p className="mt-1.5 max-w-[320px] text-center text-[15px] leading-snug text-[var(--text-secondary)]">
          {t('login.tagline')}
        </p>
      </header>

      {/* Sign-in sheet overlaps the hero */}
      <main className="flex-1 w-full max-w-[460px] mx-auto -mt-8 px-4 pb-[calc(24px+env(safe-area-inset-bottom))] flex flex-col gap-4">
        <section
          aria-labelledby="login-title"
          className="rounded-[28px] bg-[var(--bg-surface)] border border-[var(--border-hair)] shadow-[var(--shadow-overlay)] p-5 sm:p-6 flex flex-col gap-5"
        >
          <div>
            <h1 id="login-title" className="text-2xl font-bold tracking-tight">
              {t('login.welcome')}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t('login.subtitle')}
            </p>
          </div>

          {authError && (
            <Toast
              tone="danger"
              title="Couldn't sign you in"
              message={authError}
              onDismiss={onDismissAuthError}
            />
          )}

          {!otpStep ? (
            <form
              onSubmit={(e) => {
                setEditingNumber(false);
                void onRequestOtp(e);
              }}
              className="flex flex-col gap-4"
            >
              <Input
                label={t('login.phoneLabel')}
                dockSize
                mono
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                value={phoneInput}
                onChange={(e) => onChangePhoneInput(e.target.value)}
                hint={t('login.phoneHint')}
              />
              <Button
                type="submit"
                variant="primary"
                size="dock"
                className="w-full min-h-[56px]"
                icon={<MessageSquareText className="w-5 h-5" />}
              >
                {t('login.sendCode')}
              </Button>
            </form>
          ) : (
            <form onSubmit={(e) => void onVerifyOtp(e)} className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-[var(--bg-tint)] px-3.5 py-3">
                <div className="min-w-0">
                  <div className="text-xs text-[var(--text-secondary)]">
                    {t('login.codeSentTo')}
                  </div>
                  <div className="font-mono-code text-sm font-bold truncate">{phoneInput}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingNumber(true);
                    onDismissAuthSuccess();
                    onChangeOtpInput('');
                  }}
                  className="shrink-0 min-h-[44px] px-2 text-sm font-semibold text-[var(--brand)] cursor-pointer"
                >
                  {t('login.changeNumber')}
                </button>
              </div>
              <Input
                label={t('login.otpLabel')}
                dockSize
                mono
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={otpInput}
                onChange={(e) => onChangeOtpInput(e.target.value.replace(/\D/g, ''))}
              />
              {devEchoOtp && isDevSandbox && (
                <p className="text-xs rounded-[var(--radius-control)] bg-[var(--info-bg)] text-[var(--info)] px-3 py-2">
                  Dev sandbox code: <span className="font-mono-code font-bold">{devEchoOtp}</span>
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="dock"
                className="w-full min-h-[56px]"
                icon={<ArrowRight className="w-5 h-5" />}
              >
                {t('login.verify')}
              </Button>
            </form>
          )}

          <p className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
            <span>{t('login.help')}</span>
          </p>
        </section>

        {user && (
          <button
            type="button"
            onClick={onBackToWorkspace}
            className="self-center min-h-[44px] inline-flex items-center gap-1.5 px-3 text-sm font-semibold text-[var(--text-secondary)] cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> {t('login.backToWorkspace')}
          </button>
        )}

        {isDevSandbox && operators.length > 0 && (
          <details className="rounded-[var(--radius-card)] border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--text-secondary)] min-h-[44px] flex items-center">
              Developer sandbox: switch role (dev builds only)
            </summary>
            <ul className="mt-3 flex flex-col gap-2.5">
              {operators.map((op) => {
                const meta = getRoleDisplayMeta(op.role);
                const isCurrent = user?.userId === op.user_id || user?.role === op.role;
                return (
                  <li
                    key={op.user_id}
                    className={`rounded-[var(--radius-control)] border p-3 flex items-center gap-3 ${
                      isCurrent
                        ? 'bg-[var(--brand-soft)] border-[var(--brand)]'
                        : 'bg-[var(--bg-sunken)] border-[var(--border-hair)]'
                    }`}
                  >
                    <span className="w-9 h-9 shrink-0 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] text-xs font-bold font-mono-code inline-flex items-center justify-center">
                      {formatOperatorInitials(op.full_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold truncate">{op.full_name}</div>
                      <div className="text-xs text-[var(--text-secondary)] truncate">
                        {meta.shortBadge}
                      </div>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => void onPersonaSwitch(op.role)}>
                      Switch
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onChangePhoneInput(op.phone_e164)}>
                      Use phone
                    </Button>
                  </li>
                );
              })}
            </ul>
          </details>
        )}
      </main>
    </div>
  );
};
