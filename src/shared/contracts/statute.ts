/**
 * Canonical Statutory Section Citations for the
 * Kerala Fish Auctioning, Marketing and Maintenance of Quality Act, 2021 (Act 16 of 2021).
 *
 * All statutory section strings in the codebase MUST be imported from this module.
 * Automated tests verify that no file outside `statute.ts` matches `/Act 16.*s\.\d/`.
 */

export const ACT_16_2021_CITATIONS = {
  // NEEDS-COUNSEL: conflicting citations s.4(4) vs s.10(1) for the 5% (500 bps) commission cap
  /** Section 4(4) / Section 10(1): Maximum 5% (500 bps) auction commission cap. */
  COMMISSION_CAP_500_BPS: 'Kerala Act 16 of 2021 s.4(4)',

  // NEEDS-COUNSEL: conflicting citations s.4(5) vs s.10(1) for the 20/20/40/20 beneficiary split
  /** Section 4(5) / Section 10(1): Beneficiary split basis reference. */
  POLICY_SPLIT_BASIS: 'Kerala Act 16 of 2021 s.4(5)',

  // NEEDS-COUNSEL: conflicting citations s.4(4) & s.4(5)(a) vs s.10(1)
  /** Section 4(4) & s.4(5)(a): Harbour commission policy legal basis reference. */
  HARBOUR_POLICY_LEGAL_BASIS: 'Kerala Act 16 of 2021 s.4(4) & s.4(5)(a)',

  // NEEDS-COUNSEL: conflicting citations s.4(5)(a) vs s.10(1)
  /** Section 4(5)(a): Harbour 20/20/40/20 split preset label. */
  HARBOUR_SPLIT_LABEL: 'Kerala Act 16 of 2021 s.4(5)(a) Harbour Split',

  // NEEDS-COUNSEL: conflicting citations s.4(5)(b) vs s.14(1)
  /** Section 4(5)(b): Market 20/20/30/30 split preset label. */
  MARKET_SPLIT_LABEL: 'Kerala Act 16 of 2021 s.4(5)(b) Market Split',

  // NEEDS-COUNSEL: conflicting citations s.4(5) vs s.10(1)
  /** Section 4(5): 40% Annual Fisherman Bonus Escrow account label. */
  BONUS_ESCROW_LABEL: 'Act 16 s.4(5) 40% Annual Bonus Escrow',

  // NEEDS-COUNSEL: conflicting citations s.4(6) vs s.10(1) for institutional tech share signoff gate
  /** Section 4(6): Legal signoff gate for non-FIXED_SAAS_ONLY commercial modes (C7). */
  COMMERCIAL_MODE_SIGNOFF_GATE: 'Kerala Act 16 of 2021 s.4(6)',

  /** Section 4(8): Vessel with active fisheries cooperative society loan must be auctioned by an auctioneer deputed by that society. */
  SOCIETY_DEPUTED_AUCTIONEER: 'Kerala Act 16 of 2021 s.4(8)',

  /** Section 5: Auctioneer licence registration requirement for harbour. */
  AUCTIONEER_LICENCE_REGISTRATION: 'Kerala Act 16 of 2021 s.5',

  /** Section 5(7)-(8): Active and date-valid auctioneer licence enforcement. */
  AUCTIONEER_LICENCE_VALIDITY: 'Kerala Act 16 of 2021 s.5(7)-(8)',

  // NEEDS-COUNSEL: conflicting citations s.4(4)/s.4(5)(a) vs s.10(1)
  /** Section 10(1): Maximum 5% (500 bps) commission cap and 20/20/40/20 beneficiary split at Fishing Harbours & Fish Landing Centres. */
  HARBOUR_COMMISSION_SPLIT: 'Kerala Act 16 of 2021 s.10(1)',

  /** Section 10 Proviso: Harbour Management Society (HMS) direct takeover when licensed auctioneers default or are unavailable. */
  HMS_DIRECT_TAKEOVER_PROVISO: 'Kerala Act 16 of 2021 s.10 Proviso',

  // NEEDS-COUNSEL: conflicting citations s.4(5)(b) vs s.14(1)
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
