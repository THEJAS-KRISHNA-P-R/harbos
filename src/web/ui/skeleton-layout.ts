import type { WorkspaceId } from '@shared/contracts/rbac.ts';

export type WorkspaceSkeletonKind = WorkspaceId | 'generic';

export interface WorkspaceSkeletonPreset {
  kind: WorkspaceSkeletonKind;
  layout: 'office-two-col' | 'pit-split' | 'hero-stack' | 'form-table' | 'generic';
  metricCount: number;
  hasHeroBanner: boolean;
  hasStickyAside: boolean;
  hasTabs: boolean;
  primaryTableRows: number;
  primaryTableColumns: number;
}

const WORKSPACE_PRESETS: Record<WorkspaceSkeletonKind, WorkspaceSkeletonPreset> = {
  harbour: {
    kind: 'harbour',
    layout: 'office-two-col',
    metricCount: 3,
    hasHeroBanner: false,
    hasStickyAside: true,
    hasTabs: true,
    primaryTableRows: 4,
    primaryTableColumns: 4,
  },
  platform: {
    kind: 'platform',
    layout: 'office-two-col',
    metricCount: 4,
    hasHeroBanner: false,
    hasStickyAside: true,
    hasTabs: true,
    primaryTableRows: 4,
    primaryTableColumns: 5,
  },
  weighing: {
    kind: 'weighing',
    layout: 'form-table',
    metricCount: 3,
    hasHeroBanner: false,
    hasStickyAside: false,
    hasTabs: false,
    primaryTableRows: 4,
    primaryTableColumns: 6,
  },
  inspector: {
    kind: 'inspector',
    layout: 'form-table',
    metricCount: 3,
    hasHeroBanner: false,
    hasStickyAside: false,
    hasTabs: false,
    primaryTableRows: 4,
    primaryTableColumns: 6,
  },
  pit: {
    kind: 'pit',
    layout: 'pit-split',
    metricCount: 0,
    hasHeroBanner: false,
    hasStickyAside: true,
    hasTabs: false,
    primaryTableRows: 3,
    primaryTableColumns: 5,
  },
  buyer: {
    kind: 'buyer',
    layout: 'hero-stack',
    metricCount: 0,
    hasHeroBanner: true,
    hasStickyAside: false,
    hasTabs: false,
    primaryTableRows: 4,
    primaryTableColumns: 5,
  },
  fisher: {
    kind: 'fisher',
    layout: 'hero-stack',
    metricCount: 0,
    hasHeroBanner: true,
    hasStickyAside: false,
    hasTabs: false,
    primaryTableRows: 4,
    primaryTableColumns: 5,
  },
  generic: {
    kind: 'generic',
    layout: 'generic',
    metricCount: 3,
    hasHeroBanner: false,
    hasStickyAside: false,
    hasTabs: false,
    primaryTableRows: 4,
    primaryTableColumns: 4,
  },
};

export function resolveWorkspaceSkeletonPreset(
  workspace?: WorkspaceSkeletonKind
): WorkspaceSkeletonPreset {
  if (!workspace || !(workspace in WORKSPACE_PRESETS)) {
    return WORKSPACE_PRESETS.generic;
  }
  return WORKSPACE_PRESETS[workspace];
}

const STAGGERED_LINE_WIDTHS: ReadonlyArray<string> = [
  'w-full',
  'w-11/12',
  'w-5/6',
  'w-4/5',
  'w-3/4',
];

export function getSkeletonTextLineWidths(lines: number): ReadonlyArray<string> {
  const safeCount = Math.max(1, Math.min(12, Math.floor(Number.isFinite(lines) ? lines : 1)));
  if (safeCount === 1) {
    return ['w-full'];
  }
  return Array.from({ length: safeCount }, (_, idx) => {
    if (idx === safeCount - 1) {
      return 'w-2/3';
    }
    return STAGGERED_LINE_WIDTHS[idx % STAGGERED_LINE_WIDTHS.length] ?? 'w-full';
  });
}

const CELL_WIDTH_CYCLE: ReadonlyArray<string> = ['w-4/5', 'w-full', 'w-2/3', 'w-3/4', 'w-1/2'];

export function getSkeletonCellWidthClass(rowIndex: number, colIndex: number): string {
  const idx = Math.abs(rowIndex * 3 + colIndex) % CELL_WIDTH_CYCLE.length;
  return CELL_WIDTH_CYCLE[idx] ?? 'w-3/4';
}

export function shouldShowWorkspaceSkeleton(params: {
  loading?: boolean;
  hasData: boolean;
  switchingPersona?: boolean;
}): boolean {
  if (!params.hasData) return true;
  if (params.switchingPersona) return true;
  return Boolean(params.loading);
}

export type SkeletonListVariant = 'activity' | 'detailed' | 'compact' | 'key-value';

export interface SkeletonListLayoutSpec {
  variant: SkeletonListVariant;
  defaultAvatar: boolean;
  defaultBadge: boolean;
  subtitleLines: number;
  titleWidthCycle: ReadonlyArray<string>;
}

const LIST_LAYOUT_SPECS: Record<SkeletonListVariant, SkeletonListLayoutSpec> = {
  activity: {
    variant: 'activity',
    defaultAvatar: false,
    defaultBadge: true,
    subtitleLines: 1,
    titleWidthCycle: ['w-36', 'w-44', 'w-32', 'w-40'],
  },
  detailed: {
    variant: 'detailed',
    defaultAvatar: true,
    defaultBadge: true,
    subtitleLines: 2,
    titleWidthCycle: ['w-44', 'w-52', 'w-40', 'w-48'],
  },
  compact: {
    variant: 'compact',
    defaultAvatar: false,
    defaultBadge: true,
    subtitleLines: 1,
    titleWidthCycle: ['w-2/5', 'w-1/2', 'w-1/3', 'w-2/5'],
  },
  'key-value': {
    variant: 'key-value',
    defaultAvatar: false,
    defaultBadge: false,
    subtitleLines: 0,
    titleWidthCycle: ['w-32', 'w-40', 'w-28', 'w-36'],
  },
};

export function resolveSkeletonListLayout(
  variant: SkeletonListVariant = 'activity'
): SkeletonListLayoutSpec {
  return LIST_LAYOUT_SPECS[variant] ?? LIST_LAYOUT_SPECS.activity;
}

export type SkeletonCardGridVariant = 'tile' | 'summary' | 'selectable' | 'alert';
export type SkeletonCardGridColumns = 1 | 2 | 3 | 4 | 6;

const CARD_GRID_COLUMN_CLASSES: Record<SkeletonCardGridColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};

export function resolveSkeletonCardGridColumnsClass(
  columns: SkeletonCardGridColumns = 2
): string {
  return CARD_GRID_COLUMN_CLASSES[columns] ?? CARD_GRID_COLUMN_CLASSES[2];
}

