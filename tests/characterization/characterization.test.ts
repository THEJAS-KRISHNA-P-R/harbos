import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApiApp } from '../../src/server/app.ts';
import { signAccessJwt } from '../../src/server/platform/auth.ts';
import { DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import { type Role } from '../../src/shared/contracts/rbac.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';

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

test('Phase 0 Characterization — Route x Role Status & Response Shapes + Golden Money Vector', async (t) => {
  const { db, platformDb, close } = await bootstrapTestDatabase();
  const app = createApiApp(db, undefined, platformDb);

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  const tokens: Record<Role, string> = {} as Record<Role, string>;
  for (const role of ROLES) {
    const p = ROLE_PERSONAS[role];
    tokens[role] = await signAccessJwt({
      sub: p.sub,
      tenantId: DEMO_TENANT_ID,
      role,
      fullName: p.fullName,
      phoneE164: p.phoneE164,
      entityRefId: p.entityRefId,
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

  await t.test('C1: Record / verify Route x Role status & response shape goldens', async () => {
    const probes: Array<{
      id: string;
      method: string;
      path: string;
      rolesToTest: ReadonlyArray<Role | 'UNAUTH'>;
      body?: Record<string, unknown>;
    }> = [
      { id: 'GET /healthz', method: 'GET', path: '/healthz', rolesToTest: ['UNAUTH'] },
      { id: 'GET /readyz', method: 'GET', path: '/readyz', rolesToTest: ['UNAUTH'] },
      { id: 'GET /api/health', method: 'GET', path: '/api/health', rolesToTest: ['UNAUTH'] },
      {
        id: 'POST /api/v1/auth/otp/request',
        method: 'POST',
        path: '/api/v1/auth/otp/request',
        rolesToTest: ['UNAUTH'],
        body: { phoneE164: '+919447998877' },
      },
      {
        id: 'POST /api/v1/auth/otp/verify (invalid)',
        method: 'POST',
        path: '/api/v1/auth/otp/verify',
        rolesToTest: ['UNAUTH'],
        body: { phoneE164: '+919447998877', otpCode: '000000' },
      },
      {
        id: 'POST /api/v1/auth/refresh (missing cookie)',
        method: 'POST',
        path: '/api/v1/auth/refresh',
        rolesToTest: ['UNAUTH'],
      },
      {
        id: 'POST /api/v1/auth/logout',
        method: 'POST',
        path: '/api/v1/auth/logout',
        rolesToTest: ['UNAUTH'],
      },
      {
        id: 'GET /api/v1/me',
        method: 'GET',
        path: '/api/v1/me',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'GET /api/v1/auth/profile',
        method: 'GET',
        path: '/api/v1/auth/profile',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'GET /api/v1/bootstrap',
        method: 'GET',
        path: '/api/v1/bootstrap',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'GET /api/v1/metrics',
        method: 'GET',
        path: '/api/v1/metrics',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'GET /api/v1/governance/migrations',
        method: 'GET',
        path: '/api/v1/governance/migrations',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'GET /api/v1/benchmarks/harbours',
        method: 'GET',
        path: '/api/v1/benchmarks/harbours',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'GET /api/v1/ledger/audit-imports',
        method: 'GET',
        path: '/api/v1/ledger/audit-imports',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'GET /api/v1/ledger/verify',
        method: 'GET',
        path: '/api/v1/ledger/verify',
        rolesToTest: ['UNAUTH', ...ROLES],
      },
      {
        id: 'POST /api/v1/lots (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/lots',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/sync/commands (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/sync/commands',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { commands: [] },
      },
      {
        id: 'POST /api/v1/lots/:lotId/inspect (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/lots/LOT-2026-004/inspect',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/lots/:lotId/ai-assist',
        method: 'POST',
        path: '/api/v1/lots/LOT-2026-004/ai-assist',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { speciesNameEn: 'Silver Pomfret', coreTempC: 2.0, inspectorNotes: 'Fresh' },
      },
      {
        id: 'POST /api/v1/lots/:lotId/allocate (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/lots/LOT-2026-001/allocate',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/floor-prices (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/floor-prices',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { speciesId: 'SPC-01', floorPricePaisePerKg: -1 },
      },
      {
        id: 'POST /api/v1/payout-batches/:batchId/reconcile (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/payout-batches/BATCH-NONEXISTENT/reconcile',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/payout-batches/bulk-reconcile (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/payout-batches/bulk-reconcile',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { items: [] },
      },
      {
        id: 'POST /api/v1/buyers/:buyerId/receipts (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/buyers/BUY-01/receipts',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/ledger/reversals (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/ledger/reversals',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { action: 'REQUEST', originalJournalId: '', reasonNote: '' },
      },
      {
        id: 'POST /api/v1/tenants (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/tenants',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/tenants/:tenantId/users (validation/RBAC probe)',
        method: 'POST',
        path: `/api/v1/tenants/${DEMO_TENANT_ID}/users`,
        rolesToTest: ['UNAUTH', ...ROLES],
        body: {},
      },
      {
        id: 'POST /api/v1/policies (validation/RBAC probe)',
        method: 'POST',
        path: '/api/v1/policies',
        rolesToTest: ['UNAUTH', ...ROLES],
        body: { commissionBps: 900 },
      },
    ];

    const observed: GoldenMap = {};
    for (const p of probes) {
      for (const roleKey of p.rolesToTest) {
        const token = roleKey === 'UNAUTH' ? undefined : tokens[roleKey];
        const res = await callJson(p.method, p.path, token, p.body);
        const key = `${p.id} :: ${roleKey}`;
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
    'C2: Golden Money Vector — weigh -> inspect -> allocate -> payout -> reconcile -> receipt -> verify-ledger',
    async () => {
      // 1. Weigh a 400 kg (400,000 g) 10-box lot on VSL-01 (society-loan vessel SOC-MUN-01) for SPC-01 (Neymeen)
      const weighRes = await callJson('POST', '/api/v1/lots', tokens.WEIGHING_OPERATOR, {
        vesselId: 'VSL-01',
        speciesId: 'SPC-01',
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
        tokens.AUTHORIZED_INSPECTOR,
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
         FROM harbour.buyers WHERE tenant_id = $1 AND buyer_id = 'BUY-01'`,
        [DEMO_TENANT_ID]
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
        tokens.LICENSED_AUCTIONEER,
        {
          sessionId: 'SES-MUN-MORNING-01',
          auctionMode: 'PHYSICAL_SHOUT',
          auctioneerLicenceId: 'LIC-MUN-001',
          buyerId: 'BUY-01',
          boxesAllocated: 5,
          pricePerKgPaise: '75000',
          fencingToken: 10,
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
        tokens.ACCOUNTANT,
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
        tokens.ACCOUNTANT,
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
        '/api/v1/buyers/BUY-01/receipts',
        tokens.ACCOUNTANT,
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
      const verifyRes = await callJson('GET', '/api/v1/ledger/verify', tokens.ACCOUNTANT);
      assert.equal(verifyRes.status, 200);
      const verifyBody = verifyRes.body as { verified: boolean; entryCount: number };
      assert.equal(verifyBody.verified, true);
      assert.ok(verifyBody.entryCount >= 20);
    }
  );

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await close();
});
