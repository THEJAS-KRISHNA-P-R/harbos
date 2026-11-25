import test from 'node:test';
import assert from 'node:assert/strict';
import {
  humanizeCode,
  computePitSalePreview,
  clampBoxCount,
  stepTemperatureC,
} from '../../src/web/lib/ui-formatters.ts';

test('humanizeCode converts known statutory and generic SNAKE_CASE codes cleanly', () => {
  assert.equal(humanizeCode('REJECTED_UNFIT'), 'Rejected unfit');
  assert.equal(humanizeCode('A_EXPORT'), 'Export Grade A');
  assert.equal(humanizeCode('A_DOMESTIC'), 'Domestic Grade A');
  assert.equal(humanizeCode('B_PROCESS'), 'Processing Grade B');
  assert.equal(humanizeCode('FISHERMAN_NET_SETTLEMENT'), 'Fisherman net settlement');
  assert.equal(humanizeCode('PHYSICAL_SHOUT'), 'Pit shout');
  assert.equal(humanizeCode('PENDING_SECOND_APPROVAL'), 'Awaiting 2nd key');
  assert.equal(humanizeCode('CUSTOM_EVENT_CODE'), 'Custom event code');
});

test('humanizeCode leaves normal labels, hyphenated strings, numbers, and empty/null values safe', () => {
  assert.equal(humanizeCode('DRY-RUN VALID'), 'DRY-RUN VALID');
  assert.equal(humanizeCode('ZERO-PAISE PARITY'), 'ZERO-PAISE PARITY');
  assert.equal(humanizeCode('Active'), 'Active');
  assert.equal(humanizeCode('₹740/kg'), '₹740/kg');
  assert.equal(humanizeCode('LEADER LEASE'), 'LEADER LEASE');
  assert.equal(humanizeCode(null), '');
  assert.equal(humanizeCode(undefined), '');
  assert.equal(humanizeCode('   '), '');
});

test('computePitSalePreview computes exact BigInt paise and floor status', () => {
  const above = computePitSalePreview({
    priceRupeesPerKg: 740,
    boxesRequested: 2,
    lotTotalBoxes: 6,
    lotAvailableBoxes: 6,
    lotNetGrams: 150_000n,
    floorPricePaisePerKg: 70_000n,
  });
  assert.equal(above.boxesClamped, 2);
  assert.equal(above.gramsAllocated, 50_000n);
  assert.equal(above.hammerPaise, 3_700_000n); // 50 kg * ₹740 = ₹37,000 = 3,700,000 paise
  assert.equal(above.fishermanNetPaise, 3_515_000n); // 95%
  assert.equal(above.bonusEscrowPaise, 74_000n); // 2%
  assert.equal(above.floorStatus, 'ABOVE');
  assert.equal(above.priceDiffPerKgPaise, 4_000n);

  const below = computePitSalePreview({
    priceRupeesPerKg: 650,
    boxesRequested: 10,
    lotTotalBoxes: 6,
    lotAvailableBoxes: 4,
    lotNetGrams: 150_000n,
    floorPricePaisePerKg: 70_000n,
  });
  assert.equal(below.boxesClamped, 4);
  assert.equal(below.floorStatus, 'BELOW');
  assert.equal(below.priceDiffPerKgPaise, -5_000n);

  const atFloor = computePitSalePreview({
    priceRupeesPerKg: 700,
    boxesRequested: 1,
    lotTotalBoxes: 4,
    lotAvailableBoxes: 4,
    lotNetGrams: 100_000n,
    floorPricePaisePerKg: 70_000n,
  });
  assert.equal(atFloor.floorStatus, 'AT');
  assert.equal(atFloor.priceDiffPerKgPaise, 0n);
});

test('clampBoxCount and stepTemperatureC guard bounds cleanly', () => {
  assert.equal(clampBoxCount(0, 6), 1);
  assert.equal(clampBoxCount(99, 6), 6);
  assert.equal(clampBoxCount(3, 6), 3);

  assert.equal(stepTemperatureC('1.8', 0.5), '2.3');
  assert.equal(stepTemperatureC('1.8', -0.5), '1.3');
  assert.equal(stepTemperatureC('-1.8', -1.0), '-2.0');
  assert.equal(stepTemperatureC('34.8', 1.0), '35.0');
  assert.equal(stepTemperatureC('bad', 0.5), '2.5');
});
