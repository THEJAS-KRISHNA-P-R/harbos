import type { DbPort } from '@server/ports/db.ts';

export async function findClientCommandInTx(
  tx: DbPort,
  tenantId: string,
  commandId: string
) {
  const res = await tx.query<{
    status: string;
    result_ref_id: string | null;
  }>(
    `SELECT status, result_ref_id FROM sync.client_commands WHERE command_id = $1 AND tenant_id = $2`,
    [commandId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function insertClientCommandInTx(
  tx: DbPort,
  params: {
    commandId: string;
    tenantId: string;
    deviceId: string;
    resultRefId: string;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO sync.client_commands (command_id, tenant_id, device_id, command_type, status, result_ref_id, created_at)
     VALUES ($1, $2, $3, 'TAG_LOT', 'APPLIED', $4, $5)`,
    [
      params.commandId,
      params.tenantId,
      params.deviceId,
      params.resultRefId,
      params.nowIso,
    ]
  );
}
