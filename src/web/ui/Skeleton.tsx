import React from 'react';
import {
  getSkeletonCellWidthClass,
  getSkeletonTextLineWidths,
  resolveWorkspaceSkeletonPreset,
  type WorkspaceSkeletonKind,
} from './skeleton-layout.ts';

export type SkeletonVariant = 'rect' | 'text' | 'circle' | 'pill';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  lines?: number;
  animated?: boolean;
  className?: string;
  testId?: string;
}

const VARIANT_CLASSES: Record<SkeletonVariant, string> = {
  rect: 'rounded-[var(--radius-control)]',
  text: 'h-3.5 rounded-[6px]',
  circle: 'rounded-full',
  pill: 'rounded-[var(--radius-pill)]',
};

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'rect',
  width,
  height,
  lines = 1,
  animated = true,
  className = '',
  testId,
}) => {
  const baseMotion = animated ? 'skeleton-shimmer' : 'bg-[var(--bg-sunken)]';
  const style: React.CSSProperties | undefined =
    width !== undefined || height !== undefined
      ? {
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        }
      : undefined;

  if (variant === 'text' && lines > 1) {
    const widths = getSkeletonTextLineWidths(lines);
    return (
      <div
        aria-hidden="true"
        data-testid={testId}
        className={`flex flex-col gap-2 ${className}`}
        style={width !== undefined ? { width } : undefined}
      >
        {widths.map((wClass, idx) => (
          <div
            key={idx}
            style={height !== undefined ? { height } : undefined}
            className={`${baseMotion} ${VARIANT_CLASSES.text} ${wClass}`}
          />
        ))}
      </div>
    );
  }

  const defaultDims =
    className.trim() === '' && width === undefined && height === undefined
      ? variant === 'circle'
        ? 'h-9 w-9'
        : variant === 'pill'
        ? 'h-6 w-20'
        : variant === 'text'
        ? 'h-3.5 w-full'
        : 'h-4 w-full'
      : '';

  return (
    <div
      aria-hidden="true"
      data-testid={testId}
      style={style}
      className={`${baseMotion} ${VARIANT_CLASSES[variant]} ${defaultDims} ${className}`}
    />
  );
};

export const SkeletonMetric: React.FC<{ featured?: boolean; className?: string }> = ({
  featured = false,
  className = '',
}) => (
  <div
    aria-hidden="true"
    className={`rounded-[var(--radius-card)] p-3 sm:p-4 md:p-5 flex flex-col justify-between gap-2 border min-w-0 ${
      featured
        ? 'bg-[var(--brand-soft)]/50 border-[var(--navy-200)]'
        : 'bg-[var(--bg-surface)] border-[var(--border-hair)]'
    } ${className}`}
  >
    <div className="flex items-center justify-between gap-2">
      <Skeleton variant="text" className="h-3.5 w-24 sm:w-28" />
      <Skeleton variant="pill" className="h-5 w-16" />
    </div>
    <Skeleton className="h-7 sm:h-8 w-32 sm:w-36" />
    <Skeleton variant="text" className="h-3 w-28 sm:w-32" />
  </div>
);

export const SkeletonCard: React.FC<{
  showHeader?: boolean;
  showAction?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ showHeader = true, showAction = false, children, className = '' }) => (
  <section
    aria-hidden="true"
    className={`bg-[var(--bg-surface)] border border-[var(--border-hair)] rounded-[var(--radius-card)] overflow-hidden ${className}`}
  >
    {showHeader && (
      <header className="px-3.5 py-3 sm:px-5 sm:py-3.5 bg-[var(--bg-surface)] border-b border-[var(--border-hair)] flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <Skeleton className="h-4 w-40 sm:w-52 max-w-full" />
          <Skeleton variant="text" className="h-3 w-56 sm:w-72 max-w-full" />
        </div>
        {showAction && <Skeleton variant="pill" className="h-8 w-24 shrink-0" />}
      </header>
    )}
    <div className="p-3 sm:p-5">{children}</div>
  </section>
);

export const SkeletonTable: React.FC<{
  rows?: number;
  columns?: number;
  className?: string;
}> = ({ rows = 4, columns = 4, className = '' }) => (
  <div
    aria-hidden="true"
    className={`bg-[var(--bg-surface)] border border-[var(--border-hair)] rounded-[var(--radius-card)] overflow-hidden ${className}`}
  >
    {/* Mobile stacked skeleton cards */}
    <div className="md:hidden divide-y divide-[var(--border-hair)]">
      {Array.from({ length: Math.min(rows, 3) }).map((_, idx) => (
        <div key={`m-row-${idx}`} className="p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton variant="pill" className="h-5 w-16" />
          </div>
          <Skeleton variant="text" lines={2} />
        </div>
      ))}
    </div>

    {/* Desktop table skeleton */}
    <div className="hidden md:block">
      <div
        className="bg-[var(--bg-sunken)] border-b border-[var(--border-hair)] px-4 py-2.5 grid gap-4"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }).map((_, cIdx) => (
          <div
            key={`hdr-${cIdx}`}
            className="h-3 w-3/5 rounded-[6px] bg-[var(--navy-200)]/65"
          />
        ))}
      </div>
      <div className="divide-y divide-[var(--border-hair)]">
        {Array.from({ length: rows }).map((_, rIdx) => (
          <div
            key={`row-${rIdx}`}
            className="px-4 py-3.5 grid gap-4 items-center"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((__, cIdx) => (
              <Skeleton
                key={`cell-${rIdx}-${cIdx}`}
                className={`h-4 ${getSkeletonCellWidthClass(rIdx, cIdx)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const PerformanceDashboardSkeleton: React.FC<{ label?: string }> = ({
  label = 'Loading observability telemetry…',
}) => (
  <div
    role="status"
    aria-busy="true"
    aria-label={label}
    data-testid="performance-dashboard-skeleton"
  >
    <span className="sr-only">{label}</span>
    <SkeletonCard showHeader showAction>
      <div className="flex flex-col gap-5">
        {/* 3-up telemetry stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-[var(--radius-card)] bg-[var(--bg-sunken)]/60 border border-[var(--border-hair)] flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton variant="pill" className="h-5 w-16" />
              </div>
              <Skeleton className="h-6 w-36" />
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--border-hair)]">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
          ))}
        </div>

        {/* Chart canvas skeleton */}
        <div className="p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Skeleton className="h-4 w-56" />
            <div className="flex items-center gap-2">
              <Skeleton variant="pill" className="h-5 w-16" />
              <Skeleton variant="pill" className="h-5 w-16" />
              <Skeleton variant="pill" className="h-5 w-16" />
            </div>
          </div>
          <Skeleton className="h-64 w-full" />
        </div>

        {/* KPI alert cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, idx) => (
            <div
              key={idx}
              className="p-3 rounded-[var(--radius-card)] bg-[var(--bg-sunken)]/60 border border-[var(--border-hair)] flex items-center justify-between gap-3"
            >
              <div className="flex flex-col gap-1.5 flex-1">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-52 max-w-full" />
              </div>
              <Skeleton variant="pill" className="h-5 w-14 shrink-0" />
            </div>
          ))}
        </div>

        {/* Log stream skeleton */}
        <SkeletonTable rows={3} columns={5} />
      </div>
    </SkeletonCard>
  </div>
);

export const WorkspaceSkeleton: React.FC<{
  workspace?: WorkspaceSkeletonKind;
  label?: string;
}> = ({ workspace = 'generic', label = 'Loading workspace…' }) => {
  const preset = resolveWorkspaceSkeletonPreset(workspace);

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="workspace-skeleton"
      data-workspace={preset.kind}
      className="flex flex-col gap-4 sm:gap-5"
    >
      <span className="sr-only">{label}</span>

      {/* Top Workspace Header Banner */}
      <div className="p-3.5 sm:p-4 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border border-[var(--border-hair)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Skeleton variant="circle" className="hidden sm:block h-9 w-9 shrink-0" />
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <Skeleton className="h-5 w-48 sm:w-64 max-w-full" />
            <Skeleton variant="text" className="h-3.5 w-60 sm:w-80 max-w-full" />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {preset.hasTabs ? (
            <Skeleton variant="pill" className="h-9 w-full sm:w-80" />
          ) : (
            <Skeleton variant="pill" className="h-9 w-32" />
          )}
        </div>
      </div>

      {/* Metric Strip (3-up or 4-up depending on workspace) */}
      {preset.metricCount === 4 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3.5">
          {Array.from({ length: 4 }).map((_, idx) => (
            <SkeletonMetric key={idx} />
          ))}
        </div>
      )}

      {preset.metricCount === 3 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4">
          <SkeletonMetric featured className="col-span-2 sm:col-span-1" />
          <SkeletonMetric />
          <SkeletonMetric />
        </div>
      )}

      {/* Layout Variant 1: Desktop-first 2-column Office Grid (Harbour & Platform) */}
      {preset.layout === 'office-two-col' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-5 items-start">
          <div className="xl:col-span-8 flex flex-col gap-4 sm:gap-5 min-w-0">
            {preset.kind === 'platform' ? (
              <PerformanceDashboardSkeleton label={label} />
            ) : (
              <>
                <SkeletonCard showHeader showAction>
                  <SkeletonTable
                    rows={preset.primaryTableRows}
                    columns={preset.primaryTableColumns}
                  />
                </SkeletonCard>
                <SkeletonCard showHeader showAction>
                  <SkeletonTable rows={3} columns={4} />
                </SkeletonCard>
              </>
            )}
          </div>
          <aside className="xl:col-span-4 flex flex-col gap-4 min-w-0">
            <SkeletonCard showHeader>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton variant="pill" className="h-10 w-full" />
              </div>
            </SkeletonCard>
            <SkeletonCard showHeader>
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </SkeletonCard>
          </aside>
        </div>
      )}

      {/* Layout Variant 2: Auction Pit Split (Left lot/buyer cards, Right spotlight + keypad) */}
      {preset.layout === 'pit-split' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start">
            <div className="lg:col-span-7 flex flex-col gap-4">
              <SkeletonCard showHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-20 w-full rounded-[var(--radius-card)]" />
                  ))}
                </div>
              </SkeletonCard>
              <SkeletonCard showHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {Array.from({ length: 2 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-16 w-full rounded-[var(--radius-card)]" />
                  ))}
                </div>
              </SkeletonCard>
            </div>
            <div className="lg:col-span-5 flex flex-col gap-3">
              <div className="rounded-[var(--radius-card)] bg-[var(--decor-aqua-soft)] border border-[var(--border-hair)] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton variant="pill" className="h-6 w-20" />
                </div>
                <Skeleton className="h-10 w-44" />
                <Skeleton className="h-9 w-full" />
              </div>
              <SkeletonCard showHeader>
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-14 w-full" />
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 9 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-12 w-full" />
                    ))}
                  </div>
                  <Skeleton variant="pill" className="h-12 w-full" />
                </div>
              </SkeletonCard>
            </div>
          </div>
          <SkeletonCard showHeader>
            <SkeletonTable rows={3} columns={5} />
          </SkeletonCard>
        </>
      )}

      {/* Layout Variant 3: Hero Balance Card + Stacked Cards (Buyer & Fisher) */}
      {preset.layout === 'hero-stack' && (
        <>
          <section className="rounded-[var(--radius-card)] bg-[var(--decor-aqua-soft)] border border-[var(--border-hair)] p-5 sm:p-6 flex flex-col gap-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-12 w-56 max-w-full" />
            <Skeleton variant="text" className="h-3.5 w-72 max-w-full" />
            <div className="mt-2 pt-4 border-t border-[var(--border-hair)] grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Array.from({ length: preset.kind === 'buyer' ? 3 : 2 }).map((_, idx) => (
                <div key={idx} className="flex flex-col gap-1.5">
                  <Skeleton variant="text" className="h-3 w-24" />
                  <Skeleton className="h-5 w-28" />
                </div>
              ))}
            </div>
          </section>
          <SkeletonCard showHeader>
            <SkeletonTable rows={preset.primaryTableRows} columns={preset.primaryTableColumns} />
          </SkeletonCard>
          <SkeletonCard showHeader>
            <SkeletonTable rows={3} columns={4} />
          </SkeletonCard>
        </>
      )}

      {/* Layout Variant 4: Interactive Terminal Form + Registry Table (Weighing & Inspector) */}
      {preset.layout === 'form-table' && (
        <>
          <SkeletonCard showHeader>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-20 w-full rounded-[var(--radius-card)]" />
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full col-span-2 sm:col-span-1" />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <Skeleton variant="pill" className="h-12 w-40" />
                <Skeleton variant="pill" className="h-12 w-48" />
              </div>
            </div>
          </SkeletonCard>
          <SkeletonCard showHeader>
            <SkeletonTable rows={preset.primaryTableRows} columns={preset.primaryTableColumns} />
          </SkeletonCard>
        </>
      )}

      {/* Generic Fallback */}
      {preset.layout === 'generic' && (
        <SkeletonCard showHeader>
          <SkeletonTable rows={preset.primaryTableRows} columns={preset.primaryTableColumns} />
        </SkeletonCard>
      )}
    </div>
  );
};
