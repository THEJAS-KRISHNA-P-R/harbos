import React from 'react';
import {
  LogOut,
  CheckCircle2,
  Sparkles,
  MapPin,
  Clock,
  Monitor,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Tabs,
  Input,
  Drawer,
  Toast,
  SkeletonList,
} from '@web/ui/index.tsx';
import {
  getRoleDisplayMeta,
  formatOperatorInitials,
  type OperatorProfileResponse,
  type SessionUser,
} from '@web/lib/api.ts';
import {
  SESSION_HISTORY_MAX_ENTRIES,
  annotateSessionHistoryWithRegionCheck,
  countUnusualRegionSessions,
  formatAuthMethodLabel,
  formatSessionTimestamp,
} from '@shared/contracts/session-history.ts';
import type { Role, WorkspaceId } from '@shared/contracts/rbac.ts';

export interface OperatorProfileDrawerProps {
  open: boolean;
  onClose: () => void;
  user: SessionUser | null;
  profileTab: 'identity' | 'switch' | 'session';
  onChangeTab: (tab: 'identity' | 'switch' | 'session') => void;
  profileData: OperatorProfileResponse | null;
  profileLoading?: boolean;
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
  profileLoading = false,
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
  const effectiveLastKnownLocation =
    user?.lastKnownLocation ?? profileData?.lastKnownLocation ?? undefined;
  const annotatedSessionHistory = React.useMemo(
    () =>
      annotateSessionHistoryWithRegionCheck(
        profileData?.sessionHistory ?? [],
        effectiveLastKnownLocation
      ),
    [profileData?.sessionHistory, effectiveLastKnownLocation]
  );
  const unusualSessionCount = React.useMemo(
    () => countUnusualRegionSessions(annotatedSessionHistory),
    [annotatedSessionHistory]
  );

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
                {activeRoleMeta.titleEn}
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
            { id: 'identity', label: 'Profile' },
            ...(!import.meta.env.PROD
              ? [{ id: 'switch', label: 'Personas', badge: 8 }]
              : []),
            {
              id: 'session',
              label: 'Session & Activity',
              badge:
                profileData?.sessionHistory?.length ??
                profileData?.recentAudit.length ??
                0,
            },
          ]}
          activeId={import.meta.env.PROD && profileTab === 'switch' ? 'identity' : profileTab}
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
              title="Update Operator Profile Details"
              subtitle="Updates your harbour operator profile, records an audit entry, and refreshes your active session"
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
                    <strong className="text-[var(--text-primary)]">
                      {activeRoleMeta.titleEn}
                    </strong>
                  </span>
                  <Button type="submit" variant="primary" size="sm" loading={profileSaving}>
                    Save Profile
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
              Switch between any of the 8 demo harbour operator personas to test role-specific workflows:
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
          <div className="flex flex-col gap-5">
            <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] flex flex-col gap-2 text-xs">
              <div className="font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Active Session Details
              </div>
              <div className="font-mono-code text-[var(--text-primary)] grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <span>Operator ID: {user?.userId}</span>
                <span>Role: {activeRoleMeta.shortBadge}</span>
                <span>Harbour: {user?.tenantId}</span>
                <span>Phone: {user?.phoneE164}</span>
                {effectiveLastKnownLocation && (
                  <span
                    className="sm:col-span-2 inline-flex items-center gap-1.5 text-[var(--text-secondary)] pt-1 border-t border-[var(--border-hair)]"
                    data-testid="session-last-known-location"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" aria-hidden="true" />
                    <span>
                      Usual Location:{' '}
                      <strong className="text-[var(--text-primary)]">
                        {effectiveLastKnownLocation}
                      </strong>
                    </span>
                  </span>
                )}
              </div>
            </div>

            <section
              aria-labelledby="user-session-history-heading"
              data-testid="user-session-history"
              className="flex flex-col gap-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4
                    id="user-session-history-heading"
                    className="text-sm font-bold text-[var(--text-primary)] inline-flex items-center gap-1.5"
                  >
                    <ShieldCheck className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden="true" />
                    <span>User Session History</span>
                  </h4>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Last {SESSION_HISTORY_MAX_ENTRIES} recorded login timestamps and locations
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {unusualSessionCount > 0 && (
                    <Badge
                      tone="danger"
                      label={`${unusualSessionCount} outside usual region`}
                    />
                  )}
                  {annotatedSessionHistory.length > 0 && (
                    <Badge
                      tone="info"
                      label={`${annotatedSessionHistory.length} / ${SESSION_HISTORY_MAX_ENTRIES}`}
                    />
                  )}
                </div>
              </div>

              {profileLoading && !profileData ? (
                <SkeletonList
                  items={4}
                  variant="activity"
                  surface="card"
                  testId="session-history-skeleton"
                  label="Loading user session history…"
                />
              ) : annotatedSessionHistory.length > 0 ? (
                <ol
                  aria-label="Last 10 login sessions"
                  className="flex flex-col gap-2"
                >
                  {annotatedSessionHistory
                    .slice(0, SESSION_HISTORY_MAX_ENTRIES)
                    .map((entry) => {
                      const isUnusual = entry.isUnusualRegion === true;
                      return (
                        <li
                          key={entry.sessionEventId}
                          data-testid="session-history-row"
                          data-unusual-region={isUnusual ? 'true' : 'false'}
                          className={`animate-session-item-in p-3 rounded-[var(--radius-card)] border text-xs flex flex-col gap-1.5 ${
                            isUnusual
                              ? 'bg-[var(--warning-bg)] border-[var(--warning)]/60 border-l-4 border-l-[var(--danger)]'
                              : entry.isCurrent
                                ? 'bg-[var(--brand-soft)]/60 border-[var(--brand)]/40'
                                : 'bg-[var(--bg-surface)] border-[var(--border-hair)]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div
                              className={`inline-flex items-center gap-1.5 font-semibold min-w-0 ${
                                isUnusual
                                  ? 'text-[var(--danger-fg)]'
                                  : 'text-[var(--text-primary)]'
                              }`}
                            >
                              {isUnusual ? (
                                <AlertTriangle
                                  className="w-3.5 h-3.5 text-[var(--danger)] shrink-0"
                                  aria-hidden="true"
                                />
                              ) : (
                                <MapPin
                                  className="w-3.5 h-3.5 text-[var(--brand)] shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="truncate">{entry.location}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                              {isUnusual && (
                                <Badge tone="danger" label="Unusual Region" />
                              )}
                              {entry.isCurrent && <Badge tone="ok" label="Current" />}
                              <Badge
                                tone="neutral"
                                label={formatAuthMethodLabel(entry.authMethod)}
                              />
                            </div>
                          </div>

                          {isUnusual && entry.lastKnownLocation && (
                            <div
                              className="text-[11px] font-medium text-[var(--warning)] flex flex-wrap items-center gap-x-1.5 gap-y-0.5"
                              data-testid="unusual-region-callout"
                            >
                              <span>
                                Outside usual region ({entry.detectedRegion ?? 'External'})
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>Last known: {entry.lastKnownLocation}</span>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-mono-code tabular-nums">
                            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                              <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <time dateTime={entry.loginAt}>
                                {formatSessionTimestamp(entry.loginAt)}
                              </time>
                            </span>
                            <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                              <Monitor className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>
                                {entry.deviceLabel} · {entry.ipAddress}
                              </span>
                            </span>
                          </div>
                        </li>
                      );
                    })}
                </ol>
              ) : (
                <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] text-xs text-[var(--text-muted)]">
                  No login sessions recorded yet for this operator.
                </div>
              )}
            </section>

            <div>
              <h4 className="text-sm font-bold text-[var(--text-primary)] mb-2">
                Recent Operator Activity
              </h4>
              {profileLoading && !profileData ? (
                <SkeletonList
                  items={3}
                  variant="activity"
                  surface="card"
                  testId="operator-activity-skeleton"
                  label="Loading operator activity…"
                />
              ) : profileData && profileData.recentAudit.length > 0 ? (
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
                      <div className="font-mono-code text-[var(--text-secondary)] break-words">
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
