import { type DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import { computeWeightAmountPaise } from '@shared/domain/money.ts';
import {
  computeSaleSettlement,
  type CommissionPolicyConfig,
} from '@shared/domain/split.ts';
import { computeBoxAllocation } from '@shared/domain/allocate.ts';
import {
  sha256HexUtf8,
  buildSaleJournalEntries,
} from '@shared/domain/ledger-hash.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import type { AuctionMode } from '@shared/ids.ts';
import { postJournalInTx } from './posting.ts';
import {
  fetchAllocationActorsInTx,
  fetchLotRemainingInTx,
  fetchNextAllocationSeqInTx,
  fetchTenantAndPolicyInTx,
  finalizeAllocationStateInTx,
  findExistingAllocationByIdempotencyInTx,
  lockBuyerInTx,
  lockLotInTx,
  lockSessionInTx,
} from './repo.ts';

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

/**
 * Executes an atomic statutory lot sale allocation (Act 16 of 2021 §7).
 * Enforces Phase 2.7 lock acquisition order:
 *   `session -> lot -> buyer -> accounts (sorted by id) -> tenant head LAST`
 */
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
    const existing = await findExistingAllocationByIdempotencyInTx(
      tx,
      input.tenantId,
      input.idempotencyKey
    );
    if (existing) {
      if (existing.request_hash && existing.request_hash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with different allocation parameters.',
          422
        );
      }

      const lotSnap = await fetchLotRemainingInTx(tx, input.tenantId, input.lotId);
      return {
        allocationId: existing.allocation_id,
        journalId: existing.journal_id,
        hammerPaise: String(existing.hammer_paise),
        buyerPayablePaise: String(existing.buyer_payable_paise),
        fishermanNetPaise: String(existing.fisherman_net_paise),
        bonusEscrowPaise: String(existing.bonus_escrow_paise),
        floorWarningTriggered: existing.floor_warning_triggered,
        remainingBoxes: lotSnap?.available_boxes ?? 0,
        remainingGrams: String(lotSnap?.available_grams ?? '0'),
        serverLatencyMs: existing.server_latency_ms,
        idempotentReplay: true,
      };
    }

    // Lock 1: Session FOR UPDATE
    const session = await lockSessionInTx(tx, input.tenantId, input.sessionId);
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

    const { tenant, policy: policyRow } = await fetchTenantAndPolicyInTx(
      tx,
      input.tenantId
    );
    if (!tenant) {
      throw new AppError('NOT_FOUND', 'Tenant not found', 404);
    }
    if (!policyRow) {
      throw new AppError('NOT_FOUND', 'Active commission policy not found', 404);
    }

    // Lock 2: Lot FOR UPDATE
    const lot = await lockLotInTx(tx, input.tenantId, input.lotId);
    if (!lot) {
      throw new AppError('NOT_FOUND', 'Lot not found', 404);
    }

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

    const { vessel, fisherman, licence, species } = await fetchAllocationActorsInTx(
      tx,
      {
        tenantId: input.tenantId,
        vesselId: lot.vessel_id,
        fishermanId: lot.fisherman_id,
        licenceId: input.auctioneerLicenceId,
        speciesId: lot.species_id,
      }
    );
    if (!vessel) throw new AppError('NOT_FOUND', 'Vessel not found', 404);
    if (!fisherman) throw new AppError('NOT_FOUND', 'Fisherman not found', 404);
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

    if (!species) throw new AppError('NOT_FOUND', 'Species not found', 404);

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

    const settlement = computeSaleSettlement(hammerPaise, policyConfig, input.auctionMode);

    // Lock 3: Buyer FOR UPDATE
    const buyer = await lockBuyerInTx(tx, input.tenantId, input.buyerId);
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

    const allocationSeq = await fetchNextAllocationSeqInTx(
      tx,
      input.tenantId,
      input.lotId
    );
    const allocationId = `ALLOC-${lot.lot_code}-${allocationSeq}`;
    const journalId = `JRN-${allocationId}`;

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

    // Lock 4 & 5: postJournalInTx locks accounts (sorted by ID) then tenant head LAST
    await postJournalInTx(tx, {
      tenantId: input.tenantId,
      journalId,
      referenceType: 'SALE_ALLOCATION',
      referenceId: allocationId,
      description: `Sale allocation ${allocationId} on Lot ${lot.lot_code} (${boxResult.allocatedBoxes} boxes)`,
      entries: journalEntries,
      createdAtIso: input.nowIso,
    });

    const newStatus = boxResult.isFullySold ? 'FULLY_SOLD' : 'PARTIALLY_SOLD';
    const serverLatencyMs = Math.max(1, Date.now() - startMs);

    await finalizeAllocationStateInTx(tx, {
      tenantId: input.tenantId,
      buyerId: input.buyerId,
      buyerPayableDeltaPaise: settlement.buyerPayablePaise.toString(),
      lotId: input.lotId,
      remainingBoxes: boxResult.remainingBoxes,
      remainingGrams: boxResult.remainingGrams.toString(),
      newLotStatus: newStatus,
      allocationRowParams: [
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
      ],
      outboxEventId: `OUT-${allocationId}`,
      fishermanId: lot.fisherman_id,
      outboxPayloadJson: JSON.stringify({
        lotCode: lot.lot_code,
        boxes: boxResult.allocatedBoxes,
        hammerPaise: settlement.hammerPaise.toString(),
        fishermanNetPaise: settlement.fishermanNetPaise.toString(),
        bonusEscrowPaise: settlement.bonusEscrowPaise.toString(),
      }),
      nowIso: input.nowIso,
    });

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
