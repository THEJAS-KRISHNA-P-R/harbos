import type { DbPort } from '@server/ports/db.ts';

export async function lockFishermanPayableAccountsInTx(
  tx: DbPort,
  tenantId: string
) {
  const res = await tx.query<{
    account_id: string;
    owner_entity_id: string | null;
    balance_paise: string;
  }>(
    `SELECT account_id, owner_entity_id, balance_paise::text AS balance_paise
     FROM ledger.accounts
     WHERE tenant_id = $1 AND kind = 'FISHERMAN_PAYABLE' AND balance_paise > 0
     ORDER BY account_id ASC
     FOR UPDATE`,
    [tenantId]
  );
  return res.rows;
}

export async function countPayoutBatchesInTx(
  tx: DbPort,
  tenantId: string
): Promise<number> {
  const cntRes = await tx.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM ledger.payout_batches WHERE tenant_id = $1`,
    [tenantId]
  );
  return cntRes.rows[0]?.cnt ?? 0;
}

export async function insertPayoutBatchRowInTx(
  tx: DbPort,
  params: {
    batchId: string;
    tenantId: string;
    batchCode: string;
    totalAmountPaise: string;
    itemCount: number;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.payout_batches (
      batch_id, tenant_id, batch_code, beneficiary_kind,
      total_amount_paise, item_count, status, bank_utr, reconciled_at, created_at
    ) VALUES ($1, $2, $3, 'FISHERMAN_NET_SETTLEMENT', $4, $5, 'GENERATED_CSV', NULL, NULL, $6)`,
    [
      params.batchId,
      params.tenantId,
      params.batchCode,
      params.totalAmountPaise,
      params.itemCount,
      params.nowIso,
    ]
  );
}

export async function insertPayoutBatchItemRowInTx(
  tx: DbPort,
  params: {
    itemId: string;
    batchId: string;
    tenantId: string;
    fishermanId: string;
    accountId: string;
    amountPaise: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO ledger.payout_batch_items (
      item_id, batch_id, tenant_id, fisherman_id, account_id, amount_paise
    ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.itemId,
      params.batchId,
      params.tenantId,
      params.fishermanId,
      params.accountId,
      params.amountPaise,
    ]
  );
}

export async function findBuyerReceiptByIdempotencyInTx(
  tx: DbPort,
  tenantId: string,
  idempotencyKey: string
) {
  const res = await tx.query<{
    receipt_id: string;
    buyer_id: string;
    journal_id: string;
    amount_paise: string;
    payment_reference: string;
  }>(
    `SELECT receipt_id, buyer_id, journal_id, amount_paise::text AS amount_paise, payment_reference
     FROM ledger.buyer_receipts
     WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, idempotencyKey]
  );
  return res.rows[0] ?? null;
}

export async function fetchBuyerUnsettledPayablesInTx(
  tx: DbPort,
  tenantId: string,
  buyerId: string
): Promise<string> {
  const res = await tx.query<{ unsettled_payables_paise: string }>(
    `SELECT unsettled_payables_paise::text AS unsettled_payables_paise
     FROM harbour.buyers WHERE buyer_id = $1 AND tenant_id = $2`,
    [buyerId, tenantId]
  );
  return res.rows[0]?.unsettled_payables_paise ?? '0';
}

export async function lockBuyerForReceiptInTx(
  tx: DbPort,
  tenantId: string,
  buyerId: string
) {
  const res = await tx.query<{
    buyer_id: string;
    buyer_name: string;
    unsettled_payables_paise: string;
    receivable_account_id: string;
  }>(
    `SELECT buyer_id, buyer_name, unsettled_payables_paise::text AS unsettled_payables_paise, receivable_account_id
     FROM harbour.buyers WHERE buyer_id = $1 AND tenant_id = $2 FOR UPDATE`,
    [buyerId, tenantId]
  );
  return res.rows[0] ?? null;
}

export async function finalizeBuyerReceiptInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    buyerId: string;
    newUnsettledPaise: string;
    receiptId: string;
    amountPaise: string;
    referenceNo: string;
    idempotencyKey: string;
    journalId: string;
    actorUserId: string;
    nowIso: string;
  }
): Promise<void> {
  await tx.query(
    `UPDATE harbour.buyers SET unsettled_payables_paise = $1 WHERE buyer_id = $2 AND tenant_id = $3`,
    [params.newUnsettledPaise, params.buyerId, params.tenantId]
  );
  await tx.query(
    `INSERT INTO ledger.buyer_receipts (
      receipt_id, tenant_id, buyer_id, amount_paise, payment_reference,
      idempotency_key, journal_id, recorded_by_user_id, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      params.receiptId,
      params.tenantId,
      params.buyerId,
      params.amountPaise,
      params.referenceNo,
      params.idempotencyKey,
      params.journalId,
      params.actorUserId,
      params.nowIso,
    ]
  );
}

export async function resolveOrCreateBankClearingAccountInPayoutsTx(
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

export async function lockPayoutBatchByRefInTx(
  tx: DbPort,
  tenantId: string,
  batchRef: string
) {
  const res = await tx.query<{
    batch_id: string;
    batch_code: string;
    status: string;
    total_amount_paise: string;
  }>(
    `SELECT batch_id, batch_code, status, total_amount_paise::text AS total_amount_paise
     FROM ledger.payout_batches
     WHERE tenant_id = $1 AND (UPPER(batch_id) = UPPER($2) OR UPPER(batch_code) = UPPER($2))
     FOR UPDATE`,
    [tenantId, batchRef]
  );
  return res.rows[0] ?? null;
}

export async function findDuplicateBatchUtrInTx(
  tx: DbPort,
  tenantId: string,
  bankUtr: string,
  excludeBatchId: string
) {
  const res = await tx.query<{ batch_id: string }>(
    `SELECT batch_id FROM ledger.payout_batches
     WHERE tenant_id = $1 AND bank_utr = $2 AND batch_id <> $3 LIMIT 1`,
    [tenantId, bankUtr, excludeBatchId]
  );
  return res.rows[0] ?? null;
}

export async function updatePayoutBatchReconciledInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    batchRef: string;
    byExactId: boolean;
    bankUtr: string;
    nowIso: string;
  }
) {
  if (params.byExactId) {
    const res = await tx.query<{
      batch_id: string;
      batch_code: string;
      status: string;
      bank_utr: string;
    }>(
      `UPDATE ledger.payout_batches
       SET status = 'RECONCILED_UTR', bank_utr = $1, reconciled_at = $2
       WHERE tenant_id = $3 AND batch_id = $4
       RETURNING batch_id, batch_code, status, bank_utr`,
      [params.bankUtr, params.nowIso, params.tenantId, params.batchRef]
    );
    return res.rows[0] ?? null;
  }
  const res = await tx.query<{
    batch_id: string;
    batch_code: string;
    status: string;
    bank_utr: string;
  }>(
    `UPDATE ledger.payout_batches
     SET status = 'RECONCILED_UTR', bank_utr = $1, reconciled_at = $2
     WHERE tenant_id = $3 AND (UPPER(batch_id) = UPPER($4) OR UPPER(batch_code) = UPPER($4))
     RETURNING batch_id, batch_code, status, bank_utr`,
    [params.bankUtr, params.nowIso, params.tenantId, params.batchRef]
  );
  return res.rows[0] ?? null;
}

export async function listTenantPayoutBatchesInTx(tx: DbPort, tenantId: string) {
  const res = await tx.query<{
    batch_id: string;
    batch_code: string;
    status: string;
  }>(
    `SELECT batch_id, batch_code, status FROM ledger.payout_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return res.rows;
}

export async function enqueuePayoutReadyOutboxEventsInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    batchId: string;
    batchCode: string;
    bankUtr: string;
    nowIso: string;
  }
): Promise<void> {
  const itemsRes = await tx.query<{
    item_id: string;
    fisherman_id: string;
    amount_paise: string;
  }>(
    `SELECT item_id, fisherman_id, amount_paise::text AS amount_paise
     FROM ledger.payout_batch_items WHERE tenant_id = $1 AND batch_id = $2`,
    [params.tenantId, params.batchId]
  );
  for (const item of itemsRes.rows) {
    await tx.query(
      `INSERT INTO sync.outbox_events (
        event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at
      ) VALUES ($1, $2, 'SMS', $3, 'PAYOUT_READY', $4, 'PENDING', $5)
      ON CONFLICT (event_id) DO NOTHING`,
      [
        `OUT-PAY-${item.item_id}`,
        params.tenantId,
        item.fisherman_id,
        JSON.stringify({
          batchCode: params.batchCode,
          bankUtr: params.bankUtr,
          amountPaise: item.amount_paise,
        }),
        params.nowIso,
      ]
    );
  }
}
