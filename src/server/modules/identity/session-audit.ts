import crypto from 'node:crypto';
import { withPlatform, type DbPort } from '@server/ports/db.ts';
import type { AuthSessionClaims } from '@server/platform/auth.ts';
import type { Role } from '@shared/contracts/rbac.ts';
import {
  SESSION_HISTORY_MAX_ENTRIES,
  annotateSessionEntryWithRegionCheck,
  countUnusualRegionSessions,
  deriveLastKnownLocation,
  parseDeviceLabelFromUserAgent,
  parseSessionHistoryFromAuditRows,
  resolveSessionLocation,
  type AdminSessionHistoryResponse,
  type SessionAuditRowLike,
  type SessionAuthMethod,
  type SessionHistoryEntry,
} from '@shared/contracts/session-history.ts';
import {
  fetchAdminSessionLoginRows,
  fetchUserSessionLoginRowsInTx,
  findTenantByIdInTx,
  insertSessionLoginAuditInTx,
} from './repo.ts';

export interface SessionClientMeta {
  clientIp?: string | undefined;
  userAgent?: string | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
}

export async function recordSessionLoginEvent(
  platformDb: DbPort,
  params: {
    tenantId: string;
    userId: string;
    role: Role;
    authMethod: SessionAuthMethod;
    clientMeta?: SessionClientMeta | undefined;
  }
): Promise<{ location: string; lastKnownLocation: string }> {
  const nowIso = new Date().toISOString();
  return withPlatform(platformDb, async (tx) => {
    const [tenant, priorRows] = await Promise.all([
      findTenantByIdInTx(tx, params.tenantId),
      fetchUserSessionLoginRowsInTx(tx, params.userId, 20),
    ]);

    const fallbackTenantLocation = resolveSessionLocation({
      tenantNameEn: tenant?.name_en,
    });
    const location = resolveSessionLocation({
      headers: params.clientMeta?.headers,
      tenantNameEn: tenant?.name_en,
      clientIp: params.clientMeta?.clientIp,
    });

    const priorEntries = parseSessionHistoryFromAuditRows(priorRows, 20, {
      markFirstAsCurrent: false,
    });
    const lastKnownLocation = deriveLastKnownLocation(
      priorEntries,
      fallbackTenantLocation
    );

    const deviceLabel = parseDeviceLabelFromUserAgent(
      params.clientMeta?.userAgent
    );
    const ipAddress = params.clientMeta?.clientIp?.trim() || '127.0.0.1';

    await insertSessionLoginAuditInTx(tx, {
      auditId: `AUD-SESS-${crypto.randomUUID()}`,
      tenantId: params.tenantId,
      userId: params.userId,
      role: params.role,
      detailsJson: JSON.stringify({
        loginAt: nowIso,
        location,
        lastKnownLocation,
        ipAddress,
        authMethod: params.authMethod,
        deviceLabel,
      }),
      createdAtIso: nowIso,
    });

    return { location, lastKnownLocation };
  });
}

export function buildOperatorSessionSummary(
  rows: ReadonlyArray<SessionAuditRowLike>,
  fallbackTenantNameEn?: string | undefined
): {
  lastKnownLocation: string;
  unusualLoginCount: number;
  sessionHistory: ReadonlyArray<SessionHistoryEntry>;
} {
  const fallbackLocation = resolveSessionLocation({
    tenantNameEn: fallbackTenantNameEn,
  });
  const preliminary = parseSessionHistoryFromAuditRows(rows, 20, {
    markFirstAsCurrent: false,
  });
  const lastKnownLocation = deriveLastKnownLocation(
    preliminary,
    fallbackLocation
  );
  const sessionHistory = parseSessionHistoryFromAuditRows(
    rows,
    SESSION_HISTORY_MAX_ENTRIES,
    { lastKnownLocation, markFirstAsCurrent: true }
  );
  return {
    lastKnownLocation,
    unusualLoginCount: countUnusualRegionSessions(sessionHistory),
    sessionHistory,
  };
}

export async function getAdminSessionHistoryMonitor(
  db: DbPort,
  claims: AuthSessionClaims,
  platformDb?: DbPort
): Promise<AdminSessionHistoryResponse> {
  const isSuperAdmin = claims.role === 'SUPER_ADMIN' && Boolean(platformDb);
  const rawRows = isSuperAdmin
    ? await withPlatform(platformDb!, (tx) =>
        fetchAdminSessionLoginRows(tx, { limit: 40 })
      )
    : await fetchAdminSessionLoginRows(db, {
        tenantId: claims.tenantId,
        limit: 30,
      });

  // Group rows by operator so each login attempt is evaluated against that
  // operator's own usual `lastKnownLocation` baseline.
  const rowsByUser = new Map<string, SessionAuditRowLike[]>();
  for (const row of rawRows) {
    const key = row.actor_user_id ?? 'UNKNOWN';
    const list = rowsByUser.get(key) ?? [];
    list.push(row);
    rowsByUser.set(key, list);
  }

  const evaluated: SessionHistoryEntry[] = [];
  for (const userRows of rowsByUser.values()) {
    const parsedUserRows = parseSessionHistoryFromAuditRows(userRows, 25, {
      markFirstAsCurrent: false,
    });
    const fallbackTenantLoc = resolveSessionLocation({
      tenantNameEn: userRows[0]?.tenant_name_en,
    });
    const baseline = deriveLastKnownLocation(parsedUserRows, fallbackTenantLoc);
    for (const entry of parsedUserRows) {
      evaluated.push(annotateSessionEntryWithRegionCheck(entry, baseline));
    }
  }

  evaluated.sort((a, b) => Date.parse(b.loginAt) - Date.parse(a.loginAt));

  // Mark the most recent session for the active caller as current
  let markedCallerCurrent = false;
  const finalSessions = evaluated.slice(0, 25).map((entry) => {
    if (!markedCallerCurrent && entry.userId === claims.sub) {
      markedCallerCurrent = true;
      return { ...entry, isCurrent: true };
    }
    return { ...entry, isCurrent: false };
  });

  return {
    scope: isSuperAdmin ? 'PLATFORM' : 'TENANT',
    totalSessions: finalSessions.length,
    unusualCount: countUnusualRegionSessions(finalSessions),
    sessions: finalSessions,
  };
}
