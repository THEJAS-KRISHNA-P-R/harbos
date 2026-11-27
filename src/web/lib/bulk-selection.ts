import type { StorageLike } from '@web/lib/session-storage.ts';

export const ARCHIVE_STORAGE_PREFIX = 'harbouros.ui.archived.';

export interface SelectionSummary {
  selectedVisibleCount: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}

export function toggleSelectedId(
  selectedIds: ReadonlySet<string>,
  id: string
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function toggleSelectAllIds(
  selectedIds: ReadonlySet<string>,
  visibleIds: ReadonlyArray<string>
): Set<string> {
  if (visibleIds.length === 0) return new Set();
  const allSelected = visibleIds.every((id) => selectedIds.has(id));
  if (allSelected) {
    const next = new Set(selectedIds);
    for (const id of visibleIds) {
      next.delete(id);
    }
    return next;
  }
  const next = new Set(selectedIds);
  for (const id of visibleIds) {
    next.add(id);
  }
  return next;
}

export function pruneSelectedIds(
  selectedIds: ReadonlySet<string>,
  validIds: ReadonlyArray<string>
): Set<string> {
  const validSet = new Set(validIds);
  const next = new Set<string>();
  for (const id of selectedIds) {
    if (validSet.has(id)) {
      next.add(id);
    }
  }
  return next;
}

export function computeSelectionState(
  selectedIds: ReadonlySet<string>,
  visibleIds: ReadonlyArray<string>
): SelectionSummary {
  if (visibleIds.length === 0) {
    return {
      selectedVisibleCount: 0,
      allVisibleSelected: false,
      someVisibleSelected: false,
    };
  }
  let selectedVisibleCount = 0;
  for (const id of visibleIds) {
    if (selectedIds.has(id)) {
      selectedVisibleCount += 1;
    }
  }
  return {
    selectedVisibleCount,
    allVisibleSelected: selectedVisibleCount === visibleIds.length,
    someVisibleSelected:
      selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length,
  };
}

export function archiveRecordIds(
  archivedIds: ReadonlySet<string>,
  idsToArchive: ReadonlyArray<string>
): Set<string> {
  const next = new Set(archivedIds);
  for (const id of idsToArchive) {
    if (id.trim().length > 0) {
      next.add(id);
    }
  }
  return next;
}

export function restoreArchivedRecordIds(
  archivedIds: ReadonlySet<string>,
  idsToRestore?: ReadonlyArray<string>
): Set<string> {
  if (!idsToRestore) return new Set();
  const next = new Set(archivedIds);
  for (const id of idsToRestore) {
    next.delete(id);
  }
  return next;
}

export function filterArchivedRecords<T>(
  rows: ReadonlyArray<T>,
  getId: (row: T) => string,
  archivedIds: ReadonlySet<string>,
  showArchived = false
): ReadonlyArray<T> {
  if (showArchived || archivedIds.size === 0) return rows;
  return rows.filter((row) => !archivedIds.has(getId(row)));
}

export function readArchivedIds(
  storage: StorageLike | null | undefined,
  scopeKey: string
): Set<string> {
  if (!storage || !scopeKey.trim()) return new Set();
  try {
    const raw = storage.getItem(`${ARCHIVE_STORAGE_PREFIX}${scopeKey}`);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    );
  } catch {
    return new Set();
  }
}

export function persistArchivedIds(
  storage: StorageLike | null | undefined,
  scopeKey: string,
  archivedIds: ReadonlySet<string>
): boolean {
  if (!storage || !scopeKey.trim()) return false;
  const fullKey = `${ARCHIVE_STORAGE_PREFIX}${scopeKey}`;
  try {
    if (archivedIds.size === 0) {
      storage.removeItem(fullKey);
    } else {
      storage.setItem(fullKey, JSON.stringify(Array.from(archivedIds)));
    }
    return true;
  } catch {
    return false;
  }
}

export interface BulkOperationItemResult {
  id: string;
  status: 'succeeded' | 'skipped' | 'queued' | 'failed';
  reason?: string | undefined;
}

export interface BulkOperationSummary {
  succeeded: ReadonlyArray<string>;
  skipped: ReadonlyArray<string>;
  queued: ReadonlyArray<string>;
  failed: ReadonlyArray<{ id: string; reason: string }>;
}

export async function runBulkOperation(
  ids: ReadonlyArray<string>,
  execute: (id: string) => Promise<BulkOperationItemResult>
): Promise<BulkOperationSummary> {
  const succeeded: string[] = [];
  const skipped: string[] = [];
  const queued: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const id of ids) {
    try {
      const outcome = await execute(id);
      if (outcome.status === 'succeeded') {
        succeeded.push(id);
      } else if (outcome.status === 'queued') {
        queued.push(id);
      } else if (outcome.status === 'skipped') {
        skipped.push(id);
      } else {
        failed.push({ id, reason: outcome.reason ?? 'Operation failed' });
      }
    } catch (err) {
      failed.push({
        id,
        reason: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  }

  return { succeeded, skipped, queued, failed };
}

export function formatBulkApproveFeedback(input: {
  summary: BulkOperationSummary;
  itemNounSingular: string;
  itemNounPlural: string;
  actionPastTense?: string | undefined;
}): {
  tone: 'ok' | 'warn' | 'danger' | 'info';
  title: string;
  msg: string;
} {
  const { summary, itemNounSingular, itemNounPlural } = input;
  const verb = input.actionPastTense ?? 'Approved';
  const pluralize = (n: number): string =>
    `${n} ${n === 1 ? itemNounSingular : itemNounPlural}`;

  const parts: string[] = [];
  if (summary.succeeded.length > 0) {
    parts.push(`${verb.toLowerCase()} ${pluralize(summary.succeeded.length)}`);
  }
  if (summary.queued.length > 0) {
    parts.push(`queued ${pluralize(summary.queued.length)} offline for sync`);
  }
  if (summary.skipped.length > 0) {
    parts.push(`skipped ${pluralize(summary.skipped.length)} already processed`);
  }
  if (summary.failed.length > 0) {
    const firstReason = summary.failed[0]!.reason;
    parts.push(`${pluralize(summary.failed.length)} failed (${firstReason})`);
  }

  if (summary.succeeded.length > 0 && summary.failed.length === 0 && summary.queued.length === 0) {
    return {
      tone: 'ok',
      title: `${verb} ${pluralize(summary.succeeded.length)}`,
      msg:
        summary.skipped.length > 0
          ? `Successfully ${parts.join('; ')}.`
          : `Successfully ${verb.toLowerCase()} ${pluralize(summary.succeeded.length)} across the active dataset.`,
    };
  }

  if (summary.queued.length > 0 && summary.failed.length === 0) {
    return {
      tone: 'warn',
      title: `Queued ${pluralize(summary.queued.length)} for offline sync`,
      msg: `Saved locally (${parts.join('; ')}) and will replay automatically when back online.`,
    };
  }

  if (summary.succeeded.length === 0 && summary.queued.length === 0 && summary.failed.length === 0) {
    return {
      tone: 'info',
      title: 'No eligible items to approve',
      msg: `All selected ${itemNounPlural} were already approved or reconciled.`,
    };
  }

  return {
    tone: summary.succeeded.length > 0 ? 'warn' : 'danger',
    title:
      summary.succeeded.length > 0
        ? `Partially completed (${summary.succeeded.length} ${verb.toLowerCase()}, ${summary.failed.length} failed)`
        : `Bulk approval failed (${pluralize(summary.failed.length)})`,
    msg: parts.length > 0 ? `${parts.join('; ')}.` : 'Unable to process the selected records.',
  };
}

