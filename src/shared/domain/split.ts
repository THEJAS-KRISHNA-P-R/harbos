import type { CommercialMode, AuctionMode } from '@shared/ids.ts';
import { BPS_DENOMINATOR, applyBpsRoundHalfUp } from '@shared/domain/money.ts';

export interface CommissionPolicyConfig {
  readonly commissionBps: number; // <= 500 for Kerala regimes
  readonly auctioneerShareBps: number; // e.g., 2000 (20%)
  readonly hmsShareBps: number; // e.g., 2000 (20%)
  readonly fisherBonusShareBps: number; // e.g., 4000 (40% harbour) or 3000 (30% market)
  readonly coopShareBps: number; // e.g., 2000 (20% harbour) or 3000 (30% market)
  readonly commercialMode: CommercialMode;
  readonly institutionalTechShareBps?: number; // Default 2000 (20% of HMS + Co-op shares)
  readonly buyerFeeBps?: number; // Default 100 (1.00% in HYBRID Mode C)
  readonly gstRateBps?: number; // Default 1800 (18% on buyer fee in Mode C)
  readonly legalSignoffRef?: string | null;
  readonly legalSignoffDate?: string | null;
}

export interface SettlementBreakdown {
  readonly hammerPaise: bigint;
  readonly totalCommissionPaise: bigint;
  readonly fishermanNetPaise: bigint;
  readonly bonusEscrowPaise: bigint;
  readonly auctioneerGrossPaise: bigint;
  readonly hmsGrossPaise: bigint;
  readonly coopGrossPaise: bigint;
  readonly auctioneerNetPaise: bigint;
  readonly hmsNetPaise: bigint;
  readonly coopNetPaise: bigint;
  readonly harbourosInstitutionalSharePaise: bigint;
  readonly buyerFeePaise: bigint;
  readonly gstOnBuyerFeePaise: bigint;
  readonly harbourosRevenuePaise: bigint;
  readonly buyerPayablePaise: bigint;
}

/**
 * §7 Deterministic Largest-Remainder Allocation across 4 statutory pillars
 * Tie-break order: 0: Auctioneer, 1: HMS/Market society, 2: Fisher bonus/Welfare fund, 3: Co-op/LSGI
 */
export function allocateLargestRemainder(
  totalAmountPaise: bigint,
  weightsBps: readonly [number, number, number, number]
): [bigint, bigint, bigint, bigint] {
  const sumBps = weightsBps[0] + weightsBps[1] + weightsBps[2] + weightsBps[3];
  if (sumBps !== 10_000) {
    throw new Error(`Statutory split weights must sum to 10,000 bps; got ${sumBps}`);
  }

  const floors: [bigint, bigint, bigint, bigint] = [0n, 0n, 0n, 0n];
  const remainders: Array<{ index: 0 | 1 | 2 | 3; rem: bigint }> = [];
  let allocated = 0n;

  for (const idx of [0, 1, 2, 3] as const) {
    const num = totalAmountPaise * BigInt(weightsBps[idx]);
    const q = num / BPS_DENOMINATOR;
    const r = num % BPS_DENOMINATOR;
    floors[idx] = q;
    allocated += q;
    remainders.push({ index: idx, rem: r });
  }

  let leftover = totalAmountPaise - allocated;
  remainders.sort((a, b) => {
    if (b.rem !== a.rem) return b.rem > a.rem ? 1 : -1;
    return a.index - b.index; // Deterministic tie-break order
  });

  let i = 0;
  while (leftover > 0n && i < remainders.length) {
    const item = remainders[i];
    if (item) {
      floors[item.index] += 1n;
      leftover -= 1n;
    }
    i++;
  }

  return floors;
}

export function computeSaleSettlement(
  hammerPaise: bigint,
  policy: CommissionPolicyConfig,
  auctionMode: AuctionMode = 'PHYSICAL_SHOUT'
): SettlementBreakdown {
  if (hammerPaise <= 0n) {
    throw new Error('hammerPaise must be > 0');
  }
  if (policy.commissionBps < 0 || policy.commissionBps > 500) {
    throw new Error(`Statutory cap breach (Act 16 s.4(4)): commissionBps=${policy.commissionBps} exceeds 500 bps`);
  }

  // C7: Modes B and C require legal_signoff_ref and legal_signoff_date
  if (
    policy.commercialMode !== 'FIXED_SAAS_ONLY' &&
    (!policy.legalSignoffRef || !policy.legalSignoffDate)
  ) {
    throw new Error(
      `Commercial mode ${policy.commercialMode} requires legalSignoffRef and legalSignoffDate (C7 / OPEN-02)`
    );
  }

  // C13: Section 19(2) COOP_PROCUREMENT at basic price has 0 auction commission
  if (auctionMode === 'COOP_PROCUREMENT') {
    return {
      hammerPaise,
      totalCommissionPaise: 0n,
      fishermanNetPaise: hammerPaise,
      bonusEscrowPaise: 0n,
      auctioneerGrossPaise: 0n,
      hmsGrossPaise: 0n,
      coopGrossPaise: 0n,
      auctioneerNetPaise: 0n,
      hmsNetPaise: 0n,
      coopNetPaise: 0n,
      harbourosInstitutionalSharePaise: 0n,
      buyerFeePaise: 0n,
      gstOnBuyerFeePaise: 0n,
      harbourosRevenuePaise: 0n,
      buyerPayablePaise: hammerPaise,
    };
  }

  // C12: Section 10 proviso HMS_DIRECT_TAKEOVER shifts auctioneer share to HMS
  const weights: [number, number, number, number] =
    auctionMode === 'HMS_DIRECT_TAKEOVER'
      ? [
          0,
          policy.hmsShareBps + policy.auctioneerShareBps,
          policy.fisherBonusShareBps,
          policy.coopShareBps,
        ]
      : [
          policy.auctioneerShareBps,
          policy.hmsShareBps,
          policy.fisherBonusShareBps,
          policy.coopShareBps,
        ];

  const totalCommissionPaise = applyBpsRoundHalfUp(hammerPaise, policy.commissionBps);
  const fishermanNetPaise = hammerPaise - totalCommissionPaise;

  const [auctioneerGrossPaise, hmsGrossPaise, bonusEscrowPaise, coopGrossPaise] =
    allocateLargestRemainder(totalCommissionPaise, weights);

  let hmsNetPaise = hmsGrossPaise;
  let coopNetPaise = coopGrossPaise;
  let harbourosInstitutionalSharePaise = 0n;

  if (
    policy.commercialMode === 'INSTITUTIONAL_TECH_SHARE' ||
    policy.commercialMode === 'HYBRID'
  ) {
    const techShareBps = policy.institutionalTechShareBps ?? 2000; // 20% of HMS & Co-op shares
    const hmsCut = applyBpsRoundHalfUp(hmsGrossPaise, techShareBps);
    const coopCut = applyBpsRoundHalfUp(coopGrossPaise, techShareBps);
    hmsNetPaise = hmsGrossPaise - hmsCut;
    coopNetPaise = coopGrossPaise - coopCut;
    harbourosInstitutionalSharePaise = hmsCut + coopCut;
  }

  let buyerFeePaise = 0n;
  let gstOnBuyerFeePaise = 0n;

  if (policy.commercialMode === 'HYBRID') {
    const buyerFeeBps = policy.buyerFeeBps ?? 100; // 100 bps = 1%
    const gstRateBps = policy.gstRateBps ?? 1800; // 18% GST on buyer fee only (C8)
    buyerFeePaise = applyBpsRoundHalfUp(hammerPaise, buyerFeeBps);
    gstOnBuyerFeePaise = applyBpsRoundHalfUp(buyerFeePaise, gstRateBps);
  }

  const harbourosRevenuePaise = harbourosInstitutionalSharePaise + buyerFeePaise;
  const buyerPayablePaise = hammerPaise + buyerFeePaise + gstOnBuyerFeePaise;

  // Conservation invariant check (§2)
  const conservedSum =
    fishermanNetPaise +
    bonusEscrowPaise +
    auctioneerGrossPaise +
    hmsNetPaise +
    coopNetPaise +
    harbourosRevenuePaise +
    gstOnBuyerFeePaise;

  if (conservedSum !== buyerPayablePaise) {
    throw new Error(
      `Conservation law violated: sum=${conservedSum.toString()} !== buyerPayable=${buyerPayablePaise.toString()}`
    );
  }

  return {
    hammerPaise,
    totalCommissionPaise,
    fishermanNetPaise,
    bonusEscrowPaise,
    auctioneerGrossPaise,
    hmsGrossPaise,
    coopGrossPaise,
    auctioneerNetPaise: auctioneerGrossPaise,
    hmsNetPaise,
    coopNetPaise,
    harbourosInstitutionalSharePaise,
    buyerFeePaise,
    gstOnBuyerFeePaise,
    harbourosRevenuePaise,
    buyerPayablePaise,
  };
}
