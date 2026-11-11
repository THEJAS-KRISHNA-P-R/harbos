import crypto from 'node:crypto';
import { auditInTx, type DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import { computeWeightAmountPaise } from '@shared/domain/money.ts';
import { computeSaleSettlement, type CommissionPolicyConfig } from '@shared/domain/split.ts';
import { computeBoxAllocation } from '@shared/domain/allocate.ts';
import {
  GENESIS_PREV_HASH,
  sha256HexUtf8,
  computeLedgerEntryHash,
  buildSaleJournalEntries,
  buildReversalJournalEntries,
  type JournalEntryDraft,
} from '@shared/domain/ledger-hash.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import type { AuctionMode, CommercialMode, FloorEnforcement } from '@shared/ids.ts';

export function signLotQrPayload(
  lotId: string,
  vesselId: string,
  netGrams: bigint,
  secret: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${lotId}|${vesselId}|${netGrams.toString()}`)
    .digest('hex')
    .slice(0, 24);
}

export async function postJournalInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    journalId: string;
    referenceType:
      | 'SALE_ALLOCATION'
      | 'REVERSAL'
      | 'PAYOUT_BATCH'
      | 'BONUS_RELEASE'
      | 'BUYER_RECEIPT';
    referenceId: string;
    description: string;
    entries: ReadonlyArray<JournalEntryDraft>;
    createdAtIso: string;
    reversesJournalId?: string;
    authorizedByUser1?: string;
    authorizedByUser2?: string;
    reasonNote?: string;
  }
): Promise<{ journalId: string; lastEntrySeq: bigint; lastRowHash: string }> {
  if (params.entries.length < 2) {
    throw new AppError('UNBALANCED_LEDGER_ENTRY', 'Journal requires at least 2 entries', 400);
  }

  let sumD = 0n;
  let sumC = 0n;
  for (const e of params.entries) {
    if (e.amountPaise <= 0n) {
      throw new AppError('UNBALANCED_LEDGER_ENTRY', 'Entry amount_paise must be > 0', 400);
    }
    if (e.direction === 'D') sumD += e.amountPaise;
    else sumC += e.amountPaise;
  }

  if (sumD !== sumC) {
    throw new AppError(
      'UNBALANCED_LEDGER_ENTRY',
      `Double-entry violation: Debits (${sumD.toString()}) !== Credits (${sumC.toString()})`,
      400
    );
  }

  // Lock tenant head row FOR UPDATE to serialize concurrent ledger postings (§8)
  const headRes = await tx.query<{ last_entry_seq: string | number; last_row_hash: string }>(
    `SELECT last_entry_seq, last_row_hash FROM ledger.heads WHERE tenant_id = $1 FOR UPDATE`,
    [params.tenantId]
  );

  let currentSeq = 0n;
  let prevHash = GENESIS_PREV_HASH;
  const headRow = headRes.rows[0];
  if (headRow) {
    currentSeq = BigInt(headRow.last_entry_seq);
    prevHash = headRow.last_row_hash;
  } else {
    await tx.query(
      `INSERT INTO ledger.heads (tenant_id, last_entry_seq, last_row_hash) VALUES ($1, 0, $2)`,
      [params.tenantId, GENESIS_PREV_HASH]
    );
  }

  await tx.query(
    `INSERT INTO ledger.journals (
      journal_id, tenant_id, reference_type, reference_id, description,
      reverses_journal_id, authorized_by_user_1, authorized_by_user_2, reason_note,
      total_amount_paise, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      params.journalId,
      params.tenantId,
      params.referenceType,
      params.referenceId,
      params.description,
      params.reversesJournalId ?? null,
      params.authorizedByUser1 ?? null,
      params.authorizedByUser2 ?? null,
      params.reasonNote ?? null,
      sumD.toString(),
      params.createdAtIso,
    ]
  );

  for (const entry of params.entries) {
    currentSeq += 1n;
    const rowHash = computeLedgerEntryHash({
      tenantId: params.tenantId,
      entrySeq: currentSeq,
      prevRowHash: prevHash,
      journalId: params.journalId,
      accountId: entry.accountId,
      direction: entry.direction,
      amountPaise: entry.amountPaise,
      createdAtUtcIsoMs: params.createdAtIso,
    });

    await tx.query(
      `INSERT INTO ledger.entries (
        entry_seq, tenant_id, journal_id, account_id, direction,
        amount_paise, prev_row_hash, row_hash, created_at_utc_iso_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        currentSeq.toString(),
        params.tenantId,
        params.journalId,
        entry.accountId,
        entry.direction,
        entry.amountPaise.toString(),
        prevHash,
        rowHash,
        params.createdAtIso,
      ]
    );

    const acctRes = await tx.query<{ kind: string; balance_paise: string | number }>(
      `SELECT kind, balance_paise FROM ledger.accounts WHERE account_id = $1 AND tenant_id = $2`,
      [entry.accountId, params.tenantId]
    );
    const acct = acctRes.rows[0];
    if (acct) {
      const curBal = BigInt(acct.balance_paise);
      const isDebitNormal = acct.kind === 'BUYER_RECEIVABLE' || acct.kind === 'BANK_CLEARING';
      const delta =
        (isDebitNormal && entry.direction === 'D') || (!isDebitNormal && entry.direction === 'C')
          ? entry.amountPaise
          : -entry.amountPaise;
      await tx.query(
        `UPDATE ledger.accounts SET balance_paise = $1 WHERE account_id = $2 AND tenant_id = $3`,
        [(curBal + delta).toString(), entry.accountId, params.tenantId]
      );
    }

    prevHash = rowHash;
  }

  await tx.query(
    `UPDATE ledger.heads SET last_entry_seq = $1, last_row_hash = $2 WHERE tenant_id = $3`,
    [currentSeq.toString(), prevHash, params.tenantId]
  );

  return {
    journalId: params.journalId,
    lastEntrySeq: currentSeq,
    lastRowHash: prevHash,
  };
}

export interface AllocateLotSaleInput {
  readonly tenantId: string;
  readonly lotId: string;
  readonly sessionId: string;
  readonly auctionMode: AuctionMode;
  readonly auctioneerLicenceId: string;
  readonly buyerId: string;
  readonly boxesRequested: number;
  readonly pricePerKgPaise: bigint;
  readonly idempotencyKey: string;
  readonly fencingToken: number;
  readonly governmentPermissionRef?: string;
  readonly nowIso: string;
}

export function computeAllocationRequestHash(input: {
  lotId: string;
  sessionId: string;
  auctionMode: AuctionMode;
  auctioneerLicenceId: string;
  buyerId: string;
  boxesRequested: number;
  pricePerKgPaise: bigint;
}): string {
  return sha256HexUtf8(
    `${input.lotId}|${input.sessionId}|${input.auctionMode}|${input.auctioneerLicenceId}|${input.buyerId}|${input.boxesRequested}|${input.pricePerKgPaise.toString()}`
  );
}

export async function allocateLotSale(
  db: DbPort,
  input: AllocateLotSaleInput
): Promise<{
  allocationId: string;
  journalId: string;
  hammerPaise: string;
  buyerPayablePaise: string;
  fishermanNetPaise: string;
  bonusEscrowPaise: string;
  floorWarningTriggered: boolean;
  remainingBoxes: number;
  remainingGrams: string;
  serverLatencyMs: number;
  idempotentReplay: boolean;
}> {
  const startMs = Date.now();
  const requestHash = computeAllocationRequestHash(input);

  return db.transaction(async (tx) => {
    // §7 Check 7: Tenant-scoped Idempotency key with canonical request hash verification
    const existingRes = await tx.query<{
      allocation_id: string;
      journal_id: string;
      hammer_paise: string;
      buyer_payable_paise: string;
      fisherman_net_paise: string;
      bonus_escrow_paise: string;
      floor_warning_triggered: boolean;
      server_latency_ms: number;
      request_hash: string | null;
    }>(
      `SELECT allocation_id, journal_id, hammer_paise, buyer_payable_paise,
              fisherman_net_paise, bonus_escrow_paise, floor_warning_triggered,
              server_latency_ms, request_hash
       FROM auction.sale_allocations
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [input.tenantId, input.idempotencyKey]
    );
    const existing = existingRes.rows[0];
    if (existing) {
      if (existing.request_hash && existing.request_hash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with different allocation parameters.',
          422
        );
      }

      const lotSnap = await tx.query<{ available_boxes: number; available_grams: string }>(
        `SELECT available_boxes, available_grams FROM auction.lots WHERE lot_id = $1 AND tenant_id = $2`,
        [input.lotId, input.tenantId]
      );
      return {
        allocationId: existing.allocation_id,
        journalId: existing.journal_id,
        hammerPaise: String(existing.hammer_paise),
        buyerPayablePaise: String(existing.buyer_payable_paise),
        fishermanNetPaise: String(existing.fisherman_net_paise),
        bonusEscrowPaise: String(existing.bonus_escrow_paise),
        floorWarningTriggered: existing.floor_warning_triggered,
        remainingBoxes: lotSnap.rows[0]?.available_boxes ?? 0,
        remainingGrams: String(lotSnap.rows[0]?.available_grams ?? '0'),
        serverLatencyMs: existing.server_latency_ms,
        idempotentReplay: true,
      };
    }

    // §7 Check 8: Fencing token >= session's current lease token
    const sessionRes = await tx.query<{ fencing_token: number; status: string }>(
      `SELECT fencing_token, status FROM auction.sessions WHERE session_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [input.sessionId, input.tenantId]
    );
    const session = sessionRes.rows[0];
    if (!session || session.status !== 'OPEN') {
      throw new AppError('CONFLICT', 'Auction session is not open', 409);
    }
    if (input.fencingToken < session.fencing_token) {
      throw new AppError(
        'CONFLICT',
        `Stale leader tablet rejected (§7 Check 8): fencingToken=${input.fencingToken} < session token=${session.fencing_token}`,
        409
      );
    }

    // Load tenant & active commission policy
    const tenantRes = await tx.query<{
      floor_enforcement: FloorEnforcement;
      active_policy_id: string;
      hms_account_id: string;
      coop_pool_account_id: string;
      harbouros_revenue_account_id: string;
      gst_payable_account_id: string;
    }>(
      `SELECT floor_enforcement, active_policy_id, hms_account_id, coop_pool_account_id,
              harbouros_revenue_account_id, gst_payable_account_id
       FROM core.tenants WHERE tenant_id = $1`,
      [input.tenantId]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) {
      throw new AppError('NOT_FOUND', 'Tenant not found', 404);
    }

    const policyRes = await tx.query<{
      policy_id: string;
      commercial_mode: CommercialMode;
      commission_bps: number;
      auctioneer_share_bps: number;
      hms_share_bps: number;
      fisher_bonus_share_bps: number;
      coop_share_bps: number;
      institutional_tech_share_bps: number;
      buyer_fee_bps: number;
      gst_rate_bps: number;
      legal_signoff_ref: string | null;
      legal_signoff_date: string | null;
    }>(
      `SELECT policy_id, commercial_mode, commission_bps, auctioneer_share_bps,
              hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
              institutional_tech_share_bps, buyer_fee_bps, gst_rate_bps,
              legal_signoff_ref, legal_signoff_date
       FROM core.commission_policies WHERE policy_id = $1 AND tenant_id = $2`,
      [tenant.active_policy_id, input.tenantId]
    );
    const policyRow = policyRes.rows[0];
    if (!policyRow) {
      throw new AppError('NOT_FOUND', 'Active commission policy not found', 404);
    }

    // Load lot FOR UPDATE
    const lotRes = await tx.query<{
      lot_id: string;
      lot_code: string;
      vessel_id: string;
      fisherman_id: string;
      species_id: string;
      total_boxes: number;
      available_boxes: number;
      net_grams: string;
      available_grams: string;
      inspection_grade: string | null;
      status: string;
    }>(
      `SELECT lot_id, lot_code, vessel_id, fisherman_id, species_id,
              total_boxes, available_boxes, net_grams, available_grams,
              inspection_grade, status
       FROM auction.lots WHERE lot_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [input.lotId, input.tenantId]
    );
    const lot = lotRes.rows[0];
    if (!lot) {
      throw new AppError('NOT_FOUND', 'Lot not found', 404);
    }

    // §7 Check 3: Lot must have passed s.21 inspection
    if (lot.inspection_grade === 'REJECTED_UNFIT' || lot.status === 'BLOCKED_UNFIT') {
      throw new AppError(
        'FORBIDDEN',
        `Statutory quality block (${ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE}): Lot ${lot.lot_code} is graded ${String(lot.inspection_grade ?? 'REJECTED_UNFIT')} (${lot.status}) and cannot be auctioned.`,
        422
      );
    }

    if (
      !lot.inspection_grade ||
      lot.status === 'WEIGHED_PENDING_INSPECTION' ||
      (lot.status !== 'OPEN_FOR_AUCTION' && lot.status !== 'PARTIALLY_SOLD')
    ) {
      throw new AppError(
        'CONFLICT',
        `Statutory quality gate (${ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE}): Lot ${lot.lot_code} has status ${lot.status} (grade=${String(lot.inspection_grade ?? 'UNINSPECTED')}) and is not open for auction.`,
        409
      );
    }

    if (lot.available_boxes <= 0 || input.boxesRequested > lot.available_boxes) {
      throw new AppError(
        'CONFLICT',
        `Oversell prevented (§7): requested ${input.boxesRequested} boxes, only ${lot.available_boxes} available on ${lot.lot_code}.`,
        409
      );
    }

    // Load vessel & fisherman
    const vesselRes = await tx.query<{
      has_active_society_loan: boolean;
      loan_coop_society_id: string | null;
    }>(
      `SELECT has_active_society_loan, loan_coop_society_id FROM harbour.vessels WHERE vessel_id = $1 AND tenant_id = $2`,
      [lot.vessel_id, input.tenantId]
    );
    const vessel = vesselRes.rows[0];
    if (!vessel) {
      throw new AppError('NOT_FOUND', 'Vessel not found', 404);
    }

    const fishermanRes = await tx.query<{
      payable_account_id: string;
      bonus_escrow_account_id: string;
    }>(
      `SELECT payable_account_id, bonus_escrow_account_id FROM harbour.fishermen WHERE fisherman_id = $1 AND tenant_id = $2`,
      [lot.fisherman_id, input.tenantId]
    );
    const fisherman = fishermanRes.rows[0];
    if (!fisherman) {
      throw new AppError('NOT_FOUND', 'Fisherman not found', 404);
    }

    // §7 Check 1 & Check 2: Auctioneer licence validity & Society Loan match
    const licRes = await tx.query<{
      licence_no: string;
      status: string;
      valid_from: string;
      valid_until: string;
      deputed_by_society_id: string | null;
      payable_account_id: string;
    }>(
      `SELECT licence_no, status, valid_from, valid_until, deputed_by_society_id, payable_account_id
       FROM harbour.auctioneer_licences WHERE licence_id = $1 AND tenant_id = $2`,
      [input.auctioneerLicenceId, input.tenantId]
    );
    const licence = licRes.rows[0];
    if (!licence) {
      throw new AppError(
        'FORBIDDEN',
        `Auctioneer licence not registered for this harbour (${ACT_16_2021_CITATIONS.AUCTIONEER_LICENCE_REGISTRATION})`,
        422
      );
    }

    const todayDate = input.nowIso.slice(0, 10);
    if (
      licence.status !== 'ACTIVE' ||
      todayDate < licence.valid_from.slice(0, 10) ||
      todayDate > licence.valid_until.slice(0, 10)
    ) {
      throw new AppError(
        'FORBIDDEN',
        `Auctioneer licence ${licence.licence_no} is ${licence.status} (valid ${licence.valid_from.slice(0, 10)} to ${licence.valid_until.slice(0, 10)}) — blocked under ${ACT_16_2021_CITATIONS.AUCTIONEER_LICENCE_VALIDITY}.`,
        422
      );
    }

    if (
      vessel.has_active_society_loan &&
      input.auctionMode !== 'HMS_DIRECT_TAKEOVER' &&
      licence.deputed_by_society_id !== vessel.loan_coop_society_id
    ) {
      throw new AppError(
        'FORBIDDEN',
        `Section 4(8) violation (${ACT_16_2021_CITATIONS.SOCIETY_DEPUTED_AUCTIONEER}): Vessel has an active loan from co-op society ${String(vessel.loan_coop_society_id)}; only an auctioneer deputed by that society may conduct the auction.`,
        422
      );
    }

    if (
      input.auctionMode === 'HMS_DIRECT_TAKEOVER' &&
      (!input.governmentPermissionRef || input.governmentPermissionRef.trim().length < 3)
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Section 10 proviso HMS_DIRECT_TAKEOVER requires a valid government_permission_ref.',
        422
      );
    }

    // §7 Check 4: Section 19 Floor price check
    const speciesRes = await tx.query<{ floor_price_paise_per_kg: string; name_en: string }>(
      `SELECT floor_price_paise_per_kg, name_en FROM harbour.species WHERE species_id = $1 AND tenant_id = $2`,
      [lot.species_id, input.tenantId]
    );
    const species = speciesRes.rows[0];
    if (!species) {
      throw new AppError('NOT_FOUND', 'Species not found', 404);
    }

    const floorPaise = BigInt(species.floor_price_paise_per_kg);
    const effectivePricePerKgPaise =
      input.auctionMode === 'COOP_PROCUREMENT' ? floorPaise : input.pricePerKgPaise;

    let floorWarningTriggered = false;
    if (effectivePricePerKgPaise < floorPaise) {
      if (tenant.floor_enforcement === 'BLOCK') {
        throw new AppError(
          'BASIC_PRICE_BREACH',
          `Section 19 basic price block: Bid ${effectivePricePerKgPaise.toString()} paise/kg is below basic floor ${floorPaise.toString()} paise/kg for ${species.name_en}.`,
          422
        );
      } else if (tenant.floor_enforcement === 'WARN') {
        floorWarningTriggered = true;
      }
    }

    // Compute partial-box weight allocation (§7)
    const boxResult = computeBoxAllocation(
      {
        totalBoxes: lot.total_boxes,
        netGrams: BigInt(lot.net_grams),
        availableBoxes: lot.available_boxes,
        availableGrams: BigInt(lot.available_grams),
      },
      input.boxesRequested
    );

    const hammerPaise = computeWeightAmountPaise(
      boxResult.allocatedGrams,
      effectivePricePerKgPaise
    );

    const policyConfig: CommissionPolicyConfig = {
      commissionBps: policyRow.commission_bps,
      auctioneerShareBps: policyRow.auctioneer_share_bps,
      hmsShareBps: policyRow.hms_share_bps,
      fisherBonusShareBps: policyRow.fisher_bonus_share_bps,
      coopShareBps: policyRow.coop_share_bps,
      commercialMode: policyRow.commercial_mode,
      institutionalTechShareBps: policyRow.institutional_tech_share_bps,
      buyerFeeBps: policyRow.buyer_fee_bps,
      gstRateBps: policyRow.gst_rate_bps,
      legalSignoffRef: policyRow.legal_signoff_ref,
      legalSignoffDate: policyRow.legal_signoff_date,
    };

    // §7 Check 5: Statutory split & conservation
    const settlement = computeSaleSettlement(hammerPaise, policyConfig, input.auctionMode);

    // §7 Check 6: Lock buyer credit row FOR UPDATE and verify available limit >= buyerPayablePaise
    const buyerRes = await tx.query<{
      buyer_name: string;
      escrow_balance_paise: string;
      approved_credit_paise: string;
      unsettled_payables_paise: string;
      active_holds_paise: string;
      receivable_account_id: string;
    }>(
      `SELECT buyer_name, escrow_balance_paise, approved_credit_paise,
              unsettled_payables_paise, active_holds_paise, receivable_account_id
       FROM harbour.buyers WHERE buyer_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [input.buyerId, input.tenantId]
    );
    const buyer = buyerRes.rows[0];
    if (!buyer) {
      throw new AppError('NOT_FOUND', 'Buyer not found', 404);
    }

    const availableLimitPaise =
      BigInt(buyer.escrow_balance_paise) +
      BigInt(buyer.approved_credit_paise) -
      BigInt(buyer.unsettled_payables_paise) -
      BigInt(buyer.active_holds_paise);

    if (availableLimitPaise < settlement.buyerPayablePaise) {
      throw new AppError(
        'FORBIDDEN',
        `Buyer credit limit exceeded (§7 Check 6): ${buyer.buyer_name} available limit is ${availableLimitPaise.toString()} paise, sale requires ${settlement.buyerPayablePaise.toString()} paise.`,
        422
      );
    }

    // Determine next allocation_seq on lot
    const seqRes = await tx.query<{ next_seq: number }>(
      `SELECT COALESCE(MAX(allocation_seq), 0) + 1 AS next_seq
       FROM auction.sale_allocations WHERE tenant_id = $1 AND lot_id = $2`,
      [input.tenantId, input.lotId]
    );
    const allocationSeq = Number(seqRes.rows[0]?.next_seq ?? 1);
    const allocationId = `ALLOC-${lot.lot_code}-${allocationSeq}`;
    const journalId = `JRN-${allocationId}`;

    // Build and post balanced double-entry journal in same transaction (§5 ADR-007)
    const journalEntries = buildSaleJournalEntries(settlement, {
      buyerAccountId: buyer.receivable_account_id,
      fishermanPayableAccountId: fisherman.payable_account_id,
      fishermanBonusEscrowAccountId: fisherman.bonus_escrow_account_id,
      auctioneerAccountId: licence.payable_account_id,
      hmsAccountId: tenant.hms_account_id,
      coopAccountId: tenant.coop_pool_account_id,
      harbourosRevenueAccountId: tenant.harbouros_revenue_account_id,
      gstPayableAccountId: tenant.gst_payable_account_id,
    });

    await postJournalInTx(tx, {
      tenantId: input.tenantId,
      journalId,
      referenceType: 'SALE_ALLOCATION',
      referenceId: allocationId,
      description: `Sale allocation ${allocationId} on Lot ${lot.lot_code} (${boxResult.allocatedBoxes} boxes)`,
      entries: journalEntries,
      createdAtIso: input.nowIso,
    });

    // Update buyer unsettled_payables_paise
    await tx.query(
      `UPDATE harbour.buyers
       SET unsettled_payables_paise = unsettled_payables_paise + $1
       WHERE buyer_id = $2 AND tenant_id = $3`,
      [settlement.buyerPayablePaise.toString(), input.buyerId, input.tenantId]
    );

    // Decrement lot available_boxes and available_grams
    const newStatus = boxResult.isFullySold ? 'FULLY_SOLD' : 'PARTIALLY_SOLD';
    await tx.query(
      `UPDATE auction.lots
       SET available_boxes = $1, available_grams = $2, status = $3
       WHERE lot_id = $4 AND tenant_id = $5`,
      [
        boxResult.remainingBoxes,
        boxResult.remainingGrams.toString(),
        newStatus,
        input.lotId,
        input.tenantId,
      ]
    );

    const serverLatencyMs = Math.max(1, Date.now() - startMs);

    await tx.query(
      `INSERT INTO auction.sale_allocations (
        allocation_id, tenant_id, lot_id, allocation_seq, session_id, auction_mode,
        policy_id, auctioneer_licence_id, buyer_id, boxes_allocated, grams_allocated,
        price_per_kg_paise, hammer_paise, buyer_payable_paise, fisherman_net_paise,
        bonus_escrow_paise, auctioneer_paise, hms_net_paise, coop_net_paise,
        harbouros_revenue_paise, gst_paise, floor_warning_triggered,
        government_permission_ref, idempotency_key, request_hash, fencing_token, journal_id,
        server_latency_ms, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21, $22,
        $23, $24, $25, $26, $27,
        $28, $29
      )`,
      [
        allocationId,
        input.tenantId,
        input.lotId,
        allocationSeq,
        input.sessionId,
        input.auctionMode,
        policyRow.policy_id,
        input.auctioneerLicenceId,
        input.buyerId,
        boxResult.allocatedBoxes,
        boxResult.allocatedGrams.toString(),
        effectivePricePerKgPaise.toString(),
        settlement.hammerPaise.toString(),
        settlement.buyerPayablePaise.toString(),
        settlement.fishermanNetPaise.toString(),
        settlement.bonusEscrowPaise.toString(),
        settlement.auctioneerNetPaise.toString(),
        settlement.hmsNetPaise.toString(),
        settlement.coopNetPaise.toString(),
        settlement.harbourosRevenuePaise.toString(),
        settlement.gstOnBuyerFeePaise.toString(),
        floorWarningTriggered,
        input.governmentPermissionRef ?? null,
        input.idempotencyKey,
        requestHash,
        input.fencingToken,
        journalId,
        serverLatencyMs,
        input.nowIso,
      ]
    );

    await tx.query(
      `INSERT INTO sync.outbox_events (event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at)
       VALUES ($1, $2, 'SMS', $3, 'SALE_SETTLED_ML', $4, 'DISPATCHED_CONSOLE', $5)`,
      [
        `OUT-${allocationId}`,
        input.tenantId,
        lot.fisherman_id,
        JSON.stringify({
          lotCode: lot.lot_code,
          boxes: boxResult.allocatedBoxes,
          hammerPaise: settlement.hammerPaise.toString(),
          fishermanNetPaise: settlement.fishermanNetPaise.toString(),
          bonusEscrowPaise: settlement.bonusEscrowPaise.toString(),
        }),
        input.nowIso,
      ]
    );

    return {
      allocationId,
      journalId,
      hammerPaise: settlement.hammerPaise.toString(),
      buyerPayablePaise: settlement.buyerPayablePaise.toString(),
      fishermanNetPaise: settlement.fishermanNetPaise.toString(),
      bonusEscrowPaise: settlement.bonusEscrowPaise.toString(),
      floorWarningTriggered,
      remainingBoxes: boxResult.remainingBoxes,
      remainingGrams: boxResult.remainingGrams.toString(),
      serverLatencyMs,
      idempotentReplay: false,
    };
  });
}

async function resolveOrCreateBankClearingAccountInTx(
  tx: DbPort,
  tenantId: string
): Promise<string> {
  const bankRes = await tx.query<{ account_id: string }>(
    `SELECT account_id FROM ledger.accounts
     WHERE tenant_id = $1 AND kind = 'BANK_CLEARING'
     ORDER BY account_id ASC LIMIT 1`,
    [tenantId]
  );
  if (bankRes.rows[0]?.account_id) {
    return bankRes.rows[0].account_id;
  }
  const fallbackBankId = `ACC-BANK-${tenantId}`;
  await tx.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'BANK_CLEARING', '1100-BANK', 'HMS Nodal Bank Clearing Account', $2, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [fallbackBankId, tenantId]
  );
  return fallbackBankId;
}

export async function createPayoutBatch(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
  }
): Promise<{
  batchId: string;
  batchCode: string;
  journalId: string;
  totalAmountPaise: string;
  itemCount: number;
  items: ReadonlyArray<{
    itemId: string;
    beneficiaryId: string;
    accountId: string;
    amountPaise: string;
  }>;
}> {
  return db.transaction(async (tx) => {
    const payableRes = await tx.query<{
      account_id: string;
      owner_entity_id: string | null;
      balance_paise: string;
    }>(
      `SELECT account_id, owner_entity_id, balance_paise::text AS balance_paise
       FROM ledger.accounts
       WHERE tenant_id = $1 AND kind = 'FISHERMAN_PAYABLE' AND balance_paise > 0
       ORDER BY account_id ASC
       FOR UPDATE`,
      [params.tenantId]
    );

    let totalAmountPaise = 0n;
    for (const row of payableRes.rows) {
      totalAmountPaise += BigInt(row.balance_paise);
    }

    if (payableRes.rows.length === 0 || totalAmountPaise <= 0n) {
      throw new AppError(
        'NOTHING_PAYABLE',
        'No positive fisherman payable balances available to settle.',
        422
      );
    }

    const bankAccountId = await resolveOrCreateBankClearingAccountInTx(tx, params.tenantId);

    const cntRes = await tx.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM ledger.payout_batches WHERE tenant_id = $1`,
      [params.tenantId]
    );
    const seqNum = (cntRes.rows[0]?.cnt ?? 0) + 1;
    const nowIso = new Date().toISOString();
    const dateStamp = nowIso.slice(0, 10).replace(/-/g, '');
    const batchId = `BATCH-${crypto.randomUUID()}`;
    const batchCode = `MUN-PAY-${dateStamp}-${String(seqNum).padStart(2, '0')}`;
    const journalId = `JRN-${batchId}`;

    await tx.query(
      `INSERT INTO ledger.payout_batches (
        batch_id, tenant_id, batch_code, beneficiary_kind,
        total_amount_paise, item_count, status, bank_utr, reconciled_at, created_at
      ) VALUES ($1, $2, $3, 'FISHERMAN_NET_SETTLEMENT', $4, $5, 'GENERATED_CSV', NULL, NULL, $6)`,
      [
        batchId,
        params.tenantId,
        batchCode,
        totalAmountPaise.toString(),
        payableRes.rows.length,
        nowIso,
      ]
    );

    const items: Array<{
      itemId: string;
      beneficiaryId: string;
      accountId: string;
      amountPaise: string;
    }> = [];
    const journalEntries: JournalEntryDraft[] = [];

    for (const row of payableRes.rows) {
      const itemId = `PBI-${crypto.randomUUID()}`;
      const beneficiaryId = row.owner_entity_id ?? row.account_id;
      const amtPaise = BigInt(row.balance_paise);

      await tx.query(
        `INSERT INTO ledger.payout_batch_items (
          item_id, batch_id, tenant_id, fisherman_id, account_id, amount_paise
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [itemId, batchId, params.tenantId, beneficiaryId, row.account_id, amtPaise.toString()]
      );

      items.push({
        itemId,
        beneficiaryId,
        accountId: row.account_id,
        amountPaise: amtPaise.toString(),
      });

      // Debit FISHERMAN_PAYABLE (credit-normal account -> decrements balance to 0)
      journalEntries.push({
        accountId: row.account_id,
        direction: 'D',
        amountPaise: amtPaise,
      });
    }

    // Credit BANK_CLEARING for the batch total
    journalEntries.push({
      accountId: bankAccountId,
      direction: 'C',
      amountPaise: totalAmountPaise,
    });

    await postJournalInTx(tx, {
      tenantId: params.tenantId,
      journalId,
      referenceType: 'PAYOUT_BATCH',
      referenceId: batchId,
      description: `Fisherman net settlement payout batch ${batchCode} (${items.length} beneficiaries)`,
      entries: journalEntries,
      createdAtIso: nowIso,
    });

    await auditInTx(tx, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionCode: 'PAYOUT_BATCH_GENERATED',
      targetType: 'PAYOUT_BATCH',
      targetId: batchId,
      details: {
        actorName: params.actorFullName,
        batchCode,
        journalId,
        totalAmountPaise: totalAmountPaise.toString(),
        itemCount: items.length,
      },
    });

    return {
      batchId,
      batchCode,
      journalId,
      totalAmountPaise: totalAmountPaise.toString(),
      itemCount: items.length,
      items,
    };
  });
}

export async function recordBuyerReceipt(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
    buyerId: string;
    amountPaise: bigint;
    paymentChannel: 'UPI_ESCROW' | 'NEFT' | 'RTGS' | 'IMPS' | 'NODAL_TRANSFER';
    referenceNo: string;
    idempotencyKey: string;
  }
): Promise<{
  receiptId: string;
  buyerId: string;
  journalId: string;
  amountPaise: string;
  unsettledPayablesPaise: string;
  paymentChannel: string;
  referenceNo: string;
  idempotentReplay: boolean;
}> {
  if (!params.idempotencyKey.trim()) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Idempotency-Key header is required for buyer receipt postings.',
      400
    );
  }
  if (params.amountPaise <= 0n) {
    throw new AppError('VALIDATION_ERROR', 'amountPaise must be > 0', 400);
  }

  return db.transaction(async (tx) => {
    const existingRes = await tx.query<{
      receipt_id: string;
      buyer_id: string;
      journal_id: string;
      amount_paise: string;
      payment_reference: string;
    }>(
      `SELECT receipt_id, buyer_id, journal_id, amount_paise::text AS amount_paise,
              payment_reference
       FROM ledger.buyer_receipts
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [params.tenantId, params.idempotencyKey.trim()]
    );
    const existing = existingRes.rows[0];
    if (existing) {
      const bSnap = await tx.query<{ unsettled_payables_paise: string }>(
        `SELECT unsettled_payables_paise::text AS unsettled_payables_paise
         FROM harbour.buyers WHERE buyer_id = $1 AND tenant_id = $2`,
        [existing.buyer_id, params.tenantId]
      );
      return {
        receiptId: existing.receipt_id,
        buyerId: existing.buyer_id,
        journalId: existing.journal_id,
        amountPaise: existing.amount_paise,
        unsettledPayablesPaise: bSnap.rows[0]?.unsettled_payables_paise ?? '0',
        paymentChannel: params.paymentChannel,
        referenceNo: existing.payment_reference,
        idempotentReplay: true,
      };
    }

    const buyerRes = await tx.query<{
      buyer_id: string;
      buyer_name: string;
      unsettled_payables_paise: string;
      receivable_account_id: string;
    }>(
      `SELECT buyer_id, buyer_name, unsettled_payables_paise::text AS unsettled_payables_paise,
              receivable_account_id
       FROM harbour.buyers
       WHERE buyer_id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [params.buyerId, params.tenantId]
    );
    const buyer = buyerRes.rows[0];
    if (!buyer) {
      throw new AppError('NOT_FOUND', `Buyer ${params.buyerId} not found`, 404);
    }

    const currentUnsettled = BigInt(buyer.unsettled_payables_paise);
    if (params.amountPaise > currentUnsettled) {
      throw new AppError(
        'OVERPAYMENT_REJECTED',
        `Receipt amount (${params.amountPaise.toString()} paise) exceeds buyer unsettled payables (${currentUnsettled.toString()} paise).`,
        422
      );
    }

    const bankAccountId = await resolveOrCreateBankClearingAccountInTx(tx, params.tenantId);
    const receiptId = `RCPT-${crypto.randomUUID()}`;
    const journalId = `JRN-${receiptId}`;
    const nowIso = new Date().toISOString();

    await postJournalInTx(tx, {
      tenantId: params.tenantId,
      journalId,
      referenceType: 'BUYER_RECEIPT',
      referenceId: receiptId,
      description: `Buyer settlement receipt ${receiptId} from ${buyer.buyer_name} (${params.paymentChannel} ${params.referenceNo})`,
      entries: [
        {
          accountId: bankAccountId,
          direction: 'D',
          amountPaise: params.amountPaise,
        },
        {
          accountId: buyer.receivable_account_id,
          direction: 'C',
          amountPaise: params.amountPaise,
        },
      ],
      createdAtIso: nowIso,
    });

    const newUnsettled = currentUnsettled - params.amountPaise;
    await tx.query(
      `UPDATE harbour.buyers
       SET unsettled_payables_paise = $1
       WHERE buyer_id = $2 AND tenant_id = $3`,
      [newUnsettled.toString(), params.buyerId, params.tenantId]
    );

    await tx.query(
      `INSERT INTO ledger.buyer_receipts (
        receipt_id, tenant_id, buyer_id, amount_paise, payment_reference,
        idempotency_key, journal_id, recorded_by_user_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        receiptId,
        params.tenantId,
        params.buyerId,
        params.amountPaise.toString(),
        params.referenceNo,
        params.idempotencyKey.trim(),
        journalId,
        params.actorUserId,
        nowIso,
      ]
    );

    await auditInTx(tx, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionCode: 'BUYER_RECEIPT_RECORDED',
      targetType: 'BUYER_RECEIPT',
      targetId: receiptId,
      details: {
        actorName: params.actorFullName,
        buyerId: params.buyerId,
        amountPaise: params.amountPaise.toString(),
        unsettledPayablesPaise: newUnsettled.toString(),
        paymentChannel: params.paymentChannel,
        referenceNo: params.referenceNo,
        journalId,
      },
    });

    return {
      receiptId,
      buyerId: params.buyerId,
      journalId,
      amountPaise: params.amountPaise.toString(),
      unsettledPayablesPaise: newUnsettled.toString(),
      paymentChannel: params.paymentChannel,
      referenceNo: params.referenceNo,
      idempotentReplay: false,
    };
  });
}

export async function verifyTenantLedgerChain(
  db: DbPort,
  tenantId: string
): Promise<{
  verified: boolean;
  entryCount: number;
  lastEntrySeq: string;
  headHash: string;
  failedAtSeq?: string;
  failureReason?: string;
}> {
  const entriesRes = await db.query<{
    entry_seq: string;
    journal_id: string;
    account_id: string;
    direction: 'D' | 'C';
    amount_paise: string;
    prev_row_hash: string;
    row_hash: string;
    created_at_utc_iso_ms: string;
  }>(
    `SELECT entry_seq, journal_id, account_id, direction, amount_paise,
            prev_row_hash, row_hash, created_at_utc_iso_ms
     FROM ledger.entries WHERE tenant_id = $1 ORDER BY entry_seq ASC`,
    [tenantId]
  );

  let expectedPrev = GENESIS_PREV_HASH;
  let lastSeq = '0';

  for (const row of entriesRes.rows) {
    if (row.prev_row_hash !== expectedPrev) {
      return {
        verified: false,
        entryCount: entriesRes.rows.length,
        lastEntrySeq: lastSeq,
        headHash: expectedPrev,
        failedAtSeq: String(row.entry_seq),
        failureReason: `prev_row_hash mismatch at seq ${String(row.entry_seq)}`,
      };
    }

    const recomputed = computeLedgerEntryHash({
      tenantId,
      entrySeq: BigInt(row.entry_seq),
      prevRowHash: row.prev_row_hash,
      journalId: row.journal_id,
      accountId: row.account_id,
      direction: row.direction,
      amountPaise: BigInt(row.amount_paise),
      createdAtUtcIsoMs: row.created_at_utc_iso_ms,
    });

    if (recomputed !== row.row_hash) {
      return {
        verified: false,
        entryCount: entriesRes.rows.length,
        lastEntrySeq: lastSeq,
        headHash: expectedPrev,
        failedAtSeq: String(row.entry_seq),
        failureReason: `SHA-256 digest mismatch at seq ${String(row.entry_seq)}`,
      };
    }

    expectedPrev = row.row_hash;
    lastSeq = String(row.entry_seq);
  }

  return {
    verified: true,
    entryCount: entriesRes.rows.length,
    lastEntrySeq: lastSeq,
    headHash: expectedPrev,
  };
}

export async function executeDualKeyReversal(
  db: DbPort,
  params: {
    tenantId: string;
    reversalId: string;
    approverUserId: string;
    approverName: string;
    nowIso: string;
  }
): Promise<{ compensatingJournalId: string }> {
  return db.transaction(async (tx) => {
    const revRes = await tx.query<{
      reversal_id: string;
      original_journal_id: string;
      reason_note: string;
      requested_by_user_id: string;
      status: string;
    }>(
      `SELECT reversal_id, original_journal_id, reason_note, requested_by_user_id, status
       FROM ledger.reversal_requests WHERE reversal_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [params.reversalId, params.tenantId]
    );
    const rev = revRes.rows[0];
    if (!rev) {
      throw new AppError('NOT_FOUND', 'Reversal request not found', 404);
    }
    if (rev.status !== 'PENDING_SECOND_APPROVAL') {
      throw new AppError('CONFLICT', 'Reversal request is already executed', 409);
    }
    if (rev.requested_by_user_id === params.approverUserId) {
      throw new AppError(
        'FORBIDDEN',
        'Dual-key control violation (§7 Reversals): Second authorizing user must differ from requesting user.',
        422
      );
    }

    const origEntriesRes = await tx.query<{
      account_id: string;
      direction: 'D' | 'C';
      amount_paise: string;
    }>(
      `SELECT account_id, direction, amount_paise FROM ledger.entries
       WHERE tenant_id = $1 AND journal_id = $2 ORDER BY entry_seq ASC`,
      [params.tenantId, rev.original_journal_id]
    );

    const originalDrafts: JournalEntryDraft[] = origEntriesRes.rows.map((r) => ({
      accountId: r.account_id,
      direction: r.direction,
      amountPaise: BigInt(r.amount_paise),
    }));

    const compensatingEntries = buildReversalJournalEntries(originalDrafts);
    const compensatingJournalId = `JRN-REV-${params.reversalId}`;

    await postJournalInTx(tx, {
      tenantId: params.tenantId,
      journalId: compensatingJournalId,
      referenceType: 'REVERSAL',
      referenceId: params.reversalId,
      description: `Dual-key compensating reversal of ${rev.original_journal_id}: ${rev.reason_note}`,
      entries: compensatingEntries,
      createdAtIso: params.nowIso,
      reversesJournalId: rev.original_journal_id,
      authorizedByUser1: rev.requested_by_user_id,
      authorizedByUser2: params.approverUserId,
      reasonNote: rev.reason_note,
    });

    await tx.query(
      `UPDATE ledger.reversal_requests
       SET approved_by_user_id = $1, approved_by_name = $2,
           compensating_journal_id = $3, status = 'EXECUTED'
       WHERE reversal_id = $4 AND tenant_id = $5`,
      [
        params.approverUserId,
        params.approverName,
        compensatingJournalId,
        params.reversalId,
        params.tenantId,
      ]
    );

    return { compensatingJournalId };
  });
}
