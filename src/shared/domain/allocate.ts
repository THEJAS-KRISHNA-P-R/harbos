/**
 * §7 Partial-box allocation rules:
 * - A lot has totalBoxes and netGrams (and current availableBoxes, availableGrams).
 * - Allocation of k boxes takes floor(netGrams * k / totalBoxes) grams,
 *   except the last allocation (k === availableBoxes), which takes all remaining availableGrams
 *   so the sum of allocations across a lot equals netGrams exactly.
 * - If per-box weights (boxGrams[]) are explicitly provided for the k boxes, their exact sum is used.
 */

export interface LotWeightState {
  readonly totalBoxes: number;
  readonly netGrams: bigint;
  readonly availableBoxes: number;
  readonly availableGrams: bigint;
}

export interface BoxAllocationResult {
  readonly allocatedBoxes: number;
  readonly allocatedGrams: bigint;
  readonly remainingBoxes: number;
  readonly remainingGrams: bigint;
  readonly isFullySold: boolean;
}

export function computeBoxAllocation(
  lot: LotWeightState,
  requestedBoxes: number,
  explicitBoxGrams?: ReadonlyArray<bigint>
): BoxAllocationResult {
  if (!Number.isInteger(requestedBoxes) || requestedBoxes <= 0) {
    throw new Error(`requestedBoxes must be a positive integer; got ${requestedBoxes}`);
  }
  if (requestedBoxes > lot.availableBoxes) {
    throw new Error(
      `Oversell blocked: requested ${requestedBoxes} boxes, but only ${lot.availableBoxes} available`
    );
  }
  if (lot.totalBoxes <= 0 || lot.netGrams <= 0n || lot.availableGrams <= 0n) {
    throw new Error('Invalid lot box/weight state');
  }

  let allocatedGrams: bigint;

  if (explicitBoxGrams && explicitBoxGrams.length > 0) {
    if (explicitBoxGrams.length !== requestedBoxes) {
      throw new Error('explicitBoxGrams length must equal requestedBoxes');
    }
    allocatedGrams = explicitBoxGrams.reduce((acc, g) => acc + g, 0n);
    if (allocatedGrams <= 0n || allocatedGrams > lot.availableGrams) {
      throw new Error('Explicit box weights exceed available lot weight');
    }
  } else if (requestedBoxes === lot.availableBoxes) {
    // Last allocation takes all remaining grams so sum equals lot netGrams exactly
    allocatedGrams = lot.availableGrams;
  } else {
    allocatedGrams = (lot.netGrams * BigInt(requestedBoxes)) / BigInt(lot.totalBoxes);
    if (allocatedGrams <= 0n) {
      allocatedGrams = 1n;
    }
    if (allocatedGrams >= lot.availableGrams) {
      allocatedGrams = lot.availableGrams - 1n;
    }
  }

  const remainingBoxes = lot.availableBoxes - requestedBoxes;
  const remainingGrams = lot.availableGrams - allocatedGrams;

  return {
    allocatedBoxes: requestedBoxes,
    allocatedGrams,
    remainingBoxes,
    remainingGrams,
    isFullySold: remainingBoxes === 0,
  };
}
