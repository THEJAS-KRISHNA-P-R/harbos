export const SESSION_HISTORY_MAX_ENTRIES = 10;
export const SESSION_LOGIN_ACTION_CODE = 'USER_SESSION_LOGIN';

export type SessionAuthMethod =
  | 'OTP_SMS'
  | 'PERSONA_SWITCH'
  | 'TENANT_SWITCH'
  | 'TOKEN_REFRESH';

export interface SessionHistoryEntry {
  sessionEventId: string;
  loginAt: string;
  location: string;
  lastKnownLocation?: string | undefined;
  ipAddress: string;
  authMethod: SessionAuthMethod;
  deviceLabel: string;
  isCurrent?: boolean | undefined;
  isUnusualRegion?: boolean | undefined;
  detectedRegion?: string | undefined;
  expectedRegion?: string | undefined;
  userId?: string | undefined;
  operatorName?: string | undefined;
  role?: string | undefined;
  tenantId?: string | undefined;
  tenantNameEn?: string | undefined;
}

export interface AdminSessionHistoryResponse {
  scope: 'PLATFORM' | 'TENANT';
  totalSessions: number;
  unusualCount: number;
  sessions: ReadonlyArray<SessionHistoryEntry>;
}

export interface SessionAuditRowLike {
  audit_id: string;
  details_json: string;
  created_at: string;
  actor_user_id?: string | undefined;
  actor_role?: string | undefined;
  actor_name?: string | undefined;
  tenant_id?: string | undefined;
  tenant_name_en?: string | undefined;
}

export interface RegionDescriptor {
  code: string;
  label: string;
}

const REGION_ALIASES: ReadonlyArray<{
  code: string;
  label: string;
  patterns: ReadonlyArray<RegExp>;
}> = [
  {
    code: 'KL',
    label: 'Kerala (KL)',
    patterns: [
      /^kl$/i,
      /\bkerala\b/i,
      /\bkochi\b/i,
      /\bcochin\b/i,
      /\bernakulam\b/i,
      /\bmunambam\b/i,
      /\bkozhikode\b/i,
      /\bbeypore\b/i,
      /\bkollam\b/i,
      /\bneendakara\b/i,
      /\bthiruvananthapuram\b/i,
      /\btrivandrum\b/i,
      /\bvizhinjam\b/i,
      /\baluva\b/i,
      /\bthrissur\b/i,
      /\bkannur\b/i,
      /\balappuzha\b/i,
      /\bvypin\b/i,
      /\bparavur\b/i,
    ],
  },
  {
    code: 'TN',
    label: 'Tamil Nadu (TN)',
    patterns: [/^tn$/i, /\btamil\s*nadu\b/i, /\bchennai\b/i, /\btuticorin\b/i, /\bthoothukudi\b/i, /\bcoimbatore\b/i],
  },
  {
    code: 'KA',
    label: 'Karnataka (KA)',
    patterns: [/^ka$/i, /\bkarnataka\b/i, /\bbengaluru\b/i, /\bbangalore\b/i, /\bmangaluru\b/i, /\bmangalore\b/i],
  },
  {
    code: 'MH',
    label: 'Maharashtra (MH)',
    patterns: [/^mh$/i, /\bmaharashtra\b/i, /\bmumbai\b/i, /\bpune\b/i, /\bnavi\s*mumbai\b/i],
  },
  {
    code: 'DL',
    label: 'Delhi NCR (DL)',
    patterns: [/^dl$/i, /\bnew\s*delhi\b/i, /\bdelhi\b/i, /\bgurugram\b/i, /\bnoida\b/i],
  },
  {
    code: 'GJ',
    label: 'Gujarat (GJ)',
    patterns: [/^gj$/i, /\bgujarat\b/i, /\bahmedabad\b/i, /\bveraval\b/i, /\bsurat\b/i],
  },
  {
    code: 'GA',
    label: 'Goa (GA)',
    patterns: [/^ga$/i, /\bgoa\b/i, /\bpanaji\b/i, /\bvasco\b/i],
  },
  {
    code: 'AP',
    label: 'Andhra Pradesh (AP)',
    patterns: [/^ap$/i, /\bandhra\s*pradesh\b/i, /\bvisakhapatnam\b/i, /\bvizag\b/i],
  },
  {
    code: 'WB',
    label: 'West Bengal (WB)',
    patterns: [/^wb$/i, /\bwest\s*bengal\b/i, /\bkolkata\b/i],
  },
  {
    code: 'SG',
    label: 'Singapore (SG)',
    patterns: [/^sg$/i, /\bsingapore\b/i],
  },
  {
    code: 'AE',
    label: 'UAE (AE)',
    patterns: [/^ae$/i, /^uae$/i, /\bdubai\b/i, /\babu\s*dhabi\b/i, /\bsharjah\b/i, /\bunited\s*arab\s*emirates\b/i],
  },
  {
    code: 'GB',
    label: 'United Kingdom (GB)',
    patterns: [/^gb$/i, /^uk$/i, /\blondon\b/i, /\bunited\s*kingdom\b/i, /\bengland\b/i],
  },
  {
    code: 'US',
    label: 'United States (US)',
    patterns: [/^us$/i, /^usa$/i, /\bunited\s*states\b/i, /\bnew\s*york\b/i, /\bcalifornia\b/i, /\bvirginia\b/i],
  },
  {
    code: 'DE',
    label: 'Germany (DE)',
    patterns: [/^de$/i, /\bgermany\b/i, /\bfrankfurt\b/i, /\bberlin\b/i],
  },
];

function matchRegionToken(token: string): RegionDescriptor | null {
  const cleaned = token.trim();
  if (!cleaned) return null;
  for (const entry of REGION_ALIASES) {
    if (entry.patterns.some((rx) => rx.test(cleaned))) {
      return { code: entry.code, label: entry.label };
    }
  }
  return null;
}

/**
 * Extracts a normalized region descriptor (e.g. "KL" / "Kerala (KL)") from a
 * location string like "Munambam Harbour, Kochi, KL" or "Mumbai, MH, IN".
 */
export function extractRegionFromLocation(location: string): RegionDescriptor {
  const trimmed = location.trim();
  if (!trimmed) {
    return { code: 'UNKNOWN', label: 'Unknown Region' };
  }

  const segments = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Inspect segments right-to-left, skipping generic country suffix "IN" / "India"
  // when a more specific Indian state/city token is present.
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i]!;
    if (/^(in|india)$/i.test(seg) && i > 0) {
      continue;
    }
    const matched = matchRegionToken(seg);
    if (matched) return matched;
  }

  const wholeMatch = matchRegionToken(trimmed);
  if (wholeMatch) return wholeMatch;

  const fallbackSegment = segments[segments.length - 1] ?? trimmed;
  return {
    code: fallbackSegment.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
    label: fallbackSegment,
  };
}

/**
 * Checks whether a login location originates outside the user's usual region
 * defined by `lastKnownLocation`.
 */
export function isLocationOutsideUsualRegion(
  location: string,
  lastKnownLocation: string | null | undefined
): boolean {
  const loc = location.trim();
  const baseline = (lastKnownLocation ?? '').trim();
  if (!loc || !baseline) return false;

  const detected = extractRegionFromLocation(loc);
  const expected = extractRegionFromLocation(baseline);
  if (detected.code === 'UNKNOWN' || expected.code === 'UNKNOWN') return false;
  return detected.code !== expected.code;
}

/**
 * Derives an operator's usual `lastKnownLocation` baseline from a list of
 * session locations by selecting the most frequent region (mode) and returning
 * the most recent location within that usual region.
 */
export function deriveLastKnownLocation(
  entries: ReadonlyArray<Pick<SessionHistoryEntry, 'location'>>,
  fallbackLocation?: string | null | undefined
): string {
  const counts = new Map<string, { count: number; latestLocation: string }>();
  for (const entry of entries) {
    const loc = entry.location.trim();
    if (!loc) continue;
    const region = extractRegionFromLocation(loc);
    if (region.code === 'UNKNOWN') continue;
    const prev = counts.get(region.code);
    if (prev) {
      prev.count += 1;
    } else {
      counts.set(region.code, { count: 1, latestLocation: loc });
    }
  }

  let best: { count: number; latestLocation: string } | null = null;
  for (const item of counts.values()) {
    if (!best || item.count > best.count) {
      best = item;
    }
  }

  if (best) return best.latestLocation;
  const fallback = (fallbackLocation ?? '').trim();
  return fallback || 'Munambam Harbour, Kochi, KL';
}

export function annotateSessionEntryWithRegionCheck(
  entry: SessionHistoryEntry,
  fallbackLastKnownLocation?: string | null | undefined
): SessionHistoryEntry {
  const effectiveBaseline =
    (entry.lastKnownLocation ?? '').trim() ||
    (fallbackLastKnownLocation ?? '').trim() ||
    undefined;

  const detected = extractRegionFromLocation(entry.location);
  const expected = effectiveBaseline
    ? extractRegionFromLocation(effectiveBaseline)
    : undefined;
  const unusual = isLocationOutsideUsualRegion(entry.location, effectiveBaseline);

  return {
    ...entry,
    ...(effectiveBaseline ? { lastKnownLocation: effectiveBaseline } : {}),
    detectedRegion: detected.label,
    ...(expected ? { expectedRegion: expected.label } : {}),
    isUnusualRegion: unusual,
  };
}

export function annotateSessionHistoryWithRegionCheck(
  entries: ReadonlyArray<SessionHistoryEntry>,
  fallbackLastKnownLocation?: string | null | undefined
): ReadonlyArray<SessionHistoryEntry> {
  const derivedBaseline =
    (fallbackLastKnownLocation ?? '').trim() ||
    (entries.length > 0 ? deriveLastKnownLocation(entries) : '');
  return entries.map((entry) =>
    annotateSessionEntryWithRegionCheck(entry, derivedBaseline || undefined)
  );
}

export function countUnusualRegionSessions(
  entries: ReadonlyArray<SessionHistoryEntry>
): number {
  return entries.reduce((sum, entry) => sum + (entry.isUnusualRegion ? 1 : 0), 0);
}

export function filterSessionHistoryByAnomaly(
  entries: ReadonlyArray<SessionHistoryEntry>,
  onlyUnusual: boolean
): ReadonlyArray<SessionHistoryEntry> {
  if (!onlyUnusual) return entries;
  return entries.filter((entry) => entry.isUnusualRegion === true);
}

function readSingleHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  key: string
): string {
  if (!headers) return '';
  const raw = headers[key] ?? headers[key.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim() : '';
}

function safeDecodeHeaderPart(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

export function resolveSessionLocation(input: {
  headers?: Record<string, string | string[] | undefined> | undefined;
  tenantNameEn?: string | undefined;
  clientIp?: string | undefined;
}): string {
  const { headers, tenantNameEn } = input;

  const city = safeDecodeHeaderPart(
    readSingleHeader(headers, 'x-geo-city') ||
      readSingleHeader(headers, 'x-appengine-city') ||
      readSingleHeader(headers, 'cf-ipcity') ||
      readSingleHeader(headers, 'x-vercel-ip-city')
  );
  const region = safeDecodeHeaderPart(
    readSingleHeader(headers, 'x-geo-region') ||
      readSingleHeader(headers, 'x-appengine-region') ||
      readSingleHeader(headers, 'x-vercel-ip-country-region')
  );
  const country = safeDecodeHeaderPart(
    readSingleHeader(headers, 'x-geo-country') ||
      readSingleHeader(headers, 'x-appengine-country') ||
      readSingleHeader(headers, 'cf-ipcountry') ||
      readSingleHeader(headers, 'x-vercel-ip-country')
  );

  if (city) {
    const parts = [city, region, country].filter(
      (part) => part.length > 0 && part.toUpperCase() !== 'ZZ' && part.toUpperCase() !== 'XX'
    );
    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  const normalizedTenant = (tenantNameEn ?? '').trim();
  if (/munambam/i.test(normalizedTenant)) {
    return 'Munambam Harbour, Kochi, KL';
  }
  if (/beypore/i.test(normalizedTenant)) {
    return 'Beypore Harbour, Kozhikode, KL';
  }
  if (/neendakara/i.test(normalizedTenant)) {
    return 'Neendakara Harbour, Kollam, KL';
  }
  if (/vizhinjam/i.test(normalizedTenant)) {
    return 'Vizhinjam Harbour, Thiruvananthapuram, KL';
  }
  if (/thoppumpady|cochin|kochi/i.test(normalizedTenant)) {
    return 'Cochin Fisheries Harbour, Kochi, KL';
  }
  if (normalizedTenant.length > 0) {
    return `${normalizedTenant.replace(/\s*\(HMS\)\s*/gi, '').trim()}, Kerala`;
  }
  return 'Harbour Terminal, Kerala';
}

export function parseDeviceLabelFromUserAgent(userAgent?: string | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return 'Harbour Terminal';

  let browser = 'Web Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/HeadlessChrome|Chromium/i.test(ua)) browser = 'Chromium';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/curl|node|undici/i.test(ua)) browser = 'API Client';

  let os = '';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  return os ? `${browser} · ${os}` : browser;
}

function normalizeAuthMethod(raw: unknown): SessionAuthMethod {
  if (
    raw === 'OTP_SMS' ||
    raw === 'PERSONA_SWITCH' ||
    raw === 'TENANT_SWITCH' ||
    raw === 'TOKEN_REFRESH'
  ) {
    return raw;
  }
  return 'OTP_SMS';
}

function parseTimestampMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function parseSessionHistoryFromAuditRows(
  rows: ReadonlyArray<SessionAuditRowLike>,
  limit = SESSION_HISTORY_MAX_ENTRIES,
  options?: {
    lastKnownLocation?: string | null | undefined;
    markFirstAsCurrent?: boolean | undefined;
  }
): ReadonlyArray<SessionHistoryEntry> {
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const parsed: Array<{ sortMs: number; entry: SessionHistoryEntry }> = [];

  for (const row of rows) {
    let details: Record<string, unknown> = {};
    try {
      const candidate: unknown = JSON.parse(row.details_json);
      if (candidate && typeof candidate === 'object') {
        details = candidate as Record<string, unknown>;
      }
    } catch {
      details = {};
    }

    const loginAt =
      typeof details.loginAt === 'string' && details.loginAt.trim().length > 0
        ? details.loginAt.trim()
        : row.created_at;
    const location =
      typeof details.location === 'string' && details.location.trim().length > 0
        ? details.location.trim()
        : 'Harbour Terminal, Kerala';
    const rowLastKnown =
      typeof details.lastKnownLocation === 'string' &&
      details.lastKnownLocation.trim().length > 0
        ? details.lastKnownLocation.trim()
        : undefined;
    const ipAddress =
      typeof details.ipAddress === 'string' && details.ipAddress.trim().length > 0
        ? details.ipAddress.trim()
        : '127.0.0.1';
    const deviceLabel =
      typeof details.deviceLabel === 'string' && details.deviceLabel.trim().length > 0
        ? details.deviceLabel.trim()
        : 'Harbour Terminal';
    const authMethod = normalizeAuthMethod(details.authMethod);

    parsed.push({
      sortMs: parseTimestampMs(loginAt),
      entry: {
        sessionEventId: row.audit_id,
        loginAt,
        location,
        ...(rowLastKnown ? { lastKnownLocation: rowLastKnown } : {}),
        ipAddress,
        authMethod,
        deviceLabel,
        ...(row.actor_user_id ? { userId: row.actor_user_id } : {}),
        ...(row.actor_name ? { operatorName: row.actor_name } : {}),
        ...(row.actor_role ? { role: row.actor_role } : {}),
        ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
        ...(row.tenant_name_en ? { tenantNameEn: row.tenant_name_en } : {}),
      },
    });
  }

  parsed.sort((a, b) => b.sortMs - a.sortMs);

  const sortedEntries = parsed.map((item) => item.entry);
  const derivedBaseline =
    (options?.lastKnownLocation ?? '').trim() ||
    (sortedEntries.length > 0 ? deriveLastKnownLocation(sortedEntries) : '');
  const markCurrent = options?.markFirstAsCurrent ?? true;

  return sortedEntries.slice(0, safeLimit).map((entry, idx) =>
    annotateSessionEntryWithRegionCheck(
      {
        ...entry,
        ...(markCurrent ? { isCurrent: idx === 0 } : {}),
      },
      derivedBaseline || undefined
    )
  );
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatSessionTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return iso.replace('T', ' ').slice(0, 19);
  }
  const d = new Date(ms);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const mon = SHORT_MONTHS[d.getUTCMonth()] ?? 'Jan';
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year}, ${hh}:${mm} UTC`;
}

export function formatAuthMethodLabel(method: SessionAuthMethod): string {
  switch (method) {
    case 'OTP_SMS':
      return 'OTP Sign-In';
    case 'PERSONA_SWITCH':
      return 'Role Switch';
    case 'TENANT_SWITCH':
      return 'Harbour Switch';
    case 'TOKEN_REFRESH':
      return 'Session Renewed';
  }
}
