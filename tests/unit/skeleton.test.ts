import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSkeletonCellWidthClass,
  getSkeletonTextLineWidths,
  resolveWorkspaceSkeletonPreset,
  shouldShowWorkspaceSkeleton,
} from '../../src/web/ui/skeleton-layout';

test('resolveWorkspaceSkeletonPreset maps all 7 workspaces to exact layout archetypes', () => {
  const harbour = resolveWorkspaceSkeletonPreset('harbour');
  assert.equal(harbour.layout, 'office-two-col');
  assert.equal(harbour.metricCount, 3);
  assert.equal(harbour.hasStickyAside, true);
  assert.equal(harbour.hasTabs, true);

  const platform = resolveWorkspaceSkeletonPreset('platform');
  assert.equal(platform.layout, 'office-two-col');
  assert.equal(platform.metricCount, 4);
  assert.equal(platform.hasStickyAside, true);

  const pit = resolveWorkspaceSkeletonPreset('pit');
  assert.equal(pit.layout, 'pit-split');
  assert.equal(pit.metricCount, 0);
  assert.equal(pit.hasStickyAside, true);

  const buyer = resolveWorkspaceSkeletonPreset('buyer');
  assert.equal(buyer.layout, 'hero-stack');
  assert.equal(buyer.hasHeroBanner, true);

  const fisher = resolveWorkspaceSkeletonPreset('fisher');
  assert.equal(fisher.layout, 'hero-stack');
  assert.equal(fisher.hasHeroBanner, true);

  const weighing = resolveWorkspaceSkeletonPreset('weighing');
  assert.equal(weighing.layout, 'form-table');
  assert.equal(weighing.metricCount, 3);

  const inspector = resolveWorkspaceSkeletonPreset('inspector');
  assert.equal(inspector.layout, 'form-table');
  assert.equal(inspector.metricCount, 3);

  const fallback = resolveWorkspaceSkeletonPreset(undefined);
  assert.equal(fallback.kind, 'generic');
  assert.equal(fallback.layout, 'generic');
});

test('getSkeletonTextLineWidths produces staggered widths with a shorter final line', () => {
  assert.deepEqual(getSkeletonTextLineWidths(1), ['w-full']);
  assert.deepEqual(getSkeletonTextLineWidths(0), ['w-full']);

  const threeLines = getSkeletonTextLineWidths(3);
  assert.equal(threeLines.length, 3);
  assert.equal(threeLines[0], 'w-full');
  assert.equal(threeLines[2], 'w-2/3');

  const capped = getSkeletonTextLineWidths(99);
  assert.equal(capped.length, 12);
  assert.equal(capped[11], 'w-2/3');
});

test('getSkeletonCellWidthClass returns deterministic Tailwind width classes', () => {
  const w0 = getSkeletonCellWidthClass(0, 0);
  const w1 = getSkeletonCellWidthClass(0, 1);
  const w2 = getSkeletonCellWidthClass(1, 0);
  assert.ok(w0.startsWith('w-'));
  assert.ok(w1.startsWith('w-'));
  assert.ok(w2.startsWith('w-'));
  assert.notEqual(w0, w1);
});

test('shouldShowWorkspaceSkeleton handles initial load, persona switch, explicit loading, and background refresh', () => {
  assert.equal(shouldShowWorkspaceSkeleton({ hasData: false }), true);
  assert.equal(shouldShowWorkspaceSkeleton({ hasData: true, switchingPersona: true }), true);
  assert.equal(shouldShowWorkspaceSkeleton({ hasData: true, loading: true }), true);
  assert.equal(shouldShowWorkspaceSkeleton({ hasData: true, loading: false }), false);
  assert.equal(
    shouldShowWorkspaceSkeleton({ hasData: true, loading: false, switchingPersona: false }),
    false
  );
});
