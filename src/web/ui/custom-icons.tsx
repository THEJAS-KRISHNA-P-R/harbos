import React from 'react';

export interface CustomIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | undefined;
}

const baseProps = (size: number, className: string, rest: React.SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: `shrink-0 ${className}`,
  'aria-hidden': true as const,
  ...rest,
});

/**
 * 1. HarbourCrestIcon — Maritime trawler bow, wave horizon & beacon star
 */
export const HarbourCrestIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M12 3v4" />
    <path d="M10 5h4" />
    <path d="M5 14l7-4 7 4-2.2 4.5H7.2L5 14z" />
    <path d="M12 10v8.5" />
    <path d="M3 20.5c2 0 2.5-1 4.5-1s2.5 1 4.5 1 2.5-1 4.5-1 2.5 1 4.5 1" />
  </svg>
);

/**
 * 2. DockScaleIcon — Precision dockside crate platform scale & fish silhouette
 */
export const DockScaleIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <rect x="4" y="4" width="16" height="5" rx="1.5" />
    <circle cx="12" cy="6.5" r="1" />
    <path d="M7 9v6" />
    <path d="M17 9v6" />
    <path d="M3.5 15h17" />
    <rect x="5" y="15" width="14" height="5" rx="1.5" />
    <path d="M9 17.5h6" />
  </svg>
);

/**
 * 3. AuctionGavelBellIcon — Pit auctioneer hammer, sounding block & bid waves
 */
export const AuctionGavelBellIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M13.5 5.5l5 5" />
    <rect x="11" y="3.5" width="5" height="8" rx="1.5" transform="rotate(-45 11 3.5)" />
    <path d="M10.5 11.5L4.5 17.5" />
    <path d="M13 19.5h7" />
    <path d="M14.5 16.5h4" />
    <path d="M4.5 6.5c1.2-1.2 2.8-1.8 4.5-1.8" />
  </svg>
);

/**
 * 4. BuyerCrateEscrowIcon — Wholesale catch crate with verified clearing shield
 */
export const BuyerCrateEscrowIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M3.5 8.5h13v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9z" />
    <path d="M3.5 12h10" />
    <path d="M6.5 5.5h7l1.5 3h-10l1.5-3z" />
    <path d="M17 11.5l3.5 1.3v3.2c0 2.3-1.5 3.8-3.5 4.5-2-.7-3.5-2.2-3.5-4.5v-3.2L17 11.5z" />
    <path d="M15.7 15.8l1 1 2-2.2" />
  </svg>
);

/**
 * 5. FisherVesselPassbookIcon — Fishing boat hull over passbook ledger lines
 */
export const FisherVesselPassbookIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M8 8.5l4-2.5 4 2.5-1.4 3H9.4L8 8.5z" />
    <path d="M12 6v5.5" />
    <path d="M7.5 15h9" />
    <path d="M7.5 18h5.5" />
  </svg>
);

/**
 * 6. ThermometerFishGradeIcon — Section 21 core temperature probe & quality check
 */
export const ThermometerFishGradeIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M8 4.5a2 2 0 0 1 4 0v8.8a3.5 3.5 0 1 1-4 0V4.5z" />
    <circle cx="10" cy="16" r="1.2" />
    <path d="M10 8v6.5" />
    <path d="M15 7h4" />
    <path d="M15 10.5h3" />
    <path d="M15 15.5l1.5 1.5 3.5-3.5" />
  </svg>
);

/**
 * 7. HarbourLedgerVaultIcon — Harbour authority pillars & balanced T-account columns
 */
export const HarbourLedgerVaultIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M3 9l9-5.5L21 9H3z" />
    <path d="M5.5 9v8.5" />
    <path d="M12 9v8.5" />
    <path d="M18.5 9v8.5" />
    <path d="M3.5 17.5h17" />
    <path d="M2.5 20.5h19" />
  </svg>
);

/**
 * 8. StatutorySealIcon — Act 16 statutory seal with cryptographic hash link
 */
export const StatutorySealIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M12 3l7 3v5.5c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V6l7-3z" />
    <path d="M9.5 12a2.5 2.5 0 0 1 2.5-2.5h1.5" />
    <path d="M14.5 12a2.5 2.5 0 0 1-2.5 2.5h-1.5" />
    <path d="M10.5 12h3" />
  </svg>
);

/**
 * 9. PelagicFishIcon — Clean pelagic fish silhouette for species cards & headers
 */
export const PelagicFishIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M2 12s3.5-5.5 9.5-5.5c4.2 0 7.2 2.8 8.5 5.5-1.3 2.7-4.3 5.5-8.5 5.5C5.5 17.5 2 12 2 12z" />
    <path d="M20 12l2.5-3v6L20 12z" />
    <circle cx="7.5" cy="11.2" r="0.8" fill="currentColor" />
    <path d="M11 9.5c.8 1.5.8 3.5 0 5" />
  </svg>
);

/**
 * 10. TrawlerVesselIcon — Kerala coastal fishing vessel silhouette
 */
export const TrawlerVesselIcon: React.FC<CustomIconProps> = ({
  size = 18,
  className = '',
  ...rest
}) => (
  <svg {...baseProps(size, className, rest)}>
    <path d="M3 14.5l2.2 4h13.6l2.2-4-9-2-9 2z" />
    <path d="M8 13V8.5h6V13" />
    <path d="M11 8.5V5" />
    <path d="M2.5 21c2 0 2.5-.8 4.5-.8s2.5.8 4.5.8 2.5-.8 4.5-.8 2.5.8 4.5.8" />
  </svg>
);
