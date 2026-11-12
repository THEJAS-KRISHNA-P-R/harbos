import type { DbPort } from '@server/ports/db.ts';

export async function fetchDailyAuctionReportData(
  db: DbPort,
  tenantId: string,
  fromIso?: string,
  toIso?: string
) {
  const dateFilterLots =
    fromIso && toIso
      ? `AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz`
      : '';
  const paramsLots = fromIso && toIso ? [tenantId, fromIso, toIso] : [tenantId];

  const [lotsRes, allocRes] = await Promise.all([
    db.query<{
      lot_id: string;
      lot_code: string;
      status: string;
      inspection_grade: string | null;
      total_boxes: number;
      net_grams: string;
      created_at: string;
    }>(
      `SELECT lot_id, lot_code, status, inspection_grade, total_boxes, net_grams::text AS net_grams, created_at::text AS created_at
       FROM auction.lots WHERE tenant_id = $1 ${dateFilterLots} ORDER BY created_at ASC`,
      paramsLots
    ),
    db.query<{
      allocation_id: string;
      lot_id: string;
      boxes_allocated: number;
      grams_allocated: string;
      hammer_paise: string;
      buyer_payable_paise: string;
      fisherman_net_paise: string;
      bonus_escrow_paise: string;
      auctioneer_paise: string;
      hms_net_paise: string;
      coop_net_paise: string;
      harbouros_revenue_paise: string;
      gst_paise: string;
      floor_warning_triggered: boolean;
      created_at: string;
    }>(
      `SELECT allocation_id, lot_id, boxes_allocated, grams_allocated::text AS grams_allocated,
              hammer_paise::text AS hammer_paise, buyer_payable_paise::text AS buyer_payable_paise,
              fisherman_net_paise::text AS fisherman_net_paise, bonus_escrow_paise::text AS bonus_escrow_paise,
              auctioneer_paise::text AS auctioneer_paise, hms_net_paise::text AS hms_net_paise,
              coop_net_paise::text AS coop_net_paise, harbouros_revenue_paise::text AS harbouros_revenue_paise,
              gst_paise::text AS gst_paise, floor_warning_triggered, created_at::text AS created_at
       FROM auction.sale_allocations WHERE tenant_id = $1 ${dateFilterLots} ORDER BY created_at ASC`,
      paramsLots
    ),
  ]);

  return {
    lots: lotsRes.rows,
    allocations: allocRes.rows,
  };
}

export async function fetchFishermanStatementData(
  db: DbPort,
  tenantId: string,
  fishermanId?: string
) {
  const fFilter = fishermanId ? `AND f.fisherman_id = $2` : '';
  const fParams = fishermanId ? [tenantId, fishermanId] : [tenantId];

  const [fishermenRes, allocRes, payoutItemsRes] = await Promise.all([
    db.query<{
      fisherman_id: string;
      full_name: string;
      welfare_board_no: string;
      payable_account_id: string;
      bonus_escrow_account_id: string;
      payable_balance_paise: string;
      bonus_balance_paise: string;
    }>(
      `SELECT f.fisherman_id, f.full_name, f.welfare_board_no,
              f.payable_account_id, f.bonus_escrow_account_id,
              COALESCE(ap.balance_paise, 0)::text AS payable_balance_paise,
              COALESCE(ab.balance_paise, 0)::text AS bonus_balance_paise
       FROM harbour.fishermen f
       LEFT JOIN ledger.accounts ap ON ap.account_id = f.payable_account_id AND ap.tenant_id = f.tenant_id
       LEFT JOIN ledger.accounts ab ON ab.account_id = f.bonus_escrow_account_id AND ab.tenant_id = f.tenant_id
       WHERE f.tenant_id = $1 ${fFilter}
       ORDER BY f.fisherman_id ASC`,
      fParams
    ),
    db.query<{
      fisherman_id: string;
      hammer_paise: string;
      fisherman_net_paise: string;
      bonus_escrow_paise: string;
    }>(
      `SELECT l.fisherman_id,
              sa.hammer_paise::text AS hammer_paise,
              sa.fisherman_net_paise::text AS fisherman_net_paise,
              sa.bonus_escrow_paise::text AS bonus_escrow_paise
       FROM auction.sale_allocations sa
       JOIN auction.lots l ON l.lot_id = sa.lot_id AND l.tenant_id = sa.tenant_id
       WHERE sa.tenant_id = $1`,
      [tenantId]
    ),
    db.query<{
      fisherman_id: string;
      amount_paise: string;
      status: string;
    }>(
      `SELECT pbi.fisherman_id, pbi.amount_paise::text AS amount_paise, pb.status
       FROM ledger.payout_batch_items pbi
       JOIN ledger.payout_batches pb ON pb.batch_id = pbi.batch_id AND pb.tenant_id = pbi.tenant_id
       WHERE pbi.tenant_id = $1`,
      [tenantId]
    ),
  ]);

  return {
    fishermen: fishermenRes.rows,
    allocations: allocRes.rows,
    payoutItems: payoutItemsRes.rows,
  };
}

export async function fetchStatutoryApportionmentData(
  db: DbPort,
  tenantId: string
) {
  const [tenantRes, allocRes, accountsRes] = await Promise.all([
    db.query<{
      tenant_id: string;
      name_en: string;
      centre_type: string;
      hms_account_id: string;
      coop_pool_account_id: string;
    }>(
      `SELECT tenant_id, name_en, centre_type, hms_account_id, coop_pool_account_id
       FROM core.tenants WHERE tenant_id = $1`,
      [tenantId]
    ),
    db.query<{
      hammer_paise: string;
      fisherman_net_paise: string;
      auctioneer_paise: string;
      hms_net_paise: string;
      bonus_escrow_paise: string;
      coop_net_paise: string;
    }>(
      `SELECT hammer_paise::text AS hammer_paise,
              fisherman_net_paise::text AS fisherman_net_paise,
              auctioneer_paise::text AS auctioneer_paise,
              hms_net_paise::text AS hms_net_paise,
              bonus_escrow_paise::text AS bonus_escrow_paise,
              coop_net_paise::text AS coop_net_paise
       FROM auction.sale_allocations WHERE tenant_id = $1`,
      [tenantId]
    ),
    db.query<{
      account_id: string;
      kind: string;
      balance_paise: string;
    }>(
      `SELECT account_id, kind, balance_paise::text AS balance_paise
       FROM ledger.accounts WHERE tenant_id = $1`,
      [tenantId]
    ),
  ]);

  return {
    tenant: tenantRes.rows[0] ?? null,
    allocations: allocRes.rows,
    accounts: accountsRes.rows,
  };
}

export async function fetchBuyerLedgerReportData(db: DbPort, tenantId: string) {
  const [buyersRes, allocRes, receiptsRes] = await Promise.all([
    db.query<{
      buyer_id: string;
      buyer_name: string;
      paddle_no: number;
      gstin: string | null;
      escrow_balance_paise: string;
      approved_credit_paise: string;
      unsettled_payables_paise: string;
      receivable_account_id: string;
    }>(
      `SELECT buyer_id, buyer_name, paddle_no, gstin,
              escrow_balance_paise::text AS escrow_balance_paise,
              approved_credit_paise::text AS approved_credit_paise,
              unsettled_payables_paise::text AS unsettled_payables_paise,
              receivable_account_id
       FROM harbour.buyers WHERE tenant_id = $1 ORDER BY paddle_no ASC`,
      [tenantId]
    ),
    db.query<{
      buyer_id: string;
      buyer_payable_paise: string;
    }>(
      `SELECT buyer_id, buyer_payable_paise::text AS buyer_payable_paise
       FROM auction.sale_allocations WHERE tenant_id = $1`,
      [tenantId]
    ),
    db.query<{
      buyer_id: string;
      amount_paise: string;
    }>(
      `SELECT buyer_id, amount_paise::text AS amount_paise
       FROM ledger.buyer_receipts WHERE tenant_id = $1`,
      [tenantId]
    ),
  ]);

  return {
    buyers: buyersRes.rows,
    allocations: allocRes.rows,
    receipts: receiptsRes.rows,
  };
}

export async function fetchPayoutReconciliationReportData(
  db: DbPort,
  tenantId: string
) {
  const res = await db.query<{
    batch_id: string;
    batch_code: string;
    beneficiary_kind: string;
    total_amount_paise: string;
    item_count: number;
    status: string;
    bank_utr: string | null;
    reconciled_at: string | null;
    created_at: string;
  }>(
    `SELECT batch_id, batch_code, beneficiary_kind,
            total_amount_paise::text AS total_amount_paise,
            item_count, status, bank_utr,
            reconciled_at::text AS reconciled_at,
            created_at::text AS created_at
     FROM ledger.payout_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return res.rows;
}

export async function fetchShadowDiffAllocationsByLot(
  db: DbPort,
  tenantId: string
) {
  const res = await db.query<{
    lot_code: string;
    hammer_paise: string;
    fisherman_net_paise: string;
  }>(
    `SELECT l.lot_code,
            COALESCE(SUM(sa.hammer_paise), 0)::text AS hammer_paise,
            COALESCE(SUM(sa.fisherman_net_paise), 0)::text AS fisherman_net_paise
     FROM auction.lots l
     LEFT JOIN auction.sale_allocations sa ON sa.lot_id = l.lot_id AND sa.tenant_id = l.tenant_id
     WHERE l.tenant_id = $1
     GROUP BY l.lot_code`,
    [tenantId]
  );
  return res.rows;
}
