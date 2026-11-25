import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyHarbourName,
  deriveShortCode,
  validateOnboardingStep1,
  validateOnboardingOperators,
  buildDefaultOperatorsForSlug,
  buildStarterMasterdataPlan,
  STARTER_COASTAL_SPECIES,
  ROLE_DASHBOARD_DIRECTORY,
} from '../../src/web/lib/tenant-onboarding.ts';

test('slugifyHarbourName and deriveShortCode produce deterministic tenant identifiers', () => {
  assert.equal(slugifyHarbourName('Kochi Vypeen Fishing Harbour'), 'kochi-vypeen-fishing-harbour');
  assert.equal(slugifyHarbourName('  Neendakara (HMS)  '), 'neendakara-hms');
  assert.equal(deriveShortCode('Kochi Vypeen Fishing Harbour', 'kochi-vypeen'), 'KVFH');
  assert.equal(deriveShortCode('Beypore', 'beypore'), 'BEYP');
});

test('validateOnboardingStep1 rejects invalid or duplicate slugs and accepts valid identity', () => {
  const invalid = validateOnboardingStep1(
    {
      nameEn: 'AB',
      slug: 'munambam-demo',
      shortCode: 'X',
      centreType: 'KERALA_HARBOUR',
      floorEnforcement: 'WARN',
    },
    ['munambam-demo']
  );
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 3);

  const valid = validateOnboardingStep1(
    {
      nameEn: 'Vizhinjam Fishing Harbour',
      slug: 'vizhinjam-harbour',
      shortCode: 'VIZH',
      centreType: 'KERALA_HARBOUR',
      floorEnforcement: 'BLOCK',
    },
    ['munambam-demo']
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
});

test('validateOnboardingOperators validates E.164 phones, duplicates, and PINs', () => {
  const defaults = buildDefaultOperatorsForSlug('vizhinjam-harbour');
  assert.equal(validateOnboardingOperators(defaults).valid, true);

  const dupes = [
    defaults[0]!,
    { ...defaults[1]!, phoneE164: defaults[0]!.phoneE164 },
  ];
  const res = validateOnboardingOperators(dupes);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.includes('Duplicate')));

  const badPhone = [{ ...defaults[0]!, phoneE164: '9847001122', pinCode: '12' }];
  const badRes = validateOnboardingOperators(badPhone);
  assert.equal(badRes.valid, false);
  assert.equal(badRes.errors.length, 2);
});

test('starter coastal species and role dashboard directory contain zero Malayalam script', () => {
  for (const sp of STARTER_COASTAL_SPECIES) {
    assert.equal(/[\u0D00-\u0D7F]/.test(sp.nameEn), false);
    assert.equal(/[\u0D00-\u0D7F]/.test(sp.manglishName), false);
    assert.ok(sp.manglishName.length > 0);
    assert.ok(sp.floorPricePaisePerKg > 0);
  }
  assert.equal(ROLE_DASHBOARD_DIRECTORY.length, 8);
  for (const r of ROLE_DASHBOARD_DIRECTORY) {
    assert.equal(/[\u0D00-\u0D7F]/.test(`${r.label} ${r.summary} ${r.keyAction}`), false);
  }
});

test('buildStarterMasterdataPlan creates tenant-prefixed entities', () => {
  const plan = buildStarterMasterdataPlan('VIZH', {
    seedStarterSpecies: true,
    seedStarterOperations: true,
    societyName: 'Vizhinjam Coastal Society',
    vesselName: 'Ocean Star',
    vesselRegNo: 'IND-KL-01-VIZH-202',
    fishermanName: 'Antony Xavier',
    fishermanPhone: '+919847881122',
    buyerName: 'South Coast Exports',
    buyerPaddleNo: 205,
  });
  assert.equal(plan.society.societyId, 'SOC-VIZH-01');
  assert.equal(plan.vessel.ownerFishermanId, plan.fisherman.fishermanId);
  assert.equal(plan.buyer.paddleNo, 205);
  assert.equal(plan.session.status, 'OPEN');
});
