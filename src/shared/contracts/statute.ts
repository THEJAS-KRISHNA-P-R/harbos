/**
 * Canonical Statutory Section Citations for the
 * Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021).
 */

export const ACT_16_2021_CITATIONS = {
  /** Section 4(8): Vessel with active fisheries cooperative society loan must be auctioned by an auctioneer deputed by that society. */
  SOCIETY_DEPUTED_AUCTIONEER: 'Kerala Act 16 of 2021 s.4(8)',

  /** Section 10(1): Maximum 5% (500 bps) commission cap and 20/20/40/20 beneficiary split at Fishing Harbours & Fish Landing Centres. */
  HARBOUR_COMMISSION_SPLIT: 'Kerala Act 16 of 2021 s.10(1)',

  /** Section 10 Proviso: Harbour Management Society (HMS) direct takeover when licensed auctioneers default or are unavailable. */
  HMS_DIRECT_TAKEOVER_PROVISO: 'Kerala Act 16 of 2021 s.10 Proviso',

  /** Section 14(1): Maximum 5% (500 bps) commission cap and 20/20/30/30 beneficiary split at Fish Markets (MMS). */
  FISH_MARKET_COMMISSION_SPLIT: 'Kerala Act 16 of 2021 s.14(1)',

  /** Section 19(1): Publication and enforcement of basic floor price per species. */
  BASIC_FLOOR_PRICE: 'Kerala Act 16 of 2021 s.19(1)',

  /** Section 19(2): Fisheries cooperative society procurement of >= 50% of catch at published basic price with 0% auction commission. */
  COOP_PROCUREMENT_BASIC_PRICE: 'Kerala Act 16 of 2021 s.19(2)',

  /** Section 21: Mandatory hygiene & quality inspection gate; lots graded REJECTED_UNFIT or uninspected cannot be auctioned for human consumption. */
  QUALITY_INSPECTION_GATE: 'Kerala Act 16 of 2021 s.21',

  /** Section 22: Statutory auctioneer return of catch weight, species, hammer price, commission deducted, and net payable to fisherman. */
  LICENSED_AUCTIONEER_RETURN: 'Kerala Act 16 of 2021 s.22',

  /** Section 23: Prohibition of unauthorized deductions, kuli, vatta, or extra commissions outside the statutory schedule. */
  UNAUTHORIZED_DEDUCTION_PROHIBITION: 'Kerala Act 16 of 2021 s.23',
} as const;

export type Act16SectionKey = keyof typeof ACT_16_2021_CITATIONS;
