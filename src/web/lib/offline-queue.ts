import type { StorageLike } from '@web/lib/session-storage.ts';

export const OFFLINE_ACTION_QUEUE_STORAGE_KEY = 'harbouros.offline.actionQueue';

export type OfflineActionType = 'submit-weighing' | 'approve-ledger';

export interface SubmitWeighingPayload {
  commandId: string;
  vesselId: string;
  speciesId: string;
  totalBoxes: number;
  netGrams: string;
  weightSource?: 'BLE_SCALE' | 'MANUAL' | undefined;
  coreTempC?: number | undefined;
}

export interface ApproveLedgerPayload {
  reversalId: string;
}

export type QueuedOfflineAction =
  | {
      id: string;
      type: 'submit-weighing';
      tenantId: string;
      createdAt: string;
      label: string;
      payload: SubmitWeighingPayload;
    }
  | {
      id: string;
      type: 'approve-ledger';
      tenantId: string;
      createdAt: string;
      label: string;
      payload: ApproveLedgerPayload;
    };

export type OfflineActionExecutionResult =
  | { status: 'ok' }
  | { status: 'retry'; errorMessage: string }
  | { status: 'drop'; errorMessage: string };

export interface OfflineQueueReplaySummary {
  remainingQueue: ReadonlyArray<QueuedOfflineAction>;
  replayedActions: ReadonlyArray<QueuedOfflineAction>;
  retriedActions: ReadonlyArray<{ action: QueuedOfflineAction; errorMessage: string }>;
  droppedActions: ReadonlyArray<{ action: QueuedOfflineAction; errorMessage: string }>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidQueuedOfflineAction(value: unknown): value is QueuedOfflineAction {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (
    !isNonEmptyString(obj.id) ||
    !isNonEmptyString(obj.tenantId) ||
    !isNonEmptyString(obj.createdAt) ||
    !isNonEmptyString(obj.label) ||
    !obj.payload ||
    typeof obj.payload !== 'object'
  ) {
    return false;
  }

  const payload = obj.payload as Record<string, unknown>;
  if (obj.type === 'submit-weighing') {
    const boxes = Number(payload.totalBoxes);
    return (
      isNonEmptyString(payload.commandId) &&
      isNonEmptyString(payload.vesselId) &&
      isNonEmptyString(payload.speciesId) &&
      Number.isInteger(boxes) &&
      boxes > 0 &&
      isNonEmptyString(payload.netGrams) &&
      /^\d+$/.test(payload.netGrams)
    );
  }

  if (obj.type === 'approve-ledger') {
    return isNonEmptyString(payload.reversalId);
  }

  return false;
}

export function readOfflineQueue(
  storage: StorageLike | null | undefined
): ReadonlyArray<QueuedOfflineAction> {
  if (!storage) return [];
  try {
    const raw = storage.getItem(OFFLINE_ACTION_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidQueuedOfflineAction);
  } catch {
    return [];
  }
}

export function persistOfflineQueue(
  storage: StorageLike | null | undefined,
  queue: ReadonlyArray<QueuedOfflineAction>
): boolean {
  if (!storage) return false;
  try {
    if (queue.length === 0) {
      storage.removeItem(OFFLINE_ACTION_QUEUE_STORAGE_KEY);
    } else {
      storage.setItem(OFFLINE_ACTION_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    }
    return true;
  } catch {
    return false;
  }
}

export function enqueueOfflineAction(
  queue: ReadonlyArray<QueuedOfflineAction>,
  action: QueuedOfflineAction
): ReadonlyArray<QueuedOfflineAction> {
  if (queue.some((item) => item.id === action.id)) {
    return queue;
  }
  if (
    action.type === 'approve-ledger' &&
    queue.some(
      (item) =>
        item.type === 'approve-ledger' &&
        item.tenantId === action.tenantId &&
        item.payload.reversalId === action.payload.reversalId
    )
  ) {
    return queue;
  }
  return [...queue, action];
}

export function removeOfflineActionById(
  queue: ReadonlyArray<QueuedOfflineAction>,
  id: string
): ReadonlyArray<QueuedOfflineAction> {
  return queue.filter((item) => item.id !== id);
}

export function classifyReplayErrorStatus(errorMessage: string): 'retry' | 'drop' {
  const lower = errorMessage.toLowerCase();
  // Transient connectivity or server 5xx errors should be kept for retry
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    /\b5\d{2}\b/.test(lower)
  ) {
    return 'retry';
  }
  // Permanent 4xx domain/validation/auth errors should not loop indefinitely
  return 'drop';
}

export async function replayOfflineQueue(params: {
  queue: ReadonlyArray<QueuedOfflineAction>;
  tenantId: string;
  executeAction: (action: QueuedOfflineAction) => Promise<OfflineActionExecutionResult>;
}): Promise<OfflineQueueReplaySummary> {
  const remainingQueue: QueuedOfflineAction[] = [];
  const replayedActions: QueuedOfflineAction[] = [];
  const retriedActions: Array<{ action: QueuedOfflineAction; errorMessage: string }> = [];
  const droppedActions: Array<{ action: QueuedOfflineAction; errorMessage: string }> = [];

  for (const action of params.queue) {
    if (action.tenantId !== params.tenantId) {
      remainingQueue.push(action);
      continue;
    }

    const result = await params.executeAction(action);
    if (result.status === 'ok') {
      replayedActions.push(action);
    } else if (result.status === 'retry') {
      remainingQueue.push(action);
      retriedActions.push({ action, errorMessage: result.errorMessage });
    } else {
      droppedActions.push({ action, errorMessage: result.errorMessage });
    }
  }

  return {
    remainingQueue,
    replayedActions,
    retriedActions,
    droppedActions,
  };
}
