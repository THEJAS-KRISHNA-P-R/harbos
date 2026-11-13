import crypto from 'node:crypto';
import { auditInTx, type DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { AppError } from '@server/platform/errors.ts';
import { defaultClock } from '@server/platform/clock.ts';
import type { AuthSessionClaims } from '@server/platform/auth.ts';
import { signLotQrPayload } from '@server/modules/ledger/index.ts';
import {
  fetchVesselOwnerInTx,
  getNextDailyLotSeqInTx,
  getTenantShortCodeInTx,
  insertWeighedLotInTx,
} from '@server/modules/lots/index.ts';
import {
  findClientCommandInTx,
  insertClientCommandInTx,
} from './repo.ts';

export async function processSyncCommands(
  db: DbPort,
  claims: AuthSessionClaims,
  rawCommands: ReadonlyArray<Record<string, unknown>>
) {
  if (rawCommands.length === 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'commands array with at least one command is required',
      400
    );
  }

  const tenantId = claims.tenantId;
  const results = await db.transaction(async (tx) => {
    const out: Array<{
      commandId: string;
      status: string;
      lotId?: string;
      lotCode?: string;
      lotStatus?: string;
      inspectionGrade?: string | null;
    }> = [];

    for (const cmd of rawCommands) {
      const commandId = String(cmd?.commandId ?? '').trim();
      const vesselId = String(cmd?.vesselId ?? '').trim();
      const speciesId = String(cmd?.speciesId ?? '').trim();
      const totalBoxes = Number(cmd?.totalBoxes ?? 0);
      let netGrams = 0n;
      try {
        netGrams = BigInt((cmd?.netGrams as string | number) ?? 0);
      } catch {
        netGrams = 0n;
      }

      if (
        !commandId ||
        !vesselId ||
        !speciesId ||
        !Number.isInteger(totalBoxes) ||
        totalBoxes <= 0 ||
        netGrams <= 0n
      ) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Each sync command requires commandId, vesselId, speciesId, totalBoxes > 0, and netGrams > 0',
          400
        );
      }

      const existing = await findClientCommandInTx(tx, tenantId, commandId);
      if (existing) {
        out.push({
          commandId,
          status: existing.status,
          ...(existing.result_ref_id ? { lotCode: existing.result_ref_id } : {}),
        });
        continue;
      }

      const vessel = await fetchVesselOwnerInTx(tx, tenantId, vesselId);
      if (!vessel) {
        throw new AppError(
          'NOT_FOUND',
          `Vessel ${vesselId} not found in tenant ${tenantId}`,
          404
        );
      }

      const shortCode = await getTenantShortCodeInTx(tx, tenantId);
      const dayCode = defaultClock.getKolkataDayCode(defaultClock.now());
      const seqNum = await getNextDailyLotSeqInTx(tx, tenantId, dayCode);
      const lotId = `LOT-${crypto.randomUUID()}`;
      const lotCode = `${shortCode}-${dayCode}-${String(seqNum).padStart(3, '0')}`;
      const qrSignature = signLotQrPayload(
        lotId,
        vesselId,
        netGrams,
        config.QR_HMAC_SECRET
      );
      const nowIso = defaultClock.nowIso();
      const weightSource: 'MANUAL' | 'BLE_SCALE' =
        cmd?.weightSource === 'MANUAL' ? 'MANUAL' : 'BLE_SCALE';

      await insertWeighedLotInTx(tx, {
        lotId,
        tenantId,
        lotCode,
        vesselId,
        fishermanId: vessel.owner_fisherman_id,
        speciesId,
        totalBoxes,
        netGrams: netGrams.toString(),
        coreTempC: 2.0,
        weighedByUserId: claims.sub,
        weightSource,
        qrSignature,
        nowIso,
        inspectionNotes:
          'Synced from offline dockside queue; awaiting inspection',
      });

      await insertClientCommandInTx(tx, {
        commandId,
        tenantId,
        deviceId: String(cmd.deviceId ?? 'TAB-WEIGH-01'),
        resultRefId: lotCode,
        nowIso,
      });

      await auditInTx(tx, {
        tenantId,
        actorUserId: claims.sub,
        actorRole: claims.role,
        actionCode: 'LOT_SYNCED_PENDING_INSPECTION',
        targetType: 'LOT',
        targetId: lotId,
        details: {
          commandId,
          lotCode,
          vesselId,
          speciesId,
          totalBoxes,
          netGrams: netGrams.toString(),
          status: 'WEIGHED_PENDING_INSPECTION',
        },
      });

      out.push({
        commandId,
        status: 'APPLIED',
        lotId,
        lotCode,
        lotStatus: 'WEIGHED_PENDING_INSPECTION',
        inspectionGrade: null,
      });
    }

    return out;
  });

  return { syncedCount: results.length, results };
}
