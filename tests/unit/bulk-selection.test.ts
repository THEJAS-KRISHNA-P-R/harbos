import test from 'node:test';
import assert from 'node:assert/strict';
import type { StorageLike } from '../../src/web/lib/session-storage.ts';
import {
  ARCHIVE_STORAGE_PREFIX,
  archiveRecordIds,
  computeSelectionState,
  filterArchivedRecords,
  persistArchivedIds,
  pruneSelectedIds,
  readArchivedIds,
  restoreArchivedRecordIds,
  toggleSelectAllIds,
  toggleSelectedId,
} from '../../src/web/lib/bulk-selection.ts';

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };
}

test('toggleSelectedId and toggleSelectAllIds manage visible selection accurately', () => {
  const visible = ['LOT-1', 'LOT-2', 'LOT-3'];
  let selected = new Set<string>();

  selected = toggleSelectedId(selected, 'LOT-1');
  assert.deepEqual(Array.from(selected), ['LOT-1']);
  assert.deepEqual(computeSelectionState(selected, visible), {
    selectedVisibleCount: 1,
    allVisibleSelected: false,
    someVisibleSelected: true,
  });

  // Select all fills remaining visible IDs
  selected = toggleSelectAllIds(selected, visible);
  assert.deepEqual(Array.from(selected).sort(), ['LOT-1', 'LOT-2', 'LOT-3']);
  assert.deepEqual(computeSelectionState(selected, visible), {
    selectedVisibleCount: 3,
    allVisibleSelected: true,
    someVisibleSelected: false,
  });

  // Toggle select all again clears all visible IDs
  selected = toggleSelectAllIds(selected, visible);
  assert.equal(selected.size, 0);
});

test('pruneSelectedIds removes IDs no longer in the active dataset', () => {
  const selected = new Set(['LOT-1', 'LOT-2', 'LOT-ARCHIVED']);
  const pruned = pruneSelectedIds(selected, ['LOT-1', 'LOT-3']);
  assert.deepEqual(Array.from(pruned), ['LOT-1']);
});

test('archiveRecordIds, filterArchivedRecords, and restoreArchivedRecordIds work cleanly', () => {
  const rows = [
    { id: 'LOT-1', name: 'Avoli' },
    { id: 'LOT-2', name: 'Ayala' },
    { id: 'LOT-3', name: 'Choora' },
  ];

  let archived = archiveRecordIds(new Set(), ['LOT-1', 'LOT-3']);
  assert.deepEqual(
    filterArchivedRecords(rows, (r) => r.id, archived).map((r) => r.id),
    ['LOT-2']
  );

  // Partial restore
  archived = restoreArchivedRecordIds(archived, ['LOT-1']);
  assert.deepEqual(
    filterArchivedRecords(rows, (r) => r.id, archived).map((r) => r.id),
    ['LOT-1', 'LOT-2']
  );

  // Full restore
  archived = restoreArchivedRecordIds(archived);
  assert.equal(archived.size, 0);
});

test('persistArchivedIds and readArchivedIds persist per scope and ignore corrupted data', () => {
  const storage = createMemoryStorage();
  const scope = 'TEN-MUN.weighing';
  assert.equal(persistArchivedIds(storage, scope, new Set(['LOT-1', 'LOT-2'])), true);
  assert.deepEqual(Array.from(readArchivedIds(storage, scope)).sort(), ['LOT-1', 'LOT-2']);

  // Corrupt JSON fails gracefully
  storage.setItem(`${ARCHIVE_STORAGE_PREFIX}${scope}`, '{broken');
  assert.equal(readArchivedIds(storage, scope).size, 0);

  // Empty set removes storage key
  assert.equal(persistArchivedIds(storage, scope, new Set()), true);
  assert.equal(storage.getItem(`${ARCHIVE_STORAGE_PREFIX}${scope}`), null);
});

test('runBulkOperation aggregates succeeded, skipped, queued, and failed results in order', async () => {
  const { runBulkOperation, formatBulkApproveFeedback } = await import(
    '../../src/web/lib/bulk-selection.ts'
  );

  const summary = await runBulkOperation(
    ['ID-1', 'ID-2', 'ID-3', 'ID-4'],
    async (id) => {
      if (id === 'ID-1') return { id, status: 'succeeded' };
      if (id === 'ID-2') return { id, status: 'skipped' };
      if (id === 'ID-3') return { id, status: 'queued' };
      throw new Error('Dual-key guardrail');
    }
  );

  assert.deepEqual(summary.succeeded, ['ID-1']);
  assert.deepEqual(summary.skipped, ['ID-2']);
  assert.deepEqual(summary.queued, ['ID-3']);
  assert.deepEqual(summary.failed, [{ id: 'ID-4', reason: 'Dual-key guardrail' }]);

  const partial = formatBulkApproveFeedback({
    summary,
    itemNounSingular: 'reversal',
    itemNounPlural: 'reversals',
  });
  assert.equal(partial.tone, 'warn');
  assert.match(partial.title, /Partially completed/i);
  assert.match(partial.msg, /Dual-key guardrail/);

  const allSkipped = formatBulkApproveFeedback({
    summary: { succeeded: [], skipped: ['ID-2'], queued: [], failed: [] },
    itemNounSingular: 'batch',
    itemNounPlural: 'batches',
  });
  assert.equal(allSkipped.tone, 'info');
  assert.match(allSkipped.title, /No eligible items/i);

  const allSucceeded = formatBulkApproveFeedback({
    summary: { succeeded: ['LOT-1', 'LOT-2'], skipped: [], queued: [], failed: [] },
    itemNounSingular: 'lot',
    itemNounPlural: 'lots',
    actionPastTense: 'Certified',
  });
  assert.equal(allSucceeded.tone, 'ok');
  assert.equal(allSucceeded.title, 'Certified 2 lots');
});

