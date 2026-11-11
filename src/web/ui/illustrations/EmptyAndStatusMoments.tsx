import React from 'react';

export type MomentIllustrationVariant =
  | 'empty-lots'
  | 'empty-bidding'
  | 'all-inspected'
  | 'reconciled-utr'
  | 'chain-verified'
  | 'unfit-quarantine';

export const MomentIllustrationScene: React.FC<{
  variant: MomentIllustrationVariant;
  size?: number;
  className?: string;
}> = ({ variant, size = 56, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 56 56"
    fill="none"
    className={`shrink-0 select-none ${className}`}
    aria-hidden="true"
    focusable="false"
  >
    <rect
      x="3"
      y="3"
      width="50"
      height="50"
      rx="14"
      fill={
        variant === 'unfit-quarantine'
          ? 'var(--danger-bg)'
          : variant === 'reconciled-utr' || variant === 'chain-verified'
          ? 'var(--decor-sun-soft)'
          : 'var(--decor-aqua-soft)'
      }
      stroke="var(--decor-ink)"
      strokeWidth="2"
    />
    {variant === 'empty-lots' && (
      <>
        <rect x="14" y="22" width="28" height="18" rx="3" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M14 28H42M23 16H33" stroke="var(--decor-ink)" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {variant === 'empty-bidding' && (
      <>
        <circle cx="28" cy="28" r="12" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M28 21V28L33 31" stroke="var(--decor-ink)" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {variant === 'all-inspected' && (
      <>
        <path d="M28 11L42 17V27C42 36 35.5 42 28 45C20.5 42 14 36 14 27V17L28 11Z" fill="var(--bg-surface)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M22 28L26 32L34 23" stroke="var(--decor-aqua)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
    {variant === 'reconciled-utr' && (
      <>
        <rect x="12" y="16" width="32" height="24" rx="4" fill="var(--bg-surface)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M18 28L24 34L38 20" stroke="var(--decor-ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
    {variant === 'chain-verified' && (
      <>
        <circle cx="28" cy="28" r="14" fill="var(--decor-sun)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M22 28L26 32L35 23" stroke="var(--bg-surface)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
    {variant === 'unfit-quarantine' && (
      <>
        <path d="M28 13L43 40H13L28 13Z" fill="var(--bg-surface)" stroke="var(--decor-ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M28 23V31M28 35.5V36" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round" />
      </>
    )}
  </svg>
);
