import test from 'node:test';
import assert from 'node:assert/strict';
import type { StorageLike } from '../../src/web/lib/session-storage.ts';
import {
  OFFLINE_ACTION_QUEUE_STORAGE_KEY,
  classifyReplayErrorStatus,
  enqueueOfflineAction,
  persistOfflineQueue,
  readOfflineQueue,
  replayOfflineQueue,
  type QueuedOfflineAction,
} from '../../src/web/lib/offline-queue.ts';
import { resolveNetworkStatusPresentation } from '../../src/web/lib/workspace-context.ts';

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

const WEIGH_ACTION: QueuedOfflineAction = {
  id: 'CMD-WEIGH-1',
  type: 'submit-weighing',
  tenantId: 'TEN-MUN',
  createdAt: '2026-11-26T08:00:00.000Z',
  label: 'Weigh 6 boxes (150 kg)',
  payload: {
    commandId: 'CMD-WEIGH-1',
    vesselId: 'VSL-01',
    speciesId: 'SPC-01',
    totalBoxes: 6,
    netGrams: '150000',
    weightSource: 'BLE_SCALE',
    coreTempC: 1.8,
  },
};

const LEDGER_ACTION: QueuedOfflineAction = {
  id: 'CMD-LEDGER-1',
  type: 'approve-ledger',
  tenantId: 'TEN-MUN',
  createdAt: '2026-11-26T08:02:00.000Z',
  label: 'Approve reversal REV-001',
  payload: {
    reversalId: 'REV-001',
  },
};

const OTHER_TENANT_ACTION: QueuedOfflineAction = {
  id: 'CMD-WEIGH-OTHER',
  type: 'submit-weighing',
  tenantId: 'TEN-VYP',
  createdAt: '2026-11-26T08:03:00.000Z',
  label: 'Weigh 4 boxes at Vypin',
  payload: {
    commandId: 'CMD-WEIGH-OTHER',
    vesselId: 'VSL-99',
    speciesId: 'SPC-01',
    totalBoxes: 4,
    netGrams: '100000',
  },
};

test('persistOfflineQueue and readOfflineQueue round-trip valid actions and ignore corrupted entries', () => {
  const storage = createMemoryStorage();
  assert.equal(persistOfflineQueue(storage, [WEIGH_ACTION, LEDGER_ACTION]), true);

  const restored = readOfflineQueue(storage);
  assert.equal(restored.length, 2);
  assert.equal(restored[0]?.type, 'submit-weighing');
  assert.equal(restored[1]?.type, 'approve-ledger');

  // Corrupt one entry and ensure valid entries still load safely
  storage.setItem(
    OFFLINE_ACTION_QUEUE_STORAGE_KEY,
    JSON.stringify([WEIGH_ACTION, { id: 'bad', type: 'unknown' }, null])
  );
  const filtered = readOfflineQueue(storage);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, 'CMD-WEIGH-1');

  // Clearing queue removes storage key cleanly
  assert.equal(persistOfflineQueue(storage, []), true);
  assert.equal(storage.getItem(OFFLINE_ACTION_QUEUE_STORAGE_KEY), null);
});

test('enqueueOfflineAction deduplicates by id and prevents duplicate approve-ledger for same reversal', () => {
  let q = enqueueOfflineAction([], WEIGH_ACTION);
  q = enqueueOfflineAction(q, WEIGH_ACTION);
  assert.equal(q.length, 1);

  q = enqueueOfflineAction(q, LEDGER_ACTION);
  q = enqueueOfflineAction(q, {
    ...LEDGER_ACTION,
    id: 'CMD-LEDGER-DUPLICATE',
  });
  assert.equal(q.length, 2);
});

test('replayOfflineQueue replays active tenant actions in FIFO order and preserves other tenants and transient failures', async () => {
  const executedOrder: string[] = [];
  const summary = await replayOfflineQueue({
    queue: [WEIGH_ACTION, OTHER_TENANT_ACTION, LEDGER_ACTION],
    tenantId: 'TEN-MUN',
    executeAction: async (action) => {
      executedOrder.push(action.id);
      if (action.type === 'approve-ledger') {
        return { status: 'retry', errorMessage: 'Failed to fetch' };
      }
      return { status: 'ok' };
    },
  });

  assert.deepEqual(executedOrder, ['CMD-WEIGH-1', 'CMD-LEDGER-1']);
  assert.equal(summary.replayedActions.length, 1);
  assert.equal(summary.retriedActions.length, 1);
  assert.equal(summary.droppedActions.length, 0);
  // Remaining queue keeps OTHER_TENANT_ACTION + retried LEDGER_ACTION
  assert.deepEqual(
    summary.remainingQueue.map((a) => a.id),
    ['CMD-WEIGH-OTHER', 'CMD-LEDGER-1']
  );
});

test('classifyReplayErrorStatus retries network/5xx errors and drops 4xx guardrail rejections', () => {
  assert.equal(classifyReplayErrorStatus('TypeError: Failed to fetch'), 'retry');
  assert.equal(classifyReplayErrorStatus('HTTP 503 Service Unavailable'), 'retry');
  assert.equal(
    classifyReplayErrorStatus('Approver must be a different user than requester'),
    'drop'
  );
});

test('resolveNetworkStatusPresentation includes queued action count and replaying state', () => {
  const offlineQueued = resolveNetworkStatusPresentation({
    isOnline: false,
    recentlyReconnected: false,
    dismissedOfflineToast: false,
    queuedCount: 2,
  });
  assert.equal(offlineQueued.shortLabel, 'Offline · 2 queued');
  assert.match(offlineQueued.toast?.title ?? '', /2 actions queued/);

  const replaying = resolveNetworkStatusPresentation({
    isOnline: true,
    recentlyReconnected: true,
    dismissedOfflineToast: false,
    queuedCount: 2,
    replayingQueue: true,
  });
  assert.equal(replaying.shortLabel, 'Syncing 2…');
  assert.match(replaying.toast?.title ?? '', /replaying queued actions/i);
});
