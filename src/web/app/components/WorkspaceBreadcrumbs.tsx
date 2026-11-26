import React from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import type { BreadcrumbSegment } from '@web/lib/workspace-context.ts';
import type { WorkspaceGroup } from '@web/lib/command-palette.ts';

export interface WorkspaceBreadcrumbsProps {
  segments: ReadonlyArray<BreadcrumbSegment>;
  onClickTenant?: (() => void) | undefined;
  onClickGroup?: ((groupId: WorkspaceGroup) => void) | undefined;
}

export const WorkspaceBreadcrumbs: React.FC<WorkspaceBreadcrumbsProps> = ({
  segments,
  onClickTenant,
  onClickGroup,
}) => {
  if (segments.length === 0) return null;

  return (
    <nav
      aria-label="Workspace breadcrumb"
      data-testid="workspace-breadcrumbs"
      className="no-print -mt-1 sm:-mt-2"
    >
      <ol className="flex flex-wrap items-center gap-1 sm:gap-1.5 text-xs text-[var(--text-muted)]">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1 || Boolean(segment.current);
          const isTenantClickable = segment.kind === 'tenant' && Boolean(onClickTenant);
          const isGroupClickable =
            segment.kind === 'group' && Boolean(segment.groupId) && Boolean(onClickGroup);

          return (
            <li
              key={segment.id}
              className="inline-flex items-center gap-1 sm:gap-1.5 min-w-0 max-w-full"
            >
              {index > 0 && (
                <ChevronRight
                  className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-60 shrink-0"
                  aria-hidden="true"
                />
              )}

              {isLast ? (
                <span
                  aria-current="page"
                  data-testid="breadcrumb-current"
                  className="font-semibold text-[var(--text-primary)] truncate"
                >
                  {segment.label}
                </span>
              ) : isTenantClickable ? (
                <button
                  type="button"
                  data-testid="breadcrumb-tenant"
                  onClick={onClickTenant}
                  className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)] hover:text-[var(--brand)] transition-colors cursor-pointer truncate max-w-[200px] sm:max-w-[260px]"
                  title={segment.label}
                >
                  <Building2 className="w-3.5 h-3.5 shrink-0 opacity-75" aria-hidden="true" />
                  <span className="truncate">{segment.label}</span>
                </button>
              ) : isGroupClickable ? (
                <button
                  type="button"
                  data-testid="breadcrumb-group"
                  onClick={() => onClickGroup?.(segment.groupId!)}
                  className="font-medium text-[var(--text-secondary)] hover:text-[var(--brand)] transition-colors cursor-pointer truncate"
                  title={`Quick jump within ${segment.label}`}
                >
                  {segment.label}
                </button>
              ) : (
                <span
                  data-testid={`breadcrumb-${segment.kind}`}
                  className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)] truncate max-w-[200px] sm:max-w-[260px]"
                >
                  {segment.kind === 'tenant' && (
                    <Building2 className="w-3.5 h-3.5 shrink-0 opacity-75" aria-hidden="true" />
                  )}
                  <span className="truncate">{segment.label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
