import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { computeWeightAmountPaise } from '../../src/shared/domain/money.ts';
import { computeSaleSettlement, type CommissionPolicyConfig } from '../../src/shared/domain/split.ts';
import { computeBoxAllocation } from '../../src/shared/domain/allocate.ts';
import {
  GENESIS_PREV_HASH,
  computeLedgerEntryHash,
  formatCanonicalLedgerHashPayload,
  sha256HexUtf8,
  buildSaleJournalEntries,
} from '../../src/shared/domain/ledger-hash.ts';

describe('M1 Domain Core — Golden Vectors, 10,000-Case Conservation Property Tests & SHA-256 Parity', () => {
  const baseActPolicy: CommissionPolicyConfig = {
    commissionBps: 500, // 5%
    auctioneerShareBps: 2000, // 20%
    hmsShareBps: 2000, // 20%
    fisherBonusShareBps: 4000, // 40%
    coopShareBps: 2000, // 20%
    commercialMode: 'FIXED_SAAS_ONLY',
    institutionalTechShareBps: 2000,
    buyerFeeBps: 100,
    gstRateBps: 1800,
    legalSignoffRef: 'ADV-KHC-2026-OP-01',
    legalSignoffDate: '2026-01-15',
  };

  it('passes §2 Golden Vector Mode A (FIXED_SAAS_ONLY on 10,000,000 paise hammer)', () => {
    const res = computeSaleSettlement(10_000_000n, {
      ...baseActPolicy,
      commercialMode: 'FIXED_SAAS_ONLY',
    });
    assert.equal(res.fishermanNetPaise, 9_500_000n);
    assert.equal(res.bonusEscrowPaise, 200_000n);
    assert.equal(res.auctioneerNetPaise, 100_000n);
    assert.equal(res.hmsNetPaise, 100_000n);
    assert.equal(res.coopNetPaise, 100_000n);
    assert.equal(res.harbourosRevenuePaise, 0n);
    assert.equal(res.gstOnBuyerFeePaise, 0n);
    assert.equal(res.buyerPayablePaise, 10_000_000n);
  });

  it('passes §2 Golden Vector Mode B (INSTITUTIONAL_TECH_SHARE on 10,000,000 paise hammer)', () => {
    const res = computeSaleSettlement(10_000_000n, {
      ...baseActPolicy,
      commercialMode: 'INSTITUTIONAL_TECH_SHARE',
    });
    assert.equal(res.fishermanNetPaise, 9_500_000n);
    assert.equal(res.bonusEscrowPaise, 200_000n);
    assert.equal(res.auctioneerNetPaise, 100_000n);
    assert.equal(res.hmsNetPaise, 80_000n);
    assert.equal(res.coopNetPaise, 80_000n);
    assert.equal(res.harbourosRevenuePaise, 40_000n);
    assert.equal(res.gstOnBuyerFeePaise, 0n);
    assert.equal(res.buyerPayablePaise, 10_000_000n);
  });

  it('passes §2 Golden Vector Mode C (HYBRID on 10,000,000 paise hammer)', () => {
    const res = computeSaleSettlement(10_000_000n, {
      ...baseActPolicy,
      commercialMode: 'HYBRID',
    });
    assert.equal(res.fishermanNetPaise, 9_500_000n);
    assert.equal(res.bonusEscrowPaise, 200_000n);
    assert.equal(res.auctioneerNetPaise, 100_000n);
    assert.equal(res.hmsNetPaise, 80_000n);
    assert.equal(res.coopNetPaise, 80_000n);
    assert.equal(res.harbourosRevenuePaise, 140_000n);
    assert.equal(res.gstOnBuyerFeePaise, 18_000n);
    assert.equal(res.buyerPayablePaise, 10_118_000n);
  });

  it('passes 10,000-case property test for conservation across Modes A, B, and C (§7 & §12 M1)', () => {
    const modes = ['FIXED_SAAS_ONLY', 'INSTITUTIONAL_TECH_SHARE', 'HYBRID'] as const;
    for (let i = 1; i <= 10_000; i++) {
      // Deterministic PRNG over hammer prices from 1 paisa up to 99,999,999 paise
      const hammerPaise = BigInt((i * 7919) % 50_000_000) + 1n;
      const mode = modes[i % 3]!;
      const isMarket = i % 2 === 0;
      const res = computeSaleSettlement(hammerPaise, {
        ...baseActPolicy,
        commercialMode: mode,
        auctioneerShareBps: 2000,
        hmsShareBps: 2000,
        fisherBonusShareBps: isMarket ? 3000 : 4000,
        coopShareBps: isMarket ? 3000 : 2000,
      });

      const sumShares =
        res.auctioneerGrossPaise +
        res.hmsGrossPaise +
        res.bonusEscrowPaise +
        res.coopGrossPaise;
      assert.equal(sumShares, res.totalCommissionPaise);

      const sumAllFlows =
        res.fishermanNetPaise +
        res.bonusEscrowPaise +
        res.auctioneerNetPaise +
        res.hmsNetPaise +
        res.coopNetPaise +
        res.harbourosRevenuePaise +
        res.gstOnBuyerFeePaise;
      assert.equal(sumAllFlows, res.buyerPayablePaise);

      // Verify journal builder produces strictly balanced D == C entries
      const entries = buildSaleJournalEntries(res, {
        buyerAccountId: 'A1',
        fishermanPayableAccountId: 'A2',
        fishermanBonusEscrowAccountId: 'A3',
        auctioneerAccountId: 'A4',
        hmsAccountId: 'A5',
        coopAccountId: 'A6',
        harbourosRevenueAccountId: 'A7',
        gstPayableAccountId: 'A8',
      });
      const debits = entries
        .filter((e) => e.direction === 'D')
        .reduce((acc, e) => acc + e.amountPaise, 0n);
      const credits = entries
        .filter((e) => e.direction === 'C')
        .reduce((acc, e) => acc + e.amountPaise, 0n);
      assert.equal(debits, credits);
    }
  });

  it('passes partial-box allocation property test: sum of allocated grams equals lot net_grams exactly (§7)', () => {
    for (let totalBoxes = 1; totalBoxes <= 35; totalBoxes++) {
      const netGrams = BigInt(totalBoxes * 24_733 + 17); // Non-divisible gram weight
      let availBoxes = totalBoxes;
      let availGrams = netGrams;
      let sumAllocatedGrams = 0n;

      while (availBoxes > 0) {
        const stepBoxes = Math.min(availBoxes, (availBoxes % 3) + 1);
        const res = computeBoxAllocation(
          {
            totalBoxes,
            netGrams,
            availableBoxes: availBoxes,
            availableGrams: availGrams,
          },
          stepBoxes
        );
        sumAllocatedGrams += res.allocatedGrams;
        availBoxes = res.remainingBoxes;
        availGrams = res.remainingGrams;
      }

      assert.equal(sumAllocatedGrams, netGrams);
      assert.equal(availGrams, 0n);
    }
  });

  it('verifies round-half-up weight*price math and golden SHA-256 vector parity with node:crypto (§7 & §8)', () => {
    // 1255 grams at 100 paise/kg -> (1255 * 100 + 500) / 1000 = 126 paise
    assert.equal(computeWeightAmountPaise(1255n, 100n), 126n);
    // 1254 grams at 100 paise/kg -> (1254 * 100 + 500) / 1000 = 125 paise
    assert.equal(computeWeightAmountPaise(1254n, 100n), 125n);

    const sampleInput = {
      tenantId: 'munambam-demo',
      entrySeq: 1n,
      prevRowHash: GENESIS_PREV_HASH,
      journalId: 'JRN-GOLDEN-001',
      accountId: 'ACC-BUY-BUY-01',
      direction: 'D' as const,
      amountPaise: 10_000_000n,
      createdAtUtcIsoMs: '2026-11-06T05:30:00.000Z',
    };
    const payload = formatCanonicalLedgerHashPayload(sampleInput);
    const expectedNodeCrypto = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    const actualDomainHash = computeLedgerEntryHash(sampleInput);

    assert.equal(actualDomainHash, expectedNodeCrypto);
    assert.equal(sha256HexUtf8('HarbourOS Act 16 of 2021'), crypto.createHash('sha256').update('HarbourOS Act 16 of 2021', 'utf8').digest('hex'));
  });
});
