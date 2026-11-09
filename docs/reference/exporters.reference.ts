/**
 * HarbourOS Pure Search, Filter & Statutory Export Engine
 * Provides deterministic client-side filtering (Lot ID, Boat Name, Date Range)
 * and CSV / Printable PDF content generation for statutory audit compliance.
 */

import { FishLot, LedgerEntry, SaleAllocation, TenantConfig } from './types.ts';

export interface GlobalFilterCriteria {
  query: string;       // Matches Lot ID, Vessel/Boat Name, Beneficiary, Species, or Journal ID
  dateFrom?: string;   // YYYY-MM-DD inclusive
  dateTo?: string;     // YYYY-MM-DD inclusive
  statusFilter?: string;
  accountTypeFilter?: string;
}

function isWithinDateRange(isoTimestamp: string, dateFrom?: string, dateTo?: string): boolean {
  if (!dateFrom && !dateTo) return true;
  const itemDate = isoTimestamp.slice(0, 10); // YYYY-MM-DD
  if (dateFrom && itemDate < dateFrom) return false;
  if (dateTo && itemDate > dateTo) return false;
  return true;
}

/**
 * Filter FishLots by Lot ID, Boat/Vessel Name, Registration Number, Species, Status, and Date Range.
 */
export function filterFishLots(lots: FishLot[], criteria: GlobalFilterCriteria): FishLot[] {
  const q = (criteria.query || '').trim().toLowerCase();
  return lots.filter((lot) => {
    if (criteria.statusFilter && criteria.statusFilter !== 'ALL' && lot.status !== criteria.statusFilter) {
      return false;
    }
    if (!isWithinDateRange(lot.createdAt, criteria.dateFrom, criteria.dateTo)) {
      return false;
    }
    if (!q) return true;
    const searchable = [
      lot.lotId,
      lot.vesselName,
      lot.realcraftRegNo,
      lot.speciesNameEn,
      lot.speciesCode,
      lot.qualityGrade,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchable.includes(q);
  });
}

/**
 * Filter SaleAllocations by Lot ID, Boat/Vessel Name, Buyer Name, Allocation ID, and Date Range.
 */
export function filterSaleAllocations(
  allocations: SaleAllocation[],
  lots: FishLot[],
  criteria: GlobalFilterCriteria
): SaleAllocation[] {
  const q = (criteria.query || '').trim().toLowerCase();
  const lotMap = new Map(lots.map((l) => [l.lotId, l]));

  return allocations.filter((alloc) => {
    if (!isWithinDateRange(alloc.confirmedAt, criteria.dateFrom, criteria.dateTo)) {
      return false;
    }
    if (!q) return true;
    const lot = lotMap.get(alloc.lotId);
    const searchable = [
      alloc.allocationId,
      alloc.lotId,
      alloc.buyerName,
      alloc.buyerGstin,
      alloc.vesselName || lot?.vesselName || '',
      alloc.speciesNameEn || lot?.speciesNameEn || '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchable.includes(q);
  });
}

/**
 * Filter LedgerEntries by Lot ID, Boat/Vessel Name, Beneficiary, Journal ID, Account Type, and Date Range.
 */
export function filterLedgerEntries(
  entries: LedgerEntry[],
  criteria: GlobalFilterCriteria
): LedgerEntry[] {
  const q = (criteria.query || '').trim().toLowerCase();
  return entries.filter((entry) => {
    if (
      criteria.accountTypeFilter &&
      criteria.accountTypeFilter !== 'ALL' &&
      entry.accountType !== criteria.accountTypeFilter
    ) {
      return false;
    }
    if (!isWithinDateRange(entry.createdAt, criteria.dateFrom, criteria.dateTo)) {
      return false;
    }
    if (!q) return true;
    const searchable = [
      String(entry.entrySeq),
      entry.entryId,
      entry.journalId,
      entry.lotId || '',
      entry.vesselName || '',
      entry.accountType,
      entry.beneficiaryName,
      entry.rowHash,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return searchable.includes(q);
  });
}

function escapeCsvCell(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates RFC-4180 compliant CSV string for Statutory Double-Entry Ledger Entries.
 */
export function generateLedgerCsv(entries: LedgerEntry[], tenant: TenantConfig): string {
  const headers = [
    'Seq_No',
    'Entry_ID',
    'Journal_ID',
    'Harbour_Tenant',
    'Lot_ID',
    'Vessel_Name',
    'Account_Head',
    'Beneficiary_Name',
    'Direction_DC',
    'Amount_Paise',
    'Amount_INR',
    'Prev_SHA256_Hash',
    'Row_SHA256_Hash',
    'Timestamp_ISO',
  ];

  const rows = entries.map((e) => [
    e.entrySeq,
    e.entryId,
    e.journalId,
    tenant.nameEn,
    e.lotId || 'N/A',
    e.vesselName || 'N/A',
    e.accountType,
    e.beneficiaryName,
    e.direction === 'D' ? 'DEBIT' : 'CREDIT',
    e.amountPaise,
    (e.amountPaise / 100).toFixed(2),
    e.prevRowHash,
    e.rowHash,
    e.createdAt,
  ]);

  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\n');
}

/**
 * Generates RFC-4180 compliant CSV string for Sale Allocations & Statutory 5% Commission Splits.
 */
export function generateAllocationsCsv(
  allocations: SaleAllocation[],
  lots: FishLot[],
  tenant: TenantConfig
): string {
  const lotMap = new Map(lots.map((l) => [l.lotId, l]));
  const headers = [
    'Allocation_ID',
    'Harbour_Tenant',
    'Lot_ID',
    'Vessel_Name',
    'Species',
    'Buyer_Paddle',
    'Buyer_Company',
    'Buyer_GSTIN',
    'Boxes_Allocated',
    'Weight_Kg',
    'Rate_INR_Per_Kg',
    'Gross_Hammer_INR',
    'Fisherman_Net_95Pct_INR',
    'Bonus_Escrow_40Pct_INR',
    'Auctioneer_20Pct_INR',
    'HMS_20Pct_INR',
    'Coop_Society_20Pct_INR',
    'Platform_Fee_INR',
    'GST_18Pct_INR',
    'Buyer_Total_Payable_INR',
    'Confirmed_At_ISO',
  ];

  const rows = allocations.map((a) => {
    const lot = lotMap.get(a.lotId);
    const s = a.splitDetails;
    return [
      a.allocationId,
      tenant.nameEn,
      a.lotId,
      a.vesselName || lot?.vesselName || 'N/A',
      a.speciesNameEn || lot?.speciesNameEn || 'N/A',
      a.buyerPaddleNo,
      a.buyerName,
      a.buyerGstin,
      a.allocatedBoxes,
      a.allocatedWeightKg.toFixed(2),
      (a.pricePerKgPaise / 100).toFixed(2),
      (a.grossAmountPaise / 100).toFixed(2),
      (s.fishermanInstantNetPaise / 100).toFixed(2),
      (s.bonusEscrowPaise / 100).toFixed(2),
      (s.auctioneerNetPaise / 100).toFixed(2),
      (s.hmsNetPaise / 100).toFixed(2),
      (s.coopNetPaise / 100).toFixed(2),
      (s.harbourOsRevenuePaise / 100).toFixed(2),
      (s.gstOnFeesPaise / 100).toFixed(2),
      (s.buyerTotalPayablePaise / 100).toFixed(2),
      a.confirmedAt,
    ];
  });

  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\n');
}

/**
 * Triggers a browser download for a generated file payload.
 */
export function triggerClientDownload(
  filename: string,
  content: string,
  mimeType: string = 'text/csv;charset=utf-8;'
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
