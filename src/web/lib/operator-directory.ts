import type { Role } from '@shared/contracts/rbac.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';

export interface OperatorRow {
  user_id: string;
  tenant_id: string;
  tenant_name_en?: string;
  tenant_name_ml?: string;
  phone_e164: string;
  full_name: string;
  role: Role;
  entity_ref_id: string | null;
  is_active: boolean;
  entity_summary?: string;
  created_at?: string;
}

export interface OperatorProfileResponse {
  profile: OperatorRow;
  claims: {
    sub: string;
    tenantId: string;
    role: Role;
    fullName: string;
    phoneE164: string;
    entityRefId?: string | null;
    iat?: number;
    exp?: number;
  };
  recentAudit: ReadonlyArray<{
    audit_id: string;
    action_code: string;
    target_type: string;
    target_id: string;
    details_json: string;
    created_at: string;
  }>;
}

export interface RoleDisplayMeta {
  role: Role;
  titleEn: string;
  titleMl: string;
  shortBadge: string;
  statutoryRef: string;
  description: string;
  defaultWorkspace: 'weighing' | 'pit' | 'buyer' | 'fisher' | 'inspector' | 'harbour' | 'platform';
  capabilities: ReadonlyArray<string>;
}

const ROLE_DISPLAY_MAP: Record<Role, RoleDisplayMeta> = {
  HARBOUR_ADMIN: {
    role: 'HARBOUR_ADMIN',
    titleEn: 'Harbour Admin (HMS Secretary)',
    titleMl: 'ഹാർബർ അഡ്മിൻ (HMS സെക്രട്ടറി)',
    shortBadge: 'HMS Admin',
    statutoryRef: ACT_16_2021_CITATIONS.BASIC_FLOOR_PRICE,
    description:
      'Full custody of Section 19 basic floor schedules, payout batch UTR reconciliation, and Key-2 reversal approvals.',
    defaultWorkspace: 'harbour',
    capabilities: [
      'Update Section 19 Floor Price Schedule & Enforcement Mode',
      'Generate Nodal Bank Payout Batches & Reconcile UTRs',
      'Authorize 2nd Key on Dual-Key Compensating Journal Reversals',
      'Export Section 22 Statutory Returns & Audit Statements',
    ],
  },
  ACCOUNTANT: {
    role: 'ACCOUNTANT',
    titleEn: 'HMS Chief Accountant',
    titleMl: 'HMS ചീഫ് അക്കൗണ്ടന്റ്',
    shortBadge: 'Accountant',
    statutoryRef: ACT_16_2021_CITATIONS.LICENSED_AUCTIONEER_RETURN,
    description:
      'Manages double-entry harbour ledger accounts, initiates Key-1 reversal requests, and reconciles bank settlement batches.',
    defaultWorkspace: 'harbour',
    capabilities: [
      'Inspect Append-Only Double-Entry Ledger & SHA-256 Chain',
      'Initiate Key-1 Dual-Key Reversal Requests with Mandatory Reason',
      'Generate & Reconcile Nodal Bank Payout Batches',
      'Export Journal Entries & Statutory Reconciliation CSVs',
    ],
  },
  WEIGHING_OPERATOR: {
    role: 'WEIGHING_OPERATOR',
    titleEn: 'Dockside Weighing Operator',
    titleMl: 'ഡോക്സൈഡ് തൂക്ക ഓപ്പറേറ്റർ',
    shortBadge: 'Weighing Desk',
    statutoryRef: `${ACT_16_2021_CITATIONS.FISH_MARKET_COMMISSION_SPLIT} & QR Tagging`,
    description:
      'Captures integer gram catch weights at the landing quay, binds vessels and species, and prints HMAC-SHA256 QR lot stickers.',
    defaultWorkspace: 'weighing',
    capabilities: [
      'Record Landed Catch in Exact Integer Grams (Zero Float Math)',
      'Generate HMAC-SHA256 Signed Thermal QR Lot Stickers',
      'Queue Offline Dockside Lots with Idempotent Sync Replay',
      'Log Supervisor PIN Overrides to Immutable Audit Trail',
    ],
  },
  LICENSED_AUCTIONEER: {
    role: 'LICENSED_AUCTIONEER',
    titleEn: 'Licensed Pit Auctioneer',
    titleMl: 'ലൈസൻസുള്ള ലേലക്കാരൻ',
    shortBadge: 'Pit Auctioneer',
    statutoryRef: ACT_16_2021_CITATIONS.SOCIETY_DEPUTED_AUCTIONEER,
    description:
      'Conducts pit shout and Dutch clock auctions, allocates partial boxes, and triggers atomic 8-gate statutory clearing.',
    defaultWorkspace: 'pit',
    capabilities: [
      'Execute Pit Shout, Hybrid Remote & Dutch Clock Allocations',
      'Enforce Section 4(8) Co-op Society Loan Vessel Deputations',
      'Enforce Section 19 Floor Prices & Buyer Credit Guardrails',
      'Post Atomic Double-Entry Settlement Journals (<50ms P50)',
    ],
  },
  WHOLESALE_BUYER: {
    role: 'WHOLESALE_BUYER',
    titleEn: 'Wholesale Buyer (Paddle #101)',
    titleMl: 'മൊത്തവ്യാപാര വാങ്ങുന്നയാൾ',
    shortBadge: 'Buyer #101',
    statutoryRef: ACT_16_2021_CITATIONS.UNAUTHORIZED_DEDUCTION_PROHIBITION,
    description:
      'Monitors live harbour lots, places remote bids against pre-funded escrow/credit lines, and downloads export traceability dossiers.',
    defaultWorkspace: 'buyer',
    capabilities: [
      'Place Remote Bids Backed by Real-Time Escrow & Credit Lock',
      'Track Unsettled Clearing Invoices & Available Trading Limit',
      'Download MPEDA / EU Catch Traceability Dossiers (JSON)',
      'Verify Section 21 Cold-Chain & Hygiene Inspection Grades',
    ],
  },
  FISHERMAN_BOAT_OWNER: {
    role: 'FISHERMAN_BOAT_OWNER',
    titleEn: 'Fisherman / Vessel Owner',
    titleMl: 'മത്സ്യത്തൊഴിലാളി / വള്ളം ഉടമ',
    shortBadge: 'Vessel Owner',
    statutoryRef: ACT_16_2021_CITATIONS.HARBOUR_POLICY_LEGAL_BASIS,
    description:
      'Reviews transparent 95% net catch settlements, 40% annual production bonus escrow accruals, and Malayalam voice readout.',
    defaultWorkspace: 'fisher',
    capabilities: [
      'View Itemized 95% Net Catch Payouts & 5% Statutory Split',
      'Track Personal 40% Annual Production Bonus Escrow Balance',
      'Play Native Malayalam Voice Readout of Daily Settlements',
      'Download Verified Fisherman Passbook Statement (CSV)',
    ],
  },
  AUTHORIZED_INSPECTOR: {
    role: 'AUTHORIZED_INSPECTOR',
    titleEn: 'Quality Inspector (s.21)',
    titleMl: 'ഗുണനിലവാര ഇൻസ്പെക്ടർ (s.21)',
    shortBadge: 's.21 Inspector',
    statutoryRef: ACT_16_2021_CITATIONS.QUALITY_INSPECTION_GATE,
    description:
      'Performs organoleptic and core-temperature hygiene inspections, certifying export lots or quarantining unfit catch.',
    defaultWorkspace: 'inspector',
    capabilities: [
      'Certify Landed Lots as A_EXPORT, A_DOMESTIC, or B_PROCESS',
      'Quarantine Adulterated/Unfit Lots (REJECTED_UNFIT Hard Block)',
      'Record Core Flesh Temperature (°C) & Organoleptic Notes',
      'Invoke Optional Advisory AI Inspection Assist (ADR-009)',
    ],
  },
  SUPER_ADMIN: {
    role: 'SUPER_ADMIN',
    titleEn: 'Platform Super Admin',
    titleMl: 'പ്ലാറ്റ്‌ഫോം സൂപ്പർ അഡ്മിൻ',
    shortBadge: 'Super Admin',
    statutoryRef: 'Multi-Harbour Governance',
    description:
      'Governs multi-harbour tenant provisioning, Conflict C7 commercial policy gates, Golang 1.23 source code, and PostgreSQL 16 console.',
    defaultWorkspace: 'platform',
    capabilities: [
      'Inspect Live Golang 1.23 Backend & 001–005 SQL Migrations',
      'Execute Read-Only Queries in Live PostgreSQL 16 Console',
      'Provision New Harbour Tenants & Configure Floor Enforcement',
      'Enforce Conflict C7 Legal Sign-Off Gate on Commercial Policies',
    ],
  },
};

export function getRoleDisplayMeta(role: Role): RoleDisplayMeta {
  return ROLE_DISPLAY_MAP[role] ?? ROLE_DISPLAY_MAP.HARBOUR_ADMIN;
}

export function formatOperatorInitials(fullName: string): string {
  const cleaned = fullName
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(Capt\.|Dr\.|Mr\.|Ms\.|Mrs\.)\s+/i, '')
    .trim();
  if (!cleaned) return 'HO';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return (parts[0]?.slice(0, 2) ?? 'HO').toUpperCase();
  }
  const first = parts[0]?.[0] ?? 'H';
  const last = parts[parts.length - 1]?.[0] ?? 'O';
  return `${first}${last}`.toUpperCase();
}
