import type { DbPort } from '@server/ports/db.ts';
import type { AuctionMode, FloorEnforcement } from '@shared/ids.ts';

export async function listMasterdataEntities(
  db: DbPort,
  tenantId: string,
  entityType: string
): Promise<ReadonlyArray<Record<string, unknown>>> {
  switch (entityType) {
    case 'coop-societies': {
      const r = await db.query<Record<string, unknown>>(
        `SELECT * FROM harbour.coop_societies WHERE tenant_id = $1 ORDER BY society_id ASC`,
        [tenantId]
      );
      return r.rows;
    }
    case 'fishermen': {
      const r = await db.query<Record<string, unknown>>(
        `SELECT * FROM harbour.fishermen WHERE tenant_id = $1 ORDER BY fisherman_id ASC`,
        [tenantId]
      );
      return r.rows;
    }
    case 'vessels': {
      const r = await db.query<Record<string, unknown>>(
        `SELECT * FROM harbour.vessels WHERE tenant_id = $1 ORDER BY vessel_id ASC`,
        [tenantId]
      );
      return r.rows;
    }
    case 'buyers': {
      const r = await db.query<Record<string, unknown>>(
        `SELECT * FROM harbour.buyers WHERE tenant_id = $1 ORDER BY paddle_no ASC`,
        [tenantId]
      );
      return r.rows;
    }
    case 'licences': {
      const r = await db.query<Record<string, unknown>>(
        `SELECT * FROM harbour.auctioneer_licences WHERE tenant_id = $1 ORDER BY licence_id ASC`,
        [tenantId]
      );
      return r.rows;
    }
    case 'species': {
      const r = await db.query<Record<string, unknown>>(
        `SELECT * FROM harbour.species WHERE tenant_id = $1 ORDER BY code ASC`,
        [tenantId]
      );
      return r.rows;
    }
    case 'sessions': {
      const r = await db.query<Record<string, unknown>>(
        `SELECT * FROM auction.sessions WHERE tenant_id = $1 ORDER BY session_id ASC`,
        [tenantId]
      );
      return r.rows;
    }
    default:
      return [];
  }
}

export async function upsertCoopSocietyInTx(
  tx: DbPort,
  params: {
    societyId: string;
    tenantId: string;
    regNo: string;
    nameEn: string;
    nameMl: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO harbour.coop_societies (society_id, tenant_id, reg_no, name_en, name_ml, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (society_id) DO UPDATE
       SET reg_no = EXCLUDED.reg_no, name_en = EXCLUDED.name_en, name_ml = EXCLUDED.name_ml, is_active = true
       WHERE harbour.coop_societies.tenant_id = EXCLUDED.tenant_id`,
    [
      params.societyId,
      params.tenantId,
      params.regNo,
      params.nameEn,
      params.nameMl,
    ]
  );
}

export async function upsertFishermanAndAccountsInTx(
  tx: DbPort,
  params: {
    fishermanId: string;
    tenantId: string;
    fullName: string;
    phoneE164: string;
    welfareBoardNo: string;
    coopSocietyId: string | null;
    nfdpId: string | null;
    bankAccountRef: string | null;
    payableAccountId: string;
    bonusEscrowAccountId: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'FISHERMAN_PAYABLE', $3, $4, $5, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [
      params.payableAccountId,
      params.tenantId,
      `2010-${params.fishermanId}`,
      `${params.fullName} Payable`,
      params.fishermanId,
    ]
  );
  await tx.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'FISHERMAN_BONUS_ESCROW', $3, $4, $5, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [
      params.bonusEscrowAccountId,
      params.tenantId,
      `2300-${params.fishermanId}`,
      `${params.fullName} Bonus Escrow`,
      params.fishermanId,
    ]
  );
  await tx.query(
    `INSERT INTO harbour.fishermen (
       fisherman_id, tenant_id, full_name, phone_e164, welfare_board_no, coop_society_id,
       payable_account_id, bonus_escrow_account_id, nfdp_id, bank_account_ref, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
     ON CONFLICT (fisherman_id) DO UPDATE
       SET full_name = EXCLUDED.full_name, phone_e164 = EXCLUDED.phone_e164,
           welfare_board_no = EXCLUDED.welfare_board_no, coop_society_id = EXCLUDED.coop_society_id,
           nfdp_id = EXCLUDED.nfdp_id, bank_account_ref = EXCLUDED.bank_account_ref, is_active = true
       WHERE harbour.fishermen.tenant_id = EXCLUDED.tenant_id`,
    [
      params.fishermanId,
      params.tenantId,
      params.fullName,
      params.phoneE164,
      params.welfareBoardNo,
      params.coopSocietyId,
      params.payableAccountId,
      params.bonusEscrowAccountId,
      params.nfdpId,
      params.bankAccountRef,
    ]
  );
}

export async function upsertVesselInTx(
  tx: DbPort,
  params: {
    vesselId: string;
    tenantId: string;
    registrationNo: string;
    vesselNameEn: string;
    vesselNameMl: string;
    ownerFishermanId: string;
    hasActiveSocietyLoan: boolean;
    loanCoopSocietyId: string | null;
    qrToken: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO harbour.vessels (
       vessel_id, tenant_id, registration_no, vessel_name_en, vessel_name_ml,
       owner_fisherman_id, has_active_society_loan, loan_coop_society_id, qr_token, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
     ON CONFLICT (vessel_id) DO UPDATE
       SET registration_no = EXCLUDED.registration_no, vessel_name_en = EXCLUDED.vessel_name_en,
           vessel_name_ml = EXCLUDED.vessel_name_ml, owner_fisherman_id = EXCLUDED.owner_fisherman_id,
           has_active_society_loan = EXCLUDED.has_active_society_loan,
           loan_coop_society_id = EXCLUDED.loan_coop_society_id, is_active = true
       WHERE harbour.vessels.tenant_id = EXCLUDED.tenant_id`,
    [
      params.vesselId,
      params.tenantId,
      params.registrationNo,
      params.vesselNameEn,
      params.vesselNameMl,
      params.ownerFishermanId,
      params.hasActiveSocietyLoan,
      params.loanCoopSocietyId,
      params.qrToken,
    ]
  );
}

export async function upsertBuyerAndAccountInTx(
  tx: DbPort,
  params: {
    buyerId: string;
    tenantId: string;
    buyerName: string;
    paddleNo: number;
    gstin: string | null;
    exportRegNo: string | null;
    escrowBalancePaise: string;
    approvedCreditPaise: string;
    bankGuaranteeRef: string | null;
    bankGuaranteePaise: string;
    receivableAccountId: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'BUYER_RECEIVABLE', $3, $4, $5, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [
      params.receivableAccountId,
      params.tenantId,
      `1200-${params.buyerId}`,
      `${params.buyerName} Receivable`,
      params.buyerId,
    ]
  );
  await tx.query(
    `INSERT INTO harbour.buyers (
       buyer_id, tenant_id, buyer_name, paddle_no, gstin, export_reg_no,
       escrow_balance_paise, approved_credit_paise, unsettled_payables_paise, active_holds_paise,
       receivable_account_id, bank_guarantee_ref, bank_guarantee_paise, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9, $10, $11, true)
     ON CONFLICT (buyer_id) DO UPDATE
       SET buyer_name = EXCLUDED.buyer_name, paddle_no = EXCLUDED.paddle_no,
           gstin = EXCLUDED.gstin, export_reg_no = EXCLUDED.export_reg_no,
           escrow_balance_paise = EXCLUDED.escrow_balance_paise,
           approved_credit_paise = EXCLUDED.approved_credit_paise,
           bank_guarantee_ref = EXCLUDED.bank_guarantee_ref,
           bank_guarantee_paise = EXCLUDED.bank_guarantee_paise, is_active = true
       WHERE harbour.buyers.tenant_id = EXCLUDED.tenant_id`,
    [
      params.buyerId,
      params.tenantId,
      params.buyerName,
      params.paddleNo,
      params.gstin ?? '',
      params.exportRegNo,
      params.escrowBalancePaise,
      params.approvedCreditPaise,
      params.receivableAccountId,
      params.bankGuaranteeRef,
      params.bankGuaranteePaise,
    ]
  );
}

export async function upsertLicenceAndAccountInTx(
  tx: DbPort,
  params: {
    licenceId: string;
    tenantId: string;
    auctioneerUserId: string;
    auctioneerName: string;
    licenceNo: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
    validFrom: string;
    validUntil: string;
    deputedBySocietyId: string | null;
    payableAccountId: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'AUCTIONEER_PAYABLE', $3, $4, $5, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [
      params.payableAccountId,
      params.tenantId,
      `2150-${params.licenceId}`,
      `${params.auctioneerName} Payable`,
      params.licenceId,
    ]
  );
  await tx.query(
    `INSERT INTO harbour.auctioneer_licences (
       licence_id, tenant_id, auctioneer_user_id, auctioneer_name, licence_no, status,
       valid_from, valid_until, deputed_by_society_id, payable_account_id, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
     ON CONFLICT (licence_id) DO UPDATE
       SET auctioneer_user_id = EXCLUDED.auctioneer_user_id, auctioneer_name = EXCLUDED.auctioneer_name,
           licence_no = EXCLUDED.licence_no, status = EXCLUDED.status,
           valid_from = EXCLUDED.valid_from, valid_until = EXCLUDED.valid_until,
           deputed_by_society_id = EXCLUDED.deputed_by_society_id, is_active = true
       WHERE harbour.auctioneer_licences.tenant_id = EXCLUDED.tenant_id`,
    [
      params.licenceId,
      params.tenantId,
      params.auctioneerUserId,
      params.auctioneerName,
      params.licenceNo,
      params.status,
      params.validFrom,
      params.validUntil,
      params.deputedBySocietyId,
      params.payableAccountId,
    ]
  );
  await tx.query(
    `UPDATE core.users SET entity_ref_id = $1 WHERE user_id = $2 AND tenant_id = $3`,
    [params.licenceId, params.auctioneerUserId, params.tenantId]
  );
}

export async function upsertSpeciesAndHistoryInTx(
  tx: DbPort,
  params: {
    speciesId: string;
    tenantId: string;
    code: string;
    nameEn: string;
    nameMl: string;
    scientificName: string;
    floorPricePaisePerKg: string;
    exportEligible: boolean;
    historyId: string;
    changedByUserId: string;
  }
): Promise<void> {
  const prevRes = await tx.query<{ floor_price_paise_per_kg: string }>(
    `SELECT floor_price_paise_per_kg::text AS floor_price_paise_per_kg
     FROM harbour.species WHERE species_id = $1 AND tenant_id = $2`,
    [params.speciesId, params.tenantId]
  );
  const previousFloor = prevRes.rows[0]?.floor_price_paise_per_kg ?? null;

  await tx.query(
    `INSERT INTO harbour.species (
       species_id, tenant_id, code, name_en, name_ml, scientific_name,
       floor_price_paise_per_kg, export_eligible, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     ON CONFLICT (species_id) DO UPDATE
       SET code = EXCLUDED.code, name_en = EXCLUDED.name_en, name_ml = EXCLUDED.name_ml,
           scientific_name = EXCLUDED.scientific_name,
           floor_price_paise_per_kg = EXCLUDED.floor_price_paise_per_kg,
           export_eligible = EXCLUDED.export_eligible, is_active = true
       WHERE harbour.species.tenant_id = EXCLUDED.tenant_id`,
    [
      params.speciesId,
      params.tenantId,
      params.code,
      params.nameEn,
      params.nameMl,
      params.scientificName,
      params.floorPricePaisePerKg,
      params.exportEligible,
    ]
  );

  await tx.query(
    `INSERT INTO harbour.floor_price_history (
       history_id, tenant_id, species_id, previous_floor_paise_per_kg,
       new_floor_paise_per_kg, changed_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.historyId,
      params.tenantId,
      params.speciesId,
      previousFloor,
      params.floorPricePaisePerKg,
      params.changedByUserId,
    ]
  );
}

export async function upsertAuctionSessionInTx(
  tx: DbPort,
  params: {
    sessionId: string;
    tenantId: string;
    sessionCode: string;
    auctionMode: AuctionMode;
    leaderDeviceId: string;
    fencingToken: number;
    leaseExpiresAt: string;
    dutchStartPricePaise: string;
    dutchFloorPricePaise: string;
    status: 'OPEN' | 'PAUSED' | 'CLOSED';
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO auction.sessions (
       session_id, tenant_id, session_code, auction_mode, active_lot_id,
       leader_device_id, fencing_token, lease_expires_at,
       dutch_start_price_paise, dutch_floor_price_paise, status
     ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (session_id) DO UPDATE
       SET session_code = EXCLUDED.session_code, auction_mode = EXCLUDED.auction_mode,
           leader_device_id = EXCLUDED.leader_device_id, fencing_token = EXCLUDED.fencing_token,
           lease_expires_at = EXCLUDED.lease_expires_at,
           dutch_start_price_paise = EXCLUDED.dutch_start_price_paise,
           dutch_floor_price_paise = EXCLUDED.dutch_floor_price_paise,
           status = EXCLUDED.status
       WHERE auction.sessions.tenant_id = EXCLUDED.tenant_id`,
    [
      params.sessionId,
      params.tenantId,
      params.sessionCode,
      params.auctionMode,
      params.leaderDeviceId,
      params.fencingToken,
      params.leaseExpiresAt,
      params.dutchStartPricePaise,
      params.dutchFloorPricePaise,
      params.status,
    ]
  );
}

export async function softDeactivateMasterdataEntityInTx(
  tx: DbPort,
  tenantId: string,
  entityType: string,
  id: string
): Promise<boolean> {
  let sql = '';
  switch (entityType) {
    case 'coop-societies':
      sql = `UPDATE harbour.coop_societies SET is_active = false WHERE society_id = $1 AND tenant_id = $2 RETURNING society_id`;
      break;
    case 'fishermen':
      sql = `UPDATE harbour.fishermen SET is_active = false WHERE fisherman_id = $1 AND tenant_id = $2 RETURNING fisherman_id`;
      break;
    case 'vessels':
      sql = `UPDATE harbour.vessels SET is_active = false WHERE vessel_id = $1 AND tenant_id = $2 RETURNING vessel_id`;
      break;
    case 'buyers':
      sql = `UPDATE harbour.buyers SET is_active = false WHERE buyer_id = $1 AND tenant_id = $2 RETURNING buyer_id`;
      break;
    case 'licences':
      sql = `UPDATE harbour.auctioneer_licences SET is_active = false, status = 'SUSPENDED' WHERE licence_id = $1 AND tenant_id = $2 RETURNING licence_id`;
      break;
    case 'species':
      sql = `UPDATE harbour.species SET is_active = false WHERE species_id = $1 AND tenant_id = $2 RETURNING species_id`;
      break;
    case 'sessions':
      sql = `UPDATE auction.sessions SET status = 'CLOSED' WHERE session_id = $1 AND tenant_id = $2 RETURNING session_id`;
      break;
    default:
      return false;
  }
  const res = await tx.query(sql, [id, tenantId]);
  return res.rows.length > 0;
}

export async function updateFloorScheduleInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    floorEnforcement?: FloorEnforcement | undefined;
    speciesId?: string | undefined;
    floorPricePaisePerKg?: string | undefined;
    historyId: string;
    changedByUserId: string;
  }
): Promise<void> {
  if (params.floorEnforcement) {
    await tx.query(
      `UPDATE core.tenants SET floor_enforcement = $1 WHERE tenant_id = $2`,
      [params.floorEnforcement, params.tenantId]
    );
  }
  if (params.speciesId && params.floorPricePaisePerKg) {
    const prevRes = await tx.query<{ floor_price_paise_per_kg: string }>(
      `SELECT floor_price_paise_per_kg::text AS floor_price_paise_per_kg
       FROM harbour.species WHERE species_id = $1 AND tenant_id = $2`,
      [params.speciesId, params.tenantId]
    );
    const previousFloor = prevRes.rows[0]?.floor_price_paise_per_kg ?? null;

    await tx.query(
      `UPDATE harbour.species SET floor_price_paise_per_kg = $1 WHERE species_id = $2 AND tenant_id = $3`,
      [params.floorPricePaisePerKg, params.speciesId, params.tenantId]
    );

    await tx.query(
      `INSERT INTO harbour.floor_price_history (
         history_id, tenant_id, species_id, previous_floor_paise_per_kg,
         new_floor_paise_per_kg, changed_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.historyId,
        params.tenantId,
        params.speciesId,
        previousFloor,
        params.floorPricePaisePerKg,
        params.changedByUserId,
      ]
    );
  }
}
