import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserLocalStorage } from '@web/lib/session-storage.ts';
import {
  archiveRecordIds,
  filterArchivedRecords,
  persistArchivedIds,
  pruneSelectedIds,
  readArchivedIds,
  restoreArchivedRecordIds,
  toggleSelectAllIds,
  toggleSelectedId,
} from '@web/lib/bulk-selection.ts';

export interface UseBulkSelectionOptions<T> {
  rows: ReadonlyArray<T>;
  getRowId: (row: T) => string;
  /** Unique localStorage scope key for archived records, e.g. `${tenantId}.weighing.lots` */
  archiveScopeKey: string;
}

export interface UseBulkSelectionResult<T> {
  visibleRows: ReadonlyArray<T>;
  visibleRowIds: ReadonlyArray<string>;
  selectedIds: ReadonlySet<string>;
  selectedVisibleIds: ReadonlyArray<string>;
  archivedIds: ReadonlySet<string>;
  archivedInDatasetCount: number;
  toggleRow: (rowId: string) => void;
  toggleSelectAll: (rowIds: ReadonlyArray<string>) => void;
  selectAllVisible: () => void;
  clearSelection: () => void;
  archiveSelected: () => number;
  restoreArchived: () => number;
}

export function useBulkSelection<T>({
  rows,
  getRowId,
  archiveScopeKey,
}: UseBulkSelectionOptions<T>): UseBulkSelectionResult<T> {
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(() =>
    readArchivedIds(getBrowserLocalStorage(), archiveScopeKey)
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  // Re-load archived IDs and reset selection when tenant/dataset scope changes
  useEffect(() => {
    setArchivedIds(readArchivedIds(getBrowserLocalStorage(), archiveScopeKey));
    setSelectedIds(new Set());
  }, [archiveScopeKey]);

  const visibleRows = useMemo(
    () => filterArchivedRecords(rows, getRowId, archivedIds, false),
    [rows, getRowId, archivedIds]
  );

  const visibleRowIds = useMemo(() => visibleRows.map(getRowId), [visibleRows, getRowId]);

  const archivedInDatasetCount = useMemo(
    () => rows.filter((row) => archivedIds.has(getRowId(row))).length,
    [rows, getRowId, archivedIds]
  );

  // Prune any selected IDs that are no longer in the visible dataset
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const pruned = pruneSelectedIds(prev, visibleRowIds);
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [visibleRowIds]);

  const selectedVisibleIds = useMemo(
    () => visibleRowIds.filter((id) => selectedIds.has(id)),
    [visibleRowIds, selectedIds]
  );

  const toggleRow = useCallback((rowId: string): void => {
    setSelectedIds((prev) => toggleSelectedId(prev, rowId));
  }, []);

  const toggleSelectAll = useCallback((rowIds: ReadonlyArray<string>): void => {
    setSelectedIds((prev) => toggleSelectAllIds(prev, rowIds));
  }, []);

  const selectAllVisible = useCallback((): void => {
    setSelectedIds(new Set(visibleRowIds));
  }, [visibleRowIds]);

  const clearSelection = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  const archiveSelected = useCallback((): number => {
    if (selectedVisibleIds.length === 0) return 0;
    const count = selectedVisibleIds.length;
    setArchivedIds((prev) => {
      const next = archiveRecordIds(prev, selectedVisibleIds);
      persistArchivedIds(getBrowserLocalStorage(), archiveScopeKey, next);
      return next;
    });
    setSelectedIds(new Set());
    return count;
  }, [selectedVisibleIds, archiveScopeKey]);

  const restoreArchived = useCallback((): number => {
    const count = archivedInDatasetCount;
    if (count === 0 && archivedIds.size === 0) return 0;
    const cleared = restoreArchivedRecordIds(archivedIds);
    setArchivedIds(cleared);
    persistArchivedIds(getBrowserLocalStorage(), archiveScopeKey, cleared);
    return count;
  }, [archivedIds, archivedInDatasetCount, archiveScopeKey]);

  return {
    visibleRows,
    visibleRowIds,
    selectedIds,
    selectedVisibleIds,
    archivedIds,
    archivedInDatasetCount,
    toggleRow,
    toggleSelectAll,
    selectAllVisible,
    clearSelection,
    archiveSelected,
    restoreArchived,
  };
}
