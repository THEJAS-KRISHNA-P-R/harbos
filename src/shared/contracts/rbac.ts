import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';

export type Role =
  | 'SUPER_ADMIN'
  | 'HARBOUR_ADMIN'
  | 'LICENSED_AUCTIONEER'
  | 'FISHERMAN_BOAT_OWNER'
  | 'WHOLESALE_BUYER'
  | 'WEIGHING_OPERATOR'
  | 'ACCOUNTANT'
  | 'AUTHORIZED_INSPECTOR';

export type WorkspaceId =
  | 'weighing'
  | 'pit'
  | 'buyer'
  | 'fisher'
  | 'inspector'
  | 'harbour'
  | 'platform';

export interface WorkspaceDefinition {
  id: WorkspaceId;
  path: `/w/${WorkspaceId}`;
  titleEn: string;
  titleMl: string;
  subtitleEn: string;
  allowedRoles: ReadonlyArray<Role>;
  docksideMobile: boolean;
}

export const WORKSPACES: ReadonlyArray<WorkspaceDefinition> = [
  {
    id: 'weighing',
    path: '/w/weighing',
    titleEn: 'Weighing & Lots',
    titleMl: 'തൂക്കവും ലേല ചീട്ടും', // TODO-REVIEW-ML
    subtitleEn: 'Dockside vessel QR scan, species grading, scale capture & signed lot stickers',
    allowedRoles: ['WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    docksideMobile: true,
  },
  {
    id: 'pit',
    path: '/w/pit',
    titleEn: 'Auction Pit Pad',
    titleMl: 'ലേല തട്ട് ടെർമിനൽ', // TODO-REVIEW-ML
    subtitleEn: `Live lot keypad, leader lease fencing, Dutch clock & ${ACT_16_2021_CITATIONS.HARBOUR_COMMISSION_SPLIT} checks`,
    allowedRoles: ['LICENSED_AUCTIONEER', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    docksideMobile: true,
  },
  {
    id: 'buyer',
    path: '/w/buyer',
    titleEn: 'Buyer Clearing',
    titleMl: 'മൊത്ത വ്യാപാരി പോർട്ടൽ', // TODO-REVIEW-ML
    subtitleEn: 'Real-time credit bar, live lot watchlist, remote bidding, invoices & export dossiers',
    allowedRoles: ['WHOLESALE_BUYER', 'SUPER_ADMIN'],
    docksideMobile: false,
  },
  {
    id: 'fisher',
    path: '/w/fisher',
    titleEn: 'Fisher Passbook',
    titleMl: 'മത്സ്യത്തൊഴിലാളി പാസ്ബുക്ക്', // TODO-REVIEW-ML
    subtitleEn: 'Transparent 5% Act split card, 40% bonus escrow balance, Malayalam voice & statements',
    allowedRoles: ['FISHERMAN_BOAT_OWNER', 'SUPER_ADMIN'],
    docksideMobile: true,
  },
  {
    id: 'inspector',
    path: '/w/inspector',
    titleEn: 'Quality (s.21)',
    titleMl: 'ഗുണനിലവാര പരിശോധന', // TODO-REVIEW-ML
    subtitleEn: 'Organoleptic grading, core temperature check, unfit lot block & advisory AI assist',
    allowedRoles: ['AUTHORIZED_INSPECTOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
    docksideMobile: true,
  },
  {
    id: 'harbour',
    path: '/w/harbour',
    titleEn: 'Harbour & Ledger',
    titleMl: 'ഹാർബർ അഡ്മിൻ & അക്കൗണ്ടിംഗ്', // TODO-REVIEW-ML
    subtitleEn: 'Today board, s.19 floor prices, licences, payout batches, UTR reconcile, dual-key reversals & s.22 returns',
    allowedRoles: ['HARBOUR_ADMIN', 'ACCOUNTANT', 'SUPER_ADMIN'],
    docksideMobile: false,
  },
  {
    id: 'platform',
    path: '/w/platform',
    titleEn: 'Platform Admin',
    titleMl: 'പ്ലാറ്റ്ഫോം നിയന്ത്രണം', // TODO-REVIEW-ML
    subtitleEn: 'Tenant provisioning, policy legal sign-offs, SHA-256 ledger verifier, SDK keys & system health',
    allowedRoles: ['SUPER_ADMIN'],
    docksideMobile: false,
  },
];

export interface RoutePolicy {
  method: 'GET' | 'POST';
  pattern: string;
  roles: ReadonlyArray<Role> | 'PUBLIC';
}

export const ROUTE_RBAC_MATRIX: ReadonlyArray<RoutePolicy> = [
  { method: 'GET', pattern: '/api/health', roles: 'PUBLIC' },
  { method: 'POST', pattern: '/api/v1/auth/otp/request', roles: 'PUBLIC' },
  { method: 'POST', pattern: '/api/v1/auth/otp/verify', roles: 'PUBLIC' },
  { method: 'POST', pattern: '/api/v1/auth/persona-switch', roles: 'PUBLIC' },
  {
    method: 'GET',
    pattern: '/api/v1/me',
    roles: [
      'SUPER_ADMIN',
      'HARBOUR_ADMIN',
      'LICENSED_AUCTIONEER',
      'FISHERMAN_BOAT_OWNER',
      'WHOLESALE_BUYER',
      'WEIGHING_OPERATOR',
      'ACCOUNTANT',
      'AUTHORIZED_INSPECTOR',
    ],
  },
  {
    method: 'GET',
    pattern: '/api/v1/bootstrap',
    roles: [
      'SUPER_ADMIN',
      'HARBOUR_ADMIN',
      'LICENSED_AUCTIONEER',
      'FISHERMAN_BOAT_OWNER',
      'WHOLESALE_BUYER',
      'WEIGHING_OPERATOR',
      'ACCOUNTANT',
      'AUTHORIZED_INSPECTOR',
    ],
  },
  {
    method: 'POST',
    pattern: '/api/v1/lots',
    roles: ['WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/sync/commands',
    roles: ['WEIGHING_OPERATOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/lots/:lotId/inspect',
    roles: ['AUTHORIZED_INSPECTOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/lots/:lotId/ai-assist',
    roles: ['AUTHORIZED_INSPECTOR', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/lots/:lotId/allocate',
    roles: ['LICENSED_AUCTIONEER', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/floor-prices',
    roles: ['HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/payout-batches',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/payout-batches/:batchId/reconcile',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/ledger/reversals',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'GET',
    pattern: '/api/v1/ledger/verify',
    roles: ['ACCOUNTANT', 'HARBOUR_ADMIN', 'SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/tenants',
    roles: ['SUPER_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/tenants/:tenantId/users',
    roles: ['SUPER_ADMIN', 'HARBOUR_ADMIN'],
  },
  {
    method: 'POST',
    pattern: '/api/v1/policies',
    roles: ['SUPER_ADMIN', 'HARBOUR_ADMIN'],
  },
];
