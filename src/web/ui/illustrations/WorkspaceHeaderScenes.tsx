import React from 'react';
import type { WorkspaceId } from '@shared/contracts/rbac.ts';

export const WorkspaceHeaderIllustration: React.FC<{
  workspace: WorkspaceId;
  size?: number;
  className?: string;
}> = ({ workspace, size = 44, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    className={`shrink-0 select-none ${className}`}
    aria-hidden="true"
    focusable="false"
  >
    <rect
      x="2"
      y="2"
      width="44"
      height="44"
      rx="12"
      fill="var(--decor-aqua-soft)"
      stroke="var(--decor-ink)"
      strokeWidth="2"
    />
    {workspace === 'weighing' && (
      <>
        <rect x="10" y="28" width="28" height="10" rx="3" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="2" />
        <rect x="14" y="14" width="20" height="11" rx="2" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M24 25V28M18 33H30" stroke="var(--decor-ink)" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {workspace === 'pit' && (
      <>
        <path d="M10 34C14 24 34 24 38 34" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="2" />
        <rect x="19" y="12" width="14" height="8" rx="2" fill="var(--decor-sun)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M26 20V30M14 34H34" stroke="var(--decor-ink)" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {workspace === 'inspector' && (
      <>
        <path d="M24 8L36 13V23C36 31 30.5 36.5 24 39C17.5 36.5 12 31 12 23V13L24 8Z" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M19 24L22.5 27.5L29.5 20" stroke="var(--decor-ink)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
    {workspace === 'buyer' && (
      <>
        <rect x="10" y="14" width="28" height="22" rx="3" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M10 21H38M18 28H30" stroke="var(--decor-ink)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="34" cy="14" r="5" fill="var(--decor-sun)" stroke="var(--decor-ink)" strokeWidth="1.75" />
      </>
    )}
    {workspace === 'fisher' && (
      <>
        <path d="M10 27H38L34 35H14L10 27Z" fill="var(--decor-sun)" stroke="var(--decor-ink)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M24 12V27M24 13L33 22H24" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="2" strokeLinejoin="round" />
      </>
    )}
    {workspace === 'harbour' && (
      <>
        <rect x="11" y="11" width="26" height="26" rx="4" fill="var(--decor-sand)" stroke="var(--decor-ink)" strokeWidth="2" />
        <circle cx="24" cy="24" r="6" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M24 15V18M24 30V33M15 24H18M30 24H33" stroke="var(--decor-ink)" strokeWidth="2" strokeLinecap="round" />
      </>
    )}
    {workspace === 'platform' && (
      <>
        <circle cx="24" cy="24" r="13" fill="var(--decor-sun-soft)" stroke="var(--decor-ink)" strokeWidth="2" />
        <path d="M19 24L22.5 27.5L29.5 20.5" stroke="var(--decor-ink)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </>
    )}
  </svg>
);
