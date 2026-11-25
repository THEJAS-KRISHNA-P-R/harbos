import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractManglishName,
  stripMalayalamText,
  humanizeCode,
  computePitSalePreview,
} from '../../src/web/lib/ui-formatters.ts';

test('extractManglishName extracts parenthetical Manglish cleanly and strips Malayalam script', () => {
  assert.equal(extractManglishName('ആവോലി (Avoli)', 'AVOLI'), 'Avoli');
  assert.equal(
    extractManglishName('നാരൻ ചെമ്മീൻ (Naran Chemmeen)', 'NARAN'),
    'Naran Chemmeen'
  );
  assert.equal(extractManglishName('നെയ്മീൻ (Neymeen)', 'NEYMEEN'), 'Neymeen');
  assert.equal(extractManglishName('മത്തി (Mathi)', 'MATHI'), 'Mathi');
  assert.equal(extractManglishName('കരിമീൻ (Karimeen)', 'KARIMEEN'), 'Karimeen');
});

test('extractManglishName handles plain Manglish strings and falls back to title-cased code', () => {
  assert.equal(extractManglishName('Naran Chemmeen', 'NARAN'), 'Naran Chemmeen');
  assert.equal(extractManglishName('', 'KOONTHAL'), 'Koonthal');
  assert.equal(extractManglishName(null, 'SILVER_POMFRET'), 'Silver Pomfret');
  assert.equal(extractManglishName('ആവോലി', 'AVOLI'), 'Avoli');
});

test('stripMalayalamText leaves zero Malayalam Unicode characters', () => {
  const cleaned = stripMalayalamText('മുനമ്പം ഹാർബർ Munambam Harbour (HMS)');
  assert.equal(/[\u0D00-\u0D7F]/.test(cleaned), false);
  assert.equal(cleaned, 'Munambam Harbour (HMS)');
});

test('humanizeCode formats statutory codes cleanly', () => {
  assert.equal(humanizeCode('OPEN_FOR_AUCTION'), 'Open for auction');
  assert.equal(humanizeCode('HARBOUR_ADMIN'), 'Harbour admin');
});

test('computePitSalePreview computes exact statutory 95% preview', () => {
  const preview = computePitSalePreview({
    priceRupeesPerKg: 700,
    boxesRequested: 2,
    lotTotalBoxes: 4,
    lotAvailableBoxes: 4,
    lotNetGrams: 100_000n,
    floorPricePaisePerKg: 65_000n,
  });
  assert.equal(preview.gramsAllocated, 50_000n);
  assert.equal(preview.hammerPaise, 3_500_000n);
  assert.equal(preview.fishermanNetPaise, 3_325_000n);
  assert.equal(preview.floorStatus, 'ABOVE');
});
