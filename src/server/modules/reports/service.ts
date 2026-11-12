import type { DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import { ACT_16_2021_CITATIONS } from '@shared/contracts/statute.ts';
import {
  fetchBuyerLedgerReportData,
  fetchDailyAuctionReportData,
  fetchFishermanStatementData,
  fetchPayoutReconciliationReportData,
  fetchShadowDiffAllocationsByLot,
  fetchStatutoryApportionmentData,
} from './repo.ts';

/**
 * RFC 4180 CSV cell formatter with formula-injection neutralization (prefixes `'`).
 */
export function escapeRfc4180CsvCell(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  const first = str[0];
  const neutralized =
    first === '=' ||
    first === '+' ||
    first === '-' ||
    first === '@' ||
    first === '\t' ||
    first === '\r'
      ? `'${str}`
      : str;
  if (
    neutralized.includes(',') ||
    neutralized.includes('"') ||
    neutralized.includes('\n') ||
    neutralized.includes('\r')
  ) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export function formatRowsAsCsv(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<Record<string, unknown>>
): string {
  const headerLine = headers.map((h) => escapeRfc4180CsvCell(h)).join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeRfc4180CsvCell(row[h])).join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

export async function generateHarbourReport(
  readDb: DbPort,
  params: {
    tenantId: string;
    reportType:
      | 'daily-auction'
      | 'fisherman-statement'
      | 'statutory-apportionment'
      | 'buyer-ledger'
      | 'payout-reconciliation';
    from?: string | undefined;
    to?: string | undefined;
    fishermanId?: string | undefined;
  }
): Promise<{
  reportType: string;
  generatedAt: string;
  statutoryCitation: string;
  summary: Record<string, unknown>;
  headers: ReadonlyArray<string>;
  rows: ReadonlyArray<Record<string, unknown>>;
}> {
  const generatedAt = new Date().toISOString();

  if (params.reportType === 'daily-auction') {
    const data = await fetchDailyAuctionReportData(
      readDb,
      params.tenantId,
      params.from,
      params.to
    );
    let hammerTotal = 0n;
    let fishermanNetTotal = 0n;
    let bonusEscrowTotal = 0n;
    let auctioneerTotal = 0n;
    let hmsTotal = 0n;
    let coopTotal = 0n;
    let floorWarnings = 0;

    for (const a of data.allocations) {
      hammerTotal += BigInt(a.hammer_paise);
      fishermanNetTotal += BigInt(a.fisherman_net_paise);
      bonusEscrowTotal += BigInt(a.bonus_escrow_paise);
      auctioneerTotal += BigInt(a.auctioneer_paise);
      hmsTotal += BigInt(a.hms_net_paise);
      coopTotal += BigInt(a.coop_net_paise);
      if (a.floor_warning_triggered) floorWarnings += 1;
    }

    const totalCommissionPaise = hammerTotal - fishermanNetTotal;
    const lotsWeighed = data.lots.length;
    const lotsRejected = data.lots.filter(
      (l) =>
        l.status === 'BLOCKED_UNFIT' || l.inspection_grade === 'REJECTED_UNFIT'
    ).length;
    const lotsInspected = data.lots.filter(
      (l) => l.inspection_grade !== null
    ).length;
    const lotsSold = data.lots.filter(
      (l) => l.status === 'PARTIALLY_SOLD' || l.status === 'FULLY_SOLD'
    ).length;

    const rows = data.allocations.map((a) => ({
      allocationId: a.allocation_id,
      lotId: a.lot_id,
      boxesAllocated: a.boxes_allocated,
      gramsAllocated: a.grams_allocated,
      hammerPaise: a.hammer_paise,
      fishermanNetPaise: a.fisherman_net_paise,
      commissionPaise: (
        BigInt(a.hammer_paise) - BigInt(a.fisherman_net_paise)
      ).toString(),
      auctioneerPaise: a.auctioneer_paise,
      hmsNetPaise: a.hms_net_paise,
      bonusEscrowPaise: a.bonus_escrow_paise,
      coopNetPaise: a.coop_net_paise,
      floorWarningTriggered: a.floor_warning_triggered,
      createdAt: a.created_at,
    }));

    return {
      reportType: 'daily-auction',
      generatedAt,
      statutoryCitation: ACT_16_2021_CITATIONS.HARBOUR_POLICY_LEGAL_BASIS,
      summary: {
        lotsWeighed,
        lotsInspected,
        lotsRejected,
        lotsSold,
        allocationCount: data.allocations.length,
        hammerTotalPaise: hammerTotal.toString(),
        fishermanNetTotalPaise: fishermanNetTotal.toString(),
        totalCommissionPaise: totalCommissionPaise.toString(),
        auctioneerTotalPaise: auctioneerTotal.toString(),
        hmsTotalPaise: hmsTotal.toString(),
        bonusEscrowTotalPaise: bonusEscrowTotal.toString(),
        coopTotalPaise: coopTotal.toString(),
        floorWarnings,
      },
      headers: [
        'allocationId',
        'lotId',
        'boxesAllocated',
        'gramsAllocated',
        'hammerPaise',
        'fishermanNetPaise',
        'commissionPaise',
        'auctioneerPaise',
        'hmsNetPaise',
        'bonusEscrowPaise',
        'coopNetPaise',
        'floorWarningTriggered',
        'createdAt',
      ],
      rows,
    };
  }

  if (params.reportType === 'fisherman-statement') {
    const data = await fetchFishermanStatementData(
      readDb,
      params.tenantId,
      params.fishermanId
    );
    const rows = data.fishermen.map((f) => {
      let grossHammer = 0n;
      let net95 = 0n;
      let bonus40 = 0n;
      for (const a of data.allocations) {
        if (a.fisherman_id === f.fisherman_id) {
          grossHammer += BigInt(a.hammer_paise);
          net95 += BigInt(a.fisherman_net_paise);
          bonus40 += BigInt(a.bonus_escrow_paise);
        }
      }
      let payoutsSettled = 0n;
      for (const p of data.payoutItems) {
        if (p.fisherman_id === f.fisherman_id) {
          payoutsSettled += BigInt(p.amount_paise);
        }
      }
      const deduction5 = grossHammer - net95;
      return {
        fishermanId: f.fisherman_id,
        fullName: f.full_name,
        welfareBoardNo: f.welfare_board_no,
        grossHammerPaise: grossHammer.toString(),
        statutoryDeduction5PctPaise: deduction5.toString(),
        fishermanNet95PctPaise: net95.toString(),
        bonusEscrow40PctPaise: bonus40.toString(),
        payoutsSettledPaise: payoutsSettled.toString(),
        closingPayableBalancePaise: f.payable_balance_paise,
        closingBonusEscrowBalancePaise: f.bonus_balance_paise,
      };
    });

    return {
      reportType: 'fisherman-statement',
      generatedAt,
      statutoryCitation: ACT_16_2021_CITATIONS.HARBOUR_COMMISSION_SPLIT,
      summary: {
        fishermenCount: rows.length,
      },
      headers: [
        'fishermanId',
        'fullName',
        'welfareBoardNo',
        'grossHammerPaise',
        'statutoryDeduction5PctPaise',
        'fishermanNet95PctPaise',
        'bonusEscrow40PctPaise',
        'payoutsSettledPaise',
        'closingPayableBalancePaise',
        'closingBonusEscrowBalancePaise',
      ],
      rows,
    };
  }

  if (params.reportType === 'statutory-apportionment') {
    const data = await fetchStatutoryApportionmentData(readDb, params.tenantId);
    let hammerSum = 0n;
    let auctSum = 0n;
    let hmsSum = 0n;
    let bonusSum = 0n;
    let coopSum = 0n;
    for (const a of data.allocations) {
      hammerSum += BigInt(a.hammer_paise);
      auctSum += BigInt(a.auctioneer_paise);
      hmsSum += BigInt(a.hms_net_paise);
      bonusSum += BigInt(a.bonus_escrow_paise);
      coopSum += BigInt(a.coop_net_paise);
    }

    const sumByKind = (kind: string): bigint =>
      data.accounts
        .filter((acc) => acc.kind === kind)
        .reduce((acc, row) => acc + BigInt(row.balance_paise), 0n);

    const rows = [
      {
        recipientPool: 'AUCTIONEER_SHARE_20PCT',
        allocatedTotalPaise: auctSum.toString(),
        ledgerBalancePaise: sumByKind('AUCTIONEER_PAYABLE').toString(),
      },
      {
        recipientPool: 'HMS_FUND_20PCT',
        allocatedTotalPaise: hmsSum.toString(),
        ledgerBalancePaise: sumByKind('HMS_FUND').toString(),
      },
      {
        recipientPool: 'FISHERMAN_BONUS_ESCROW',
        allocatedTotalPaise: bonusSum.toString(),
        ledgerBalancePaise: sumByKind('FISHERMAN_BONUS_ESCROW').toString(),
      },
      {
        recipientPool: 'COOP_SOCIETY_FUND',
        allocatedTotalPaise: coopSum.toString(),
        ledgerBalancePaise: sumByKind('COOP_SOCIETY_FUND').toString(),
      },
    ];

    return {
      reportType: 'statutory-apportionment',
      generatedAt,
      statutoryCitation: ACT_16_2021_CITATIONS.POLICY_SPLIT_BASIS,
      summary: {
        centreType: data.tenant?.centre_type ?? 'KERALA_HARBOUR',
        hammerTotalPaise: hammerSum.toString(),
        totalApportionedCommissionPaise: (
          auctSum +
          hmsSum +
          bonusSum +
          coopSum
        ).toString(),
      },
      headers: ['recipientPool', 'allocatedTotalPaise', 'ledgerBalancePaise'],
      rows,
    };
  }

  if (params.reportType === 'buyer-ledger') {
    const data = await fetchBuyerLedgerReportData(readDb, params.tenantId);
    const rows = data.buyers.map((b) => {
      let purchases = 0n;
      for (const a of data.allocations) {
        if (a.buyer_id === b.buyer_id) {
          purchases += BigInt(a.buyer_payable_paise);
        }
      }
      let receipts = 0n;
      for (const r of data.receipts) {
        if (r.buyer_id === b.buyer_id) {
          receipts += BigInt(r.amount_paise);
        }
      }
      const closingUnsettled = BigInt(b.unsettled_payables_paise);
      const openingUnsettled = closingUnsettled - purchases + receipts;
      return {
        buyerId: b.buyer_id,
        buyerName: b.buyer_name,
        paddleNo: b.paddle_no,
        gstin: b.gstin ?? '',
        openingUnsettledPaise: openingUnsettled.toString(),
        purchasesPaise: purchases.toString(),
        receiptsPaise: receipts.toString(),
        approvedCreditPaise: b.approved_credit_paise,
        escrowBalancePaise: b.escrow_balance_paise,
        closingUnsettledPaise: closingUnsettled.toString(),
      };
    });

    return {
      reportType: 'buyer-ledger',
      generatedAt,
      statutoryCitation: ACT_16_2021_CITATIONS.HARBOUR_POLICY_LEGAL_BASIS,
      summary: {
        buyersCount: rows.length,
      },
      headers: [
        'buyerId',
        'buyerName',
        'paddleNo',
        'gstin',
        'openingUnsettledPaise',
        'purchasesPaise',
        'receiptsPaise',
        'approvedCreditPaise',
        'escrowBalancePaise',
        'closingUnsettledPaise',
      ],
      rows,
    };
  }

  const batches = await fetchPayoutReconciliationReportData(
    readDb,
    params.tenantId
  );
  const nowMs = Date.now();
  let generatedCount = 0;
  let reconciledCount = 0;
  let agedOver24hUnsettledCount = 0;

  const rows = batches.map((b) => {
    const isReconciled = b.status === 'RECONCILED_UTR';
    const ageHours =
      (nowMs - new Date(b.created_at).getTime()) / (1000 * 3600);
    const isAgedUnsettled = !isReconciled && ageHours > 24;
    if (isReconciled) reconciledCount += 1;
    else generatedCount += 1;
    if (isAgedUnsettled) agedOver24hUnsettledCount += 1;

    return {
      batchId: b.batch_id,
      batchCode: b.batch_code,
      totalAmountPaise: b.total_amount_paise,
      itemCount: b.item_count,
      status: b.status,
      bankUtr: b.bank_utr ?? '',
      reconciledAt: b.reconciled_at ?? '',
      createdAt: b.created_at,
      agedOver24hUnsettled: isAgedUnsettled,
    };
  });

  return {
    reportType: 'payout-reconciliation',
    generatedAt,
    statutoryCitation: ACT_16_2021_CITATIONS.HARBOUR_POLICY_LEGAL_BASIS,
    summary: {
      totalBatches: rows.length,
      reconciledBatches: reconciledCount,
      unreconciledBatches: generatedCount,
      agedOver24hUnsettledCount,
    },
    headers: [
      'batchId',
      'batchCode',
      'totalAmountPaise',
      'itemCount',
      'status',
      'bankUtr',
      'reconciledAt',
      'createdAt',
      'agedOver24hUnsettled',
    ],
    rows,
  };
}

export async function computeShadowPilotDiff(
  readDb: DbPort,
  tenantId: string,
  csvText: string
) {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Shadow-diff CSV requires a header row (lotCode,hammerPaise,fishermanNetPaise,commissionPaise) and at least one row',
      400
    );
  }

  const dbRows = await fetchShadowDiffAllocationsByLot(readDb, tenantId);
  const dbMap = new Map<
    string,
    { hammerPaise: bigint; fishermanNetPaise: bigint; commissionPaise: bigint }
  >();
  for (const r of dbRows) {
    const h = BigInt(r.hammer_paise);
    const fn = BigInt(r.fisherman_net_paise);
    dbMap.set(r.lot_code.toUpperCase(), {
      hammerPaise: h,
      fishermanNetPaise: fn,
      commissionPaise: h - fn,
    });
  }

  const diffs: Array<{
    lotCode: string;
    matched: boolean;
    paperHammerPaise: string;
    systemHammerPaise: string;
    hammerDeltaPaise: string;
    paperFishermanNetPaise: string;
    systemFishermanNetPaise: string;
    fishermanNetDeltaPaise: string;
    paperCommissionPaise: string;
    systemCommissionPaise: string;
    commissionDeltaPaise: string;
  }> = [];

  let totalDivergentRows = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i]!.split(',').map((c) => c.trim());
    const lotCode = (cols[0] ?? '').toUpperCase();
    if (!lotCode) continue;

    let paperHammer = 0n;
    let paperNet = 0n;
    let paperComm = 0n;
    try {
      paperHammer = BigInt(cols[1] ?? '0');
      paperNet = BigInt(cols[2] ?? '0');
      paperComm = BigInt(cols[3] ?? '0');
    } catch {
      throw new AppError(
        'VALIDATION_ERROR',
        `Invalid integer paise values on CSV row ${i + 1} (${lotCode})`,
        400
      );
    }

    const sys = dbMap.get(lotCode) ?? {
      hammerPaise: 0n,
      fishermanNetPaise: 0n,
      commissionPaise: 0n,
    };

    const hammerDelta = sys.hammerPaise - paperHammer;
    const netDelta = sys.fishermanNetPaise - paperNet;
    const commDelta = sys.commissionPaise - paperComm;
    const matched = hammerDelta === 0n && netDelta === 0n && commDelta === 0n;
    if (!matched) totalDivergentRows += 1;

    diffs.push({
      lotCode,
      matched,
      paperHammerPaise: paperHammer.toString(),
      systemHammerPaise: sys.hammerPaise.toString(),
      hammerDeltaPaise: hammerDelta.toString(),
      paperFishermanNetPaise: paperNet.toString(),
      systemFishermanNetPaise: sys.fishermanNetPaise.toString(),
      fishermanNetDeltaPaise: netDelta.toString(),
      paperCommissionPaise: paperComm.toString(),
      systemCommissionPaise: sys.commissionPaise.toString(),
      commissionDeltaPaise: commDelta.toString(),
    });
  }

  return {
    zeroPaiseDivergence: totalDivergentRows === 0,
    totalCompared: diffs.length,
    totalDivergentRows,
    diffs,
  };
}
