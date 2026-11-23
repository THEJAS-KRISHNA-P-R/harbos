import { createServer } from 'node:http';
import { config } from '@server/config.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { createDefaultSmsAdapter } from '@server/adapters/sms-msg91.ts';
import { logger } from '@server/platform/logger.ts';
import { processOutboxBatchOnce } from '@server/modules/notifications/index.ts';

export async function startOutboxWorker(options?: {
  pollIntervalMs?: number;
  once?: boolean;
}): Promise<void> {
  const dbUrl = config.DATABASE_PLATFORM_URL || config.DATABASE_URL;
  const platformDb = dbUrl
    ? new PgPoolAdapter(dbUrl)
    : new PGliteAdapter('memory://');
  const smsAdapter = createDefaultSmsAdapter();
  const pollIntervalMs = options?.pollIntervalMs ?? 2_000;

  let stopping = false;
  const stop = (signal: string) => {
    logger.info(`Outbox worker received ${signal}, stopping after current batch`);
    stopping = true;
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  logger.info('HarbourOS outbox worker started', {
    smsProvider: config.SMS_PROVIDER,
    pollIntervalMs,
  });

  try {
    while (!stopping) {
      const stats = await processOutboxBatchOnce(platformDb, smsAdapter);
      if (stats.claimed > 0) {
        logger.info('Processed outbox batch', stats);
      }
      if (options?.once) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } finally {
    if (platformDb.close) {
      await platformDb.close();
    }
  }
}

/**
 * Cloud Run requires every Service container to listen on $PORT. The worker has no API, so expose a
 * minimal liveness endpoint. unref() so it never keeps the process alive after a graceful SIGTERM.
 */
export function startWorkerHealthServer(port: number): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const ok = req.url === '/healthz' || req.url === '/readyz';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'not_found', service: 'harbouros-worker' }));
  });
  server.on('error', (err: Error) => {
    // Never crash the delivery loop over the health listener (e.g. port taken in local dev).
    logger.warn('Worker health listener could not bind', { port, error: err.message });
  });
  server.listen(port, '0.0.0.0');
  server.unref();
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const once = process.argv.includes('--once');
  if (!once) {
    startWorkerHealthServer(config.PORT);
  }
  startOutboxWorker({ once }).catch((err: unknown) => {
    logger.error('Outbox worker fatal error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
