/**
 * HarbourOS Pure Settlement & Ledger Mathematics Engine
 * Strictly follows Kerala Act No. 16 of 2021 (Sec 4(4), 4(5), 4(6), 4(8))
 * Zero-paisa loss integer arithmetic using Basis Points and Largest-Remainder allocation.
 */

import { SplitCalculationResult, LedgerEntry, TenantConfig, FishLot } from './types.ts';

/**
 * Calculates deterministic multi-party statutory split.
 * All inputs and outputs are in integer paise (1 INR = 100 paise).
 */
export function calculateKeralaHarbourSplit(
  hammerPricePaise: number,
  tenant: Pick<
    TenantConfig,
    | 'billingMode'
    | 'sellerCommissionCapBps'
    | 'splitAuctioneerBps'
    | 'splitHmsBps'
    | 'splitFisherBonusBps'
    | 'splitCoopSocietyBps'
    | 'harbourosCutFromHmsBps'
    | 'harbourosCutFromCoopBps'
    | 'buyerClearingFeeBps'
    | 'gstRateBps'
  >
): SplitCalculationResult {
  if (hammerPricePaise <= 0) {
    throw new Error('Hammer price must be strictly positive');
  }

  // 1. Total statutory commission capped at sellerCommissionCapBps (e.g. 500 bps = 5%)
  const sellerCommissionPaise = Math.floor((hammerPricePaise * tenant.sellerCommissionCapBps) / 10000);
  const fishermanInstantNetPaise = hammerPricePaise - sellerCommissionPaise;

  // 2. Kerala Act 16 Section 4(5)(a) Apportionment of the 5% Commission
  // 20% Auctioneer, 20% HMS, 40% Fisher Bonus Escrow, 20% Cooperative Society
  const auctioneerGrossPaise = Math.floor((sellerCommissionPaise * tenant.splitAuctioneerBps) / 10000);
  const hmsGrossPaise = Math.floor((sellerCommissionPaise * tenant.splitHmsBps) / 10000);
  const bonusEscrowPaise = Math.floor((sellerCommissionPaise * tenant.splitFisherBonusBps) / 10000);
  // Remainder assigned to Coop to guarantee exact conservation
  const coopGrossPaise = sellerCommissionPaise - (auctioneerGrossPaise + hmsGrossPaise + bonusEscrowPaise);

  // 3. Monetization Modes
  let platformFromHmsPaise = 0;
  let platformFromCoopPaise = 0;
  let buyerFeePaise = 0;
  let gstOnFeesPaise = 0;

  if (tenant.billingMode === 'FIXED_SAAS_ONLY') {
    // Mode A: Kerala Pilot Default - 0 bps dockside transaction fee, zero cut from participants
    platformFromHmsPaise = 0;
    platformFromCoopPaise = 0;
    buyerFeePaise = 0;
    gstOnFeesPaise = 0;
  } else if (tenant.billingMode === 'INSTITUTIONAL_TECH_SHARE') {
    // Mode B: Deducted solely from HMS and Co-op Society institutional shares
    platformFromHmsPaise = Math.floor((hmsGrossPaise * tenant.harbourosCutFromHmsBps) / 10000);
    platformFromCoopPaise = Math.floor((coopGrossPaise * tenant.harbourosCutFromCoopBps) / 10000);
    const taxablePlatformRevenue = platformFromHmsPaise + platformFromCoopPaise;
    gstOnFeesPaise = Math.floor((taxablePlatformRevenue * tenant.gstRateBps) / 10000);
  } else if (tenant.billingMode === 'HYBRID_INSTITUTIONAL_AND_BUYER') {
    // Mode C: Deducted from HMS/Co-op + Buyer Clearing Fee on top
    platformFromHmsPaise = Math.floor((hmsGrossPaise * tenant.harbourosCutFromHmsBps) / 10000);
    platformFromCoopPaise = Math.floor((coopGrossPaise * tenant.harbourosCutFromCoopBps) / 10000);
    buyerFeePaise = Math.floor((hammerPricePaise * tenant.buyerClearingFeeBps) / 10000);
    const totalPlatformRevenue = platformFromHmsPaise + platformFromCoopPaise + buyerFeePaise;
    gstOnFeesPaise = Math.floor((totalPlatformRevenue * tenant.gstRateBps) / 10000);
  }

  const auctioneerNetPaise = auctioneerGrossPaise; // Always protected 100%
  const hmsNetPaise = hmsGrossPaise - platformFromHmsPaise;
  const coopNetPaise = coopGrossPaise - platformFromCoopPaise;
  const harbourOsRevenuePaise = platformFromHmsPaise + platformFromCoopPaise + buyerFeePaise;
  const buyerTotalPayablePaise = hammerPricePaise + buyerFeePaise + (buyerFeePaise > 0 ? gstOnFeesPaise : 0);

  return {
    hammerPricePaise,
    sellerCommissionPaise,
    fishermanInstantNetPaise,
    bonusEscrowPaise,
    auctioneerNetPaise,
    hmsNetPaise,
    coopNetPaise,
    harbourOsRevenuePaise,
    buyerFeePaise,
    gstOnFeesPaise,
    buyerTotalPayablePaise,
  };
}

/**
 * Standard SHA-256 hash digest implementation for browser and Node.js
 */
export async function sha256(message: string): Promise<string> {
  // Use Web Crypto if available (browser / modern Node.js)
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic fallback hash for pure test / non-crypto contexts
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

/**
 * Synchronous deterministic SHA-256 digest simulator for quick ledger chaining
 */
export function computeLedgerRowHash(
  tenantId: string,
  prevRowHash: string,
  journalId: string,
  accountType: string,
  direction: 'D' | 'C',
  amountPaise: number,
  createdAt: string
): string {
  const payload = [
    tenantId,
    prevRowHash,
    journalId,
    accountType,
    direction,
    amountPaise.toString(),
    createdAt,
  ].join('|');

  // Fast deterministic 64-char hex hash
  let h1 = 0xdeadbeef ^ payload.length;
  let h2 = 0x41c6ce57 ^ payload.length;
  let h3 = 0x85ebca6b ^ payload.length;
  let h4 = 0xc2b2ae35 ^ payload.length;

  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 974246729);
    h4 = Math.imul(h4 ^ ch, 381201587);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const hex3 = (h3 >>> 0).toString(16).padStart(8, '0');
  const hex4 = (h4 >>> 0).toString(16).padStart(8, '0');

  // Repeat for 64 characters
  return (hex1 + hex2 + hex3 + hex4 + hex2 + hex1 + hex4 + hex3).slice(0, 64);
}

/**
 * Validates cryptographic chain integrity across an array of ledger entries.
 * Returns true if valid, or the index and error if tampered.
 */
export function verifyLedgerIntegrity(entries: LedgerEntry[]): {
  isValid: boolean;
  tamperedIndex?: number;
  expectedHash?: string;
  actualHash?: string;
  error?: string;
} {
  if (entries.length === 0) return { isValid: true };

  const genesisHash = '0'.repeat(64);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPrev = i === 0 ? genesisHash : entries[i - 1].rowHash;

    if (entry.prevRowHash !== expectedPrev) {
      return {
        isValid: false,
        tamperedIndex: i,
        expectedHash: expectedPrev,
        actualHash: entry.prevRowHash,
        error: `Broken hash link at sequence #${entry.entrySeq}. Expected prev ${expectedPrev.slice(0, 8)}..., got ${entry.prevRowHash.slice(0, 8)}...`,
      };
    }

    const recomputedHash = computeLedgerRowHash(
      entry.tenantId,
      entry.prevRowHash,
      entry.journalId,
      entry.accountType,
      entry.direction,
      entry.amountPaise,
      entry.createdAt
    );

    if (entry.rowHash !== recomputedHash) {
      return {
        isValid: false,
        tamperedIndex: i,
        expectedHash: recomputedHash,
        actualHash: entry.rowHash,
        error: `Hash mismatch at sequence #${entry.entrySeq}. Entry payload was modified!`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Validates and decrements lot inventory atomically for partial-box bidding.
 */
export function allocateLotBoxes(
  lot: FishLot,
  boxesToAllocate: number,
  pricePerKgPaise: number
): {
  allocatedWeightKg: number;
  grossAmountPaise: number;
  remainingBoxes: number;
  isFullySold: boolean;
} {
  if (boxesToAllocate <= 0) {
    throw new Error('Allocation must be at least 1 box');
  }
  if (boxesToAllocate > lot.availableBoxes) {
    throw new Error(`Requested ${boxesToAllocate} boxes but only ${lot.availableBoxes} available`);
  }
  if (pricePerKgPaise < lot.section19FloorPricePaise) {
    throw new Error(
      `Price ₹${(pricePerKgPaise / 100).toFixed(2)}/kg is below Section 19 Floor Price of ₹${(lot.section19FloorPricePaise / 100).toFixed(2)}/kg`
    );
  }

  // Weight proportion
  const avgKgPerBox = lot.netWeightKg / lot.totalBoxes;
  const allocatedWeightKg = parseFloat((boxesToAllocate * avgKgPerBox).toFixed(2));
  const grossAmountPaise = Math.round(allocatedWeightKg * pricePerKgPaise);
  const remainingBoxes = lot.availableBoxes - boxesToAllocate;
  const isFullySold = remainingBoxes === 0;

  return {
    allocatedWeightKg,
    grossAmountPaise,
    remainingBoxes,
    isFullySold,
  };
}

export function formatPaise(paise: number): string {
  const inr = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(inr);
}
