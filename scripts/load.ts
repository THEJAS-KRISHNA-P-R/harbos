import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createApiApp } from '../src/server/app.ts';
import { signAccessJwt } from '../src/server/platform/auth.ts';
import { DEMO_TENANT_ID } from '../src/server/platform/seed.ts';
import { runVerifyAllTenantLedgersJob } from '../src/server/entry/jobs.ts';
import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { config } from '../src/server/config.ts';
import { bootstrapTestDatabase } from '../tests/helpers/pg-bootstrap.ts';
import { createIsolatedTenant } from '../tests/helpers/fixtures.ts';
import type { DbPort } from '../src/server/ports/db.ts';

export interface ScenarioResult {
  readonly scenarioName: string;
  readonly totalOperations: number;
  readonly successfulOperations: number;
  readonly failedOperations: number;
  readonly status5xx: number;
  readonly durationSeconds: number;
  readonly throughputOpsSec: number;
  readonly latenciesMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
  };
  readonly details: Record<string, unknown>;
}

export interface MultiScenarioLoadResults {
  readonly timestamp: string;
  readonly targetUrls: ReadonlyArray<string>;
  readonly durationSecondsTarget: number;
  readonly total5xx: number;
  readonly overallP95Ms: number;
  readonly zeroOversellVerified: boolean;
  readonly ledgerVerifyClean: boolean;
  readonly scenarios: ScenarioResult[];
  readonly overallPassed: boolean;
}

function computePercentiles(latencies: number[]): {
  p50: number;
  p95: number;
  p99: number;
  max: number;
} {
  if (latencies.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const getP = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
  return {
    p50: Number(getP(50).toFixed(2)),
    p95: Number(getP(95).toFixed(2)),
    p99: Number(getP(99).toFixed(2)),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
  };
}

export async function runLoadScenarios(): Promise<MultiScenarioLoadResults> {
  const envTargetUrls = (process.env.LOAD_TARGET_URLS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const durationSecTarget = Math.max(
    5,
    Number(process.env.LOAD_DURATION_SEC ?? (envTargetUrls.length > 0 ? 60 : 15))
  );
  const p95LimitMs = Number(process.env.LOAD_P95_MAX_MS ?? 500);

  let targetUrls: string[];
  let platformDb: DbPort;
  let cleanupFns: Array<() => Promise<void>> = [];

  if (envTargetUrls.length > 0) {
    targetUrls = envTargetUrls;
    const platformUrl =
      process.env.DATABASE_PLATFORM_URL ||
      config.DATABASE_PLATFORM_URL ||
      process.env.DATABASE_URL ||
      config.DATABASE_URL;
    if (!platformUrl || !platformUrl.startsWith('postgres')) {
      throw new Error('LOAD_TARGET_URLS mode requires DATABASE_PLATFORM_URL (PostgreSQL)');
    }
    const pgPlatform = new PgPoolAdapter(platformUrl, 30_000);
    platformDb = pgPlatform;
    cleanupFns.push(async () => {
      await pgPlatform.close();
    });
  } else {
    const boot = await bootstrapTestDatabase();
    platformDb = boot.platformDb;
    const app1 = createApiApp(boot.db, undefined, boot.platformDb);
    const app2 = createApiApp(boot.db, undefined, boot.platformDb);
    const s1: http.Server = await new Promise((resolve) => {
      const s = app1.listen(0, '127.0.0.1', () => resolve(s));
    });
    const s2: http.Server = await new Promise((resolve) => {
      const s = app2.listen(0, '127.0.0.1', () => resolve(s));
    });
    const p1 = (s1.address() as { port: number }).port;
    const p2 = (s2.address() as { port: number }).port;
    targetUrls = [`http://127.0.0.1:${p1}`, `http://127.0.0.1:${p2}`];
    cleanupFns.push(async () => {
      await new Promise<void>((resolve) => s1.close(() => resolve()));
      await new Promise<void>((resolve) => s2.close(() => resolve()));
      await boot.close();
    });
  }

  console.log(
    `=== HarbourOS Multi-Instance Load Smoke Gate (${targetUrls.length} web instances, ${durationSecTarget}s duration, p95 < ${p95LimitMs}ms) ===`
  );
  console.log(`[load] Targets: ${targetUrls.join(', ')}`);

  const scenarioResults: ScenarioResult[] = [];
  const allLatencies: number[] = [];
  let total5xx = 0;
  const touchedTenants = new Set<string>([DEMO_TENANT_ID]);

  let rrCounter = 0;
  const nextBaseUrl = (): string => {
    const url = targetUrls[rrCounter % targetUrls.length]!;
    rrCounter += 1;
    return url;
  };

  try {
    // 0. Health check all web targets
    for (const url of targetUrls) {
      const [hRes, rRes] = await Promise.all([
        fetch(`${url}/healthz`),
        fetch(`${url}/readyz`),
      ]);
      assert.equal(hRes.status, 200, `Target ${url}/healthz failed (${hRes.status})`);
      assert.equal(rRes.status, 200, `Target ${url}/readyz failed (${rRes.status})`);
    }
    console.log(`[load] All ${targetUrls.length} web instances passed /healthz and /readyz.`);

    // ------------------------------------------------------------------------
    // Scenario 1: Hot Lot 200 Concurrent Allocations Across All Web Instances
    // ------------------------------------------------------------------------
    console.log('\n[Scenario 1/3] Hot Lot: 200 Concurrent Allocations Across Web Instances (Zero Oversell Gate)...');
    const hotIso = await createIsolatedTenant(platformDb, 'hotload');
    touchedTenants.add(hotIso.tenantId);

    const weighUser = hotIso.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const inspUser = hotIso.users.find((u) => u.role === 'AUTHORIZED_INSPECTOR')!;
    const auctUser = hotIso.users.find((u) => u.role === 'LICENSED_AUCTIONEER')!;

    const [weighToken, inspToken, auctToken] = await Promise.all([
      signAccessJwt({
        sub: weighUser.userId,
        tenantId: hotIso.tenantId,
        role: weighUser.role,
        fullName: weighUser.fullName,
        phoneE164: weighUser.phoneE164,
      }),
      signAccessJwt({
        sub: inspUser.userId,
        tenantId: hotIso.tenantId,
        role: inspUser.role,
        fullName: inspUser.fullName,
        phoneE164: inspUser.phoneE164,
      }),
      signAccessJwt({
        sub: auctUser.userId,
        tenantId: hotIso.tenantId,
        role: auctUser.role,
        fullName: auctUser.fullName,
        phoneE164: auctUser.phoneE164,
        entityRefId: `LIC-${hotIso.tenantId}-01`,
      }),
    ]);

    const createLotRes = await fetch(`${nextBaseUrl()}/api/v1/lots`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${weighToken}`,
      },
      body: JSON.stringify({
        vesselId: `VES-${hotIso.tenantId}-01`,
        speciesId: hotIso.speciesId,
        totalBoxes: 10,
        netGrams: '400000',
        coreTempC: 1.5,
        weightSource: 'BLE_SCALE',
      }),
    });
    assert.equal(createLotRes.status, 201, `Hot lot creation failed (${createLotRes.status})`);
    const hotLot = (await createLotRes.json()) as { lotId: string };

    const inspectRes = await fetch(`${nextBaseUrl()}/api/v1/lots/${hotLot.lotId}/inspect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${inspToken}`,
      },
      body: JSON.stringify({ grade: 'A_EXPORT', coreTempC: 1.5, notes: 'Load test hot lot ready' }),
    });
    assert.equal(inspectRes.status, 200, `Hot lot inspection failed (${inspectRes.status})`);

    const s1Concurrency = 200;
    const s1Latencies: number[] = [];
    let s1Success = 0;
    let s1Rejected4xx = 0;
    let s1Status5xx = 0;
    const s1Start = performance.now();

    await Promise.all(
      Array.from({ length: s1Concurrency }, async (_, idx) => {
        const target = targetUrls[idx % targetUrls.length]!;
        const t0 = performance.now();
        try {
          const res = await fetch(`${target}/api/v1/lots/${hotLot.lotId}/allocate`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${auctToken}`,
              'Idempotency-Key': `HOT-LOAD-${hotLot.lotId}-${idx}`,
            },
            body: JSON.stringify({
              sessionId: hotIso.sessionId,
              auctionMode: 'PHYSICAL_SHOUT',
              auctioneerLicenceId: `LIC-${hotIso.tenantId}-01`,
              buyerId: hotIso.buyerId,
              boxesAllocated: 1,
              pricePerKgPaise: '50000',
              fencingToken: 1,
            }),
          });
          const dt = performance.now() - t0;
          s1Latencies.push(dt);
          allLatencies.push(dt);
          if (res.status === 201) s1Success += 1;
          else if (res.status >= 500) {
            s1Status5xx += 1;
            total5xx += 1;
          } else {
            s1Rejected4xx += 1;
          }
        } catch {
          s1Status5xx += 1;
          total5xx += 1;
        }
      })
    );

    const s1DurationSec = (performance.now() - s1Start) / 1000;
    const allocSumRes = await platformDb.query<{ sum_boxes: string; cnt: string }>(
      `SELECT COALESCE(SUM(boxes_allocated), 0)::text AS sum_boxes, COUNT(*)::text AS cnt
       FROM auction.sale_allocations WHERE lot_id = $1`,
      [hotLot.lotId]
    );
    const sumBoxes = Number(allocSumRes.rows[0]?.sum_boxes ?? 0);
    const zeroOversellVerified = sumBoxes === 10 && s1Success === 10;

    console.log(
      `[Scenario 1/3] Hot Lot: ${sumBoxes}/10 boxes allocated (201=${s1Success}, 4xx=${s1Rejected4xx}, 5xx=${s1Status5xx}, p95=${computePercentiles(s1Latencies).p95}ms)`
    );

    scenarioResults.push({
      scenarioName: 'Hot Lot 200 Concurrent Allocations (2 Web Instances)',
      totalOperations: s1Concurrency,
      successfulOperations: s1Success,
      failedOperations: s1Rejected4xx + s1Status5xx,
      status5xx: s1Status5xx,
      durationSeconds: Number(s1DurationSec.toFixed(2)),
      throughputOpsSec: Number((s1Concurrency / Math.max(0.01, s1DurationSec)).toFixed(1)),
      latenciesMs: computePercentiles(s1Latencies),
      details: {
        totalInitialBoxes: 10,
        totalAllocatedBoxes: sumBoxes,
        zeroOversellVerified,
      },
    });

    // ------------------------------------------------------------------------
    // Scenario 2: Sustained Mixed Read/Write Load for Full Duration (60s in CI)
    // ------------------------------------------------------------------------
    const sustainedSec = Math.max(3, durationSecTarget - Math.ceil(s1DurationSec));
    console.log(
      `\n[Scenario 2/3] Sustained Mixed R/W Load Across ${targetUrls.length} Web Processes for ${sustainedSec}s...`
    );

    const rwIso = await createIsolatedTenant(platformDb, 'rwload');
    touchedTenants.add(rwIso.tenantId);

    const rwWeigh = rwIso.users.find((u) => u.role === 'WEIGHING_OPERATOR')!;
    const rwAccountant = rwIso.users.find((u) => u.role === 'ACCOUNTANT')!;

    const [rwWeighToken, rwAcctToken] = await Promise.all([
      signAccessJwt({
        sub: rwWeigh.userId,
        tenantId: rwIso.tenantId,
        role: rwWeigh.role,
        fullName: rwWeigh.fullName,
        phoneE164: rwWeigh.phoneE164,
      }),
      signAccessJwt({
        sub: rwAccountant.userId,
        tenantId: rwIso.tenantId,
        role: rwAccountant.role,
        fullName: rwAccountant.fullName,
        phoneE164: rwAccountant.phoneE164,
      }),
    ]);

    const readEndpoints = [
      '/api/v1/lots?limit=25',
      '/api/v1/auth/profile',
      '/api/v1/bootstrap',
      '/api/v1/reports/daily-auction',
      '/healthz',
    ];

    const s2Latencies: number[] = [];
    let s2Success = 0;
    let s2Non5xxFail = 0;
    let s2Status5xx = 0;
    let s2Writes = 0;
    let s2Reads = 0;

    const s2Start = performance.now();
    const s2EndDeadline = s2Start + sustainedSec * 1000;
    const workerCount = 6;

    // Note: Keep per-IP request rate below the 600 req/min API edge limiter when all workers share 127.0.0.1,
    // by sending distinct X-Forwarded-For client IPs simulating real dockside terminals behind the LB.
    const workers = Array.from({ length: workerCount }, async (_, workerIdx) => {
      let iter = 0;
      const clientIp = `10.42.0.${10 + workerIdx}`;
      while (performance.now() < s2EndDeadline) {
        const baseUrl = nextBaseUrl();
        const isWrite = iter % 8 === 0;
        const t0 = performance.now();
        try {
          let res: Response;
          if (isWrite) {
            res = await fetch(`${baseUrl}/api/v1/lots`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${rwWeighToken}`,
                'x-forwarded-for': clientIp,
              },
              body: JSON.stringify({
                vesselId: `VES-${rwIso.tenantId}-01`,
                speciesId: rwIso.speciesId,
                totalBoxes: 4,
                netGrams: '160000',
                coreTempC: 1.9,
                weightSource: 'BLE_SCALE',
              }),
            });
            s2Writes += 1;
          } else {
            const ep = readEndpoints[iter % readEndpoints.length]!;
            res = await fetch(`${baseUrl}${ep}`, {
              headers: {
                authorization: `Bearer ${rwAcctToken}`,
                'x-forwarded-for': clientIp,
              },
            });
            s2Reads += 1;
          }
          const dt = performance.now() - t0;
          s2Latencies.push(dt);
          allLatencies.push(dt);
          if (res.status >= 200 && res.status < 400) {
            s2Success += 1;
          } else if (res.status >= 500) {
            s2Status5xx += 1;
            total5xx += 1;
          } else {
            s2Non5xxFail += 1;
          }
        } catch {
          s2Status5xx += 1;
          total5xx += 1;
        }
        iter += 1;
        // Pace lightly to stay realistic (~20-35 req/sec total across 6 terminals) and avoid artificial 429s
        await new Promise((r) => setTimeout(r, 120));
      }
    });

    await Promise.all(workers);
    const s2DurationSec = (performance.now() - s2Start) / 1000;
    const s2Total = s2Success + s2Non5xxFail + s2Status5xx;

    console.log(
      `[Scenario 2/3] Sustained R/W (${s2DurationSec.toFixed(1)}s): ${s2Total} ops (${s2Reads} reads, ${s2Writes} writes, 2xx=${s2Success}, 4xx=${s2Non5xxFail}, 5xx=${s2Status5xx}, p95=${computePercentiles(s2Latencies).p95}ms)`
    );

    scenarioResults.push({
      scenarioName: `Sustained Mixed R/W (${targetUrls.length} Web Processes)`,
      totalOperations: s2Total,
      successfulOperations: s2Success,
      failedOperations: s2Non5xxFail + s2Status5xx,
      status5xx: s2Status5xx,
      durationSeconds: Number(s2DurationSec.toFixed(2)),
      throughputOpsSec: Number((s2Total / Math.max(0.01, s2DurationSec)).toFixed(1)),
      latenciesMs: computePercentiles(s2Latencies),
      details: {
        reads: s2Reads,
        writes: s2Writes,
        non5xxErrors: s2Non5xxFail,
        workerCount,
      },
    });

    // ------------------------------------------------------------------------
    // Scenario 3: Post-Load Cryptographic Ledger Chain Verification
    // ------------------------------------------------------------------------
    console.log('\n[Scenario 3/3] Verifying SHA-256 Ledger Hash Chain on Touched Tenants...');
    const s3Start = performance.now();
    const verificationResults: Array<{ tenantId: string; verified: boolean; entryCount: number }> = [];
    for (const tid of touchedTenants) {
      const res = await runVerifyAllTenantLedgersJob(platformDb, tid);
      for (const r of res) {
        verificationResults.push({
          tenantId: r.tenantId,
          verified: r.verified,
          entryCount: r.entryCount,
        });
      }
    }
    const ledgerVerifyClean =
      verificationResults.length > 0 && verificationResults.every((r) => r.verified);
    const s3DurationSec = (performance.now() - s3Start) / 1000;

    console.log(
      `[Scenario 3/3] Ledger Verify: ${ledgerVerifyClean ? 'CLEAN' : 'FAILED'} across ${verificationResults.length} tenant(s): ${JSON.stringify(verificationResults)}`
    );

    scenarioResults.push({
      scenarioName: 'Post-Load Ledger Chain Verification',
      totalOperations: verificationResults.length,
      successfulOperations: verificationResults.filter((r) => r.verified).length,
      failedOperations: verificationResults.filter((r) => !r.verified).length,
      status5xx: 0,
      durationSeconds: Number(s3DurationSec.toFixed(2)),
      throughputOpsSec: Number(
        (verificationResults.length / Math.max(0.001, s3DurationSec)).toFixed(1)
      ),
      latenciesMs: { p50: Number((s3DurationSec * 1000).toFixed(2)), p95: Number((s3DurationSec * 1000).toFixed(2)), p99: Number((s3DurationSec * 1000).toFixed(2)), max: Number((s3DurationSec * 1000).toFixed(2)) },
      details: { verificationResults },
    });

    const overallPercentiles = computePercentiles(allLatencies);
    const overallPassed =
      total5xx === 0 &&
      overallPercentiles.p95 < p95LimitMs &&
      zeroOversellVerified &&
      ledgerVerifyClean;

    const overallResults: MultiScenarioLoadResults = {
      timestamp: new Date().toISOString(),
      targetUrls,
      durationSecondsTarget: durationSecTarget,
      total5xx,
      overallP95Ms: overallPercentiles.p95,
      zeroOversellVerified,
      ledgerVerifyClean,
      scenarios: scenarioResults,
      overallPassed,
    };

    const outDir = path.resolve(process.cwd(), 'docs');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'load-results.json'),
      JSON.stringify(overallResults, null, 2),
      'utf8'
    );

    console.log('\n=== Load Smoke Gate Summary ===');
    console.log(`- Overall p95 latency : ${overallPercentiles.p95}ms (limit < ${p95LimitMs}ms)`);
    console.log(`- Total 5xx responses : ${total5xx} (limit == 0)`);
    console.log(`- Hot-lot zero oversell: ${zeroOversellVerified ? 'PASS (10/10 boxes)' : 'FAIL'}`);
    console.log(`- Ledger verify clean : ${ledgerVerifyClean ? 'PASS' : 'FAIL'}`);

    assert.equal(total5xx, 0, `Load Gate FAILED: encountered ${total5xx} HTTP 5xx responses`);
    assert.ok(
      overallPercentiles.p95 < p95LimitMs,
      `Load Gate FAILED: overall p95 ${overallPercentiles.p95}ms >= ${p95LimitMs}ms`
    );
    assert.equal(zeroOversellVerified, true, 'Load Gate FAILED: hot lot oversell check failed');
    assert.equal(ledgerVerifyClean, true, 'Load Gate FAILED: ledger chain verification failed');

    return overallResults;
  } finally {
    for (const fn of cleanupFns) {
      await fn();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLoadScenarios()
    .then((res) => {
      console.log(
        `[load] Results saved to docs/load-results.json (status: ${res.overallPassed ? 'GREEN' : 'RED'})`
      );
      process.exit(res.overallPassed ? 0 : 1);
    })
    .catch((err: unknown) => {
      console.error('[load] Load smoke gate FAILED:', err);
      process.exit(1);
    });
}
