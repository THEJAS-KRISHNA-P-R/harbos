import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createApiApp } from '../src/server/app.ts';
import { signAccessJwt } from '../src/server/platform/auth.ts';
import { DEMO_TENANT_ID } from '../src/server/platform/seed.ts';
import { bootstrapTestDatabase } from '../tests/helpers/pg-bootstrap.ts';

export interface LoadTestMetrics {
  readonly timestamp: string;
  readonly totalRequests: number;
  readonly concurrency: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly durationSeconds: number;
  readonly rps: number;
  readonly latenciesMs: {
    readonly min: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
    readonly mean: number;
  };
  readonly endpointsTested: ReadonlyArray<string>;
}

/**
 * Phase 4.3 Load Testing Script:
 * Simulates concurrent dockside requests against the API,
 * records latency percentiles (p50, p95, p99), throughput (RPS),
 * and produces docs/load-results.json.
 */
export async function runLoadTest(options?: {
  readonly totalRequests?: number;
  readonly concurrency?: number;
}): Promise<LoadTestMetrics> {
  const totalRequests = options?.totalRequests ?? 1000;
  const concurrency = options?.concurrency ?? 20;

  const bootstrapped = await bootstrapTestDatabase();
  const db = bootstrapped.db;
  const platformDb = bootstrapped.platformDb;

  const app = createApiApp(db, undefined, platformDb, db);
  let server: http.Server;
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const accountantToken = await signAccessJwt({
    sub: 'USR-ACCT-01',
    tenantId: DEMO_TENANT_ID,
    role: 'ACCOUNTANT',
    fullName: 'Deepa Krishnan',
    phoneE164: '+919447000007',
  });

  const endpoints = [
    '/api/v1/lots',
    '/api/v1/auth/profile',
    '/healthz',
    '/readyz',
  ];

  const latencies: number[] = [];
  let successfulRequests = 0;
  let failedRequests = 0;

  const startTime = Date.now();
  let completed = 0;

  // Run in chunks of concurrency
  const runWorker = async () => {
    while (completed < totalRequests) {
      completed++;
      const ep = endpoints[completed % endpoints.length];
      const reqStart = Date.now();
      try {
        const res = await fetch(`${baseUrl}${ep}`, {
          headers: {
            Authorization: `Bearer ${accountantToken}`,
          },
        });
        const duration = Date.now() - reqStart;
        latencies.push(duration);
        if (res.status >= 200 && res.status < 400) {
          successfulRequests++;
        } else {
          failedRequests++;
        }
      } catch {
        failedRequests++;
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => runWorker());
  await Promise.all(workers);

  const totalTimeSeconds = Math.max(0.001, (Date.now() - startTime) / 1000);
  latencies.sort((a, b) => a - b);

  const getPercentile = (p: number) => {
    if (latencies.length === 0) return 0;
    const idx = Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length));
    return latencies[idx] ?? 0;
  };

  const sum = latencies.reduce((acc, val) => acc + val, 0);
  const mean = latencies.length > 0 ? Number((sum / latencies.length).toFixed(2)) : 0;

  const metrics: LoadTestMetrics = {
    timestamp: new Date().toISOString(),
    totalRequests,
    concurrency,
    successfulRequests,
    failedRequests,
    durationSeconds: Number(totalTimeSeconds.toFixed(2)),
    rps: Number((successfulRequests / totalTimeSeconds).toFixed(1)),
    latenciesMs: {
      min: latencies[0] ?? 0,
      p50: getPercentile(50),
      p95: getPercentile(95),
      p99: getPercentile(99),
      max: latencies[latencies.length - 1] ?? 0,
      mean,
    },
    endpointsTested: endpoints,
  };

  const outDir = path.resolve(process.cwd(), 'docs');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'load-results.json'), JSON.stringify(metrics, null, 2), 'utf8');

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await bootstrapped.close();

  return metrics;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLoadTest()
    .then((metrics) => {
      console.log('Load test completed successfully:');
      console.log(`Throughput: ${metrics.rps} req/sec`);
      console.log(`p50: ${metrics.latenciesMs.p50}ms, p95: ${metrics.latenciesMs.p95}ms, p99: ${metrics.latenciesMs.p99}ms`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Load test failed', err);
      process.exit(1);
    });
}
