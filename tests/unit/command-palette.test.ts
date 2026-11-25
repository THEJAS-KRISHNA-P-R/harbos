import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommandPaletteItems,
  buildWorkspaceQuickJumpItems,
  filterCommandPaletteItems,
  WORKSPACE_GROUP_MAP,
} from '../../src/web/lib/command-palette.ts';
import type { WorkspaceId } from '../../src/shared/contracts/rbac.ts';

test('buildWorkspaceQuickJumpItems covers all 7 workspaces across operations, clearing, and governance', () => {
  const allWorkspaces = buildWorkspaceQuickJumpItems();
  assert.equal(allWorkspaces.length, 7);

  const byGroup = {
    operations: allWorkspaces.filter((w) => w.workspaceGroup === 'operations').map((w) => w.targetWorkspace),
    clearing: allWorkspaces.filter((w) => w.workspaceGroup === 'clearing').map((w) => w.targetWorkspace),
    governance: allWorkspaces.filter((w) => w.workspaceGroup === 'governance').map((w) => w.targetWorkspace),
  };

  assert.deepEqual(byGroup.operations, ['weighing', 'pit', 'inspector']);
  assert.deepEqual(byGroup.clearing, ['buyer', 'fisher']);
  assert.deepEqual(byGroup.governance, ['harbour', 'platform']);
});

test('buildWorkspaceQuickJumpItems filters strictly by allowedWorkspaceIds', () => {
  const allowed = new Set<WorkspaceId>(['weighing', 'harbour']);
  const items = buildWorkspaceQuickJumpItems(allowed);
  assert.deepEqual(
    items.map((i) => i.targetWorkspace),
    ['weighing', 'harbour']
  );
});

test('filterCommandPaletteItems filters workspaces by group scope and cross-group search queries', () => {
  const all = buildCommandPaletteItems(null, '', 'all');

  const clearingScope = filterCommandPaletteItems(all, '', 'clearing');
  assert.deepEqual(
    clearingScope.map((i) => i.targetWorkspace),
    ['buyer', 'fisher']
  );

  const opsScope = filterCommandPaletteItems(all, '', 'operations');
  assert.deepEqual(
    opsScope.map((i) => i.targetWorkspace),
    ['weighing', 'pit', 'inspector']
  );

  const govScope = filterCommandPaletteItems(all, '', 'governance');
  assert.deepEqual(
    govScope.map((i) => i.targetWorkspace),
    ['harbour', 'platform']
  );

  const multiToken = buildCommandPaletteItems(null, 'clearing fisher', 'all');
  assert.equal(multiToken[0]?.targetWorkspace, 'fisher');
  assert.equal(multiToken[0]?.workspaceGroup, WORKSPACE_GROUP_MAP.fisher);
});

test('buildCommandPaletteItems ranks direct workspace quick-jump matches first for Enter navigation', () => {
  const inspectorMatch = buildCommandPaletteItems(null, 'quality', 'all');
  assert.equal(inspectorMatch[0]?.targetWorkspace, 'inspector');

  const buyerMatch = buildCommandPaletteItems(null, 'buyer', 'all');
  assert.equal(buyerMatch[0]?.targetWorkspace, 'buyer');

  const platformMatch = buildCommandPaletteItems(null, 'platform', 'all');
  assert.equal(platformMatch[0]?.targetWorkspace, 'platform');

  const utrMatch = buildCommandPaletteItems(null, 'UTR CSV', 'all');
  assert.equal(utrMatch[0]?.id, 'act-utr-import');
});
