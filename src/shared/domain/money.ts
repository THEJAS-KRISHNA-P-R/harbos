/**
 * §7 Domain Money & Weight Rules
 * - Money = bigint paise (1 INR = 100 paise)
 * - Weight = bigint grams (1 kg = 1000 grams)
 * - Rates = integer basis points (10,000 bps = 100%)
 */

export const BPS_DENOMINATOR = 10_000n;
export const GRAMS_PER_KG = 1_000n;

/**
 * §7 Price × weight:
 * amountPaise = (grams * pricePerKgPaise + 500n) / 1000n (round half up)
 */
export function computeWeightAmountPaise(grams: bigint, pricePerKgPaise: bigint): bigint {
  if (grams < 0n) {
    throw new Error('grams must be non-negative');
  }
  if (pricePerKgPaise < 0n) {
    throw new Error('pricePerKgPaise must be non-negative');
  }
  return (grams * pricePerKgPaise + 500n) / GRAMS_PER_KG;
}

/**
 * Applies basis points with round-half-up integer math:
 * (amountPaise * bps + 5000n) / 10000n
 */
export function applyBpsRoundHalfUp(amountPaise: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new Error(`Invalid bps: ${bps}`);
  }
  return (amountPaise * BigInt(bps) + 5_000n) / BPS_DENOMINATOR;
}

/**
 * Formats integer paise into Indian Rupee display string (en-IN grouping, ₹ symbol).
 */
export function formatInrFromPaise(paise: bigint | string | number): string {
  const val = typeof paise === 'bigint' ? paise : BigInt(paise);
  const isNegative = val < 0n;
  const abs = isNegative ? -val : val;
  const rupees = abs / 100n;
  const remPaise = abs % 100n;
  const formattedRupees = Number(rupees).toLocaleString('en-IN');
  const paiseStr = remPaise.toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}₹${formattedRupees}.${paiseStr}`;
}

export function formatKgFromGrams(grams: bigint | string | number): string {
  const val = typeof grams === 'bigint' ? grams : BigInt(grams);
  const wholeKg = val / 1000n;
  const remGrams = val % 1000n;
  return `${Number(wholeKg).toLocaleString('en-IN')}.${remGrams.toString().padStart(3, '0')} kg`;
}
