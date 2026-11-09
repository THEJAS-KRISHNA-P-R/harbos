import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiApp } from '@server/app.ts';
import { config } from '@server/config.ts';
import type { DbPort } from '@server/ports/db.ts';
import { PGliteAdapter } from '@server/adapters/db-pglite.ts';
import { PgPoolAdapter } from '@server/adapters/db-pg.ts';
import { runCatchPhotoAssist } from '@server/adapters/llm-gemini.ts';
import { runMigrationsAndSeed } from '@server/platform/seed.ts';
import { logger } from '@server/platform/logger.ts';

const PG_BRIDGE_PORT = 5433;
const GO_BACKEND_PORT = 8080;
const GO_BIN_PATH = '/tmp/harbouros-go-api';
const GO_COMPILER_PATH = '/tmp/go/bin/go';

function startPostgresBridgeServer(db: DbPort): Promise<http.Server> {
  return new Promise((resolve) => {
    const bridgeApp = express();
    bridgeApp.use(express.json({ limit: '5mb' }));

    bridgeApp.post('/internal/pg-exec', async (req: Request, res: Response) => {
      const { op, sql, params } = req.body as {
        op?: 'query' | 'exec';
        sql?: string;
        params?: unknown[];
      };
      if (!sql) {
        res.status(400).json({ error: 'sql is required' });
        return;
      }
      try {
        if (op === 'exec') {
          await db.exec(sql);
          res.status(200).json({ rows: [] });
          return;
        }
        const qRes = await db.query(sql, Array.isArray(params) ? params : []);
        res.status(200).json({ rows: qRes.rows });
      } catch (err) {
        res.status(422).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // High-throughput multi-query batch endpoint for Go 1.23 single-roundtrip reads
    bridgeApp.post('/internal/pg-batch', async (req: Request, res: Response) => {
      const { queries } = req.body as {
        queries?: Array<{ sql?: string; params?: unknown[] }>;
      };
      if (!Array.isArray(queries) || queries.length === 0) {
        res.status(400).json({ error: 'queries array is required' });
        return;
      }
      try {
        const results: Array<{ rows: readonly unknown[] }> = [];
        for (const q of queries) {
          if (!q?.sql) {
            results.push({ rows: [] });
            continue;
          }
          const qRes = await db.query(q.sql, Array.isArray(q.params) ? q.params : []);
          results.push({ rows: qRes.rows });
        }
        res.status(200).json({ results });
      } catch (err) {
        res.status(422).json({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    const srv = bridgeApp.listen(PG_BRIDGE_PORT, '127.0.0.1', () => {
      logger.info('PostgreSQL SQL execution bridge active for Go backend', {
        bridgePort: PG_BRIDGE_PORT,
      });
      resolve(srv);
    });
  });
}

async function ensureAndSpawnGoBackend(): Promise<ChildProcess | null> {
  try {
    try {
      execSync('pkill -9 -f harbouros-go-api || true', { stdio: 'ignore' });
    } catch {
      // ignore if no process existed
    }

    if (fs.existsSync(GO_COMPILER_PATH)) {
      execSync(
        `${GO_COMPILER_PATH} -C backend-go build -o ${GO_BIN_PATH} ./cmd/harbouros-api`,
        { stdio: 'inherit' }
      );
    }
    if (!fs.existsSync(GO_BIN_PATH)) {
      return null;
    }

    const child = spawn(GO_BIN_PATH, [], {
      cwd: process.cwd(),
      env: {
        ...{
          PATH: '/usr/local/bin:/usr/bin:/bin:/tmp/go/bin',
          GO_BACKEND_PORT: String(GO_BACKEND_PORT),
          PG_BRIDGE_URL: `http://127.0.0.1:${PG_BRIDGE_PORT}`,
          JWT_ACCESS_SECRET: config.JWT_ACCESS_SECRET,
          QR_HMAC_SECRET: config.QR_HMAC_SECRET,
          OTP_DEV_ECHO: String(config.OTP_DEV_ECHO),
          DEMO_MODE: String(config.DEMO_MODE),
          WORKSPACE_ROOT: process.cwd(),
          MIGRATIONS_DIR: path.resolve(process.cwd(), 'db/migrations'),
        },
      },
      stdio: 'inherit',
    });

    const cleanup = (): void => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('exit', cleanup);

    // Wait up to 3 seconds for Go backend to listen on 127.0.0.1:8080
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const ready = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://127.0.0.1:${GO_BACKEND_PORT}/api/health`, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
      });
      if (ready) {
        logger.info('Go 1.23 backend process verified healthy and serving /api/*', {
          goPort: GO_BACKEND_PORT,
        });
        return child;
      }
    }
    return child;
  } catch (err) {
    logger.error('Failed to spawn Go backend binary, falling back to in-process router', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function startServer(): Promise<void> {
  const db = config.DATABASE_URL
    ? new PgPoolAdapter(config.DATABASE_URL)
    : new PGliteAdapter('memory://');
  await runMigrationsAndSeed(db);

  await startPostgresBridgeServer(db);
  const goProc = await ensureAndSpawnGoBackend();

  const fallbackApiApp = createApiApp(db, runCatchPhotoAssist);
  const app = express();

  const goKeepAliveAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 256,
    maxFreeSockets: 128,
    keepAliveMsecs: 30000,
  });

  // Proxy all /api/* requests to the live Go 1.23 backend when active
  app.use((req, res, next) => {
    if (!req.url.startsWith('/api/') || !goProc) {
      next();
      return;
    }

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: GO_BACKEND_PORT,
        path: req.originalUrl,
        method: req.method,
        agent: goKeepAliveAgent,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${GO_BACKEND_PORT}`,
        },
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode ?? 200);
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v !== undefined) {
            res.setHeader(k, v);
          }
        }
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', () => {
      // Transparently fall back if Go process is restarting
      fallbackApiApp(req, res, next);
    });

    req.pipe(proxyReq);
  });

  // Fallback API routes
  app.use(fallbackApiApp);

  if (config.NODE_ENV !== 'production') {
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

  app.listen(config.PORT, '0.0.0.0', () => {
    logger.info('HarbourOS server booted with Go 1.23 backend & PostgreSQL 16 engine', {
      port: config.PORT,
      goBackendActive: Boolean(goProc),
      env: config.NODE_ENV,
      demoMode: config.DEMO_MODE,
    });
  });
}

startServer().catch((err: unknown) => {
  logger.error('Failed to boot HarbourOS server', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
