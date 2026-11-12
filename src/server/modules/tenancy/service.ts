import crypto from 'node:crypto';
import { withPlatform, type DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import {
  hashSupervisorPin,
  type AuthSessionClaims,
} from '@server/platform/auth.ts';
import { updateObservedDbCounts } from '@server/platform/observability.ts';
import {
  queryAllImportAuditLogsWithLruCache,
  verifyTenantLedgerChain,
} from '@server/modules/ledger/index.ts';
import { GENESIS_PREV_HASH } from '@shared/domain/ledger-hash.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import type { Role } from '@shared/contracts/rbac.ts';
import type { CentreType, CommercialMode } from '@shared/ids.ts';
import {
  fetchWorkspaceBootstrapCollectionsInTx,
  insertCommissionPolicyVersionInTx,
  insertHonestTenantInTx,
  insertTenantUserInTx,
} from './repo.ts';

/**
 * Phase 3.2 Honest `POST /api/v1/tenants`:
 * Creates ONLY the tenant row, commission policy v1 (`FIXED_SAAS_ONLY`),
 * ledger head (`last_entry_seq=0`, `GENESIS_PREV_HASH`), and the 5 institutional
 * ledger accounts (`HMS_FUND`, `COOP_SOCIETY_FUND`, `HARBOUROS_REVENUE`,
 * `GST_PAYABLE`, `BANK_CLEARING`). Zero fake fishermen, buyers, species, or sessions.
 */
export async function provisionHonestTenant(
  platformDb: DbPort,
  input: {
    slug?: string | undefined;
    nameEn?: string | undefined;
    nameMl?: string | undefined;
    centreType?: CentreType | undefined;
  }
) {
  const slug = String(input.slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  const nameEn = String(input.nameEn ?? '').trim();
  const nameMl = String(input.nameMl ?? nameEn).trim();
  const preset = String(input.centreType ?? 'KERALA_HARBOUR') as CentreType;

  if (!slug || !nameEn) {
    throw new AppError('VALIDATION_ERROR', 'slug and nameEn are required', 400);
  }

  const tenantId = `ten-${slug}`;
  const policyId = `POL-${slug.toUpperCase()}-V1`;
  const hmsAcc = `ACC-HMS-${slug}`;
  const coopAcc = `ACC-COOP-${slug}`;
  const revAcc = `ACC-REV-${slug}`;
  const gstAcc = `ACC-GST-${slug}`;
  const bankAcc = `ACC-BANK-${slug}`;

  const [auctBps, hmsBps, bonusBps, coopBps] =
    preset === 'KERALA_MARKET'
      ? [2000, 2000, 3000, 3000]
      : [2000, 2000, 4000, 2000];

  await withPlatform(platformDb, (tx) =>
    insertHonestTenantInTx(tx, {
      tenantId,
      slug,
      nameEn,
      nameMl,
      preset,
      policyId,
      hmsAcc,
      coopAcc,
      revAcc,
      gstAcc,
      bankAcc,
      auctBps,
      hmsBps,
      bonusBps,
      coopBps,
      legalBasisRef:
        preset === 'KERALA_MARKET'
          ? ACT_16_2021_CITATIONS.MARKET_SPLIT_LABEL
          : ACT_16_2021_CITATIONS.HARBOUR_SPLIT_LABEL,
      effectiveFromDate: new Date().toISOString().slice(0, 10),
      genesisHash: GENESIS_PREV_HASH,
    })
  );

  return {
    tenantId,
    slug,
    preset,
    policyId,
    accounts: {
      hmsAccountId: hmsAcc,
      coopPoolAccountId: coopAcc,
      harbourosRevenueAccountId: revAcc,
      gstPayableAccountId: gstAcc,
      bankClearingAccountId: bankAcc,
    },
  };
}

export async function provisionTenantUser(
  platformDb: DbPort,
  tenantDb: DbPort,
  claims: AuthSessionClaims,
  targetTenantId: string,
  input: {
    phoneE164?: string | undefined;
    fullName?: string | undefined;
    role?: string | undefined;
    entityRefId?: string | null | undefined;
    pinCode?: string | undefined;
    preferredLocale?: 'ml' | 'en' | undefined;
  }
) {
  if (claims.role !== 'SUPER_ADMIN' && claims.tenantId !== targetTenantId) {
    throw new AppError(
      'FORBIDDEN',
      'Cannot provision users for another tenant',
      403
    );
  }
  const phoneE164 = String(input.phoneE164 ?? '').trim();
  const fullName = String(input.fullName ?? '').trim();
  const role = String(input.role ?? '') as Role;
  const entityRefId = input.entityRefId
    ? String(input.entityRefId).trim()
    : null;
  const pinCode = String(input.pinCode ?? '1234').trim() || '1234';

  if (!phoneE164.startsWith('+') || !fullName || !role) {
    throw new AppError(
      'VALIDATION_ERROR',
      'phoneE164, fullName, and role are required',
      400
    );
  }

  const userId = `USR-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
  const pinHash = hashSupervisorPin(
    pinCode,
    'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  );

  const runInsert = (tx: DbPort) =>
    insertTenantUserInTx(tx, {
      userId,
      tenantId: targetTenantId,
      phoneE164,
      fullName,
      role,
      pinCode,
      pinHash,
      entityRefId,
      preferredLocale: input.preferredLocale ?? 'ml',
    });

  if (claims.role === 'SUPER_ADMIN') {
    await withPlatform(platformDb, runInsert);
  } else {
    await tenantDb.transaction(runInsert);
  }

  return {
    userId,
    tenantId: targetTenantId,
    phoneE164,
    fullName,
    role,
    entityRefId,
  };
}

export async function createCommissionPolicy(
  db: DbPort,
  tenantId: string,
  input: {
    commercialMode?: string | undefined;
    commissionBps?: number | undefined;
    auctioneerShareBps?: number | undefined;
    hmsShareBps?: number | undefined;
    fisherBonusShareBps?: number | undefined;
    coopShareBps?: number | undefined;
    notificationRef?: string | undefined;
    legalSignoffRef?: string | null | undefined;
    legalSignoffDate?: string | null | undefined;
  }
) {
  const commercialMode = String(
    input.commercialMode ?? 'FIXED_SAAS_ONLY'
  ) as CommercialMode;
  const commissionBps = Number(input.commissionBps ?? 500);
  const auctioneerShareBps = Number(input.auctioneerShareBps ?? 2000);
  const hmsShareBps = Number(input.hmsShareBps ?? 2000);
  const fisherBonusShareBps = Number(input.fisherBonusShareBps ?? 4000);
  const coopShareBps = Number(input.coopShareBps ?? 2000);
  const notificationRef = String(
    input.notificationRef ?? 'GO(P) No. 18/2021/F&PD'
  );
  const legalSignoffRef = input.legalSignoffRef
    ? String(input.legalSignoffRef).trim()
    : null;
  const legalSignoffDate = input.legalSignoffDate
    ? String(input.legalSignoffDate).trim()
    : null;

  if (commissionBps < 0 || commissionBps > 500) {
    throw new AppError(
      'STATUTORY_CAP_BREACH',
      `Commission rate cannot exceed 500 bps (5.00%) under ${ACT_16_2021_CITATIONS.COMMISSION_CAP_500_BPS}`,
      422
    );
  }
  if (
    auctioneerShareBps +
      hmsShareBps +
      fisherBonusShareBps +
      coopShareBps !==
    10000
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Recipient shares must sum to exactly 10,000 bps (100%)',
      422
    );
  }
  if (
    commercialMode !== 'FIXED_SAAS_ONLY' &&
    (!legalSignoffRef || !legalSignoffDate)
  ) {
    throw new AppError(
      'FORBIDDEN',
      `Commercial mode ${commercialMode} is blocked by statutory guardrail C7 (${ACT_16_2021_CITATIONS.COMMERCIAL_MODE_SIGNOFF_GATE}) unless both legalSignoffRef and legalSignoffDate are provided.`,
      422
    );
  }

  const nextVer = await db.transaction((tx) =>
    insertCommissionPolicyVersionInTx(tx, {
      tenantId,
      commercialMode,
      commissionBps,
      auctioneerShareBps,
      hmsShareBps,
      fisherBonusShareBps,
      coopShareBps,
      notificationRef,
      legalBasisRef: ACT_16_2021_CITATIONS.POLICY_SPLIT_BASIS,
      legalSignoffRef,
      legalSignoffDate,
      effectiveFromDate: new Date().toISOString().slice(0, 10),
    })
  );

  return {
    policyId: nextVer.policyId,
    versionNum: nextVer.ver,
    commercialMode,
  };
}

export async function getWorkspaceBootstrap(
  db: DbPort,
  claims: AuthSessionClaims
) {
  const tenantId = claims.tenantId;
  const role = claims.role;
  const entityRefId = claims.entityRefId ?? null;

  return db.transaction(async (tx) => {
    const [collections, cachedAuditAndBatches, chainVerification] =
      await Promise.all([
        fetchWorkspaceBootstrapCollectionsInTx(tx, tenantId),
        queryAllImportAuditLogsWithLruCache(tx, tenantId, 'ALL'),
        verifyTenantLedgerChain(tx, tenantId),
      ]);

    updateObservedDbCounts({
      tenantsCount: collections.allTenantsRows.length,
      usersCount: collections.usersRows.length,
    });

    const isFisherman = role === 'FISHERMAN_BOAT_OWNER';
    const isBuyer = role === 'WHOLESALE_BUYER';
    const isAdminOrAccountant =
      role === 'SUPER_ADMIN' ||
      role === 'HARBOUR_ADMIN' ||
      role === 'ACCOUNTANT';

    const scopedFishermen = isFisherman
      ? collections.fishermenRows.filter(
          (f) => String(f.fisherman_id) === String(entityRefId)
        )
      : collections.fishermenRows;

    const scopedVessels = isFisherman
      ? collections.vesselsRows.filter(
          (v) => String(v.owner_fisherman_id) === String(entityRefId)
        )
      : collections.vesselsRows;

    const scopedBuyers = isFisherman
      ? []
      : isBuyer && entityRefId
        ? collections.buyersRows.filter(
            (b) => String(b.buyer_id) === String(entityRefId)
          )
        : collections.buyersRows;

    const scopedUsers = isAdminOrAccountant
      ? collections.usersRows
      : collections.usersRows.filter((u) => String(u.user_id) === claims.sub);

    return {
      cacheStatus: cachedAuditAndBatches.cacheStatus,
      body: {
        tenant: collections.tenantRows[0] ?? null,
        allTenants: collections.allTenantsRows,
        policies: collections.policiesRows,
        users: scopedUsers,
        societies: collections.societiesRows,
        fishermen: scopedFishermen,
        vessels: scopedVessels,
        licences: collections.licencesRows,
        buyers: scopedBuyers,
        species: collections.speciesRows,
        lots: collections.lotsRows,
        sessions: collections.sessionsRows,
        allocations: collections.allocationsRows,
        accounts: collections.accountsRows,
        journals: collections.journalsRows,
        entries: collections.entriesRows,
        reversals: collections.reversalsRows,
        payoutBatches: cachedAuditAndBatches.payoutBatches,
        outboxEvents: collections.outboxRows,
        auditLogs: cachedAuditAndBatches.auditLogs,
        ledgerVerification: chainVerification,
        auditSqlLruCache: {
          cacheStatus: cachedAuditAndBatches.cacheStatus,
          cachedAtIso: cachedAuditAndBatches.cachedAtIso,
          stats: cachedAuditAndBatches.stats,
        },
      },
    };
  });
}
