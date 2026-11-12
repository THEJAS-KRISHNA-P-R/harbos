import type { DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import type { AuthSessionClaims } from '@server/platform/auth.ts';
import { executeWithDbIdempotency } from '@server/platform/idempotency.ts';
import {
  buildKeysetPage,
  decodeKeysetCursor,
  normalizeKeysetLimit,
  type KeysetPage,
} from '@server/platform/pagination.ts';
import {
  allocateLotSale,
  computeAllocationRequestHash,
  invalidateLedgerAuditSqlLruCache,
} from '@server/modules/ledger/index.ts';
import type { AuctionMode } from '@shared/ids.ts';
import { fetchAllocationsKeysetPage } from './repo.ts';

export async function listAllocationsKeyset(
  db: DbPort,
  params: {
    tenantId: string;
    cursor?: string | undefined;
    limit?: number | undefined;
  }
): Promise<KeysetPage<Record<string, unknown>>> {
  const limit = normalizeKeysetLimit(params.limit, 50, 200);
  const cursor = params.cursor ? decodeKeysetCursor(params.cursor) : null;
  const rows = await fetchAllocationsKeysetPage(db, {
    tenantId: params.tenantId,
    limitPlusOne: limit + 1,
    cursor,
  });
  return buildKeysetPage(
    rows,
    limit,
    (r) => String(r.created_at),
    (r) => String(r.allocation_id)
  );
}

export async function executeLotAllocation(
  db: DbPort,
  claims: AuthSessionClaims,
  lotId: string,
  idempotencyKey: string,
  input: {
    sessionId: string;
    auctionMode: AuctionMode;
    auctioneerLicenceId: string;
    buyerId: string;
    boxesAllocated?: number | undefined;
    boxesRequested?: number | undefined;
    pricePerKgPaise: number | string;
    fencingToken: number;
    governmentPermissionRef?: string | undefined;
  }
) {
  if (
    claims.role === 'LICENSED_AUCTIONEER' &&
    claims.entityRefId &&
    claims.entityRefId !== input.auctioneerLicenceId
  ) {
    throw new AppError(
      'FORBIDDEN',
      `Licensed auctioneer (${claims.sub}) is bound to licence ${claims.entityRefId} and cannot impersonate licence ${input.auctioneerLicenceId}.`,
      403
    );
  }

  const boxesRequested = input.boxesAllocated ?? input.boxesRequested ?? 0;
  const pricePerKgPaise = BigInt(input.pricePerKgPaise);
  const requestHash = computeAllocationRequestHash({
    lotId,
    sessionId: input.sessionId,
    auctionMode: input.auctionMode,
    auctioneerLicenceId: input.auctioneerLicenceId,
    buyerId: input.buyerId,
    boxesRequested,
    pricePerKgPaise,
  });

  const idemOutcome = await db.transaction((tx) =>
    executeWithDbIdempotency(
      tx,
      {
        tenantId: claims.tenantId,
        scope: 'ALLOCATE_LOT_SALE',
        key: idempotencyKey,
        requestHash,
        defaultStatus: 201,
      },
      async () => {
        const result = await allocateLotSale(tx, {
          tenantId: claims.tenantId,
          lotId,
          sessionId: input.sessionId,
          auctionMode: input.auctionMode,
          auctioneerLicenceId: input.auctioneerLicenceId,
          buyerId: input.buyerId,
          boxesRequested,
          pricePerKgPaise,
          idempotencyKey,
          fencingToken: input.fencingToken,
          ...(input.governmentPermissionRef
            ? { governmentPermissionRef: input.governmentPermissionRef }
            : {}),
          nowIso: new Date().toISOString(),
        });
        return {
          status: result.idempotentReplay ? 200 : 201,
          body: result as Record<string, unknown> & typeof result,
        };
      }
    )
  );

  invalidateLedgerAuditSqlLruCache(claims.tenantId);
  return {
    status: idemOutcome.replayed ? 200 : idemOutcome.status,
    body: idemOutcome.body,
  };
}
