const EXPLICIT_CODE_LABELS: Readonly<Record<string, string>> = {
  A_EXPORT: 'Export Grade A',
  A_DOMESTIC: 'Domestic Grade A',
  B_PROCESS: 'Processing Grade B',
  REJECTED_UNFIT: 'Rejected unfit',
  BLOCKED_UNFIT: 'Blocked unfit',
  OPEN_FOR_AUCTION: 'Open for auction',
  PARTIALLY_SOLD: 'Partially sold',
  FULLY_SOLD: 'Fully sold',
  PHYSICAL_SHOUT: 'Pit shout',
  HYBRID_REMOTE: 'Hybrid remote',
  DUTCH_CLOCK: 'Dutch clock',
  COOP_PROCUREMENT: 'Co-op procurement',
  HMS_DIRECT_TAKEOVER: 'Harbour takeover',
  GENERATED_CSV: 'CSV ready',
  RECONCILED_UTR: 'UTR reconciled',
  PENDING_SECOND_APPROVAL: 'Awaiting 2nd key',
  FISHERMAN_NET_SETTLEMENT: 'Fisherman net settlement',
  FISHER_BONUS_ESCROW: 'Fisher bonus escrow',
  AUCTIONEER_COMMISSION: 'Auctioneer commission',
  HMS_COMMISSION: 'Harbour office share',
  COOP_SOCIETY_SHARE: 'Co-op society share',
  LOT_ALLOCATED: 'Lot allocated',
  LOT_WEIGHED: 'Lot weighed',
  LOT_INSPECTED: 'Lot inspected',
  LOT_REJECTED_S21: 'Lot rejected unfit',
  PAYOUT_BATCH_GENERATED: 'Payout batch generated',
  PAYOUT_BATCH_RECONCILED: 'Payout batch reconciled',
  REVERSAL_REQUESTED: 'Reversal requested',
  REVERSAL_EXECUTED: 'Reversal executed',
  HARBOUR_ADMIN: 'Harbour admin',
  LICENSED_AUCTIONEER: 'Licensed auctioneer',
  WEIGHING_OPERATOR: 'Weighing operator',
  WHOLESALE_BUYER: 'Wholesale buyer',
  FISHERMAN_BOAT_OWNER: 'Vessel owner',
  AUTHORIZED_INSPECTOR: 'Quality inspector',
  SUPER_ADMIN: 'Platform admin',
  ACCOUNTANT: 'Accountant',
};

/**
 * Turns machine codes like REJECTED_UNFIT or FISHERMAN_NET_SETTLEMENT into readable text;
 * leaves normal prose, numbers, and non-snake-case labels untouched.
 */
export function humanizeCode(label: string | null | undefined): string {
  if (typeof label !== 'string') {
    return '';
  }
  const trimmed = label.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed in EXPLICIT_CODE_LABELS) {
    return EXPLICIT_CODE_LABELS[trimmed]!;
  }
  if (!/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(trimmed)) {
    return label;
  }
  const words = trimmed.toLowerCase().split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface PitSalePreview {
  boxesClamped: number;
  gramsAllocated: bigint;
  hammerPaise: bigint;
  fishermanNetPaise: bigint;
  bonusEscrowPaise: bigint;
  floorStatus: 'ABOVE' | 'AT' | 'BELOW';
  priceDiffPerKgPaise: bigint;
}

/**
 * Pure BigInt preview of an auction pit allocation before submission.
 * Uses the statutory 95% fisherman net / 2% bonus escrow split for display preview only;
 * authoritative settlement math always runs server-side.
 */
export function computePitSalePreview(params: {
  priceRupeesPerKg: number;
  boxesRequested: number;
  lotTotalBoxes: number;
  lotAvailableBoxes: number;
  lotNetGrams: bigint;
  floorPricePaisePerKg: bigint;
}): PitSalePreview {
  const safeTotalBoxes = Math.max(1, Math.floor(params.lotTotalBoxes || 1));
  const safeAvailable = Math.max(0, Math.floor(params.lotAvailableBoxes || 0));
  const boxesClamped = clampBoxCount(params.boxesRequested, safeAvailable);
  const pricePerKgPaise = BigInt(Math.max(0, Math.round((Number(params.priceRupeesPerKg) || 0) * 100)));

  const gramsAllocated =
    safeAvailable > 0
      ? (params.lotNetGrams * BigInt(boxesClamped)) / BigInt(safeTotalBoxes)
      : 0n;

  const hammerPaise = (gramsAllocated * pricePerKgPaise) / 1000n;
  const commissionPaise = (hammerPaise * 5n) / 100n;
  const fishermanNetPaise = hammerPaise - commissionPaise;
  const bonusEscrowPaise = (commissionPaise * 40n) / 100n;

  const priceDiffPerKgPaise = pricePerKgPaise - params.floorPricePaisePerKg;
  const floorStatus: 'ABOVE' | 'AT' | 'BELOW' =
    priceDiffPerKgPaise > 0n ? 'ABOVE' : priceDiffPerKgPaise < 0n ? 'BELOW' : 'AT';

  return {
    boxesClamped,
    gramsAllocated,
    hammerPaise,
    fishermanNetPaise,
    bonusEscrowPaise,
    floorStatus,
    priceDiffPerKgPaise,
  };
}

export function clampBoxCount(requested: number, available: number): number {
  const maxBoxes = Math.max(1, Math.floor(available || 0));
  const req = Math.floor(Number.isFinite(requested) ? requested : 1);
  if (req < 1) return 1;
  if (req > maxBoxes) return maxBoxes;
  return req;
}

export function stepTemperatureC(current: string, delta: number): string {
  const parsed = Number(current);
  const base = Number.isFinite(parsed) ? parsed : 2.0;
  const next = Math.min(35, Math.max(-2, Math.round((base + delta) * 10) / 10));
  return next.toFixed(1);
}
