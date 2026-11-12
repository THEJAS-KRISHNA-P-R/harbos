import crypto from 'node:crypto';
import type { DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import {
  claimIdempotencyKeyInTx,
  completeIdempotencyKeyInTx,
  lockExistingIdempotencyKeyInTx,
} from '@server/modules/platform/index.ts';

export function computeCanonicalRequestHash(payload: unknown): string {
  const canonical =
    payload === undefined || payload === null
      ? ''
      : typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export interface IdempotentExecutionResult<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

/**
 * Phase 2.3: Multi-instance database-backed idempotency using `core.idempotency_keys`.
 * Works inside the caller's tenant-scoped transaction (`tx`).
 */
export async function executeWithDbIdempotency<T extends Record<string, unknown>>(
  tx: DbPort,
  params: {
    tenantId: string;
    scope: string;
    key: string;
    requestHash: string;
    defaultStatus?: number;
    ttlHours?: number;
  },
  work: () => Promise<{ status?: number; body: T }>
): Promise<IdempotentExecutionResult<T>> {
  const cleanKey = params.key.trim();
  if (!cleanKey) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Idempotency-Key is required for ${params.scope}`,
      400
    );
  }

  const ttlHours = params.ttlHours ?? 24;
  const expiresAtIso = new Date(Date.now() + ttlHours * 3600_000).toISOString();

  const claimed = await claimIdempotencyKeyInTx(tx, {
    tenantId: params.tenantId,
    scope: params.scope,
    key: cleanKey,
    requestHash: params.requestHash,
    expiresAtIso,
  });

  if (!claimed) {
    const existing = await lockExistingIdempotencyKeyInTx<T>(tx, {
      tenantId: params.tenantId,
      scope: params.scope,
      key: cleanKey,
    });

    if (existing) {
      if (existing.request_hash !== params.requestHash) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          `Idempotency-Key "${cleanKey}" was already used with different request parameters in scope ${params.scope}.`,
          422
        );
      }

      if (existing.state === 'DONE' && existing.response_body !== null) {
        const parsedBody =
          typeof existing.response_body === 'string'
            ? (JSON.parse(existing.response_body) as T)
            : existing.response_body;
        return {
          status: existing.response_status ?? 200,
          body: {
            ...parsedBody,
            idempotentReplay: true,
          } as T,
          replayed: true,
        };
      }
    }
  }

  const outcome = await work();
  const status = outcome.status ?? params.defaultStatus ?? 200;

  await completeIdempotencyKeyInTx(tx, {
    tenantId: params.tenantId,
    scope: params.scope,
    key: cleanKey,
    status,
    responseBodyJson: JSON.stringify(outcome.body),
  });

  return {
    status,
    body: outcome.body,
    replayed: false,
  };
}
