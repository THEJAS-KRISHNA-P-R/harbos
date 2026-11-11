import path from 'node:path';
import express from 'express';
import { createApiApp } from '@server/app.ts';
import { config } from '@server/config.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { runCatchPhotoAssist } from '@server/adapters/llm-gemini.ts';
import { runMigrationsAndSeed, verifySqlMigrations } from '@server/platform/seed.ts';
import { logger } from '@server/platform/logger.ts';

export async function startServer(): Promise<void> {
  if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
    throw new Error(
      'FATAL [main]: DATABASE_URL is required in production (PGlite is for development/test only).'
    );
  }

  const db = config.DATABASE_URL
    ? new PgPoolAdapter(config.DATABASE_URL)
    : new PGliteAdapter('memory://');

  const platformDb = config.DATABASE_PLATFORM_URL
    ? new PgPoolAdapter(config.DATABASE_PLATFORM_URL)
    : db;

  if (config.NODE_ENV === 'production' && !config.RUN_MIGRATIONS_ON_BOOT) {
    await verifySqlMigrations(platformDb);
  } else {
    await runMigrationsAndSeed(platformDb);
  }

  const apiApp = createApiApp(db, runCatchPhotoAssist, platformDb);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Mount the canonical TypeScript API application
  app.use(apiApp);

  if (config.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info('HarbourOS clearing monolith listening', {
      port: config.PORT,
      env: config.NODE_ENV,
      databaseDriver: config.DATABASE_URL ? 'pg-pool' : 'pglite',
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, initiating graceful shutdown`);
    server.close(() => {
      void (async () => {
        try {
          if (db.close) {
            await db.close();
          }
          if (platformDb !== db && platformDb.close) {
            await platformDb.close();
          }
        } catch (err) {
          logger.error('Error closing database adapter during shutdown', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        process.exit(0);
      })();
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err: unknown) => {
  logger.error('Failed to boot HarbourOS server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
