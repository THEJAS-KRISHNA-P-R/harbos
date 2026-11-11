import React from 'react';
import { LogOut, CheckCircle2, Sparkles } from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Tabs,
  Input,
  Drawer,
  Toast,
} from '@web/ui/index.tsx';
import {
  getRoleDisplayMeta,
  formatOperatorInitials,
  type OperatorProfileResponse,
  type SessionUser,
} from '@web/lib/api.ts';
import type { Role, WorkspaceId } from '@shared/contracts/rbac.ts';

export interface OperatorProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  user: SessionUser | null;
  profileTab: 'identity' | 'switch' | 'session';
  onChangeTab: (tab: 'identity' | 'switch' | 'session') => void;
  profileData: OperatorProfileResponse | null;
  editFullName: string;
  onChangeFullName: (val: string) => void;
  editPhoneE164: string;
  onChangePhoneE164: (val: string) => void;
  profileSaving: boolean;
  profileFeedback: {
    tone: 'ok' | 'warn' | 'danger' | 'info';
    title: string;
    msg: string;
  } | null;
  onDismissFeedback: () => void;
  onSaveProfile: (e: React.FormEvent) => Promise<void>;
  onPersonaSwitch: (role: Role) => Promise<void>;
  onSelectWorkspace: (wsId: WorkspaceId) => void;
  onOpenFullLoginPortal: () => void;
}

export const OperatorProfileDrawer: React.FC<OperatorProfileDrawerProps> = ({
  open,
  onClose,
  user,
  profileTab,
  onChangeTab,
  profileData,
  editFullName,
  onChangeFullName,
  editPhoneE164,
  onChangePhoneE164,
  profileSaving,
  profileFeedback,
  onDismissFeedback,
  onSaveProfile,
  onPersonaSwitch,
  onSelectWorkspace,
  onOpenFullLoginPortal,
}) => {
  const activeRoleMeta = getRoleDisplayMeta(user?.role ?? 'HARBOUR_ADMIN');
  const activeInitials = formatOperatorInitials(user?.fullName ?? 'Capt. Mathew Thomas');

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Operator Profile & Session"
      footer={
        <>
          <Button
            variant="outline"
            icon={<LogOut className="w-4 h-4" />}
            onClick={onOpenFullLoginPortal}
          >
            Open Full Sign-In Portal
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="p-5 rounded-[var(--radius-card)] bg-[var(--brand-soft)] border border-[var(--navy-200)] flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-[var(--radius-pill)] bg-[var(--brand)] text-[var(--brand-fg)] text-base font-bold font-mono-code flex items-center justify-center shrink-0">
              {activeInitials}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-[var(--text-primary)]">
                  {user?.fullName ?? 'Capt. Mathew Thomas'}
                </h3>
                <Badge tone="ok" label={activeRoleMeta.shortBadge} />
              </div>
              <div className="text-xs font-semibold text-[var(--brand-soft-fg)] mt-0.5">
                {activeRoleMeta.titleEn} · <span lang="ml">{activeRoleMeta.titleMl}</span>
              </div>
              <div className="text-xs font-mono-code text-[var(--text-secondary)] mt-1">
                ID: {user?.userId ?? 'USR-ADM-01'} · Phone: {user?.phoneE164 ?? '—'} · Tenant:{' '}
                {user?.tenantId ?? 'munambam-demo'}
              </div>
            </div>
          </div>
        </div>

        <Tabs
          items={[
            { id: 'identity', label: 'Edit Profile & Authority' },
            { id: 'switch', label: 'Switch Persona', badge: 8 },
            { id: 'session', label: 'JWT & Activity', badge: profileData?.recentAudit.length ?? 0 },
          ]}
          activeId={profileTab}
          onChange={(id) => onChangeTab(id as 'identity' | 'switch' | 'session')}
        />

        {profileFeedback && (
          <Toast
            tone={profileFeedback.tone}
            title={profileFeedback.title}
            message={profileFeedback.msg}
            onDismiss={onDismissFeedback}
          />
        )}

        {profileTab === 'identity' && (
          <div className="flex flex-col gap-5">
            <Card
              stepBadge="POSTGRESQL"
              kicker="core.users Record"
              title="Update Operator Profile Details"
              subtitle="Saves directly to PostgreSQL core.users, logs to core.audit_logs, and refreshes your HS256 JWT"
            >
              <form onSubmit={(e) => void onSaveProfile(e)} className="flex flex-col gap-4">
                <Input
                  label="Operator Full Name"
                  value={editFullName}
                  onChange={(e) => onChangeFullName(e.target.value)}
                  required
                />
                <Input
                  label="Registered Mobile Number (E.164)"
                  mono
                  value={editPhoneE164}
                  onChange={(e) => onChangePhoneE164(e.target.value)}
                  hint="Used for SMS/WhatsApp OTP login and dual-key notifications"
                  required
                />
                <div className="flex items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-[var(--text-muted)]">
                    Role:{' '}
                    <strong className="font-mono-code text-[var(--text-primary)]">
                      {user?.role}
                    </strong>
                  </span>
                  <Button type="submit" variant="primary" size="sm" loading={profileSaving}>
                    Save Profile to PostgreSQL
                  </Button>
                </div>
              </form>
            </Card>

            <Card
              stepBadge={activeRoleMeta.statutoryRef}
              kicker="Role-Based Access Control"
              title="Authorized Statutory Capabilities"
              subtitle={activeRoleMeta.description}
            >
              <div className="flex flex-col gap-2.5">
                {activeRoleMeta.capabilities.map((cap) => (
                  <div
                    key={cap}
                    className="p-3 rounded-[var(--radius-control)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex items-center gap-2.5 text-xs font-medium text-[var(--text-primary)]"
                  >
                    <CheckCircle2 className="w-4 h-4 text-[var(--brand)] shrink-0" />
                    <span>{cap}</span>
                  </div>
                ))}
                <div className="pt-2 flex items-center justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Sparkles className="w-3.5 h-3.5" />}
                    onClick={() => {
                      onSelectWorkspace(activeRoleMeta.defaultWorkspace);
                      onClose();
                    }}
                  >
                    Go to Primary Workspace ({activeRoleMeta.defaultWorkspace})
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}

        {profileTab === 'switch' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--text-secondary)]">
              Switch between any of the 8 seeded harbour operator personas in <code>core.users</code> to test role-specific statutory workflows:
            </p>
            {(
              [
                'HARBOUR_ADMIN',
                'ACCOUNTANT',
                'WEIGHING_OPERATOR',
                'LICENSED_AUCTIONEER',
                'WHOLESALE_BUYER',
                'FISHERMAN_BOAT_OWNER',
                'AUTHORIZED_INSPECTOR',
                'SUPER_ADMIN',
              ] as const
            ).map((r) => {
              const meta = getRoleDisplayMeta(r);
              const active = user?.role === r;
              return (
                <div
                  key={r}
                  className={`p-3.5 rounded-[var(--radius-card)] border flex items-center justify-between gap-3 ${
                    active
                      ? 'bg-[var(--brand-soft)] border-[var(--brand)]'
                      : 'bg-[var(--bg-surface)] border-[var(--border-hair)]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--text-primary)]">
                        {meta.titleEn}
                      </span>
                      <span className="text-[11px] font-mono-code px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-sunken)] text-[var(--text-secondary)] whitespace-nowrap shrink-0 leading-none">
                        {meta.statutoryRef}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {meta.description}
                    </p>
                  </div>
                  <Button
                    variant={active ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => {
                      void onPersonaSwitch(r);
                      onClose();
                    }}
                  >
                    {active ? 'Active' : 'Switch'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {profileTab === 'session' && (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-2 text-xs">
              <div className="font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Verified HS256 JWT Claims (RFC 7519)
              </div>
              <div className="font-mono-code text-[var(--text-primary)] grid grid-cols-2 gap-1.5">
                <span>sub: {user?.userId}</span>
                <span>role: {user?.role}</span>
                <span>tenantId: {user?.tenantId}</span>
                <span>phone: {user?.phoneE164}</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-[var(--text-primary)] mb-2">
                Recent Operator Audit Trail (`core.audit_logs`)
              </h4>
              {profileData && profileData.recentAudit.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {profileData.recentAudit.map((a) => (
                    <div
                      key={a.audit_id}
                      className="p-3 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-xs flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="ok" label={a.action_code} />
                        <span className="font-mono-code text-[var(--text-muted)]">
                          {a.created_at.replace('T', ' ').slice(0, 19)}
                        </span>
                      </div>
                      <div className="font-mono-code text-[var(--text-secondary)]">
                        Target: {a.target_type} ({a.target_id}) · {a.details_json}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  No personal audit events recorded yet for this operator in the current session.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
};
