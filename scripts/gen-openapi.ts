import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createApiApp } from '../src/server/app.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import {
  getRegisteredRoutes,
  resetRegisteredRoutes,
} from '../src/server/platform/http-route.ts';
import { ROUTE_RBAC_MATRIX } from '../src/shared/contracts/rbac.ts';

function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function safeJsonSchema(schema?: z.ZodType<unknown>): Record<string, unknown> {
  if (!schema) {
    return { type: 'object' };
  }
  try {
    const out = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<
      string,
      unknown
    >;
    delete out.$schema;
    return out;
  } catch {
    return { type: 'object' };
  }
}

async function main() {
  resetRegisteredRoutes();
  const dummyDb = new PGliteAdapter('memory://');
  createApiApp(dummyDb);
  const routes = getRegisteredRoutes();

  if (routes.length !== ROUTE_RBAC_MATRIX.length) {
    const registeredKeys = new Set(
      routes.map((r) => `${r.method} ${r.path}`)
    );
    const missingFromApp = ROUTE_RBAC_MATRIX.filter(
      (m) => !registeredKeys.has(`${m.method} ${m.pattern}`)
    );
    if (missingFromApp.length > 0) {
      throw new Error(
        `OpenAPI generation failed: ROUTE_RBAC_MATRIX contains routes not mounted in app: ${missingFromApp
          .map((m) => `${m.method} ${m.pattern}`)
          .join(', ')}`
      );
    }
  }

  const paths: Record<string, Record<string, unknown>> = {};

  for (const decl of routes) {
    const oaPath = toOpenApiPath(decl.path);
    if (!paths[oaPath]) {
      paths[oaPath] = {};
    }
    const methodLower = decl.method.toLowerCase();
    const operation: Record<string, unknown> = {
      summary: decl.summary ?? `${decl.method} ${decl.path}`,
      tags: decl.tags ?? ['harbouros'],
      security: decl.roles === 'PUBLIC' ? [] : [{ bearerAuth: [] }],
      'x-rbac-roles': decl.roles,
      ...(decl.idempotent ? { 'x-idempotency': decl.idempotent } : {}),
      ...(decl.audit ? { 'x-audit-code': decl.audit } : {}),
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: safeJsonSchema(decl.response),
            },
          },
        },
      },
    };

    if (decl.method !== 'GET' && decl.body) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: safeJsonSchema(decl.body),
          },
        },
      };
    }

    paths[oaPath]![methodLower] = operation;
  }

  const openApiSpec = {
    openapi: '3.1.0',
    info: {
      title: 'HarbourOS Statutory Clearing & Auction Monolith API',
      version: '1.0.0-pilot',
      description:
        'Generated directly from declarative Zod route schemas (src/server/modules/**/routes.ts) and ROUTE_RBAC_MATRIX (src/shared/contracts/rbac.ts).',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    paths,
  };

  const outPath = path.resolve(process.cwd(), 'docs/openapi.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const serialized = `${JSON.stringify(openApiSpec, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    if (!fs.existsSync(outPath)) {
      console.error('docs/openapi.json does not exist. Run npm run gen:openapi');
      process.exit(1);
    }
    const existing = fs.readFileSync(outPath, 'utf8');
    if (existing !== serialized) {
      console.error(
        'docs/openapi.json is out of sync with route declarations. Run npm run gen:openapi'
      );
      process.exit(1);
    }
    console.log(
      `OpenAPI 3.1 check PASSED (${routes.length} routes verified against docs/openapi.json).`
    );
  } else {
    fs.writeFileSync(outPath, serialized, 'utf8');
    console.log(
      `Generated docs/openapi.json (${routes.length} routes, ${Buffer.byteLength(serialized)} bytes).`
    );
  }

  if (dummyDb.close) await dummyDb.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
