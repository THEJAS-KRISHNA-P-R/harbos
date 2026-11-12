import crypto from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@server/platform/errors.ts';

export const KeysetQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export interface KeysetCursor {
  readonly ts: string;
  readonly createdAt: string;
  readonly id: string;
}

export interface KeysetPage<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}

export function normalizeKeysetLimit(
  rawLimit: number | string | undefined,
  defaultLimit = 50,
  maxLimit = 200
): number {
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    return defaultLimit;
  }
  const n = typeof rawLimit === 'number' ? rawLimit : Number(rawLimit);
  if (!Number.isFinite(n) || n < 1) {
    return defaultLimit;
  }
  return Math.min(Math.floor(n), maxLimit);
}

export function encodeKeysetCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt, i: id }), 'utf8').toString(
    'base64url'
  );
}

export function decodeKeysetCursor(
  rawCursor: string | undefined
): KeysetCursor | null {
  if (!rawCursor || !rawCursor.trim()) {
    return null;
  }
  try {
    const json = Buffer.from(rawCursor.trim(), 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as { c?: unknown; ts?: unknown; i?: unknown; id?: unknown };
    const tsVal = typeof parsed.c === 'string' ? parsed.c : typeof parsed.ts === 'string' ? parsed.ts : '';
    const idVal = typeof parsed.i === 'string' ? parsed.i : typeof parsed.id === 'string' ? parsed.id : '';
    if (tsVal.length > 0 && idVal.length > 0) {
      return { ts: tsVal, createdAt: tsVal, id: idVal };
    }
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Malformed pagination cursor', 400);
  }
  throw new AppError('VALIDATION_ERROR', 'Malformed pagination cursor', 400);
}

export function buildKeysetPage<T>(
  rowsLimitPlusOne: ReadonlyArray<T>,
  limit: number,
  getCreatedAt: (row: T) => string,
  getId: (row: T) => string
): KeysetPage<T> {
  if (rowsLimitPlusOne.length <= limit) {
    return {
      items: rowsLimitPlusOne,
      nextCursor: null,
    };
  }
  const items = rowsLimitPlusOne.slice(0, limit);
  const lastItem = items[items.length - 1]!;
  return {
    items,
    nextCursor: encodeKeysetCursor(getCreatedAt(lastItem), getId(lastItem)),
  };
}

export function computeListEtag(payload: unknown): string {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('base64url')
    .slice(0, 24);
  return `W/"${digest}"`;
}
