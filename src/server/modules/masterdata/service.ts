import crypto from 'node:crypto';
import { auditInTx, type DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { AppError } from '@server/platform/errors.ts';
import type { AuthSessionClaims } from '@server/platform/auth.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import type { AuctionMode, FloorEnforcement } from '@shared/ids.ts';
import {
  listMasterdataEntities,
  softDeactivateMasterdataEntityInTx,
  updateFloorScheduleInTx,
  upsertAuctionSessionInTx,
  upsertBuyerAndAccountInTx,
  upsertCoopSocietyInTx,
  upsertFishermanAndAccountsInTx,
  upsertLicenceAndAccountInTx,
  upsertSpeciesAndHistoryInTx,
  upsertVesselInTx,
} from './repo.ts';

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function computeValidGstinCheckChar(prefix14: string): string {
  const clean = prefix14.trim().toUpperCase();
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const codePoint = GSTIN_CHARS.indexOf(clean[i] ?? '');
    const factor = i % 2 === 0 ? 1 : 2;
    const product = codePoint * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const rem = sum % 36;
  const checkIndex = (36 - rem) % 36;
  return GSTIN_CHARS[checkIndex]!;
}

export function validateIndianGstin(gstin: string): { valid: boolean; reason?: string } {
  const clean = gstin.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(clean)) {
    return {
      valid: false,
      reason: 'GSTIN must match 15-character Indian format (2-digit state + 10-char PAN + entity + Z + check digit)',
    };
  }
  const expectedCheck = computeValidGstinCheckChar(clean.slice(0, 14));
  if (clean[14] !== expectedCheck) {
    return {
      valid: false,
      reason: `GSTIN mod-36 checksum mismatch: expected check character '${expectedCheck}', got '${clean[14]}'`,
    };
  }
  return { valid: true };
}

export function hasCsvFormulaInjection(cell: string, fieldName = ''): boolean {
  if (!cell) return false;
  if (fieldName === 'phoneE164' && /^\+[1-9]\d{9,14}$/.test(cell.trim())) return false;
  const firstChar = cell[0];
  return firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@' || firstChar === '\t' || firstChar === '\r';
}

export async function createOrUpdateCoopSociety(
  db: DbPort,
  claims: AuthSessionClaims,
  input: { societyId?: string | undefined; regNo: string; nameEn: string; nameMl?: string | undefined }
) {
  const societyId = input.societyId?.trim() || `SOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const nameMl = input.nameMl?.trim() || input.nameEn.trim();
  await db.transaction(async (tx) => {
    await upsertCoopSocietyInTx(tx, { societyId, tenantId: claims.tenantId, regNo: input.regNo.trim(), nameEn: input.nameEn.trim(), nameMl });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_SOCIETY_UPSERTED',
      targetType: 'COOP_SOCIETY',
      targetId: societyId,
      details: { regNo: input.regNo, nameEn: input.nameEn },
    });
  });
  return { societyId, tenantId: claims.tenantId, regNo: input.regNo.trim(), nameEn: input.nameEn.trim(), nameMl };
}

export async function createOrUpdateFisherman(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    fishermanId?: string | undefined;
    fullName: string;
    phoneE164: string;
    welfareBoardNo: string;
    coopSocietyId?: string | null | undefined;
    nfdpId?: string | null | undefined;
    bankAccountRef?: string | null | undefined;
  }
) {
  const fishermanId = input.fishermanId?.trim() || `FSH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const payableAccountId = `ACC-FSH-PAY-${fishermanId}`;
  const bonusEscrowAccountId = `ACC-FSH-BON-${fishermanId}`;

  await db.transaction(async (tx) => {
    await upsertFishermanAndAccountsInTx(tx, {
      fishermanId,
      tenantId: claims.tenantId,
      fullName: input.fullName.trim(),
      phoneE164: input.phoneE164.trim(),
      welfareBoardNo: input.welfareBoardNo.trim(),
      coopSocietyId: input.coopSocietyId ?? null,
      nfdpId: input.nfdpId ?? null,
      bankAccountRef: input.bankAccountRef ?? null,
      payableAccountId,
      bonusEscrowAccountId,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_FISHERMAN_UPSERTED',
      targetType: 'FISHERMAN',
      targetId: fishermanId,
      details: { fullName: input.fullName, welfareBoardNo: input.welfareBoardNo, payableAccountId, bonusEscrowAccountId },
    });
  });

  return {
    fishermanId,
    tenantId: claims.tenantId,
    fullName: input.fullName.trim(),
    phoneE164: input.phoneE164.trim(),
    welfareBoardNo: input.welfareBoardNo.trim(),
    coopSocietyId: input.coopSocietyId ?? null,
    nfdpId: input.nfdpId ?? null,
    bankAccountRef: input.bankAccountRef ?? null,
    payableAccountId,
    bonusEscrowAccountId,
  };
}

export async function createOrUpdateVessel(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    vesselId?: string | undefined;
    registrationNo: string;
    vesselNameEn: string;
    vesselNameMl?: string | undefined;
    ownerFishermanId: string;
    hasActiveSocietyLoan?: boolean | undefined;
    loanCoopSocietyId?: string | null | undefined;
  }
) {
  const vesselId = input.vesselId?.trim() || `VSL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const sig = crypto
    .createHmac('sha256', config.QR_HMAC_SECRET)
    .update(`${claims.tenantId}|${vesselId}|${input.registrationNo.trim()}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  const qrToken = `QR-VSL-${vesselId}-${sig}`;
  const vesselNameMl = input.vesselNameMl?.trim() || input.vesselNameEn.trim();

  await db.transaction(async (tx) => {
    await upsertVesselInTx(tx, {
      vesselId,
      tenantId: claims.tenantId,
      registrationNo: input.registrationNo.trim(),
      vesselNameEn: input.vesselNameEn.trim(),
      vesselNameMl,
      ownerFishermanId: input.ownerFishermanId.trim(),
      hasActiveSocietyLoan: Boolean(input.hasActiveSocietyLoan),
      loanCoopSocietyId: input.loanCoopSocietyId ?? null,
      qrToken,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_VESSEL_UPSERTED',
      targetType: 'VESSEL',
      targetId: vesselId,
      details: { registrationNo: input.registrationNo, ownerFishermanId: input.ownerFishermanId, qrToken },
    });
  });

  return {
    vesselId,
    tenantId: claims.tenantId,
    registrationNo: input.registrationNo.trim(),
    vesselNameEn: input.vesselNameEn.trim(),
    vesselNameMl,
    ownerFishermanId: input.ownerFishermanId.trim(),
    hasActiveSocietyLoan: Boolean(input.hasActiveSocietyLoan),
    loanCoopSocietyId: input.loanCoopSocietyId ?? null,
    qrToken,
  };
}

export async function createOrUpdateBuyer(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    buyerId?: string | undefined;
    buyerName: string;
    paddleNo: number;
    gstin?: string | null | undefined;
    exportRegNo?: string | null | undefined;
    escrowBalancePaise?: string | number | undefined;
    approvedCreditPaise?: string | number | undefined;
    bankGuaranteeRef?: string | null | undefined;
    bankGuaranteePaise?: string | number | undefined;
  }
) {
  let cleanGstin: string | null = null;
  if (input.gstin && input.gstin.trim()) {
    cleanGstin = input.gstin.trim().toUpperCase();
    const gstCheck = validateIndianGstin(cleanGstin);
    if (!gstCheck.valid) {
      throw new AppError('VALIDATION_ERROR', gstCheck.reason!, 400, { fieldErrors: [{ field: 'gstin', message: gstCheck.reason! }] });
    }
  }

  const buyerId = input.buyerId?.trim() || `BUY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const receivableAccountId = `ACC-BUY-REC-${buyerId}`;
  const escrowStr = BigInt(input.escrowBalancePaise ?? 0).toString();
  const creditStr = BigInt(input.approvedCreditPaise ?? 0).toString();
  const bgStr = BigInt(input.bankGuaranteePaise ?? 0).toString();

  await db.transaction(async (tx) => {
    await upsertBuyerAndAccountInTx(tx, {
      buyerId,
      tenantId: claims.tenantId,
      buyerName: input.buyerName.trim(),
      paddleNo: input.paddleNo,
      gstin: cleanGstin,
      exportRegNo: input.exportRegNo ?? null,
      escrowBalancePaise: escrowStr,
      approvedCreditPaise: creditStr,
      bankGuaranteeRef: input.bankGuaranteeRef ?? null,
      bankGuaranteePaise: bgStr,
      receivableAccountId,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_BUYER_UPSERTED',
      targetType: 'BUYER',
      targetId: buyerId,
      details: { buyerName: input.buyerName, paddleNo: input.paddleNo, gstin: cleanGstin, receivableAccountId },
    });
  });

  return {
    buyerId,
    tenantId: claims.tenantId,
    buyerName: input.buyerName.trim(),
    paddleNo: input.paddleNo,
    gstin: cleanGstin,
    receivableAccountId,
    escrowBalancePaise: escrowStr,
    approvedCreditPaise: creditStr,
  };
}

export async function createOrUpdateLicence(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    licenceId?: string | undefined;
    auctioneerUserId: string;
    auctioneerName: string;
    licenceNo: string;
    status?: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | undefined;
    validFrom: string;
    validUntil: string;
    deputedBySocietyId?: string | null | undefined;
  }
) {
  const fromMs = new Date(`${input.validFrom}T00:00:00Z`).getTime();
  const untilMs = new Date(`${input.validUntil}T00:00:00Z`).getTime();
  if (untilMs < fromMs || untilMs - fromMs > 366 * 86_400_000) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Section 5 licence validity violation (${ACT_16_2021_CITATIONS.AUCTIONEER_LICENCE_VALIDITY}): validUntil must be >= validFrom and within 1 year.`,
      422
    );
  }

  const licenceId = input.licenceId?.trim() || `LIC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const payableAccountId = `ACC-AUCT-PAY-${licenceId}`;
  const status = input.status ?? 'ACTIVE';

  await db.transaction(async (tx) => {
    await upsertLicenceAndAccountInTx(tx, {
      licenceId,
      tenantId: claims.tenantId,
      auctioneerUserId: input.auctioneerUserId.trim(),
      auctioneerName: input.auctioneerName.trim(),
      licenceNo: input.licenceNo.trim(),
      status,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      deputedBySocietyId: input.deputedBySocietyId ?? null,
      payableAccountId,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_LICENCE_UPSERTED',
      targetType: 'AUCTIONEER_LICENCE',
      targetId: licenceId,
      details: { licenceNo: input.licenceNo, auctioneerUserId: input.auctioneerUserId, validFrom: input.validFrom, validUntil: input.validUntil, payableAccountId },
    });
  });

  return {
    licenceId,
    tenantId: claims.tenantId,
    auctioneerUserId: input.auctioneerUserId.trim(),
    auctioneerName: input.auctioneerName.trim(),
    licenceNo: input.licenceNo.trim(),
    status,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    deputedBySocietyId: input.deputedBySocietyId ?? null,
    payableAccountId,
  };
}

export async function createOrUpdateSpecies(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    speciesId?: string | undefined;
    code: string;
    nameEn: string;
    nameMl?: string | undefined;
    scientificName?: string | undefined;
    floorPricePaisePerKg: string | number;
    exportEligible?: boolean | undefined;
  }
) {
  const speciesId = input.speciesId?.trim() || `SPC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const code = input.code.trim().toUpperCase();
  const nameEn = input.nameEn.trim();
  const nameMl = input.nameMl?.trim() || nameEn;
  const scientificName = input.scientificName?.trim() || 'Marine Teleost';
  const floorPricePaisePerKg = BigInt(input.floorPricePaisePerKg).toString();
  const exportEligible = input.exportEligible ?? true;
  const historyId = `FPH-${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await upsertSpeciesAndHistoryInTx(tx, {
      speciesId,
      tenantId: claims.tenantId,
      code,
      nameEn,
      nameMl,
      scientificName,
      floorPricePaisePerKg,
      exportEligible,
      historyId,
      changedByUserId: claims.sub,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_SPECIES_UPSERTED',
      targetType: 'SPECIES',
      targetId: speciesId,
      details: { code, nameEn, floorPricePaisePerKg },
    });
  });

  return { speciesId, tenantId: claims.tenantId, code, nameEn, nameMl, scientificName, floorPricePaisePerKg, exportEligible };
}

export async function createOrUpdateSession(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    sessionId?: string | undefined;
    sessionCode: string;
    auctionMode?: AuctionMode | undefined;
    leaderDeviceId?: string | undefined;
    fencingToken?: number | undefined;
    dutchStartPricePaise?: string | number | undefined;
    dutchFloorPricePaise?: string | number | undefined;
    status?: 'OPEN' | 'PAUSED' | 'CLOSED' | undefined;
  }
) {
  const sessionId = input.sessionId?.trim() || `SES-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const auctionMode = input.auctionMode ?? 'PHYSICAL_SHOUT';
  const leaderDeviceId = input.leaderDeviceId?.trim() || 'PIT-PAD-01';
  const fencingToken = input.fencingToken ?? 1;
  const leaseExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const dutchStartPricePaise = BigInt(input.dutchStartPricePaise ?? 75000).toString();
  const dutchFloorPricePaise = BigInt(input.dutchFloorPricePaise ?? 60000).toString();
  const status = input.status ?? 'OPEN';

  await db.transaction(async (tx) => {
    await upsertAuctionSessionInTx(tx, {
      sessionId,
      tenantId: claims.tenantId,
      sessionCode: input.sessionCode.trim(),
      auctionMode,
      leaderDeviceId,
      fencingToken,
      leaseExpiresAt,
      dutchStartPricePaise,
      dutchFloorPricePaise,
      status,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_SESSION_UPSERTED',
      targetType: 'SESSION',
      targetId: sessionId,
      details: { sessionCode: input.sessionCode, auctionMode, fencingToken, status },
    });
  });

  return { sessionId, tenantId: claims.tenantId, sessionCode: input.sessionCode.trim(), auctionMode, leaderDeviceId, fencingToken, status };
}

export async function deactivateMasterdataEntity(
  db: DbPort,
  claims: AuthSessionClaims,
  entityType: string,
  id: string
) {
  return db.transaction(async (tx) => {
    const ok = await softDeactivateMasterdataEntityInTx(tx, claims.tenantId, entityType, id);
    if (!ok) throw new AppError('NOT_FOUND', `Entity ${id} of type ${entityType} not found in tenant`, 404);
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'MASTERDATA_DEACTIVATED',
      targetType: entityType.toUpperCase(),
      targetId: id,
      details: { entityType, id, isActive: false },
    });
    return { deactivated: true, entityType, id };
  });
}

export async function updateSection19FloorSchedule(
  db: DbPort,
  claims: AuthSessionClaims,
  input: {
    floorEnforcement?: FloorEnforcement | undefined;
    speciesId?: string | undefined;
    floorPricePaisePerKg?: string | number | undefined;
  }
) {
  let floorValStr: string | undefined;
  if (input.speciesId && input.floorPricePaisePerKg !== undefined) {
    const floorVal = BigInt(input.floorPricePaisePerKg);
    if (floorVal <= 0n) throw new AppError('VALIDATION_ERROR', 'floorPricePaisePerKg must be > 0', 400);
    floorValStr = floorVal.toString();
  }

  await db.transaction(async (tx) => {
    await updateFloorScheduleInTx(tx, {
      tenantId: claims.tenantId,
      floorEnforcement: input.floorEnforcement,
      speciesId: input.speciesId,
      floorPricePaisePerKg: floorValStr,
      historyId: `FPH-${crypto.randomUUID()}`,
      changedByUserId: claims.sub,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'FLOOR_SCHEDULE_UPDATED_S19',
      targetType: 'SPECIES',
      targetId: String(input.speciesId ?? 'TENANT-FLOOR-MODE'),
      details: { actorName: claims.fullName, floorEnforcement: input.floorEnforcement, floorPricePaisePerKg: input.floorPricePaisePerKg },
    });
  });

  return { updated: true };
}

export async function importMasterdataCsv(
  db: DbPort,
  claims: AuthSessionClaims,
  entityType: 'coop-societies' | 'fishermen' | 'vessels' | 'buyers' | 'species' | 'licences',
  csvText: string,
  dryRun: boolean
) {
  const lines = csvText.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new AppError('VALIDATION_ERROR', 'CSV must include a header row and at least one data row', 400);
  }

  const headers = lines[0]!.split(',').map((h) => h.trim());
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const validRowsData: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i += 1) {
    const rowNum = i + 1;
    const cols = lines[i]!.split(',').map((c) => c.trim());
    const record: Record<string, string> = {};
    let rowHasError = false;

    for (let c = 0; c < headers.length; c += 1) {
      const field = headers[c]!;
      const val = cols[c] ?? '';
      if (hasCsvFormulaInjection(val, field)) {
        errors.push({ row: rowNum, field, message: `Blocked CSV formula injection prefix in field '${field}'` });
        rowHasError = true;
      }
      record[field] = val;
    }

    if (entityType === 'buyers' && record.gstin) {
      const gstCheck = validateIndianGstin(record.gstin);
      if (!gstCheck.valid) {
        errors.push({ row: rowNum, field: 'gstin', message: gstCheck.reason! });
        rowHasError = true;
      }
    }

    if (entityType === 'fishermen' && (!record.phoneE164 || !/^\+[1-9]\d{9,14}$/.test(record.phoneE164))) {
      errors.push({ row: rowNum, field: 'phoneE164', message: 'Invalid E.164 phone number' });
      rowHasError = true;
    }

    if (!rowHasError) validRowsData.push(record);
  }

  const totalRows = lines.length - 1;

  if (!dryRun && errors.length === 0) {
    for (const r of validRowsData) {
      if (entityType === 'coop-societies') {
        await createOrUpdateCoopSociety(db, claims, { societyId: r.societyId || undefined, regNo: r.regNo || 'KL-COOP', nameEn: r.nameEn || 'Society', nameMl: r.nameMl || r.nameEn });
      } else if (entityType === 'fishermen') {
        await createOrUpdateFisherman(db, claims, { fishermanId: r.fishermanId || undefined, fullName: r.fullName || 'Fisherman', phoneE164: r.phoneE164!, welfareBoardNo: r.welfareBoardNo || 'KFWFB-001', coopSocietyId: r.coopSocietyId || null, nfdpId: r.nfdpId || null, bankAccountRef: r.bankAccountRef || null });
      } else if (entityType === 'vessels') {
        await createOrUpdateVessel(db, claims, { vesselId: r.vesselId || undefined, registrationNo: r.registrationNo || 'IND-KL-01', vesselNameEn: r.vesselNameEn || 'Vessel', vesselNameMl: r.vesselNameMl || r.vesselNameEn, ownerFishermanId: r.ownerFishermanId!, hasActiveSocietyLoan: r.hasActiveSocietyLoan === 'true', loanCoopSocietyId: r.loanCoopSocietyId || null });
      } else if (entityType === 'buyers') {
        await createOrUpdateBuyer(db, claims, { buyerId: r.buyerId || undefined, buyerName: r.buyerName || 'Buyer', paddleNo: Number(r.paddleNo || 101), gstin: r.gstin || null, exportRegNo: r.exportRegNo || null, escrowBalancePaise: r.escrowBalancePaise || '0', approvedCreditPaise: r.approvedCreditPaise || '0' });
      } else if (entityType === 'species') {
        await createOrUpdateSpecies(db, claims, { speciesId: r.speciesId || undefined, code: r.code || 'SPC', nameEn: r.nameEn || 'Species', nameMl: r.nameMl || r.nameEn, scientificName: r.scientificName || 'Marine Teleost', floorPricePaisePerKg: r.floorPricePaisePerKg || '50000', exportEligible: r.exportEligible !== 'false' });
      } else if (entityType === 'licences') {
        await createOrUpdateLicence(db, claims, { licenceId: r.licenceId || undefined, auctioneerUserId: r.auctioneerUserId!, auctioneerName: r.auctioneerName || 'Auctioneer', licenceNo: r.licenceNo || 'AUCT-01', validFrom: r.validFrom!, validUntil: r.validUntil!, deputedBySocietyId: r.deputedBySocietyId || null });
      }
    }
  }

  return { dryRun, entityType, totalRows, validRows: validRowsData.length, committed: !dryRun && errors.length === 0, errors };
}

export { listMasterdataEntities };
