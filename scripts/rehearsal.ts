/**
 * HarbourOS Zero-SQL Public-API End-to-End Pilot Rehearsal (C1 #9)
 *
 * Strictly executes public HTTP API calls via fetch() with ZERO database drivers,
 * ZERO SQL queries, and ZERO imports from src/server/**.
 *
 * Usage:
 *   REHEARSAL_BASE_URL=http://127.0.0.1:3000 npm run rehearse
 */

const BASE_URL = (process.env.REHEARSAL_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

interface JsonFetchOptions {
  method?: 'GET' | 'POST';
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
}

async function apiJson<T>(path: string, opts: JsonFetchOptions = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-HarbourOS-SDK-Version': '2.4.0-rehearsal',
  };
  if (opts.token) {
    headers['Authorization'] = `Bearer ${opts.token}`;
  }
  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : 'invalid JSON';
    throw new Error(`${opts.method ?? 'GET'} ${path} returned non-JSON (${res.status}): ${detail} — ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${opts.method ?? 'GET'} ${path} failed (${res.status}): ${JSON.stringify(parsed)}`);
  }
  return { status: res.status, data: parsed };
}

async function apiCsv(path: string, token: string): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} CSV failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return text;
}

function assertCondition(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`REHEARSAL ASSERTION FAILED: ${msg}`);
  }
}

async function acquireRoleToken(role: string): Promise<string> {
  const explicitPhone = process.env.REHEARSAL_PHONE_E164;
  if (explicitPhone) {
    const otpReq = await apiJson<{ devOtpEcho?: string }>('/api/v1/auth/otp/request', {
      method: 'POST',
      body: { phoneE164: explicitPhone },
    });
    const otpCode = process.env.REHEARSAL_OTP_CODE ?? otpReq.data.devOtpEcho;
    assertCondition(otpCode, 'REHEARSAL_OTP_CODE or OTP_DEV_ECHO required when REHEARSAL_PHONE_E164 is set');
    const verified = await apiJson<{ accessToken: string }>('/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phoneE164: explicitPhone, otpCode },
    });
    return verified.data.accessToken;
  }

  const switched = await apiJson<{ accessToken: string }>('/api/v1/auth/persona-switch', {
    method: 'POST',
    body: { role },
  });
  return switched.data.accessToken;
}

async function runRehearsal(): Promise<void> {
  const startedAt = Date.now();
  const runId = `REH-${Date.now()}`;
  console.log(`[rehearsal] Starting zero-SQL public-API rehearsal against ${BASE_URL} (${runId})`);

  // 1. Health & Readiness probes
  const health = await apiJson<{ status: string }>('/healthz');
  const ready = await apiJson<{ status: string }>('/readyz');
  assertCondition(health.status === 200, 'healthz must return 200');
  assertCondition(ready.status === 200, 'readyz must return 200');
  console.log('[rehearsal] 1/9 /healthz & /readyz OK');

  // 2. Authenticate distinct role tokens & fetch live bootstrap masterdata
  const adminToken = await acquireRoleToken('HARBOUR_ADMIN');
  const weighingToken = await acquireRoleToken('WEIGHING_OPERATOR');
  const inspectorToken = await acquireRoleToken('AUTHORIZED_INSPECTOR');
  const auctioneerToken = await acquireRoleToken('LICENSED_AUCTIONEER');

  const boot = await apiJson<{
    vessels: ReadonlyArray<{ vessel_id: string; has_active_society_loan: boolean; loan_coop_society_id: string | null }>;
    species: ReadonlyArray<{ species_id: string; floor_price_paise_per_kg: string }>;
    licences: ReadonlyArray<{ licence_id: string; status: string; deputed_by_society_id: string | null }>;
    buyers: ReadonlyArray<{ buyer_id: string; escrow_balance_paise: string; approved_credit_paise: string; unsettled_payables_paise: string; active_holds_paise: string }>;
  }>('/api/v1/bootstrap', { token: adminToken });

  const vessel = boot.data.vessels.find((v) => !v.has_active_society_loan) ?? boot.data.vessels[0];
  const species = boot.data.species[0];
  const licence =
    (vessel?.has_active_society_loan
      ? boot.data.licences.find((l) => l.status === 'ACTIVE' && l.deputed_by_society_id === vessel.loan_coop_society_id)
      : boot.data.licences.find((l) => l.status === 'ACTIVE')) ?? boot.data.licences[0];
  const buyer = boot.data.buyers[0];

  assertCondition(vessel && species && licence && buyer, 'Bootstrap must provide vessel, species, licence, and buyer');
  console.log(`[rehearsal] 2/9 Authenticated 4 roles (vessel=${vessel.vessel_id}, species=${species.species_id}, licence=${licence.licence_id}, buyer=${buyer.buyer_id})`);

  // 3. Masterdata CSV Dry-Run Validation (zero-mutation gate)
  const dryRun = await apiJson<{
    dryRun: boolean;
    totalRows: number;
    validRows: number;
    committed: boolean;
    errors: ReadonlyArray<unknown>;
  }>('/api/v1/masterdata/import/species', {
    method: 'POST',
    token: adminToken,
    body: {
      dryRun: true,
      csvText:
        'speciesId,code,nameEn,nameMl,scientificName,floorPricePaisePerKg,exportEligible\n' +
        `SPC-${runId},REH,Rehearsal Pomfret,ആവോലി,Pampus argenteus,65000,true`,
    },
  });
  assertCondition(dryRun.data.validRows === 1 && dryRun.data.errors.length === 0 && !dryRun.data.committed, 'Masterdata dry-run must validate 1 row without committing');
  console.log('[rehearsal] 3/9 Masterdata CSV dry-run validation OK');

  // 4. Weigh & Tag Lot
  const lot = await apiJson<{
    lotId: string;
    lotCode: string;
    qrSignature: string;
    totalBoxes: number;
    netGrams: string;
  }>('/api/v1/lots', {
    method: 'POST',
    token: weighingToken,
    idempotencyKey: `idem-weigh-${runId}`,
    body: {
      vesselId: vessel.vessel_id,
      speciesId: species.species_id,
      totalBoxes: 2,
      netGrams: '50000',
      coreTempC: 1.8,
      weightSource: 'BLE_SCALE',
    },
  });
  assertCondition(lot.data.lotId && lot.data.lotCode && lot.data.qrSignature, 'Weighed lot must include lotId, lotCode, and qrSignature');
  console.log(`[rehearsal] 4/9 Weighed lot ${lot.data.lotCode} (QR=${lot.data.qrSignature.slice(0, 12)}…)`);

  // 5. Inspect Quality (s.21)
  const inspected = await apiJson<{ lotId: string; grade: string; status: string }>(
    `/api/v1/lots/${lot.data.lotId}/inspect`,
    {
      method: 'POST',
      token: inspectorToken,
      body: {
        grade: 'A_EXPORT',
        coreTempC: 1.8,
        notes: `Pilot rehearsal certification ${runId}`,
      },
    }
  );
  assertCondition(inspected.data.grade === 'A_EXPORT', 'Inspection grade must be A_EXPORT');
  console.log(`[rehearsal] 5/9 Inspected ${lot.data.lotCode} -> ${inspected.data.grade}`);

  // 6. Auction Pit Sale Allocation (exact 95/5 ledger post)
  const floorPaise = BigInt(species.floor_price_paise_per_kg || '50000');
  const bidPricePaise = (floorPaise > 40000n ? floorPaise : 40000n).toString();
  const alloc = await apiJson<{
    allocationId: string;
    journalId: string;
    hammerPaise: string;
    fishermanNetPaise: string;
    bonusEscrowPaise: string;
    remainingBoxes: number;
  }>(`/api/v1/lots/${lot.data.lotId}/allocate`, {
    method: 'POST',
    token: auctioneerToken,
    idempotencyKey: `idem-alloc-${runId}`,
    body: {
      sessionId: 'SES-MUN-MORNING-01',
      auctionMode: 'PHYSICAL_SHOUT',
      auctioneerLicenceId: licence.licence_id,
      buyerId: buyer.buyer_id,
      boxesAllocated: 2,
      pricePerKgPaise: bidPricePaise,
      fencingToken: 10,
    },
  });
  const hammer = BigInt(alloc.data.hammerPaise);
  const net = BigInt(alloc.data.fishermanNetPaise);
  const commission = hammer - net;
  assertCondition(alloc.data.remainingBoxes === 0 && hammer > 0n && net > 0n, 'Allocation must clear all 2 boxes with positive hammer and net');
  console.log(`[rehearsal] 6/9 Allocated ${alloc.data.allocationId} (hammer=${hammer}p, net=${net}p, journal=${alloc.data.journalId})`);

  // 7. Generate Payout Batch & Reconcile Bank UTR
  const batch = await apiJson<{ batchId: string; batchCode: string }>('/api/v1/payout-batches', {
    method: 'POST',
    token: adminToken,
  });
  const utrRef = `UTR-REH-${Date.now()}`;
  await apiJson(`/api/v1/payout-batches/${batch.data.batchId}/reconcile`, {
    method: 'POST',
    token: adminToken,
    body: { bankUtr: utrRef },
  });
  console.log(`[rehearsal] 7/9 Payout batch ${batch.data.batchCode} reconciled with ${utrRef}`);

  // 8. Verify all 5 Statutory Reports (JSON + RFC 4180 CSV) + Shadow-Pilot Diff
  const reportTypes = [
    'daily-auction',
    'fisherman-statement',
    'statutory-apportionment',
    'buyer-ledger',
    'payout-reconciliation',
  ] as const;

  for (const rType of reportTypes) {
    const rJson = await apiJson<{
      reportType: string;
      headers: ReadonlyArray<string>;
      rows: ReadonlyArray<Record<string, unknown>>;
    }>(`/api/v1/reports/${rType}`, { token: adminToken });
    assertCondition(rJson.data.headers.length > 0, `Report ${rType} must return headers`);

    if (rType === 'statutory-apportionment') {
      for (const row of rJson.data.rows) {
        assertCondition(
          String(row.allocatedTotalPaise) === String(row.ledgerBalancePaise),
          `Statutory apportionment mismatch on ${String(row.recipientPool)}: allocated=${String(row.allocatedTotalPaise)} vs ledger=${String(row.ledgerBalancePaise)}`
        );
      }
    }

    const csv = await apiCsv(`/api/v1/reports/${rType}?format=csv`, adminToken);
    assertCondition(csv.split('\n').length >= 1 && csv.includes(rJson.data.headers[0]!), `Report ${rType} CSV must contain header row`);
  }

  const shadowDiff = await apiJson<{
    zeroPaiseDivergence: boolean;
    totalCompared: number;
    totalDivergentRows: number;
  }>('/api/v1/reports/shadow-diff', {
    method: 'POST',
    token: adminToken,
    body: {
      csvText: `lotCode,hammerPaise,fishermanNetPaise,commissionPaise\n${lot.data.lotCode},${hammer.toString()},${net.toString()},${commission.toString()}`,
    },
  });
  assertCondition(
    shadowDiff.data.zeroPaiseDivergence && shadowDiff.data.totalCompared === 1 && shadowDiff.data.totalDivergentRows === 0,
    `Shadow-diff expected 0-paise parity, got ${JSON.stringify(shadowDiff.data)}`
  );
  console.log('[rehearsal] 8/9 All 5 statutory reports (JSON + CSV) + Shadow-Pilot 0-paise diff OK');

  // 9. Cryptographic SHA-256 Ledger Chain Verification
  const verify = await apiJson<{ verified: boolean; entryCount: number; headHash: string }>(
    '/api/v1/ledger/verify',
    { token: adminToken }
  );
  assertCondition(verify.data.verified && verify.data.entryCount > 0, 'Ledger verification must return verified=true');
  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[rehearsal] 9/9 SHA-256 ledger verified (${verify.data.entryCount} entries, head=${verify.data.headHash.slice(0, 16)}…) in ${elapsedMs} ms`
  );
  console.log('[rehearsal] PASS — Zero-SQL public-API rehearsal complete.');
}

runRehearsal().catch((err: unknown) => {
  console.error('[rehearsal] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
