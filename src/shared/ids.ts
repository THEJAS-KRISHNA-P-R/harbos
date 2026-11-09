export type Brand<K, T extends string> = K & { readonly __brand: T };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type VesselId = Brand<string, 'VesselId'>;
export type LotId = Brand<string, 'LotId'>;
export type TradeId = Brand<string, 'TradeId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type JournalId = Brand<string, 'JournalId'>;

export type CentreType =
  | 'KERALA_HARBOUR'
  | 'KERALA_LANDING_CENTRE'
  | 'KERALA_MARKET'
  | 'INDIA_COOP';

export type FloorEnforcement = 'BLOCK' | 'WARN' | 'OFF';

export type CommercialMode =
  | 'FIXED_SAAS_ONLY'
  | 'INSTITUTIONAL_TECH_SHARE'
  | 'HYBRID';

export type AuctionMode =
  | 'PHYSICAL_SHOUT'
  | 'HYBRID_REMOTE'
  | 'DUTCH_CLOCK'
  | 'COOP_PROCUREMENT'
  | 'HMS_DIRECT_TAKEOVER';

export type SaleUnitType = 'WEIGHT_KG' | 'BOX' | 'BASKET' | 'PIECE';

export type InspectionGrade =
  | 'A_EXPORT'
  | 'A_DOMESTIC'
  | 'B_PROCESS'
  | 'REJECTED_UNFIT';
