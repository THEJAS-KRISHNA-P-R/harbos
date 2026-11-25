import type { Role, WorkspaceId } from '@shared/contracts/rbac.ts';
import type { CentreType, FloorEnforcement } from '@shared/ids.ts';

export interface TenantIdentityDraft {
  nameEn: string;
  slug: string;
  shortCode: string;
  centreType: CentreType;
  floorEnforcement: FloorEnforcement;
}

export interface OnboardingOperatorDraft {
  id: string;
  fullName: string;
  phoneE164: string;
  role: Role;
  pinCode: string;
}

export interface StarterSpeciesSeed {
  code: string;
  nameEn: string;
  manglishName: string;
  scientificName: string;
  floorPricePaisePerKg: number;
  exportEligible: boolean;
}

export interface OnboardingMasterdataOptions {
  seedStarterSpecies: boolean;
  seedStarterOperations: boolean;
  societyName: string;
  vesselName: string;
  vesselRegNo: string;
  fishermanName: string;
  fishermanPhone: string;
  buyerName: string;
  buyerPaddleNo: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ReadonlyArray<string>;
}

export interface RoleDashboardInfo {
  role: Role;
  label: string;
  shortLabel: string;
  workspaceId: WorkspaceId;
  category: 'Operations' | 'Clearing' | 'Governance';
  summary: string;
  keyAction: string;
}

export const ROLE_DASHBOARD_DIRECTORY: ReadonlyArray<RoleDashboardInfo> = [
  {
    role: 'HARBOUR_ADMIN',
    label: 'Harbour Admin',
    shortLabel: 'HMS Admin',
    workspaceId: 'harbour',
    category: 'Governance',
    summary: 'Floor price schedules, masterdata, payout clearing, and statutory returns.',
    keyAction: 'Manage harbour operations',
  },
  {
    role: 'ACCOUNTANT',
    label: 'Chief Accountant',
    shortLabel: 'Accountant',
    workspaceId: 'harbour',
    category: 'Governance',
    summary: 'Double-entry ledger accounts, UTR reconciliation, and dual-key reversals.',
    keyAction: 'Open accounting ledger',
  },
  {
    role: 'WEIGHING_OPERATOR',
    label: 'Weighing Desk',
    shortLabel: 'Weighing',
    workspaceId: 'weighing',
    category: 'Operations',
    summary: 'Dockside vessel intake, species tagging, exact gram weights, and QR stickers.',
    keyAction: 'Tag landed catch',
  },
  {
    role: 'LICENSED_AUCTIONEER',
    label: 'Auction Pit Pad',
    shortLabel: 'Auctioneer',
    workspaceId: 'pit',
    category: 'Operations',
    summary: 'Live pit shout, Dutch clock bids, partial box splits, and instant clearing.',
    keyAction: 'Run live auction',
  },
  {
    role: 'AUTHORIZED_INSPECTOR',
    label: 'Quality Inspector',
    shortLabel: 'Inspector',
    workspaceId: 'inspector',
    category: 'Operations',
    summary: 'Organoleptic grading, core temperature logging, and unfit lot quarantine.',
    keyAction: 'Certify lot quality',
  },
  {
    role: 'WHOLESALE_BUYER',
    label: 'Wholesale Buyer',
    shortLabel: 'Buyer',
    workspaceId: 'buyer',
    category: 'Clearing',
    summary: 'Live trading limit, remote lot bidding, invoices, and export dossiers.',
    keyAction: 'Place remote bids',
  },
  {
    role: 'FISHERMAN_BOAT_OWNER',
    label: 'Vessel Owner',
    shortLabel: 'Fisher',
    workspaceId: 'fisher',
    category: 'Clearing',
    summary: '95% net catch settlements, 40% annual bonus escrow, and passbook statements.',
    keyAction: 'View catch passbook',
  },
  {
    role: 'SUPER_ADMIN',
    label: 'Platform Super Admin',
    shortLabel: 'Super Admin',
    workspaceId: 'platform',
    category: 'Governance',
    summary: 'Multi-tenant provisioning, tenant switching, commercial policies, and system health.',
    keyAction: 'Manage all tenants',
  },
];

export const STARTER_COASTAL_SPECIES: ReadonlyArray<StarterSpeciesSeed> = [
  {
    code: 'AVOLI',
    nameEn: 'Silver Pomfret',
    manglishName: 'Avoli',
    scientificName: 'Pampus argenteus',
    floorPricePaisePerKg: 72000,
    exportEligible: true,
  },
  {
    code: 'NEYMEEN',
    nameEn: 'Seer Fish (King Mackerel)',
    manglishName: 'Neymeen',
    scientificName: 'Scomberomorus commerson',
    floorPricePaisePerKg: 68000,
    exportEligible: true,
  },
  {
    code: 'NARAN',
    nameEn: 'Indian White Prawn',
    manglishName: 'Naran Chemmeen',
    scientificName: 'Penaeus indicus',
    floorPricePaisePerKg: 52000,
    exportEligible: true,
  },
  {
    code: 'KARIMEEN',
    nameEn: 'Pearl Spot',
    manglishName: 'Karimeen',
    scientificName: 'Etroplus suratensis',
    floorPricePaisePerKg: 55000,
    exportEligible: true,
  },
  {
    code: 'CHOORA',
    nameEn: 'Yellowfin Tuna',
    manglishName: 'Choora',
    scientificName: 'Thunnus albacares',
    floorPricePaisePerKg: 34000,
    exportEligible: true,
  },
  {
    code: 'KOONTHAL',
    nameEn: 'Indian Squid',
    manglishName: 'Koonthal',
    scientificName: 'Uroteuthis duvaucelii',
    floorPricePaisePerKg: 29000,
    exportEligible: true,
  },
  {
    code: 'AYALA',
    nameEn: 'Indian Mackerel',
    manglishName: 'Ayala',
    scientificName: 'Rastrelliger kanagurta',
    floorPricePaisePerKg: 18000,
    exportEligible: false,
  },
  {
    code: 'MATHI',
    nameEn: 'Indian Oil Sardine',
    manglishName: 'Mathi',
    scientificName: 'Sardinella longiceps',
    floorPricePaisePerKg: 12000,
    exportEligible: false,
  },
];

export function slugifyHarbourName(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
}

export function deriveShortCode(nameEn: string, slug: string): string {
  const words = nameEn
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 3) {
    const initials = words
      .slice(0, 4)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
    if (initials.length >= 3) return initials.slice(0, 4);
  }
  const clean = (slug || nameEn).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length >= 3) return clean.slice(0, 4);
  return (clean || 'HRB').padEnd(3, 'X');
}

export function validateOnboardingStep1(
  draft: TenantIdentityDraft,
  existingSlugs: ReadonlyArray<string> = []
): ValidationResult {
  const errors: string[] = [];
  const name = draft.nameEn.trim();
  const slug = slugifyHarbourName(draft.slug);
  const shortCode = draft.shortCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (name.length < 3) {
    errors.push('Harbour or market name must be at least 3 characters.');
  }
  if (slug.length < 3) {
    errors.push('URL slug must be at least 3 lowercase alphanumeric characters.');
  }
  if (existingSlugs.some((s) => s.toLowerCase() === slug)) {
    errors.push(`A tenant with slug "${slug}" already exists.`);
  }
  if (shortCode.length < 2 || shortCode.length > 6) {
    errors.push('Lot short code must be 2 to 6 uppercase letters or digits.');
  }

  return { valid: errors.length === 0, errors };
}

export function validateOnboardingOperators(
  operators: ReadonlyArray<OnboardingOperatorDraft>
): ValidationResult {
  const errors: string[] = [];
  if (operators.length === 0) {
    errors.push('Add at least one Harbour Admin operator to manage the new tenant.');
    return { valid: false, errors };
  }

  const seenPhones = new Set<string>();
  for (let i = 0; i < operators.length; i += 1) {
    const op = operators[i]!;
    const phone = op.phoneE164.replace(/\s+/g, '');
    if (op.fullName.trim().length < 2) {
      errors.push(`Operator #${i + 1}: Full name is required.`);
    }
    if (!/^\+[1-9]\d{9,14}$/.test(phone)) {
      errors.push(`Operator #${i + 1}: Phone must be valid E.164 (e.g. +919847001122).`);
    } else if (seenPhones.has(phone)) {
      errors.push(`Duplicate phone number ${phone} across operators.`);
    } else {
      seenPhones.add(phone);
    }
    if (op.pinCode.trim().length < 4) {
      errors.push(`Operator #${i + 1}: Supervisor PIN must be at least 4 characters.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function buildDefaultOperatorsForSlug(slug: string): OnboardingOperatorDraft[] {
  // Deterministic non-colliding demo suffix from slug characters
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) {
    hash = (hash * 31 + slug.charCodeAt(i)) % 8900;
  }
  const base = 1000 + hash;
  return [
    {
      id: 'op-admin',
      fullName: 'Harbour Secretary',
      phoneE164: `+91984710${String(base).padStart(4, '0')}`,
      role: 'HARBOUR_ADMIN',
      pinCode: '1234',
    },
    {
      id: 'op-weigh',
      fullName: 'Dockside Weighmaster',
      phoneE164: `+91984720${String(base).padStart(4, '0')}`,
      role: 'WEIGHING_OPERATOR',
      pinCode: '1234',
    },
    {
      id: 'op-pit',
      fullName: 'Lead Pit Auctioneer',
      phoneE164: `+91984730${String(base).padStart(4, '0')}`,
      role: 'LICENSED_AUCTIONEER',
      pinCode: '1234',
    },
  ];
}

export function buildStarterMasterdataPlan(
  shortCode: string,
  options: OnboardingMasterdataOptions
) {
  const cleanCode = shortCode.replace(/[^A-Z0-9]/g, '').toUpperCase() || 'HRB';
  const societyId = `SOC-${cleanCode}-01`;
  const fishermanId = `FSH-${cleanCode}-01`;
  const vesselId = `VSL-${cleanCode}-01`;
  const buyerId = `BUY-${cleanCode}-01`;
  const sessionId = `SES-${cleanCode}-AM01`;

  return {
    society: {
      societyId,
      regNo: `KL-COOP-${cleanCode}-01`,
      nameEn: options.societyName.trim() || `${cleanCode} Fishermen Co-op Society`,
      nameMl: options.societyName.trim() || `${cleanCode} Fishermen Co-op Society`,
    },
    fisherman: {
      fishermanId,
      fullName: options.fishermanName.trim() || 'Varghese Joseph',
      phoneE164: options.fishermanPhone.replace(/\s+/g, '') || '+919847990011',
      welfareBoardNo: `KFWB-${cleanCode}-101`,
      coopSocietyId: societyId,
    },
    vessel: {
      vesselId,
      registrationNo: options.vesselRegNo.trim() || `IND-KL-07-${cleanCode}-101`,
      vesselNameEn: options.vesselName.trim() || 'Sea Star I',
      vesselNameMl: options.vesselName.trim() || 'Sea Star I',
      ownerFishermanId: fishermanId,
      hasActiveSocietyLoan: false,
    },
    buyer: {
      buyerId,
      buyerName: options.buyerName.trim() || `${cleanCode} Marine Exports`,
      paddleNo: Math.max(1, Math.floor(options.buyerPaddleNo || 101)),
      escrowBalancePaise: 50_000_000, // ₹5,00,000 starter escrow
      approvedCreditPaise: 25_000_000, // ₹2,50,000 approved credit
    },
    session: {
      sessionId,
      sessionCode: `${cleanCode}-MORNING-01`,
      auctionMode: 'PHYSICAL_SHOUT' as const,
      status: 'OPEN' as const,
    },
  };
}
