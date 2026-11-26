import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceBreadcrumbs,
  resolveNetworkStatusPresentation,
} from '../../src/web/lib/workspace-context.ts';

test('buildWorkspaceBreadcrumbs maps active tenant, workspace group, and current workspace across all groups', () => {
  const opsTrail = buildWorkspaceBreadcrumbs({
    tenantName: 'Munambam Fishing Harbour (HMS)',
    workspaceId: 'weighing',
    workspaceLabel: 'Weighing & Lots',
  });
  assert.deepEqual(
    opsTrail.map((s) => ({ kind: s.kind, label: s.label, current: Boolean(s.current) })),
    [
      { kind: 'tenant', label: 'Munambam Fishing Harbour (HMS)', current: false },
      { kind: 'group', label: 'Operations', current: false },
      { kind: 'workspace', label: 'Weighing & Lots', current: true },
    ]
  );
  assert.equal(opsTrail[1]?.groupId, 'operations');

  const clearingTrail = buildWorkspaceBreadcrumbs({
    tenantName: 'Kochi Vypeen Harbour',
    workspaceId: 'buyer',
    workspaceLabel: 'Buyer Clearing',
  });
  assert.equal(clearingTrail[0]?.label, 'Kochi Vypeen Harbour');
  assert.equal(clearingTrail[1]?.label, 'Clearing');
  assert.equal(clearingTrail[1]?.groupId, 'clearing');
  assert.equal(clearingTrail[2]?.label, 'Buyer Clearing');

  const govTrail = buildWorkspaceBreadcrumbs({
    tenantName: null,
    workspaceId: 'platform',
    workspaceLabel: 'Platform Admin',
  });
  assert.equal(govTrail[0]?.label, 'Munambam Fishing Harbour (HMS)');
  assert.equal(govTrail[1]?.label, 'Governance');
  assert.equal(govTrail[1]?.groupId, 'governance');
});

test('resolveNetworkStatusPresentation handles online, offline queued, dismissed offline, and reconnected states', () => {
  const steadyOnline = resolveNetworkStatusPresentation({
    isOnline: true,
    recentlyReconnected: false,
    dismissedOfflineToast: false,
  });
  assert.equal(steadyOnline.status, 'online');
  assert.equal(steadyOnline.toast, null);

  const offlineActive = resolveNetworkStatusPresentation({
    isOnline: false,
    recentlyReconnected: false,
    dismissedOfflineToast: false,
  });
  assert.equal(offlineActive.status, 'offline');
  assert.equal(offlineActive.shortLabel, 'Offline · Queued');
  assert.equal(offlineActive.toast?.tone, 'warn');
  assert.match(offlineActive.toast?.message ?? '', /queued locally/i);

  const offlineDismissed = resolveNetworkStatusPresentation({
    isOnline: false,
    recentlyReconnected: false,
    dismissedOfflineToast: true,
  });
  assert.equal(offlineDismissed.status, 'offline');
  assert.equal(offlineDismissed.toast, null);

  const reconnected = resolveNetworkStatusPresentation({
    isOnline: true,
    recentlyReconnected: true,
    dismissedOfflineToast: false,
  });
  assert.equal(reconnected.status, 'reconnected');
  assert.equal(reconnected.toast?.tone, 'ok');
});
