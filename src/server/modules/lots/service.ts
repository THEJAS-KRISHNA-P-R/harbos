import crypto from 'node:crypto';
import { auditInTx, type DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { AppError } from '@server/platform/errors.ts';
import {
  verifySupervisorPin,
  type AuthSessionClaims,
} from '@server/platform/auth.ts';
import {
  buildKeysetPage,
  decodeKeysetCursor,
  normalizeKeysetLimit,
  type KeysetPage,
} from '@server/platform/pagination.ts';
import { signLotQrPayload } from '@server/modules/ledger/index.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import type { InspectionGrade } from '@shared/ids.ts';
import { defaultClock, type Clock } from '@server/platform/clock.ts';
import {
  countLotAllocationsInTx,
  countTenantLotsInTx,
  fetchLotsKeysetPage,
  fetchSupervisorPinsInTx,
  fetchVesselOwnerInTx,
  getNextDailyLotSeqInTx,
  getTenantShortCodeInTx,
  insertWeighedLotInTx,
  lockLotForInspectionInTx,
  updateLotInspectionInTx,
} from './repo.ts';

export async function listLotsKeyset(
  db: DbPort,
  params: {
    tenantId: string;
    cursor?: string | undefined;
    limit?: number | undefined;
    status?: string | undefined;
  }
): Promise<KeysetPage<Record<string, unknown>>> {
  const limit = normalizeKeysetLimit(params.limit, 50, 200);
  const cursor = params.cursor ? decodeKeysetCursor(params.cursor) : null;
  const rows = await fetchLotsKeysetPage(db, {
    tenantId: params.tenantId,
    limitPlusOne: limit + 1,
    cursor,
    status: params.status,
  });
  return buildKeysetPage(
    rows,
    limit,
    (r) => String(r.created_at),
    (r) => String(r.lot_id)
  );
}

export async function createAndTagLot(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    vesselId?: string | undefined;
    speciesId?: string | undefined;
    totalBoxes?: number | undefined;
    netGrams?: number | string | undefined;
    coreTempC?: number | undefined;
    weightSource?: string | undefined;
    supervisorPin?: string | undefined;
  },
  clock: Clock = defaultClock
) {
  const tenantId = claims.tenantId;
  const vesselId = String(input.vesselId ?? '').trim();
  const speciesId = String(input.speciesId ?? '').trim();
  const totalBoxes = Number(input.totalBoxes ?? 0);
  let netGrams = 0n;
  try {
    netGrams = BigInt(input.netGrams ?? 0);
  } catch {
    netGrams = 0n;
  }
  const coreTempC = Number(input.coreTempC ?? 2.0);
  const rawWeightSource = String(input.weightSource ?? 'MANUAL').trim();
  const weightSource: 'MANUAL' | 'BLE_SCALE' =
    rawWeightSource === 'BLE_SCALE' ? 'BLE_SCALE' : 'MANUAL';
  const supervisorPin = String(input.supervisorPin ?? '');

  if (
    !vesselId ||
    !speciesId ||
    !Number.isInteger(totalBoxes) ||
    totalBoxes <= 0 ||
    netGrams <= 0n
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      'vesselId, speciesId, totalBoxes > 0, and netGrams > 0 are required',
      400
    );
  }

  return db.transaction(async (tx) => {
    if (weightSource === 'MANUAL') {
      const pinRows = await fetchSupervisorPinsInTx(tx, tenantId);
      const pinAuthorized = pinRows.some((r) =>
        verifySupervisorPin(supervisorPin, r.supervisor_pin_hash, r.pin_code)
      );
      if (!pinAuthorized) {
        throw new AppError(
          'FORBIDDEN',
          'Valid supervisor PIN required for manual scale weight override.',
          403
        );
      }
    }

    const vessel = await fetchVesselOwnerInTx(tx, tenantId, vesselId);
    if (!vessel) {
      throw new AppError(
        'NOT_FOUND',
        'Vessel not found in this harbour',
        404
      );
    }

    const shortCode = await getTenantShortCodeInTx(tx, tenantId);
    const dayCode = clock.getKolkataDayCode(clock.now());
    const seqNum = await getNextDailyLotSeqInTx(tx, tenantId, dayCode);
    const lotId = `LOT-${crypto.randomUUID()}`;
    const lotCode = `${shortCode}-${dayCode}-${String(seqNum).padStart(3, '0')}`;
    const qrSignature = signLotQrPayload(
      lotId,
      vesselId,
      netGrams,
      config.QR_HMAC_SECRET
    );
    const nowIso = clock.nowIso();

    await insertWeighedLotInTx(tx, {
      lotId,
      tenantId,
      lotCode,
      vesselId,
      fishermanId: vessel.owner_fisherman_id,
      speciesId,
      totalBoxes,
      netGrams: netGrams.toString(),
      coreTempC,
      weighedByUserId: claims.sub,
      weightSource,
      qrSignature,
      nowIso,
    });

    await auditInTx(tx, {
      tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'LOT_WEIGHED_AND_TAGGED',
      targetType: 'LOT',
      targetId: lotId,
      details: {
        lotCode,
        weightSource,
        netGrams: netGrams.toString(),
        qrSignature,
        status: 'WEIGHED_PENDING_INSPECTION',
      },
    });

    return {
      lotId,
      lotCode,
      qrSignature,
      netGrams: netGrams.toString(),
      totalBoxes,
      status: 'WEIGHED_PENDING_INSPECTION' as const,
      inspectionGrade: null,
    };
  });
}

export async function inspectLotQuality(
  db: DbPort,
  claims: AuthSessionClaims,
  lotId: string,
  input: {
    grade: InspectionGrade;
    coreTempC: number;
    notes: string;
    overrideReason?: string | undefined;
  }
) {
  const tenantId = claims.tenantId;
  const newStatus =
    input.grade === 'REJECTED_UNFIT' ? 'BLOCKED_UNFIT' : 'OPEN_FOR_AUCTION';

  const updatedLot = await db.transaction(async (tx) => {
    const existingLot = await lockLotForInspectionInTx(tx, tenantId, lotId);
    if (!existingLot) {
      throw new AppError(
        'NOT_FOUND',
        `Lot ${lotId} not found in tenant ${tenantId}`,
        404
      );
    }

    if (
      existingLot.weighed_by_user_id &&
      existingLot.weighed_by_user_id === claims.sub
    ) {
      const canOverride =
        claims.role === 'HARBOUR_ADMIN' &&
        typeof input.overrideReason === 'string' &&
        input.overrideReason.trim().length >= 5;
      if (!canOverride) {
        throw new AppError(
          'SELF_INSPECTION_FORBIDDEN',
          `Independent quality gate (${ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE}): Operator who weighed the lot cannot perform Section 21 inspection.`,
          403
        );
      }
    }

    const allocCount = await countLotAllocationsInTx(tx, tenantId, lotId);
    if (
      allocCount > 0 ||
      existingLot.status === 'PARTIALLY_SOLD' ||
      existingLot.status === 'FULLY_SOLD'
    ) {
      throw new AppError(
        'CONFLICT',
        `Lot ${existingLot.lot_code} already has sale allocations and cannot be re-inspected.`,
        409
      );
    }

    const upd = await updateLotInspectionInTx(tx, {
      tenantId,
      lotId,
      grade: input.grade,
      coreTempC: input.coreTempC,
      notes: input.notes,
      inspectedByUserId: claims.sub,
      newStatus,
    });

    await auditInTx(tx, {
      tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode:
        input.grade === 'REJECTED_UNFIT'
          ? 'QUALITY_INSPECTION_REJECTED_S21'
          : 'QUALITY_INSPECTION_PASSED_S21',
      targetType: 'LOT',
      targetId: lotId,
      details: {
        actorName: claims.fullName,
        grade: input.grade,
        coreTempC: input.coreTempC,
        status: newStatus,
        statutoryRef: ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE,
        ...(input.overrideReason
          ? { overrideReason: input.overrideReason }
          : {}),
      },
    });

    return upd;
  });

  return {
    lotId: updatedLot.lot_id,
    grade: input.grade,
    coreTempC: input.coreTempC,
    status: updatedLot.status,
  };
}

export async function recordLotSlipReprint(
  db: DbPort,
  claims: AuthSessionClaims,
  lotId: string,
  input: {
    slipType: 'LOT_LABEL' | 'BUYER_SALE_SLIP' | 'FISHERMAN_SETTLEMENT_SLIP';
    paperSize: '58mm' | '80mm' | 'A4';
    reason: string;
  }
) {
  return db.transaction(async (tx) => {
    const auditId = await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'LOT_SLIP_REPRINTED',
      targetType: 'LOT',
      targetId: lotId,
      details: {
        actorName: claims.fullName,
        slipType: input.slipType,
        paperSize: input.paperSize,
        reason: input.reason,
        watermark: 'REPRINT',
      },
    });
    return {
      reprinted: true,
      watermark: 'REPRINT' as const,
      lotId,
      slipType: input.slipType,
      paperSize: input.paperSize,
      auditId,
      reprintedAt: new Date().toISOString(),
    };
  });
}
