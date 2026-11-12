import type { DbPort } from '@server/ports/db.ts';

export async function fetchAllocationsKeysetPage(
  db: DbPort,
  params: {
    tenantId: string;
    limitPlusOne: number;
    cursor?: { ts: string; id: string } | null;
  }
) {
  if (params.cursor) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM auction.sale_allocations
       WHERE tenant_id = $1
         AND (created_at, allocation_id) < ($2::timestamptz, $3)
       ORDER BY created_at DESC, allocation_id DESC
       LIMIT $4`,
      [params.tenantId, params.cursor.ts, params.cursor.id, params.limitPlusOne]
    );
    return res.rows;
  }
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM auction.sale_allocations
     WHERE tenant_id = $1
     ORDER BY created_at DESC, allocation_id DESC
     LIMIT $2`,
    [params.tenantId, params.limitPlusOne]
  );
  return res.rows;
}
