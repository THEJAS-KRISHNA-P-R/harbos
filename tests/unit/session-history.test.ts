import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_HISTORY_MAX_ENTRIES,
  annotateSessionHistoryWithRegionCheck,
  countUnusualRegionSessions,
  deriveLastKnownLocation,
  extractRegionFromLocation,
  filterSessionHistoryByAnomaly,
  formatAuthMethodLabel,
  formatSessionTimestamp,
  isLocationOutsideUsualRegion,
  parseDeviceLabelFromUserAgent,
  parseSessionHistoryFromAuditRows,
  resolveSessionLocation,
} from '../../src/shared/contracts/session-history.ts';

test('resolveSessionLocation prefers proxy geo headers and falls back to harbour tenant location', () => {
  assert.equal(
    resolveSessionLocation({
      headers: {
        'x-geo-city': 'Kochi',
        'x-geo-region': 'KL',
        'x-geo-country': 'IN',
      },
      tenantNameEn: 'Munambam Fishing Harbour (HMS)',
    }),
    'Kochi, KL, IN'
  );

  assert.equal(
    resolveSessionLocation({
      headers: { 'x-appengine-city': 'Kozhikode', 'x-appengine-region': 'KL' },
      tenantNameEn: 'Munambam Fishing Harbour (HMS)',
    }),
    'Kozhikode, KL'
  );

  assert.equal(
    resolveSessionLocation({
      headers: {},
      tenantNameEn: 'Munambam Fishing Harbour (HMS)',
    }),
    'Munambam Harbour, Kochi, KL'
  );

  assert.equal(
    resolveSessionLocation({
      headers: {},
      tenantNameEn: 'Beypore Fishing Harbour',
    }),
    'Beypore Harbour, Kozhikode, KL'
  );
});

test('parseDeviceLabelFromUserAgent identifies browser and OS cleanly', () => {
  assert.equal(
    parseDeviceLabelFromUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    ),
    'Chrome · macOS'
  );
  assert.equal(
    parseDeviceLabelFromUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'
    ),
    'Edge · Windows'
  );
  assert.equal(
    parseDeviceLabelFromUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    ),
    'Safari · iOS'
  );
  assert.equal(parseDeviceLabelFromUserAgent(''), 'Harbour Terminal');
});

test('extractRegionFromLocation and isLocationOutsideUsualRegion detect regional anomalies accurately', () => {
  assert.equal(extractRegionFromLocation('Munambam Harbour Office, Kochi, KL').code, 'KL');
  assert.equal(extractRegionFromLocation('Beypore Harbour, Kozhikode, KL').code, 'KL');
  assert.equal(extractRegionFromLocation('Mumbai, MH, IN').code, 'MH');
  assert.equal(extractRegionFromLocation('Singapore Maritime Relay, Singapore, SG').code, 'SG');
  assert.equal(extractRegionFromLocation('Dubai Maritime Exchange, Dubai, UAE').code, 'AE');

  // Same Kerala region should NOT be flagged
  assert.equal(
    isLocationOutsideUsualRegion(
      'Beypore Harbour, Kozhikode, KL',
      'Munambam Harbour Office, Kochi, KL'
    ),
    false
  );
  assert.equal(
    isLocationOutsideUsualRegion(
      'Ernakulam Fisheries Directorate, Kochi, KL',
      'Munambam Harbour Office, Kochi, KL'
    ),
    false
  );

  // Different state or country MUST be flagged
  assert.equal(
    isLocationOutsideUsualRegion(
      'Mumbai Port Proxy, Mumbai, MH',
      'Munambam Harbour Office, Kochi, KL'
    ),
    true
  );
  assert.equal(
    isLocationOutsideUsualRegion(
      'Singapore Maritime Relay, Singapore, SG',
      'Munambam Harbour Office, Kochi, KL'
    ),
    true
  );
  assert.equal(
    isLocationOutsideUsualRegion(
      'Bengaluru Cloud VPN, Bengaluru, KA',
      'Kochi Governance NOC, Ernakulam, KL'
    ),
    true
  );

  // Missing baseline returns false gracefully
  assert.equal(isLocationOutsideUsualRegion('Mumbai, MH', null), false);
});

test('deriveLastKnownLocation picks the user usual region baseline even if an anomalous login is newest', () => {
  const baseline = deriveLastKnownLocation([
    { location: 'Singapore Maritime Relay, Singapore, SG' },
    { location: 'Munambam Harbour Office, Kochi, KL' },
    { location: 'Ernakulam Fisheries Directorate, Kochi, KL' },
    { location: 'Munambam Harbour Office, Kochi, KL' },
  ]);
  assert.equal(baseline, 'Munambam Harbour Office, Kochi, KL');
});

test('parseSessionHistoryFromAuditRows sorts newest first, marks latest as current, caps at 10, and flags out-of-region logins against lastKnownLocation', () => {
  const rows = Array.from({ length: 13 }, (_, idx) => {
    const day = String(idx + 10).padStart(2, '0');
    const isAnomalous = idx === 11;
    return {
      audit_id: `AUD-SESS-${idx + 1}`,
      created_at: `2026-11-${day}T06:15:00.000Z`,
      details_json: JSON.stringify({
        loginAt: `2026-11-${day}T06:15:00.000Z`,
        location: isAnomalous
          ? 'Mumbai Port Proxy, Mumbai, MH'
          : `Harbour Desk #${idx + 1}, Kochi, KL`,
        lastKnownLocation: 'Munambam Harbour Office, Kochi, KL',
        ipAddress: isAnomalous ? '49.36.118.42' : `103.42.88.${idx + 1}`,
        authMethod: idx % 2 === 0 ? 'OTP_SMS' : 'PERSONA_SWITCH',
        deviceLabel: 'Chrome · macOS',
      }),
    };
  });

  // Malformed JSON row must not crash parser
  rows.push({
    audit_id: 'AUD-SESS-BROKEN',
    created_at: '2026-11-01T05:00:00.000Z',
    details_json: '{bad-json',
  });

  const history = parseSessionHistoryFromAuditRows(rows, SESSION_HISTORY_MAX_ENTRIES);
  assert.equal(history.length, 10);
  assert.equal(history[0]?.sessionEventId, 'AUD-SESS-13');
  assert.equal(history[0]?.isCurrent, true);
  assert.equal(history[0]?.isUnusualRegion, false);
  assert.equal(history[0]?.lastKnownLocation, 'Munambam Harbour Office, Kochi, KL');

  // Row AUD-SESS-12 (idx=11) originated in Mumbai, MH vs usual KL
  assert.equal(history[1]?.sessionEventId, 'AUD-SESS-12');
  assert.equal(history[1]?.isUnusualRegion, true);
  assert.equal(history[1]?.detectedRegion, 'Maharashtra (MH)');
  assert.equal(history[1]?.expectedRegion, 'Kerala (KL)');

  assert.equal(countUnusualRegionSessions(history), 1);
  assert.equal(filterSessionHistoryByAnomaly(history, true).length, 1);
  assert.equal(filterSessionHistoryByAnomaly(history, false).length, 10);
});

test('annotateSessionHistoryWithRegionCheck checks entries against session lastKnownLocation override', () => {
  const annotated = annotateSessionHistoryWithRegionCheck(
    [
      {
        sessionEventId: 'S1',
        loginAt: '2026-11-27T08:00:00.000Z',
        location: 'Chennai Clearing Gateway, Chennai, TN',
        ipAddress: '106.51.44.9',
        authMethod: 'OTP_SMS',
        deviceLabel: 'Chrome · Windows',
      },
      {
        sessionEventId: 'S2',
        loginAt: '2026-11-26T08:00:00.000Z',
        location: 'Munambam Harbour, Kochi, KL',
        ipAddress: '103.42.88.14',
        authMethod: 'OTP_SMS',
        deviceLabel: 'Chrome · macOS',
      },
    ],
    'Munambam Harbour Office, Kochi, KL'
  );

  assert.equal(annotated[0]?.isUnusualRegion, true);
  assert.equal(annotated[0]?.lastKnownLocation, 'Munambam Harbour Office, Kochi, KL');
  assert.equal(annotated[1]?.isUnusualRegion, false);
});

test('formatSessionTimestamp and formatAuthMethodLabel format cleanly', () => {
  assert.equal(formatSessionTimestamp('2026-11-27T07:05:19.000Z'), '27 Nov 2026, 07:05 UTC');
  assert.equal(formatAuthMethodLabel('OTP_SMS'), 'OTP Sign-In');
  assert.equal(formatAuthMethodLabel('PERSONA_SWITCH'), 'Role Switch');
  assert.equal(formatAuthMethodLabel('TENANT_SWITCH'), 'Harbour Switch');
  assert.equal(formatAuthMethodLabel('TOKEN_REFRESH'), 'Session Renewed');
});
