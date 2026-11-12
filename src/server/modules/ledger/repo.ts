import type { DbPort } from '@server/ports/db.ts';
import type { CommercialMode, FloorEnforcement } from '@shared/ids.ts';

export async function lockAccountsSortedInTx(
  tx: DbPort,
  tenantId: string,
  accountIds: ReadonlyArray<string>
): Promise<Map<string, { kind: string; balancePaise: bigint }>> {
  const uniqueSorted = [...new Set(accountIds)].sort();
  const map = new Map<string, { kind: string; balancePaise: bigint }>();
  for (const accId of uniqueSorted) {
    const res = await tx.query<{ kind: string; balance_paise: string | number }>(
      `SELECT kind, balance_paise FROM ledger.accounts WHERE account_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [accId, tenantId]
    );
    const row = res.rows[0];
    if (row) {
      map.set(accId, { kind: row.kind, balancePaise: BigInt(row.balance_paise) });
    }
  }
  return map;
}

export async function lockTenantHeadInTx(
  tx: DbPort,
  tenantId: string,
  genesisHash: string
): Promise<{ currentSeq: bigint; prevHash: string }> {
  const headRes = await tx.query<{ last_entry_seq: string | number; last_row_hash: string }>(
    `SELECT last_entry_seq, last_row_hash FROM ledger.heads WHERE tenant_id = $1 FOR UPDATE`,
    [tenantId]
  );
  const headRow = headRes.rows[0];
  if (headRow) {
    return { currentSeq: BigInt(headRow.last_entry_seq), prevHash: headRow.last_row_hash };
  }
  await tx.query(
    `INSERT INTO ledger.heads (tenant_id, last_entry_seq, last_row_hash) VALUES ($1, 0, $2)`,
    [tenantId, genesisHash]
  );
  return { currentSeq: 0n, prevHash: genesisHash };
}

export async function insertJournalRowInTx(
  tx: DbPort,
  params: {
    journalId: string;
    tenantId: string;
    referenceType: string;
    referenceId: string;
    description: string;
    reversesJournalId: string | null;
    authorizedByUser1: string | null;
    authorizedByUser2: string | null;
    reasonNote: string | null;
    totalAmountPaise: string;
    createdAtIso: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.journals (
      journal_id, tenant_id, reference_type, reference_id, description,
      reverses_journal_id, authorized_by_user_1, authorized_by_user_2, reason_note,
      total_amount_paise, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      params.journalId,
      params.tenantId,
      params.referenceType,
      params.referenceId,
      params.description,
      params.reversesJournalId,
      params.authorizedByUser1,
      params.authorizedByUser2,
      params.reasonNote,
      params.totalAmountPaise,
      params.createdAtIso,
    ]
  );
}

export async function insertEntryAndUpdateAccountInTx(
  tx: DbPort,
  params: {
    entrySeq: string;
    tenantId: string;
    journalId: string;
    accountId: string;
    direction: 'D' | 'C';
    amountPaise: string;
    prevRowHash: string;
    rowHash: string;
    createdAtIso: string;
    newBalancePaise: string | null;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.entries (
      entry_seq, tenant_id, journal_id, account_id, direction,
      amount_paise, prev_row_hash, row_hash, created_at_utc_iso_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      params.entrySeq,
      params.tenantId,
      params.journalId,
      params.accountId,
      params.direction,
      params.amountPaise,
      params.prevRowHash,
      params.rowHash,
      params.createdAtIso,
    ]
  );
  if (params.newBalancePaise !== null) {
    await tx.query(
      `UPDATE ledger.accounts SET balance_paise = $1 WHERE account_id = $2 AND tenant_id = $3`,
      [params.newBalancePaise, params.accountId, params.tenantId]
    );
  }
}

export async function updateTenantHeadInTx(
  tx: DbPort,
  tenantId: string,
  lastEntrySeq: string,
  lastRowHash: string
): Promise<void> {
  await tx.query(
    `UPDATE ledger.heads SET last_entry_seq = $1, last_row_hash = $2 WHERE tenant_id = $3`,
    [lastEntrySeq, lastRowHash, tenantId]
  );
}

export async function resolveOrCreateBankClearingAccountInTx(
  tx: DbPort,
  tenantId: string
): Promise<string> {
  const bankRes = await tx.query<{ account_id: string }>(
    `SELECT account_id FROM ledger.accounts WHERE tenant_id = $1 AND kind = 'BANK_CLEARING' ORDER BY account_id ASC LIMIT 1`,
    [tenantId]
  );
  if (bankRes.rows[0]?.account_id) return bankRes.rows[0].account_id;
  const fallbackBankId = `ACC-BANK-${tenantId}`;
  await tx.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'BANK_CLEARING', '1100-BANK', 'HMS Nodal Bank Clearing Account', $2, 0)
     ON CONFLICT (account_id) DO NOTHING`,
    [fallbackBankId, tenantId]
  );
  return fallbackBankId;
}

export async function fetchEntriesPage(
  db: DbPort,
  tenantId: string,
  afterSeq: bigint,
  limit: number
) {
  const res = await db.query<{
    entry_seq: string;
    journal_id: string;
    account_id: string;
    direction: 'D' | 'C';
    amount_paise: string;
    prev_row_hash: string;
    row_hash: string;
    created_at_utc_iso_ms: string;
  }>(
    `SELECT entry_seq::text AS entry_seq, journal_id, account_id, direction,
            amount_paise::text AS amount_paise, prev_row_hash, row_hash, created_at_utc_iso_ms
     FROM ledger.entries WHERE tenant_id = $1 AND entry_seq > $2 ORDER BY (entry_seq::bigint) ASC LIMIT $3`,
    [tenantId, afterSeq.toString(), limit]
  );
  return res.rows;
}

export async function fetchLatestAnchor(db: DbPort, tenantId: string) {
  const res = await db.query<{ last_entry_seq: string; head_hash: string }>(
    `SELECT last_entry_seq::text AS last_entry_seq, head_hash
     FROM ledger.daily_anchors WHERE tenant_id = $1 ORDER BY last_entry_seq DESC LIMIT 1`,
    [tenantId]
  );
  return res.rows[0] ?? null;
}

export async function fetchEntryCountAndAnchorRow(
  db: DbPort,
  tenantId: string,
  anchorSeq: bigint
) {
  const cntRes = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM ledger.entries WHERE tenant_id = $1 AND entry_seq <= $2`,
    [tenantId, anchorSeq.toString()]
  );
  const hashRes = await db.query<{ row_hash: string }>(
    `SELECT row_hash FROM ledger.entries WHERE tenant_id = $1 AND entry_seq = $2`,
    [tenantId, anchorSeq.toString()]
  );
  return {
    priorCount: cntRes.rows[0]?.cnt ?? 0,
    anchorRowHash: hashRes.rows[0]?.row_hash ?? null,
  };
}

export async function findExistingAllocationByIdempotencyInTx(
  tx: DbPort,
  tenantId: string,
  idempotencyKey: string
) {
  const res = await tx.query<{
    allocation_id: string;
    journal_id: string;
    hammer_paise: string;
    buyer_payable_paise: string;
    fisherman_net_paise: string;
    bonus_escrow_paise: string;
    floor_warning_triggered: boolean;
    server_latency_ms: number;
    request_hash: string | null;
  }>(
    `SELECT allocation_id, journal_id, hammer_paise, buyer_payable_paise,
            fisherman_net_paise, bonus_escrow_paise, floor_warning_triggered,
            server_latency_ms, request_hash
     FROM auction.sale_allocations WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, idempotencyKey]
  );
  return res.rows[0] ?? null;
}

export async function fetchLotRemainingInTx(tx: DbPort, tenantId: string, lotId: string) {
  const res = await tx.query<{ available_boxes: number; available_grams: string }>(
    `SELECT available_boxes, available_grams FROM auction.lots WHERE lot_id = $1 AND tenant_id = $2`,
    [lotId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function lockSessionInTx(tx: DbPort, tenantId: string, sessionId: string) {
  const res = await tx.query<{ fencing_token: number; status: string }>(
    `SELECT fencing_token, status FROM auction.sessions WHERE session_id = $1 AND tenant_id = $2 FOR UPDATE`,
    [sessionId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function fetchTenantAndPolicyInTx(tx: DbPort, tenantId: string) {
  const tenantRes = await tx.query<{
    floor_enforcement: FloorEnforcement;
    active_policy_id: string;
    hms_account_id: string;
    coop_pool_account_id: string;
    harbouros_revenue_account_id: string;
    gst_payable_account_id: string;
  }>(
    `SELECT floor_enforcement, active_policy_id, hms_account_id, coop_pool_account_id,
            harbouros_revenue_account_id, gst_payable_account_id
     FROM core.tenants WHERE tenant_id = $1`,
    [tenantId]
  );
  const tenant = tenantRes.rows[0] ?? null;
  if (!tenant) return { tenant: null, policy: null };

  const policyRes = await tx.query<{
    policy_id: string;
    commercial_mode: CommercialMode;
    commission_bps: number;
    auctioneer_share_bps: number;
    hms_share_bps: number;
    fisher_bonus_share_bps: number;
    coop_share_bps: number;
    institutional_tech_share_bps: number;
    buyer_fee_bps: number;
    gst_rate_bps: number;
    legal_signoff_ref: string | null;
    legal_signoff_date: string | null;
  }>(
    `SELECT policy_id, commercial_mode, commission_bps, auctioneer_share_bps,
            hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
            institutional_tech_share_bps, buyer_fee_bps, gst_rate_bps,
            legal_signoff_ref, legal_signoff_date
     FROM core.commission_policies WHERE policy_id = $1 AND tenant_id = $2`,
    [tenant.active_policy_id, tenantId]
  );
  return { tenant, policy: policyRes.rows[0] ?? null };
}

export async function lockLotInTx(tx: DbPort, tenantId: string, lotId: string) {
  const res = await tx.query<{
    lot_id: string;
    lot_code: string;
    vessel_id: string;
    fisherman_id: string;
    species_id: string;
    total_boxes: number;
    available_boxes: number;
    net_grams: string;
    available_grams: string;
    inspection_grade: string | null;
    status: string;
  }>(
    `SELECT lot_id, lot_code, vessel_id, fisherman_id, species_id,
            total_boxes, available_boxes, net_grams, available_grams,
            inspection_grade, status
     FROM auction.lots WHERE lot_id = $1 AND tenant_id = $2 FOR UPDATE`,
    [lotId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function fetchAllocationActorsInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    vesselId: string;
    fishermanId: string;
    licenceId: string;
    speciesId: string;
  }
) {
  const vesselRes = await tx.query<{ has_active_society_loan: boolean; loan_coop_society_id: string | null }>(
    `SELECT has_active_society_loan, loan_coop_society_id FROM harbour.vessels WHERE vessel_id = $1 AND tenant_id = $2`,
    [params.vesselId, params.tenantId]
  );
  const fishermanRes = await tx.query<{ payable_account_id: string; bonus_escrow_account_id: string }>(
    `SELECT payable_account_id, bonus_escrow_account_id FROM harbour.fishermen WHERE fisherman_id = $1 AND tenant_id = $2`,
    [params.fishermanId, params.tenantId]
  );
  const licRes = await tx.query<{
    licence_no: string;
    status: string;
    valid_from: string;
    valid_until: string;
    deputed_by_society_id: string | null;
    payable_account_id: string;
  }>(
    `SELECT licence_no, status, valid_from, valid_until, deputed_by_society_id, payable_account_id
     FROM harbour.auctioneer_licences WHERE licence_id = $1 AND tenant_id = $2`,
    [params.licenceId, params.tenantId]
  );
  const speciesRes = await tx.query<{ floor_price_paise_per_kg: string; name_en: string }>(
    `SELECT floor_price_paise_per_kg, name_en FROM harbour.species WHERE species_id = $1 AND tenant_id = $2`,
    [params.speciesId, params.tenantId]
  );
  return {
    vessel: vesselRes.rows[0] ?? null,
    fisherman: fishermanRes.rows[0] ?? null,
    licence: licRes.rows[0] ?? null,
    species: speciesRes.rows[0] ?? null,
  };
}

export async function lockBuyerInTx(tx: DbPort, tenantId: string, buyerId: string) {
  const res = await tx.query<{
    buyer_id: string;
    buyer_name: string;
    escrow_balance_paise: string;
    approved_credit_paise: string;
    unsettled_payables_paise: string;
    active_holds_paise: string;
    receivable_account_id: string;
  }>(
    `SELECT buyer_id, buyer_name, escrow_balance_paise::text AS escrow_balance_paise,
            approved_credit_paise::text AS approved_credit_paise,
            unsettled_payables_paise::text AS unsettled_payables_paise,
            active_holds_paise::text AS active_holds_paise,
            receivable_account_id
     FROM harbour.buyers WHERE buyer_id = $1 AND tenant_id = $2 FOR UPDATE`,
    [buyerId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function fetchNextAllocationSeqInTx(
  tx: DbPort,
  tenantId: string,
  lotId: string
): Promise<number> {
  const seqRes = await tx.query<{ next_seq: number }>(
    `SELECT COALESCE(MAX(allocation_seq), 0) + 1 AS next_seq FROM auction.sale_allocations WHERE tenant_id = $1 AND lot_id = $2`,
    [tenantId, lotId]
  );
  return Number(seqRes.rows[0]?.next_seq ?? 1);
}

export async function finalizeAllocationStateInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    buyerId: string;
    buyerPayableDeltaPaise: string;
    lotId: string;
    remainingBoxes: number;
    remainingGrams: string;
    newLotStatus: string;
    allocationRowParams: ReadonlyArray<unknown>;
    outboxEventId: string;
    fishermanId: string;
    outboxPayloadJson: string;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `UPDATE harbour.buyers SET unsettled_payables_paise = unsettled_payables_paise + $1 WHERE buyer_id = $2 AND tenant_id = $3`,
    [params.buyerPayableDeltaPaise, params.buyerId, params.tenantId]
  );
  await tx.query(
    `UPDATE auction.lots SET available_boxes = $1, available_grams = $2, status = $3 WHERE lot_id = $4 AND tenant_id = $5`,
    [params.remainingBoxes, params.remainingGrams, params.newLotStatus, params.lotId, params.tenantId]
  );
  await tx.query(
    `INSERT INTO auction.sale_allocations (
      allocation_id, tenant_id, lot_id, allocation_seq, session_id, auction_mode,
      policy_id, auctioneer_licence_id, buyer_id, boxes_allocated, grams_allocated,
      price_per_kg_paise, hammer_paise, buyer_payable_paise, fisherman_net_paise,
      bonus_escrow_paise, auctioneer_paise, hms_net_paise, coop_net_paise,
      harbouros_revenue_paise, gst_paise, floor_warning_triggered,
      government_permission_ref, idempotency_key, request_hash, fencing_token, journal_id,
      server_latency_ms, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
    )`,
    params.allocationRowParams
  );
  await tx.query(
    `INSERT INTO sync.outbox_events (event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at)
     VALUES ($1, $2, 'SMS', $3, 'LOT_SOLD', $4, 'PENDING', $5)`,
    [params.outboxEventId, params.tenantId, params.fishermanId, params.outboxPayloadJson, params.nowIso]
  );
}

export async function lockReversalRequestInTx(tx: DbPort, tenantId: string, reversalId: string) {
  const res = await tx.query<{
    reversal_id: string;
    original_journal_id: string;
    reason_note: string;
    requested_by_user_id: string;
    status: string;
  }>(
    `SELECT reversal_id, original_journal_id, reason_note, requested_by_user_id, status
     FROM ledger.reversal_requests WHERE reversal_id = $1 AND tenant_id = $2 FOR UPDATE`,
    [reversalId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function fetchJournalEntriesForReversalInTx(tx: DbPort, tenantId: string, journalId: string) {
  const res = await tx.query<{ account_id: string; direction: 'D' | 'C'; amount_paise: string }>(
    `SELECT account_id, direction, amount_paise FROM ledger.entries WHERE tenant_id = $1 AND journal_id = $2 ORDER BY entry_seq ASC`,
    [tenantId, journalId]
  );
  return res.rows;
}

export async function markReversalExecutedInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    reversalId: string;
    approverUserId: string;
    approverName: string;
    compensatingJournalId: string;
  }
): Promise<void> {
  await tx.query(
    `UPDATE ledger.reversal_requests
     SET approved_by_user_id = $1, approved_by_name = $2, compensating_journal_id = $3, status = 'EXECUTED'
     WHERE reversal_id = $4 AND tenant_id = $5`,
    [params.approverUserId, params.approverName, params.compensatingJournalId, params.reversalId, params.tenantId]
  );
}

export async function insertReversalRequestInTx(
  tx: DbPort,
  params: {
    reversalId: string;
    tenantId: string;
    originalJournalId: string;
    reasonNote: string;
    requestedByUserId: string;
    requestedByName: string;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.reversal_requests (
      reversal_id, tenant_id, original_journal_id, reason_note,
      requested_by_user_id, requested_by_name, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING_SECOND_APPROVAL', $7)`,
    [
      params.reversalId,
      params.tenantId,
      params.originalJournalId,
      params.reasonNote,
      params.requestedByUserId,
      params.requestedByName,
      params.nowIso,
    ]
  );
}

export async function fetchPayoutBatchesAndAuditLogs(db: DbPort, tenantId: string) {
  const [batchesRes, auditLogsRes] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT * FROM ledger.payout_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    ),
    db.query<Record<string, unknown>>(
      `SELECT a.audit_id, a.tenant_id, a.actor_user_id, COALESCE(u.full_name, a.actor_user_id) AS actor_name,
              a.actor_role, a.action_code, a.target_type, a.target_id, a.details_json, a.created_at
       FROM core.audit_logs a
       LEFT JOIN core.users u ON u.user_id = a.actor_user_id
       WHERE a.tenant_id = $1 ORDER BY a.created_at DESC LIMIT 100`,
      [tenantId]
    ),
  ]);
  return { payoutBatches: batchesRes.rows, auditLogs: auditLogsRes.rows };
}

export async function fetchJournalsKeysetPage(
  db: DbPort,
  params: { tenantId: string; limitPlusOne: number; cursor?: { ts: string; id: string } | null }
) {
  if (params.cursor) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM ledger.journals
       WHERE tenant_id = $1 AND (created_at, journal_id) < ($2::timestamptz, $3)
       ORDER BY created_at DESC, journal_id DESC LIMIT $4`,
      [params.tenantId, params.cursor.ts, params.cursor.id, params.limitPlusOne]
    );
    return res.rows;
  }
  const res = await db.query<Record<string, unknown>>(
    `SELECT * FROM ledger.journals WHERE tenant_id = $1 ORDER BY created_at DESC, journal_id DESC LIMIT $2`,
    [params.tenantId, params.limitPlusOne]
  );
  return res.rows;
}
