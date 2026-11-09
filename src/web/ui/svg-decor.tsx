import React from 'react';

export interface SvgDecorProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Wise.com-inspired compact 2-tone spot medallions:
 * - Self-contained 48px–56px circular/squircle spot graphics with bold geometric forms
 * - Overlapping corner status badge coin (Wise avatar/transfer badge pattern)
 * - Zero embedded <text> tags (all typography stays in HTML/CSS)
 * - Zero background grid clutter; uses only HarbourOS §11 Navy-on-Off-White CSS variables
 */

/**
 * 1. MaritimeCrestSvgEmblem — Primary brand medallion (Anchor + Statutory Balance Scale)
 */
export const MaritimeCrestSvgEmblem: React.FC<SvgDecorProps> = ({
  size = 40,
  className = '',
  title = 'HarbourOS Maritime Statutory Crest',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label={title}
    className={`shrink-0 select-none ${className}`}
  >
    <circle
      cx="32"
      cy="32"
      r="30"
      fill="var(--brand-soft)"
      stroke="var(--navy-200)"
      strokeWidth="1.5"
    />
    <circle
      cx="32"
      cy="32"
      r="23"
      fill="var(--bg-surface)"
      stroke="var(--brand)"
      strokeWidth="2"
    />
    {/* Top anchor ring */}
    <circle
      cx="32"
      cy="18"
      r="3.5"
      fill="var(--brand-soft)"
      stroke="var(--brand)"
      strokeWidth="2"
    />
    {/* Anchor shank & balance crossbar */}
    <path
      d="M32 21.5V44M21 27H43"
      stroke="var(--brand)"
      strokeWidth="2.25"
      strokeLinecap="round"
    />
    {/* Crown & flukes */}
    <path
      d="M21 37C21 42.5 25.9 46 32 46C38.1 46 43 42.5 43 37"
      stroke="var(--brand)"
      strokeWidth="2.25"
      strokeLinecap="round"
    />
    <path
      d="M18.5 39L21 36L24 38.5M45.5 39L43 36L40 38.5"
      stroke="var(--brand)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 2. HarbourQuayDawnSvgDecor — Wise-style compact spot medallion for Harbour Governance
 *    (Harbour Lighthouse + Vessel Bow + Corner Statutory Check Coin)
 */
export const HarbourQuayDawnSvgDecor: React.FC<SvgDecorProps> = ({
  size = 48,
  className = '',
  title = 'Harbour Administration & Statutory Governance',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label={title}
    className={`shrink-0 select-none ${className}`}
  >
    {/* Soft squircle container */}
    <rect
      x="2"
      y="2"
      width="56"
      height="56"
      rx="18"
      fill="var(--brand-soft)"
      stroke="var(--navy-200)"
      strokeWidth="1.5"
    />
    {/* Inner crisp disc */}
    <circle cx="30" cy="30" r="20" fill="var(--bg-surface)" stroke="var(--brand)" strokeWidth="2" />
    {/* Lighthouse & Harbour Pier */}
    <path
      d="M21 38L23 21H29L31 38H21Z"
      fill="var(--brand-soft)"
      stroke="var(--brand)"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <rect x="22" y="17" width="8" height="4" rx="1.5" fill="var(--brand)" />
    {/* Beacon rays */}
    <path
      d="M32 18L40 15M32 20L41 21"
      stroke="var(--brand)"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    {/* Quay wave line */}
    <path
      d="M16 38H44M19 42H41"
      stroke="var(--brand)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Wise-style overlapping corner badge coin */}
    <circle cx="49" cy="49" r="12" fill="var(--brand)" stroke="var(--bg-surface)" strokeWidth="2.5" />
    <path
      d="M44.5 49.2L47.6 52.2L53.8 46"
      stroke="var(--brand-fg)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 3. DocksideWeighingScaleSvgDecor — Wise-style compact spot medallion for Weighing & QR Lots
 *    (Precision Scale Dial + Weight Pan + Corner QR Matrix Coin)
 */
export const DocksideWeighingScaleSvgDecor: React.FC<SvgDecorProps> = ({
  size = 48,
  className = '',
  title = 'Dockside Integer-Gram Scale & QR Tagging',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label={title}
    className={`shrink-0 select-none ${className}`}
  >
    <rect
      x="2"
      y="2"
      width="56"
      height="56"
      rx="18"
      fill="var(--brand-soft)"
      stroke="var(--navy-200)"
      strokeWidth="1.5"
    />
    {/* Scale Body & Pan */}
    <rect
      x="13"
      y="14"
      width="34"
      height="6"
      rx="3"
      fill="var(--bg-surface)"
      stroke="var(--brand)"
      strokeWidth="2"
    />
    <path d="M22 20V25H38V20" stroke="var(--brand)" strokeWidth="2" />
    <rect
      x="15"
      y="25"
      width="30"
      height="22"
      rx="6"
      fill="var(--bg-surface)"
      stroke="var(--brand)"
      strokeWidth="2"
    />
    {/* Precision Dial Gauge */}
    <circle
      cx="30"
      cy="36"
      r="7"
      fill="var(--brand-soft)"
      stroke="var(--brand)"
      strokeWidth="1.8"
    />
    <path
      d="M30 36L33.5 32.5"
      stroke="var(--brand)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    {/* Wise-style overlapping corner QR badge coin */}
    <circle cx="49" cy="49" r="12" fill="var(--brand)" stroke="var(--bg-surface)" strokeWidth="2.5" />
    <rect x="44.5" y="44.5" width="4" height="4" rx="0.8" fill="var(--brand-fg)" />
    <rect x="50.5" y="44.5" width="4" height="4" rx="0.8" fill="var(--brand-fg)" />
    <rect x="44.5" y="50.5" width="4" height="4" rx="0.8" fill="var(--brand-fg)" />
    <rect x="50.5" y="50.5" width="4" height="4" rx="0.8" fill="var(--navy-200)" />
  </svg>
);

/**
 * 4. AuctionPitAmphitheatreSvgDecor — Wise-style compact spot medallion for Auction Pit
 *    (Auction Gavel & Sound Block + Corner Bid Arrow Coin)
 */
export const AuctionPitAmphitheatreSvgDecor: React.FC<SvgDecorProps> = ({
  size = 48,
  className = '',
  title = 'Auction Pit Terminal & Statutory Clearing',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label={title}
    className={`shrink-0 select-none ${className}`}
  >
    <rect
      x="2"
      y="2"
      width="56"
      height="56"
      rx="18"
      fill="var(--brand-soft)"
      stroke="var(--navy-200)"
      strokeWidth="1.5"
    />
    <circle cx="30" cy="30" r="20" fill="var(--bg-surface)" stroke="var(--brand)" strokeWidth="2" />
    {/* Gavel Head & Handle */}
    <path
      d="M21 25L29 17L35 23L27 31L21 25Z"
      fill="var(--brand-soft)"
      stroke="var(--brand)"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M31 27L40 36"
      stroke="var(--brand)"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    {/* Sound Block Base */}
    <path
      d="M18 41H34"
      stroke="var(--brand)"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
    {/* Wise-style overlapping corner badge coin */}
    <circle cx="49" cy="49" r="12" fill="var(--brand)" stroke="var(--bg-surface)" strokeWidth="2.5" />
    <path
      d="M45 51L49 45L53 51M49 45V54"
      stroke="var(--brand-fg)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 5. StatutoryLedgerWaterfallSvgDecor — Wise-style compact spot medallion for Double-Entry Ledger
 *    (Interlocking Settlement Coins + Corner SHA-256 Lock Shield)
 */
export const StatutoryLedgerWaterfallSvgDecor: React.FC<SvgDecorProps> = ({
  size = 48,
  className = '',
  title = '95/5 Statutory Settlement & SHA-256 Ledger',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label={title}
    className={`shrink-0 select-none ${className}`}
  >
    <rect
      x="2"
      y="2"
      width="56"
      height="56"
      rx="18"
      fill="var(--brand-soft)"
      stroke="var(--navy-200)"
      strokeWidth="1.5"
    />
    {/* Interlocking Wise-style Ledger Coins */}
    <circle
      cx="25"
      cy="27"
      r="13"
      fill="var(--bg-surface)"
      stroke="var(--brand)"
      strokeWidth="2"
    />
    <circle
      cx="36"
      cy="33"
      r="11"
      fill="var(--brand-soft)"
      stroke="var(--brand)"
      strokeWidth="2"
    />
    {/* Double-Entry Transfer Arrows */}
    <path
      d="M21 25H29M26 22L29 25L26 28"
      stroke="var(--brand)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M39 34H33M35.5 31.5L33 34L35.5 36.5"
      stroke="var(--brand)"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Wise-style overlapping corner shield coin */}
    <circle cx="49" cy="49" r="12" fill="var(--brand)" stroke="var(--bg-surface)" strokeWidth="2.5" />
    <path
      d="M49 43.5L53.5 45.5V49C53.5 51.8 51.6 53.9 49 54.8C46.4 53.9 44.5 51.8 44.5 49V45.5L49 43.5Z"
      fill="var(--brand-fg)"
    />
  </svg>
);

/**
 * 6. ColdChainInspectorSvgDecor — Wise-style compact spot medallion for s.21 Quality Inspection
 *    (Precision Thermometer + Cold-Chain Crystal + Corner Certified Coin)
 */
export const ColdChainInspectorSvgDecor: React.FC<SvgDecorProps> = ({
  size = 48,
  className = '',
  title = 'Section 21 Cold-Chain & Hygiene Certification',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    role="img"
    aria-label={title}
    className={`shrink-0 select-none ${className}`}
  >
    <rect
      x="2"
      y="2"
      width="56"
      height="56"
      rx="18"
      fill="var(--brand-soft)"
      stroke="var(--navy-200)"
      strokeWidth="1.5"
    />
    <circle cx="30" cy="30" r="20" fill="var(--bg-surface)" stroke="var(--brand)" strokeWidth="2" />
    {/* Thermometer Stem & Bulb */}
    <rect
      x="23"
      y="16"
      width="8"
      height="20"
      rx="4"
      fill="var(--brand-soft)"
      stroke="var(--brand)"
      strokeWidth="1.8"
    />
    <circle cx="27" cy="38" r="6" fill="var(--brand)" />
    <path d="M27 23V35" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" />
    {/* Cold-chain tick marks */}
    <path
      d="M34 20H39M34 25H37M34 30H39"
      stroke="var(--brand)"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    {/* Wise-style overlapping corner check coin */}
    <circle cx="49" cy="49" r="12" fill="var(--brand)" stroke="var(--bg-surface)" strokeWidth="2.5" />
    <path
      d="M44.5 49.2L47.6 52.2L53.8 46"
      stroke="var(--brand-fg)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
