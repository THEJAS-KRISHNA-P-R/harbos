import type { DbPort } from '@server/ports/db.ts';
import type { InspectionGrade } from '@shared/ids.ts';

export async function fetchLotsKeysetPage(
  db: DbPort,
  params: {
    tenantId: string;
    limitPlusOne: number;
    cursor?: { ts: string; id: string } | null | undefined;
    status?: string | undefined;
  }
) {
  if (params.cursor && params.status) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM auction.lots
       WHERE tenant_id = $1 AND status = $2
         AND (created_at, lot_id) < ($3::timestamptz, $4)
       ORDER BY created_at DESC, lot_id DESC
       LIMIT $5`,
      [
        params.tenantId,
        params.status,
        params.cursor.ts,
        params.cursor.id,
        params.limitPlusOne,
      ]
    );
    return res.rows;
  }
  if (params.cursor) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM auction.lots
       WHERE tenant_id = $1
         AND (created_at, lot_id) < ($2::timestamptz, $3)
       ORDER BY created_at DESC, lot_id DESC
       LIMIT $4`,
      [params.tenantId, params.cursor.ts, params.cursor.id, params.limitPlusOne]
    );
    return res.rows;
  }
  if (params.status) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM auction.lots
       WHERE tenant_id = $1 AND status = $2
       ORDER BY created_at DESC, lot_id DESC
       LIMIT $3`,
      [params.tenantId, params.status, params.limitPlusOne]
    );
    return res.rows;
  }
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM auction.lots
     WHERE tenant_id = $1
     ORDER BY created_at DESC, lot_id DESC
     LIMIT $2`,
    [params.tenantId, params.limitPlusOne]
  );
  return res.rows;
}

export async function fetchSupervisorPinsInTx(tx: DbPort, tenantId: string) {
  const res = await tx.query<{
    pin_code: string | null;
    supervisor_pin_hash: string | null;
  }>(
    `SELECT pin_code, supervisor_pin_hash
     FROM core.users
     WHERE tenant_id = $1 AND role IN ('WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN') AND is_active = true`,
    [tenantId]
  );
  return res.rows;
}

export async function fetchVesselOwnerInTx(
  tx: DbPort,
  tenantId: string,
  vesselId: string
) {
  const res = await tx.query<{ owner_fisherman_id: string }>(
    `SELECT owner_fisherman_id FROM harbour.vessels WHERE vessel_id = $1 AND tenant_id = $2`,
    [vesselId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function countTenantLotsInTx(
  tx: DbPort,
  tenantId: string
): Promise<number> {
  const res = await tx.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM auction.lots WHERE tenant_id = $1`,
    [tenantId]
  );
  return res.rows[0]?.cnt ?? 0;
}

export async function insertWeighedLotInTx(
  tx: DbPort,
  params: {
    lotId: string;
    tenantId: string;
    lotCode: string;
    vesselId: string;
    fishermanId: string;
    speciesId: string;
    totalBoxes: number;
    netGrams: string;
    coreTempC: number;
    weighedByUserId: string;
    weightSource: 'MANUAL' | 'BLE_SCALE';
    qrSignature: string;
    nowIso: string;
    inspectionNotes?: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO auction.lots (
      lot_id, tenant_id, lot_code, vessel_id, fisherman_id, species_id,
      sale_unit_type, total_boxes, available_boxes, net_grams, available_grams,
      core_temp_c, inspection_grade, inspection_notes, inspected_by_user_id, weighed_by_user_id,
      weight_source, qr_signature, status, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      'BOX', $7, $7, $8, $8,
      $9, NULL, $10, NULL, $11,
      $12, $13, 'WEIGHED_PENDING_INSPECTION', $14
    )`,
    [
      params.lotId,
      params.tenantId,
      params.lotCode,
      params.vesselId,
      params.fishermanId,
      params.speciesId,
      params.totalBoxes,
      params.netGrams,
      params.coreTempC,
      params.inspectionNotes ??
        'Weighed at dockside terminal; awaiting quality inspection',
      params.weighedByUserId,
      params.weightSource,
      params.qrSignature,
      params.nowIso,
    ]
  );
}

export async function lockLotForInspectionInTx(
  tx: DbPort,
  tenantId: string,
  lotId: string
) {
  const res = await tx.query<{
    lot_id: string;
    lot_code: string;
    status: string;
    weighed_by_user_id: string | null;
  }>(
    `SELECT lot_id, lot_code, status, weighed_by_user_id
     FROM auction.lots
     WHERE lot_id = $1 AND tenant_id = $2
     FOR UPDATE`,
    [lotId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function countLotAllocationsInTx(
  tx: DbPort,
  tenantId: string,
  lotId: string
): Promise<number> {
  const res = await tx.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM auction.sale_allocations WHERE lot_id = $1 AND tenant_id = $2`,
    [lotId, tenantId]
  );
  return res.rows[0]?.cnt ?? 0;
}

export async function updateLotInspectionInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    lotId: string;
    grade: InspectionGrade;
    coreTempC: number;
    notes: string;
    inspectedByUserId: string;
    newStatus: string;
  }
) {
  const res = await tx.query<{ lot_id: string; status: string }>(
    `UPDATE auction.lots
     SET inspection_grade = $1, core_temp_c = $2, inspection_notes = $3,
         inspected_by_user_id = $4, status = $5
     WHERE lot_id = $6 AND tenant_id = $7
     RETURNING lot_id, status`,
    [
      params.grade,
      params.coreTempC,
      params.notes,
      params.inspectedByUserId,
      params.newStatus,
      params.lotId,
      params.tenantId,
    ]
  );
  return res.rows[0]!;
}
