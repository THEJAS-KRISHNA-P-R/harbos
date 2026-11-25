import React from 'react';

export interface TopProgressBarProps {
  /** Whether a background synchronization or data refresh is currently active */
  active: boolean;
  /** Accessible label announced when synchronizing */
  label?: string | undefined;
  /** Optional data-testid for automated inspection */
  testId?: string | undefined;
  /** Positioning mode: 'fixed' spans full shell top edge; 'sticky-header' pins to top edge of a relative/sticky header */
  placement?: 'fixed' | 'header' | undefined;
}

/**
 * Slim indeterminate progress bar pinned to the very top edge of AppShell.
 * Uses GPU compositor-only animations (`transform` + `opacity`) so it introduces
 * zero layout shift and respects `prefers-reduced-motion`.
 */
export const TopProgressBar: React.FC<TopProgressBarProps> = ({
  active,
  label = 'Synchronizing harbour data…',
  testId = 'appshell-sync-progress',
  placement = 'fixed',
}) => {
  const positionClass =
    placement === 'header'
      ? 'absolute top-0 inset-x-0 z-40'
      : 'fixed top-0 inset-x-0 z-50';

  return (
    <div
      role={active ? 'progressbar' : undefined}
      aria-label={active ? label : undefined}
      aria-valuetext={active ? label : undefined}
      aria-busy={active ? 'true' : undefined}
      aria-hidden={active ? undefined : 'true'}
      data-testid={testId}
      data-syncing={active ? 'true' : 'false'}
      className={`${positionClass} h-[3px] overflow-hidden pointer-events-none no-print transition-opacity duration-200 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {active && <span className="sr-only">{label}</span>}
      <div className="relative h-full w-full bg-[var(--navy-200)]/80">
        <span
          aria-hidden="true"
          className={`top-progress-bar-primary absolute inset-y-0 left-0 w-full bg-[var(--brand)] ${
            active ? 'is-active' : ''
          }`}
        />
        <span
          aria-hidden="true"
          className={`top-progress-bar-secondary absolute inset-y-0 left-0 w-full bg-[var(--info)] ${
            active ? 'is-active' : ''
          }`}
        />
      </div>
    </div>
  );
};
