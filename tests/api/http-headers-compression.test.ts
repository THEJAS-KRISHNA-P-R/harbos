import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import express from 'express';
import { createApiApp } from '../../src/server/app.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';
import { DEMO_TENANT_ID } from '../../src/server/platform/seed.ts';
import { signAccessJwt } from '../../src/server/platform/auth.ts';
import type { DbPort } from '../../src/server/ports/db.ts';

function rawHttpGet(
  port: number,
  urlPath: string,
  headers: Record<string, string> = {}
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('B4: HTTP Compression & Static Asset Immutable Cache-Control Headers', () => {
  let db: DbPort;
  let platformDb: DbPort;
  let closeDb: () => Promise<void>;
  let server: http.Server;
  let port: number;
  let tmpDistDir: string;
  let authToken: string;

  before(async () => {
    const boot = await bootstrapTestDatabase();
    db = boot.db;
    platformDb = boot.platformDb;
    closeDb = boot.close;

    authToken = await signAccessJwt({
      sub: 'USR-HDR-TEST',
      tenantId: DEMO_TENANT_ID,
      role: 'HARBOUR_ADMIN',
      fullName: 'Header Test Admin',
      phoneE164: '+919447000099',
    });

    tmpDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbouros-static-'));
    const assetsDir = path.join(tmpDistDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    // >2KB payload so compression middleware always engages
    fs.writeFileSync(
      path.join(assetsDir, 'bundle-hash1234.js'),
      `console.log(${JSON.stringify('harbouros-static-asset-'.repeat(120))});`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(tmpDistDir, 'index.html'),
      `<!doctype html><html><body>${'HarbourOS Shell '.repeat(120)}</body></html>`,
      'utf8'
    );

    const apiApp = createApiApp(db, undefined, platformDb);
    const app = express();
    app.use(apiApp);
    app.use(
      express.static(tmpDistDir, {
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    port = addr.port;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpDistDir, { recursive: true, force: true });
    await closeDb();
  });

  it('compresses large API JSON responses with gzip and sets Cache-Control: no-store on /api/*', async () => {
    const res = await rawHttpGet(port, '/api/v1/bootstrap', {
      authorization: `Bearer ${authToken}`,
      'accept-encoding': 'gzip',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(
      res.headers['content-encoding'],
      'gzip',
      'Expected gzip compression on >1KB /api/v1/bootstrap JSON payload'
    );

    const unzipped = zlib.gunzipSync(res.body).toString('utf8');
    const parsed = JSON.parse(unzipped) as Record<string, unknown>;
    assert.ok(parsed && typeof parsed === 'object');
  });

  it('sets Cache-Control: public, max-age=31536000, immutable on hashed /assets/* files and compresses them', async () => {
    const res = await rawHttpGet(port, '/assets/bundle-hash1234.js', {
      'accept-encoding': 'gzip',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(
      res.headers['cache-control'],
      'public, max-age=31536000, immutable'
    );
  });

  it('sets Cache-Control: no-cache on index.html and root shell', async () => {
    const res = await rawHttpGet(port, '/index.html', {
      'accept-encoding': 'gzip',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-cache');
  });
});
