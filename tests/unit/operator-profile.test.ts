import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOperatorInitials, getRoleDisplayMeta } from '../../src/web/lib/api.ts';

test('formatOperatorInitials strips honorifics and parenthetical suffixes and extracts 2-letter initials', () => {
  assert.equal(formatOperatorInitials('Capt. Mathew Thomas'), 'MT');
  assert.equal(formatOperatorInitials('Capt. Mathew Thomas (Harbour Secretary)'), 'MT');
  assert.equal(formatOperatorInitials('Deepa Krishnan (HMS Accountant)'), 'DK');
  assert.equal(formatOperatorInitials('Dr. Lekshmi R. (Food Safety Inspector)'), 'LR');
  assert.equal(formatOperatorInitials('K. Balakrishnan Nair'), 'KN');
  assert.equal(formatOperatorInitials('Sajeev'), 'SA');
  assert.equal(formatOperatorInitials(''), 'HO');
});

test('getRoleDisplayMeta returns statutory capabilities and default workspace for all roles', () => {
  const adminMeta = getRoleDisplayMeta('HARBOUR_ADMIN');
  assert.equal(adminMeta.defaultWorkspace, 'harbour');
  assert.equal(adminMeta.shortBadge, 'HMS Admin');
  assert.ok(adminMeta.capabilities.length >= 4);

  const auctioneerMeta = getRoleDisplayMeta('LICENSED_AUCTIONEER');
  assert.equal(auctioneerMeta.defaultWorkspace, 'pit');
  assert.equal(auctioneerMeta.statutoryRef, 'Act 16 s.5 & s.4(8)');

  const inspectorMeta = getRoleDisplayMeta('AUTHORIZED_INSPECTOR');
  assert.equal(inspectorMeta.defaultWorkspace, 'inspector');
});
