import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApiApp } from '../../src/server/app.ts';
import { signAccessJwt } from '../../src/server/platform/auth.ts';
import { DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import { type Role } from '../../src/shared/contracts/rbac.ts';
import type { DbPort } from '../../src/server/ports/db.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';
import { createIsolatedTenant } from '../helpers/fixtures.ts';

const ROLES: ReadonlyArray<Role> = [
  'WEIGHING_OPERATOR',
  'LICENSED_AUCTIONEER',
  'WHOLESALE_BUYER',
  'FISHERMAN_BOAT_OWNER',
  'AUTHORIZED_INSPECTOR',
  'HARBOUR_ADMIN',
  'ACCOUNTANT',
  'SUPER_ADMIN',
];

export interface GoldenShapeEntry {
  status: number;
  topKeys: string[];
  keyTypes: Record<string, string>;
}

export type GoldenMap = Record<string, GoldenShapeEntry>;

function valueType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function extractResponseShape(status: number, body: unknown): GoldenShapeEntry {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status, topKeys: [], keyTypes: {} };
  }
  const obj = body as Record<string, unknown>;
  const topKeys = Object.keys(obj).sort();
  const keyTypes: Record<string, string> = {};
  for (const k of topKeys) {
    keyTypes[k] = valueType(obj[k]);
  }
  return { status, topKeys, keyTypes };
}

const ROLE_PERSONAS: Record<
  Role,
  { sub: string; fullName: string; phoneE164: string; entityRefId: string | null }
> = {
  WEIGHING_OPERATOR: {
    sub: 'USR-WEIGH-01',
    fullName: 'Sajeev K. (Weighing Operator)',
    phoneE164: '+919447000001',
    entityRefId: null,
  },
  LICENSED_AUCTIONEER: {
    sub: 'USR-AUCT-01',
    fullName: 'K. Balakrishnan Nair (Deputed Auctioneer)',
    phoneE164: '+919447000002',
    entityRefId: 'LIC-MUN-001',
  },
  WHOLESALE_BUYER: {
    sub: 'USR-BUYER-01',
    fullName: 'Ramesh Menon (Apex Marine Exports)',
    phoneE164: '+919447000003',
    entityRefId: 'BUY-01',
  },
  FISHERMAN_BOAT_OWNER: {
    sub: 'USR-FISHER-01',
    fullName: 'Antony Varghese (St. Antony II Owner)',
    phoneE164: '+919447000004',
    entityRefId: 'FSH-01',
  },
  AUTHORIZED_INSPECTOR: {
    sub: 'USR-INSP-01',
    fullName: 'Dr.lekshmi R. (Food Safety & Quality Inspector)',
    phoneE164: '+919447000005',
    entityRefId: null,
  },
  HARBOUR_ADMIN: {
    sub: 'USR-HADMIN-01',
    fullName: 'Capt. Mathew Thomas (Harbour Secretary)',
    phoneE164: '+919447000006',
    entityRefId: null,
  },
  ACCOUNTANT: {
    sub: 'USR-ACCT-01',
    fullName: 'Deepa Krishnan (HMS Chief Accountant)',
    phoneE164: '+919447000007',
    entityRefId: null,
  },
  SUPER_ADMIN: {
    sub: 'USR-SUPER-01',
    fullName: 'Thejas R. (Platform Super Admin)',
    phoneE164: '+919447000008',
    entityRefId: null,
  },
};

const GOLDENS_PATH = path.resolve(process.cwd(), 'tests/characterization/goldens.json');

async function computeSeededRowsHash(db: DbPort): Promise<string> {
  const users = await db.query<{ r: string }>(
    `SELECT string_agg(user_id || ':' || full_name || ':' || is_active::text, '|' ORDER BY user_id) AS r FROM core.users WHERE tenant_id = $1`,
    [DEMO_TENANT_ID]
  );
  const lots = await db.query<{ r: string }>(
    `SELECT string_agg(lot_id || ':' || status || ':' || net_grams::text, '|' ORDER BY lot_id) AS r FROM auction.lots WHERE tenant_id = $1`,
    [DEMO_TENANT_ID]
  );
  const buyers = await db.query<{ r: string }>(
    `SELECT string_agg(buyer_id || ':' || unsettled_payables_paise::text, '|' ORDER BY buyer_id) AS r FROM harbour.buyers WHERE tenant_id = $1`,
    [DEMO_TENANT_ID]
  );
  const accounts = await db.query<{ r: string }>(
    `SELECT string_agg(account_id || ':' || balance_paise::text, '|' ORDER BY account_id) AS r FROM ledger.accounts WHERE tenant_id = $1`,
    [DEMO_TENANT_ID]
  );
  const raw = `${users.rows[0]?.r ?? ''}__${lots.rows[0]?.r ?? ''}__${buyers.rows[0]?.r ?? ''}__${accounts.rows[0]?.r ?? ''}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

test('Phase 0 Characterization — Route x Role Status & Response Shapes + Golden Money Vector', async (t) => {
  const { db, platformDb, close } = await bootstrapTestDatabase();
  const app = createApiApp(db, undefined, platformDb);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const isoProbe = await createIsolatedTenant(platformDb, 'probe');
  const tokens: Record<Role, string> = {} as Record<Role, string>;
  for (const u of isoProbe.users) {
    tokens[u.role] = await signAccessJwt({
      sub: u.userId,
      tenantId: isoProbe.tenantId,
      role: u.role,
      fullName: u.fullName,
      phoneE164: u.phoneE164,
      entityRefId: u.entityRefId,
    });
  }

  async function callJson(
    method: string,
    routePath: string,
    token?: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders ?? {}),
    };
    const res = await fetch(`${baseUrl}${routePath}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { rawText: text };
    }
    return { status: res.status, body: parsed };
  }

  const seededHashBefore = await computeSeededRowsHash(platformDb);

  await t.test('C1: Record / verify Route x Role status & response shape goldens across all 55 routes', async () => {
    const probes: Array<{
      id: string;
      method: string;
      openApiPath: string;
      path: string;
      rolesToTest: ReadonlyArray<Role | 'UNAUTH'>;
      body?: Record<string, unknown>;
    }> = [
      // 1-4. Health & Demo Operators (PUBLIC)
      { id: 'GET /healthz', method: 'GET', openApiPath: '/healthz', path: '/healthz', rolesToTest: ['UNAUTH'] },
      { id: 'GET /readyz', method: 'GET', openApiPath: '/readyz', path: '/readyz', rolesToTest: ['UNAUTH'] },
      { id: 'GET /api/health', method: 'GET', openApiPath: '/api/health', path: '/api/health', rolesToTest: ['UNAUTH'] },
      { id: 'GET /api/v1/demo/operators', method: 'GET', openApiPath: '/api/v1/demo/operators', path: '/api/v1/demo/operators', rolesToTest: ['UNAUTH'] },

      // 5-9. Public Auth
      {
        id: 'POST /api/v1/auth/otp/request',
        method: 'POST',
        openApiPath: '/api/v1/auth/otp/request',
        path: '/api/v1/auth/otp/request',
        rolesToTest: ['UNAUTH'],
        body: { phoneE164: '+919447998877' },
      },
      {
        id: 'POST /api/v1/auth/otp/verify',
        method: 'POST',
        openApiPath: '/api/v1/auth/otp/verify',
        path: '/api/v1/auth/otp/verify',
        rolesToTest: ['UNAUTH'],
        body: { phoneE164: '+919447998877', otpCode: '000000' },
      },
      {
        id: 'POST /api/v1/auth/refresh',
        method: 'POST',
        openApiPath: '/api/v1/auth/refresh',
        path: '/api/v1/auth/refresh',
        rolesToTest: ['UNAUTH'],
      },
      {
        id: 'POST /api/v1/auth/logout',
        method: 'POST',
        openApiPath: '/api/v1/auth/logout',
        path: '/api/v1/auth/logout',
        rolesToTest: ['UNAUTH'],
      },
      {
        id: 'POST /api/v1/auth/persona-switch',
        method: 'POST',
        openApiPath: '/api/v1/auth/persona-switch',
        path: '/api/v1/auth/persona-switch',
        rolesToTest: ['UNAUTH'],
        body: { role: 'WEIGHING_OPERATOR' },
      },

      // 10-14. User Profile & Preferences (ALL_ROLES)
      { id: 'GET /api/v1/me', method: 'GET', openApiPath: '/api/v1/me', path: '/api/v1/me', rolesToTest: ['UNAUTH', ...ROLES] },
      { id: 'GET /api/v1/auth/profile', method: 'GET', openApiPath: '/api/v1/auth/profile', path: '/api/v1/auth/profile', rolesToTest: ['UNAUTH', ...ROLES] },
      {
        id: 'POST /api/v1/auth/profile',
        method: 'POST',
        openApiPath: '/api/v1/auth/profile',
        path: '/api/v1/auth/profile',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/auth/locale',
        method: 'POST',
        openApiPath: '/api/v1/auth/locale',
        path: '/api/v1/auth/locale',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/auth/consent',
        method: 'POST',
        openApiPath: '/api/v1/auth/consent',
        path: '/api/v1/auth/consent',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },

      // 15-16. Privacy / DPDP
      { id: 'GET /api/v1/privacy/export', method: 'GET', openApiPath: '/api/v1/privacy/export', path: '/api/v1/privacy/export', rolesToTest: ['UNAUTH', ...ROLES] },
      {
        id: 'POST /api/v1/privacy/erase',
        method: 'POST',
        openApiPath: '/api/v1/privacy/erase',
        path: '/api/v1/privacy/erase',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },

      // 17-21. Bootstrap & Reads
      { id: 'GET /api/v1/bootstrap', method: 'GET', openApiPath: '/api/v1/bootstrap', path: '/api/v1/bootstrap', rolesToTest: ['UNAUTH', ...ROLES] },
      { id: 'GET /api/v1/lots', method: 'GET', openApiPath: '/api/v1/lots', path: '/api/v1/lots', rolesToTest: ['UNAUTH', ...ROLES] },
      { id: 'GET /api/v1/allocations', method: 'GET', openApiPath: '/api/v1/allocations', path: '/api/v1/allocations', rolesToTest: ['UNAUTH', ...ROLES] },
      { id: 'GET /api/v1/ledger/journals', method: 'GET', openApiPath: '/api/v1/ledger/journals', path: '/api/v1/ledger/journals', rolesToTest: ['UNAUTH', ...ROLES] },
      { id: 'GET /api/v1/audit-logs', method: 'GET', openApiPath: '/api/v1/audit-logs', path: '/api/v1/audit-logs', rolesToTest: ['UNAUTH', ...ROLES] },

      // 22-24. Platform & Observability
      { id: 'GET /api/v1/metrics', method: 'GET', openApiPath: '/api/v1/metrics', path: '/api/v1/metrics', rolesToTest: ['UNAUTH', ...ROLES] },
      { id: 'GET /api/v1/governance/migrations', method: 'GET', openApiPath: '/api/v1/governance/migrations', path: '/api/v1/governance/migrations', rolesToTest: ['UNAUTH', ...ROLES] },
      { id: 'GET /api/v1/benchmarks/harbours', method: 'GET', openApiPath: '/api/v1/benchmarks/harbours', path: '/api/v1/benchmarks/harbours', rolesToTest: ['UNAUTH', ...ROLES] },

      // 25-31. Lots, Sync, Inspection, Allocation, Floor Prices
      {
        id: 'POST /api/v1/lots',
        method: 'POST',
        openApiPath: '/api/v1/lots',
        path: '/api/v1/lots',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/lots/{lotId}/reprint',
        method: 'POST',
        openApiPath: '/api/v1/lots/{lotId}/reprint',
        path: '/api/v1/lots/LOT-2026-004/reprint',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/sync/commands',
        method: 'POST',
        openApiPath: '/api/v1/sync/commands',
        path: '/api/v1/sync/commands',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { commands: [] },
      },
      {
        id: 'POST /api/v1/lots/{lotId}/inspect',
        method: 'POST',
        openApiPath: '/api/v1/lots/{lotId}/inspect',
        path: '/api/v1/lots/LOT-2026-004/inspect',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/lots/{lotId}/ai-assist',
        method: 'POST',
        openApiPath: '/api/v1/lots/{lotId}/ai-assist',
        path: '/api/v1/lots/LOT-2026-004/ai-assist',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { speciesNameEn: 'Silver Pomfret', coreTempC: 2.0, inspectorNotes: 'Fresh' },
      },
      {
        id: 'POST /api/v1/lots/{lotId}/allocate',
        method: 'POST',
        openApiPath: '/api/v1/lots/{lotId}/allocate',
        path: '/api/v1/lots/LOT-2026-001/allocate',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/floor-prices',
        method: 'POST',
        openApiPath: '/api/v1/floor-prices',
        path: '/api/v1/floor-prices',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { speciesId: isoProbe.speciesId, floorPricePaisePerKg: -1 },
      },

      // 32-39. Webhook, Payouts, Ledger
      {
        id: 'POST /api/v1/webhooks/bank-nodal',
        method: 'POST',
        openApiPath: '/api/v1/webhooks/bank-nodal',
        path: '/api/v1/webhooks/bank-nodal',
        rolesToTest: ['UNAUTH'],
        body: {},
      },
      { id: 'GET /api/v1/ledger/audit-imports', method: 'GET', openApiPath: '/api/v1/ledger/audit-imports', path: '/api/v1/ledger/audit-imports', rolesToTest: ['UNAUTH', ...ROLES] },
      {
        id: 'POST /api/v1/payout-batches',
        method: 'POST',
        openApiPath: '/api/v1/payout-batches',
        path: '/api/v1/payout-batches',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/payout-batches/{batchId}/reconcile',
        method: 'POST',
        openApiPath: '/api/v1/payout-batches/{batchId}/reconcile',
        path: '/api/v1/payout-batches/BATCH-NONEXISTENT/reconcile',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/payout-batches/bulk-reconcile',
        method: 'POST',
        openApiPath: '/api/v1/payout-batches/bulk-reconcile',
        path: '/api/v1/payout-batches/bulk-reconcile',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { items: [] },
      },
      {
        id: 'POST /api/v1/buyers/{buyerId}/receipts',
        method: 'POST',
        openApiPath: '/api/v1/buyers/{buyerId}/receipts',
        path: `/api/v1/buyers/${isoProbe.buyerId}/receipts`,
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/ledger/reversals',
        method: 'POST',
        openApiPath: '/api/v1/ledger/reversals',
        path: '/api/v1/ledger/reversals',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { action: 'REQUEST', originalJournalId: '', reasonNote: '' },
      },
      { id: 'GET /api/v1/ledger/verify', method: 'GET', openApiPath: '/api/v1/ledger/verify', path: '/api/v1/ledger/verify', rolesToTest: ['UNAUTH', ...ROLES] },

      // 40-42. Tenancy & Policies
      {
        id: 'POST /api/v1/tenants',
        method: 'POST',
        openApiPath: '/api/v1/tenants',
        path: '/api/v1/tenants',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/tenants/{tenantId}/users',
        method: 'POST',
        openApiPath: '/api/v1/tenants/{tenantId}/users',
        path: `/api/v1/tenants/${isoProbe.tenantId}/users`,
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/policies',
        method: 'POST',
        openApiPath: '/api/v1/policies',
        path: '/api/v1/policies',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { commissionBps: 900 },
      },

      // 43-52. Masterdata
      { id: 'GET /api/v1/masterdata/{entityType}', method: 'GET', openApiPath: '/api/v1/masterdata/{entityType}', path: '/api/v1/masterdata/species', rolesToTest: ['UNAUTH', ...ROLES] },
      {
        id: 'POST /api/v1/masterdata/coop-societies',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/coop-societies',
        path: '/api/v1/masterdata/coop-societies',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/fishermen',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/fishermen',
        path: '/api/v1/masterdata/fishermen',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/vessels',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/vessels',
        path: '/api/v1/masterdata/vessels',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/buyers',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/buyers',
        path: '/api/v1/masterdata/buyers',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/licences',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/licences',
        path: '/api/v1/masterdata/licences',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/species',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/species',
        path: '/api/v1/masterdata/species',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/sessions',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/sessions',
        path: '/api/v1/masterdata/sessions',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/{entityType}/{id}/deactivate',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/{entityType}/{id}/deactivate',
        path: '/api/v1/masterdata/species/SPC-NONEXISTENT/deactivate',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/masterdata/import/{entityType}',
        method: 'POST',
        openApiPath: '/api/v1/masterdata/import/{entityType}',
        path: '/api/v1/masterdata/import/species',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },

      // 53-54. Reports
      { id: 'GET /api/v1/reports/{reportType}', method: 'GET', openApiPath: '/api/v1/reports/{reportType}', path: '/api/v1/reports/daily-settlement', rolesToTest: ['UNAUTH', ...ROLES] },
      {
        id: 'POST /api/v1/reports/shadow-diff',
        method: 'POST',
        openApiPath: '/api/v1/reports/shadow-diff',
        path: '/api/v1/reports/shadow-diff',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },

      // 55. Notifications
      { id: 'GET /api/v1/notifications/outbox', method: 'GET', openApiPath: '/api/v1/notifications/outbox', path: '/api/v1/notifications/outbox', rolesToTest: ['UNAUTH', ...ROLES] },
    ];

    // Assert exact 100% coverage of docs/openapi.json
    const openApiRaw = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'docs/openapi.json'), 'utf8')
    );
    const openApiEndpoints: string[] = [];
    for (const [p, ops] of Object.entries(
      openApiRaw.paths as Record<string, Record<string, unknown>>
    )) {
      for (const m of Object.keys(ops)) {
        openApiEndpoints.push(`${m.toUpperCase()} ${p}`);
      }
    }
    const coveredSet = new Set(probes.map((p) => `${p.method} ${p.openApiPath}`));
    for (const ep of openApiEndpoints) {
      assert.ok(
        coveredSet.has(ep),
        `Characterization suite missing OpenAPI route: ${ep}`
      );
    }
    assert.equal(
      probes.length,
      openApiEndpoints.length,
      `Expected exactly ${openApiEndpoints.length} probes, got ${probes.length}`
    );

    const observed: GoldenMap = {};
    for (const p of probes) {
      for (const roleKey of p.rolesToTest) {
        const token = roleKey === 'UNAUTH' ? undefined : tokens[roleKey];
        const res = await callJson(p.method, p.path, token, p.body);
        const key = `${p.method} ${p.openApiPath} :: ${roleKey}`;
        observed[key] = extractResponseShape(res.status, res.body);
      }
    }

    if (!fs.existsSync(GOLDENS_PATH) || process.env['UPDATE_GOLDENS'] === '1') {
      fs.mkdirSync(path.dirname(GOLDENS_PATH), { recursive: true });
      fs.writeFileSync(GOLDENS_PATH, JSON.stringify(observed, null, 2) + '\n', 'utf8');
    }

    const committed: GoldenMap = JSON.parse(fs.readFileSync(GOLDENS_PATH, 'utf8'));
    for (const [key, expected] of Object.entries(committed)) {
      const actual = observed[key];
      assert.ok(actual, `Missing characterization probe for "${key}"`);
      assert.equal(
        actual.status,
        expected.status,
        `Status drift on "${key}": expected ${expected.status}, got ${actual.status}`
      );
      assert.deepEqual(
        actual.topKeys,
        expected.topKeys,
        `Response key shape drift on "${key}": expected [${expected.topKeys.join(', ')}], got [${actual.topKeys.join(', ')}]`
      );
      assert.deepEqual(
        actual.keyTypes,
        expected.keyTypes,
        `Response value type drift on "${key}"`
      );
    }
  });

  await t.test(
    'C2: Golden Money Vector on Isolated Tenant — weigh -> inspect -> allocate -> payout -> reconcile -> receipt -> verify-ledger',
    async () => {
      // Create dedicated isolated tenant fixture to guarantee ZERO mutation of seeded demo state
      const iso = await createIsolatedTenant(platformDb, 'char-c2');

      const isoTokens: Record<Role, string> = {} as Record<Role, string>;
      for (const u of iso.users) {
        isoTokens[u.role] = await signAccessJwt({
          sub: u.userId,
          tenantId: iso.tenantId,
          role: u.role,
          fullName: u.fullName,
          phoneE164: u.phoneE164,
          entityRefId: u.entityRefId,
        });
      }

      // 1. Weigh a 400 kg (400,000 g) 10-box lot on isolated vessel for isolated species
      const weighRes = await callJson('POST', '/api/v1/lots', isoTokens.WEIGHING_OPERATOR, {
        vesselId: `VES-${iso.tenantId}-01`,
        speciesId: iso.speciesId,
        totalBoxes: 10,
        netGrams: '400000',
        coreTempC: 1.6,
        weightSource: 'BLE_SCALE',
      });
      assert.equal(weighRes.status, 201, `Weigh failed: ${JSON.stringify(weighRes.body)}`);
      const weighedLot = weighRes.body as {
        lotId: string;
        lotCode: string;
        status: string;
        inspectionGrade: string | null;
      };
      assert.equal(weighedLot.status, 'WEIGHED_PENDING_INSPECTION');
      assert.equal(weighedLot.inspectionGrade, null);

      // 2. Inspect the lot as AUTHORIZED_INSPECTOR (independent from WEIGHING_OPERATOR)
      const inspectRes = await callJson(
        'POST',
        `/api/v1/lots/${weighedLot.lotId}/inspect`,
        isoTokens.AUTHORIZED_INSPECTOR,
        {
          grade: 'A_EXPORT',
          coreTempC: 1.6,
          notes: 'Golden vector s.21 inspection passed',
        }
      );
      assert.equal(inspectRes.status, 200, `Inspect failed: ${JSON.stringify(inspectRes.body)}`);
      const inspectedLot = inspectRes.body as { status: string; grade: string };
      assert.equal(inspectedLot.status, 'OPEN_FOR_AUCTION');
      assert.equal(inspectedLot.grade, 'A_EXPORT');

      // Snapshot buyer unsettled payables before allocation
      const buyerBeforeRes = await platformDb.query<{ unsettled_payables_paise: string }>(
        `SELECT unsettled_payables_paise::text AS unsettled_payables_paise
         FROM harbour.buyers WHERE tenant_id = $1 AND buyer_id = $2`,
        [iso.tenantId, iso.buyerId]
      );
      const buyerUnsettledBefore = BigInt(
        buyerBeforeRes.rows[0]?.unsettled_payables_paise ?? '0'
      );

      // 3. Allocate 5 boxes (200 kg = 200,000 g) @ ₹750.00/kg (75000 paise/kg) under Mode A FIXED_SAAS_ONLY
      // Hammer = 200 * 75000 = 15,000,000 paise (₹1,50,000.00)
      // Commission (5% = 500 bps) = 750,000 paise
      // Fisherman Net (95%) = 14,250,000 paise
      // Bonus Escrow (40% of 5% = 2%) = 300,000 paise
      // Auctioneer / HMS / Co-op (20% of 5% = 1% each) = 150,000 paise each
      // Under Mode A FIXED_SAAS_ONLY: buyerFee = 0, gst = 0, harbourosRevenue = 0 -> buyerPayablePaise = 15,000,000 paise
      const idemAlloc = `GOLDEN-VEC-ALLOC-${weighedLot.lotId}`;
      const allocRes = await callJson(
        'POST',
        `/api/v1/lots/${weighedLot.lotId}/allocate`,
        isoTokens.LICENSED_AUCTIONEER,
        {
          sessionId: iso.sessionId,
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: `LIC-${iso.tenantId}-01`,
          buyerId: iso.buyerId,
          boxesAllocated: 5,
          pricePerKgPaise: '75000',
          fencingToken: 1,
        },
        { 'Idempotency-Key': idemAlloc }
      );
      assert.equal(allocRes.status, 201, `Allocate failed: ${JSON.stringify(allocRes.body)}`);
      const allocBody = allocRes.body as {
        allocationId: string;
        journalId: string;
        hammerPaise: string;
        buyerPayablePaise: string;
        fishermanNetPaise: string;
        bonusEscrowPaise: string;
        floorWarningTriggered: boolean;
        remainingBoxes: number;
        remainingGrams: string;
        idempotentReplay: boolean;
      };
      assert.equal(allocBody.hammerPaise, '15000000');
      assert.equal(allocBody.buyerPayablePaise, '15000000');
      assert.equal(allocBody.fishermanNetPaise, '14250000');
      assert.equal(allocBody.bonusEscrowPaise, '300000');
      assert.equal(allocBody.floorWarningTriggered, false);
      assert.equal(allocBody.remainingBoxes, 5);
      assert.equal(allocBody.remainingGrams, '200000');
      assert.equal(allocBody.idempotentReplay, false);

      // Verify exact DB row values in auction.sale_allocations
      const saleRowRes = await platformDb.query<{
        hammer_paise: string;
        buyer_payable_paise: string;
        fisherman_net_paise: string;
        bonus_escrow_paise: string;
        auctioneer_paise: string;
        hms_net_paise: string;
        coop_net_paise: string;
        harbouros_revenue_paise: string;
        gst_paise: string;
      }>(
        `SELECT hammer_paise::text, buyer_payable_paise::text, fisherman_net_paise::text,
                bonus_escrow_paise::text, auctioneer_paise::text, hms_net_paise::text,
                coop_net_paise::text, harbouros_revenue_paise::text, gst_paise::text
         FROM auction.sale_allocations WHERE allocation_id = $1`,
        [allocBody.allocationId]
      );
      assert.deepEqual(saleRowRes.rows[0], {
        hammer_paise: '15000000',
        buyer_payable_paise: '15000000',
        fisherman_net_paise: '14250000',
        bonus_escrow_paise: '300000',
        auctioneer_paise: '150000',
        hms_net_paise: '150000',
        coop_net_paise: '150000',
        harbouros_revenue_paise: '0',
        gst_paise: '0',
      });

      // 4. Generate Payout Batch as ACCOUNTANT
      const payoutRes = await callJson(
        'POST',
        '/api/v1/payout-batches',
        isoTokens.ACCOUNTANT,
        {}
      );
      assert.equal(payoutRes.status, 201, `Payout batch failed: ${JSON.stringify(payoutRes.body)}`);
      const payoutBody = payoutRes.body as {
        batchId: string;
        batchCode: string;
        totalAmountPaise: string;
        itemCount: number;
      };
      assert.ok(BigInt(payoutBody.totalAmountPaise) >= 14_250_000n);
      assert.ok(payoutBody.itemCount >= 1);

      // 5. Reconcile Payout Batch with Bank UTR & exact confirmTotalPaise
      const utrCode = `FDRL261112${weighedLot.lotId.replace(/[^A-Z0-9]/g, '').slice(-6)}`;
      const reconcileRes = await callJson(
        'POST',
        `/api/v1/payout-batches/${payoutBody.batchId}/reconcile`,
        isoTokens.ACCOUNTANT,
        {
          bankUtr: utrCode,
          confirmTotalPaise: payoutBody.totalAmountPaise,
        }
      );
      assert.equal(
        reconcileRes.status,
        200,
        `Reconcile failed: ${JSON.stringify(reconcileRes.body)}`
      );
      const reconcileBody = reconcileRes.body as {
        batchId: string;
        status: string;
        bankUtr: string;
      };
      assert.equal(reconcileBody.status, 'RECONCILED_UTR');
      assert.equal(reconcileBody.bankUtr, utrCode);

      // 6. Record Buyer Receipt for the exact 15,000,000 paise allocation payable
      const idemReceipt = `GOLDEN-VEC-RCPT-${weighedLot.lotId}`;
      const receiptRes = await callJson(
        'POST',
        `/api/v1/buyers/${iso.buyerId}/receipts`,
        isoTokens.ACCOUNTANT,
        {
          amountPaise: '15000000',
          paymentChannel: 'NEFT',
          referenceNo: `NEFT-${weighedLot.lotId}`,
        },
        { 'Idempotency-Key': idemReceipt }
      );
      assert.equal(receiptRes.status, 201, `Receipt failed: ${JSON.stringify(receiptRes.body)}`);
      const receiptBody = receiptRes.body as {
        amountPaise: string;
        unsettledPayablesPaise: string;
      };
      assert.equal(receiptBody.amountPaise, '15000000');
      assert.equal(BigInt(receiptBody.unsettledPayablesPaise), buyerUnsettledBefore);

      // 7. Verify tenant ledger SHA-256 hash chain is 100% intact
      const verifyRes = await callJson('GET', '/api/v1/ledger/verify', isoTokens.ACCOUNTANT);
      assert.equal(verifyRes.status, 200);
      const verifyBody = verifyRes.body as { verified: boolean; entryCount: number };
      assert.equal(verifyBody.verified, true);
      assert.ok(verifyBody.entryCount >= 5);
    }
  );

  // 8. Seeded rows intact gate: assert zero modification across core.users, core.tenants, harbour.buyers, ledger.accounts in demo tenant
  const seededHashAfter = await computeSeededRowsHash(platformDb);
  assert.equal(
    seededHashAfter,
    seededHashBefore,
    'Seeded demo tenant rows must be completely untouched after characterization suite execution'
  );

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await close();
});
