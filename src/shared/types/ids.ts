export type Brand<K, T extends string> = K & { readonly __brand: T };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type VesselId = Brand<string, 'VesselId'>;
export type LotId = Brand<string, 'LotId'>;
export type TradeId = Brand<string, 'TradeId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type JournalEntryId = Brand<string, 'JournalEntryId'>;

export type Paisa = Brand<bigint, 'Paisa'>;
export type Grams = Brand<bigint, 'Grams'>;
export type Bps = Brand<number, 'Bps'>;

export type CentreType = 'HARBOUR' | 'LANDING_CENTRE' | 'FISH_MARKET';
export type BasicPriceEnforcement = 'BLOCK' | 'WARN' | 'OFF';
export type CommercialFeeMode =
  | 'FIXED_SAAS_ONLY'
  | 'INSTITUTIONAL_SHARE_PILOT'
  | 'BUYER_SERVICE_FEE_PILOT';

export type SettlementChannel =
  | 'STANDARD_AUCTION'
  | 'SOCIETY_DEPUTED_AUCTION'
  | 'HMS_DIRECT_TAKEOVER'
  | 'COOP_PROCUREMENT';
