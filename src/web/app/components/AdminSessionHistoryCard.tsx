import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  MapPin,
  Monitor,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  SkeletonList,
} from '@web/ui/index.tsx';
import {
  apiRequest,
  getRoleDisplayMeta,
  type AdminSessionHistoryResponse,
} from '@web/lib/api.ts';
import {
  countUnusualRegionSessions,
  filterSessionHistoryByAnomaly,
  formatAuthMethodLabel,
  formatSessionTimestamp,
} from '@shared/contracts/session-history.ts';
import type { Role } from '@shared/contracts/rbac.ts';

export interface AdminSessionHistoryCardProps {
  token: string;
  scopeLabel?: string | undefined;
  title?: string | undefined;
  subtitle?: string | undefined;
  maxVisible?: number | undefined;
}

export const AdminSessionHistoryCard: React.FC<AdminSessionHistoryCardProps> = ({
  token,
  scopeLabel,
  title = 'Operator Session History & Regional Security',
  subtitle = 'Monitors recent operator logins against each user’s last known location and highlights out-of-region attempts',
  maxVisible = 10,
}) => {
  const [monitor, setMonitor] = useState<AdminSessionHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [onlyUnusual, setOnlyUnusual] = useState(false);

  const loadMonitor = useCallback(async (): Promise<void> => {
    if (!token) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<AdminSessionHistoryResponse>(
        '/api/v1/auth/session-history',
        { method: 'GET', token }
      );
      setMonitor(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load operator session history'
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadMonitor();
  }, [loadMonitor]);

  const sessions = monitor?.sessions ?? [];
  const unusualCount = useMemo(
    () => monitor?.unusualCount ?? countUnusualRegionSessions(sessions),
    [monitor?.unusualCount, sessions]
  );
  const visibleSessions = useMemo(
    () => filterSessionHistoryByAnomaly(sessions, onlyUnusual).slice(0, maxVisible),
    [sessions, onlyUnusual, maxVisible]
  );

  return (
    <Card
      title={title}
      subtitle={
        scopeLabel
          ? `${subtitle} · Scope: ${scopeLabel}`
          : subtitle
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {unusualCount > 0 ? (
            <Badge
              tone="danger"
              label={`${unusualCount} Unusual Region ${unusualCount === 1 ? 'Login' : 'Logins'}`}
            />
          ) : (
            monitor && (
              <Badge tone="ok" label="All Logins In Usual Region" />
            )
          )}
          <Button
            variant="outline"
            size="sm"
            loading={loading}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => void loadMonitor()}
          >
            Refresh
          </Button>
        </div>
      }
    >
      <div
        data-testid="admin-session-history-panel"
        className="flex flex-col gap-3.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border-hair)]">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter session history">
            <Button
              variant={!onlyUnusual ? 'primary' : 'secondary'}
              size="sm"
              data-testid="admin-session-filter-all"
              onClick={() => setOnlyUnusual(false)}
            >
              All Logins ({sessions.length})
            </Button>
            <Button
              variant={onlyUnusual ? 'primary' : 'secondary'}
              size="sm"
              data-testid="admin-session-filter-unusual"
              icon={<ShieldAlert className="w-3.5 h-3.5" />}
              onClick={() => setOnlyUnusual(true)}
            >
              Unusual Region Only ({unusualCount})
            </Button>
          </div>
          <div className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" aria-hidden="true" />
            <span>
              Checked against each operator&apos;s <span className="font-semibold text-[var(--text-secondary)]">lastKnownLocation</span>
            </span>
          </div>
        </div>

        {errorMsg ? (
          <div className="p-3.5 rounded-[var(--radius-card)] bg-[var(--danger-bg)] border border-[var(--danger)]/40 text-xs text-[var(--danger-fg)]">
            {errorMsg}
          </div>
        ) : loading && !monitor ? (
          <SkeletonList
            items={4}
            variant="activity"
            surface="card"
            testId="admin-session-history-skeleton"
            label="Loading operator session history…"
          />
        ) : visibleSessions.length > 0 ? (
          <ol
            aria-label="Operator login session history"
            className="flex flex-col gap-2"
          >
            {visibleSessions.map((entry) => {
              const isUnusual = entry.isUnusualRegion === true;
              const roleMeta = entry.role
                ? getRoleDisplayMeta(entry.role as Role)
                : null;
              return (
                <li
                  key={entry.sessionEventId}
                  data-testid="admin-session-row"
                  data-unusual-region={isUnusual ? 'true' : 'false'}
                  className={`animate-session-item-in p-3.5 rounded-[var(--radius-card)] border text-xs flex flex-col gap-1.5 ${
                    isUnusual
                      ? 'bg-[var(--warning-bg)] border-[var(--warning)]/60 border-l-4 border-l-[var(--danger)]'
                      : entry.isCurrent
                        ? 'bg-[var(--brand-soft)]/60 border-[var(--brand)]/40'
                        : 'bg-[var(--bg-surface)] border-[var(--border-hair)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span
                        className={`inline-flex items-center gap-1.5 font-bold min-w-0 ${
                          isUnusual
                            ? 'text-[var(--danger-fg)]'
                            : 'text-[var(--text-primary)]'
                        }`}
                      >
                        {isUnusual ? (
                          <AlertTriangle
                            className="w-4 h-4 text-[var(--danger)] shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <MapPin
                            className="w-3.5 h-3.5 text-[var(--brand)] shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate">{entry.location}</span>
                      </span>
                      {entry.operatorName && (
                        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)] font-medium">
                          <User className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>{entry.operatorName}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {isUnusual && (
                        <Badge tone="danger" label="Unusual Region" />
                      )}
                      {entry.isCurrent && <Badge tone="ok" label="Current" />}
                      {roleMeta && (
                        <Badge tone="info" label={roleMeta.shortBadge} />
                      )}
                      <Badge
                        tone="neutral"
                        label={formatAuthMethodLabel(entry.authMethod)}
                      />
                    </div>
                  </div>

                  {isUnusual && entry.lastKnownLocation ? (
                    <div
                      data-testid="admin-unusual-region-detail"
                      className="text-[11px] font-semibold text-[var(--warning)] flex flex-wrap items-center gap-x-2 gap-y-0.5"
                    >
                      <span>
                        Originates outside usual region ({entry.detectedRegion ?? 'External'} vs expected {entry.expectedRegion ?? 'Usual Region'})
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Last known location: {entry.lastKnownLocation}</span>
                    </div>
                  ) : entry.lastKnownLocation ? (
                    <div className="text-[11px] text-[var(--text-muted)]">
                      Matches usual region · Last known: {entry.lastKnownLocation}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] font-mono-code tabular-nums">
                    <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                      <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <time dateTime={entry.loginAt}>
                        {formatSessionTimestamp(entry.loginAt)}
                      </time>
                      {monitor?.scope === 'PLATFORM' && entry.tenantNameEn && (
                        <span className="text-[var(--text-muted)]">
                          · {entry.tenantNameEn}
                        </span>
                      )}
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
          <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-sunken)] border border-[var(--border-hair)] text-xs text-[var(--text-muted)]">
            {onlyUnusual
              ? 'No out-of-region login attempts detected in the recent session window.'
              : 'No operator login sessions recorded yet.'}
          </div>
        )}
      </div>
    </Card>
  );
};
