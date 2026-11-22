import crypto from 'node:crypto';
import { auditInTx, type DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { AppError } from '@server/platform/errors.ts';
import type { AuthSessionClaims } from '@server/platform/auth.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import {
  upsertBuyerAndAccountInTx,
  upsertCoopSocietyInTx,
  upsertFishermanAndAccountsInTx,
  upsertLicenceAndAccountInTx,
  upsertSpeciesAndHistoryInTx,
  upsertVesselInTx,
} from './repo.ts';
import { validateIndianGstin } from './service.ts';

export function hasCsvFormulaInjection(cell: string, fieldName = ''): boolean {
  if (!cell) return false;
  if (fieldName === 'phoneE164' && /^\+[1-9]\d{9,14}$/.test(cell.trim())) return false;
  const firstChar = cell[0];
  return (
    firstChar === '=' ||
    firstChar === '+' ||
    firstChar === '-' ||
    firstChar === '@' ||
    firstChar === '\t' ||
    firstChar === '\r'
  );
}

export async function importMasterdataCsv(
  db: DbPort,
  claims: AuthSessionClaims,
  entityType: 'coop-societies' | 'fishermen' | 'vessels' | 'buyers' | 'species' | 'licences',
  csvText: string,
  dryRun: boolean
) {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new AppError(
      'VALIDATION_ERROR',
      'CSV must include a header row and at least one data row',
      400
    );
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
        errors.push({
          row: rowNum,
          field,
          message: `Blocked CSV formula injection prefix in field '${field}'`,
        });
        rowHasError = true;
      }
      record[field] = val;
    }

    if (entityType === 'buyers') {
      if (record.gstin) {
        const gstCheck = validateIndianGstin(record.gstin);
        if (!gstCheck.valid) {
          errors.push({ row: rowNum, field: 'gstin', message: gstCheck.reason! });
          rowHasError = true;
        }
      }
      const paddleNum = Number(record.paddleNo || 101);
      if (!Number.isInteger(paddleNum) || paddleNum <= 0) {
        errors.push({
          row: rowNum,
          field: 'paddleNo',
          message: 'paddleNo must be a positive integer',
        });
        rowHasError = true;
      }
    }

    if (entityType === 'fishermen') {
      if (!record.phoneE164 || !/^\+[1-9]\d{9,14}$/.test(record.phoneE164)) {
        errors.push({ row: rowNum, field: 'phoneE164', message: 'Invalid E.164 phone number' });
        rowHasError = true;
      }
      if (!record.coopSocietyId) {
        errors.push({ row: rowNum, field: 'coopSocietyId', message: 'coopSocietyId is required' });
        rowHasError = true;
      }
    }

    if (entityType === 'vessels' && !record.ownerFishermanId) {
      errors.push({
        row: rowNum,
        field: 'ownerFishermanId',
        message: 'ownerFishermanId is required',
      });
      rowHasError = true;
    }

    if (entityType === 'species') {
      try {
        if (BigInt(record.floorPricePaisePerKg || '50000') <= 0n) {
          errors.push({
            row: rowNum,
            field: 'floorPricePaisePerKg',
            message: 'floorPricePaisePerKg must be > 0',
          });
          rowHasError = true;
        }
      } catch {
        errors.push({
          row: rowNum,
          field: 'floorPricePaisePerKg',
          message: 'floorPricePaisePerKg must be an integer',
        });
        rowHasError = true;
      }
    }

    if (entityType === 'licences') {
      const fromMs = new Date(`${record.validFrom ?? ''}T00:00:00Z`).getTime();
      const untilMs = new Date(`${record.validUntil ?? ''}T00:00:00Z`).getTime();
      if (!record.auctioneerUserId) {
        errors.push({
          row: rowNum,
          field: 'auctioneerUserId',
          message: 'auctioneerUserId is required',
        });
        rowHasError = true;
      }
      if (
        !Number.isFinite(fromMs) ||
        !Number.isFinite(untilMs) ||
        untilMs < fromMs ||
        untilMs - fromMs > 366 * 86_400_000
      ) {
        errors.push({
          row: rowNum,
          field: 'validUntil',
          message: `Section 5 licence validity violation (${ACT_16_2021_CITATIONS.AUCTIONEER_LICENCE_VALIDITY})`,
        });
        rowHasError = true;
      }
    }

    if (!rowHasError) validRowsData.push(record);
  }

  const totalRows = lines.length - 1;

  if (!dryRun && errors.length === 0) {
    // Atomic all-or-nothing batch commit inside a single DB transaction
    await db.transaction(async (tx) => {
      for (const r of validRowsData) {
        if (entityType === 'coop-societies') {
          const societyId =
            r.societyId?.trim() || `SOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          const nameEn = (r.nameEn || 'Society').trim();
          await upsertCoopSocietyInTx(tx, {
            societyId,
            tenantId: claims.tenantId,
            regNo: (r.regNo || 'KL-COOP').trim(),
            nameEn,
            nameMl: (r.nameMl || nameEn).trim(),
          });
        } else if (entityType === 'fishermen') {
          const fishermanId =
            r.fishermanId?.trim() || `FSH-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await upsertFishermanAndAccountsInTx(tx, {
            fishermanId,
            tenantId: claims.tenantId,
            fullName: (r.fullName || 'Fisherman').trim(),
            phoneE164: r.phoneE164!.trim(),
            welfareBoardNo: (r.welfareBoardNo || 'KFWFB-001').trim(),
            coopSocietyId: r.coopSocietyId || null,
            nfdpId: r.nfdpId || null,
            bankAccountRef: r.bankAccountRef || null,
            payableAccountId: `ACC-FSH-PAY-${fishermanId}`,
            bonusEscrowAccountId: `ACC-FSH-BON-${fishermanId}`,
          });
        } else if (entityType === 'vessels') {
          const vesselId =
            r.vesselId?.trim() || `VSL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          const registrationNo = (r.registrationNo || 'IND-KL-01').trim();
          const sig = crypto
            .createHmac('sha256', config.QR_HMAC_SECRET)
            .update(`${claims.tenantId}|${vesselId}|${registrationNo}`)
            .digest('hex')
            .slice(0, 12)
            .toUpperCase();
          const vesselNameEn = (r.vesselNameEn || 'Vessel').trim();
          await upsertVesselInTx(tx, {
            vesselId,
            tenantId: claims.tenantId,
            registrationNo,
            vesselNameEn,
            vesselNameMl: (r.vesselNameMl || vesselNameEn).trim(),
            ownerFishermanId: r.ownerFishermanId!.trim(),
            hasActiveSocietyLoan: r.hasActiveSocietyLoan === 'true',
            loanCoopSocietyId: r.loanCoopSocietyId || null,
            qrToken: `QR-VSL-${vesselId}-${sig}`,
          });
        } else if (entityType === 'buyers') {
          const buyerId =
            r.buyerId?.trim() || `BUY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await upsertBuyerAndAccountInTx(tx, {
            buyerId,
            tenantId: claims.tenantId,
            buyerName: (r.buyerName || 'Buyer').trim(),
            paddleNo: Number(r.paddleNo || 101),
            gstin: r.gstin ? r.gstin.trim().toUpperCase() : null,
            exportRegNo: r.exportRegNo || null,
            escrowBalancePaise: BigInt(r.escrowBalancePaise || '0').toString(),
            approvedCreditPaise: BigInt(r.approvedCreditPaise || '0').toString(),
            bankGuaranteeRef: r.bankGuaranteeRef || null,
            bankGuaranteePaise: BigInt(r.bankGuaranteePaise || '0').toString(),
            receivableAccountId: `ACC-BUY-REC-${buyerId}`,
          });
        } else if (entityType === 'species') {
          const speciesId =
            r.speciesId?.trim() || `SPC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          const nameEn = (r.nameEn || 'Species').trim();
          await upsertSpeciesAndHistoryInTx(tx, {
            speciesId,
            tenantId: claims.tenantId,
            code: (r.code || 'SPC').trim().toUpperCase(),
            nameEn,
            nameMl: (r.nameMl || nameEn).trim(),
            scientificName: (r.scientificName || 'Marine Teleost').trim(),
            floorPricePaisePerKg: BigInt(r.floorPricePaisePerKg || '50000').toString(),
            exportEligible: r.exportEligible !== 'false',
            historyId: `FPH-${crypto.randomUUID()}`,
            changedByUserId: claims.sub,
          });
        } else if (entityType === 'licences') {
          const licenceId =
            r.licenceId?.trim() || `LIC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          await upsertLicenceAndAccountInTx(tx, {
            licenceId,
            tenantId: claims.tenantId,
            auctioneerUserId: r.auctioneerUserId!.trim(),
            auctioneerName: (r.auctioneerName || 'Auctioneer').trim(),
            licenceNo: (r.licenceNo || 'AUCT-01').trim(),
            status: 'ACTIVE',
            validFrom: r.validFrom!,
            validUntil: r.validUntil!,
            deputedBySocietyId: r.deputedBySocietyId || null,
            payableAccountId: `ACC-AUCT-PAY-${licenceId}`,
          });
        }
      }

      await auditInTx(tx, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        actorRole: claims.role,
        actionCode: 'MASTERDATA_CSV_IMPORTED',
        targetType: entityType.toUpperCase(),
        targetId: `BATCH-${validRowsData.length}`,
        details: { entityType, rowCount: validRowsData.length, atomic: true },
      });
    });
  }

  return {
    dryRun,
    entityType,
    totalRows,
    validRows: validRowsData.length,
    committed: !dryRun && errors.length === 0,
    errors,
  };
}
