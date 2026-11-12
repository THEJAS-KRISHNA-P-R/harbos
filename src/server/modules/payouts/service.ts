import crypto from 'node:crypto';
import { auditInTx, withTenant, type DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { AppError } from '@server/platform/errors.ts';
import { computeCanonicalRequestHash, executeWithDbIdempotency } from '@server/platform/idempotency.ts';
import { DEMO_TENANT_ID } from '@server/platform/seed.ts';
import { postJournalInTx, invalidateLedgerAuditSqlLruCache } from '@server/modules/ledger/index.ts';
import type { JournalEntryDraft } from '@shared/domain/ledger-hash.ts';
import { sanitizeBulkReconcilePayload, validateAndNormalizeBankUtr, type SanitizedBulkInvalidItem } from '@shared/domain/utr-validation.ts';
import { HARBOUROS_SDK_VERSION, signBankNodalWebhookPayload, verifyBankNodalWebhookSignature, type BankNodalWebhookPayload } from '@shared/sdk/harbouros-sdk.ts';
import {
  countPayoutBatchesInTx,
  enqueuePayoutReadyOutboxEventsInTx,
  fetchBuyerUnsettledPayablesInTx,
  finalizeBuyerReceiptInTx,
  findBuyerReceiptByIdempotencyInTx,
  findDuplicateBatchUtrInTx,
  insertPayoutBatchItemRowInTx,
  insertPayoutBatchRowInTx,
  listTenantPayoutBatchesInTx,
  lockBuyerForReceiptInTx,
  lockFishermanPayableAccountsInTx,
  lockPayoutBatchByRefInTx,
  resolveOrCreateBankClearingAccountInPayoutsTx,
  updatePayoutBatchReconciledInTx,
} from './repo.ts';

export interface ReconciledBatchSummary {
  batchId: string;
  batchCode: string;
  status: string;
  bankUtr: string;
}

export interface BulkReconcileResult {
  auditId: string;
  timestampIso: string;
  sourceLabel: string;
  reconciledCount: number;
  totalRowsParsed: number;
  invalidOrUnmatchedCount: number;
  duplicatesSkipped: number;
  idempotentReplay: boolean;
  reconciled: ReadonlyArray<ReconciledBatchSummary>;
  invalidItems: ReadonlyArray<SanitizedBulkInvalidItem>;
}

export async function createPayoutBatch(
  db: DbPort,
  params: { tenantId: string; actorUserId: string; actorRole: string; actorFullName: string }
) {
  return db.transaction(async (tx) => {
    const bankAccountId = await resolveOrCreateBankClearingAccountInPayoutsTx(tx, params.tenantId);
    const payableRows = await lockFishermanPayableAccountsInTx(tx, params.tenantId);

    let totalAmountPaise = 0n;
    for (const row of payableRows) totalAmountPaise += BigInt(row.balance_paise);

    if (payableRows.length === 0 || totalAmountPaise <= 0n) {
      throw new AppError('NOTHING_PAYABLE', 'No positive fisherman payable balances available to settle.', 422);
    }

    const seqNum = (await countPayoutBatchesInTx(tx, params.tenantId)) + 1;
    const nowIso = new Date().toISOString();
    const dateStamp = nowIso.slice(0, 10).replace(/-/g, '');
    const batchId = `BATCH-${crypto.randomUUID()}`;
    const tenantPrefix = params.tenantId.replace(/^ten-/, '').slice(0, 3).toUpperCase() || 'HRB';
    const batchCode = `${tenantPrefix}-PAY-${dateStamp}-${String(seqNum).padStart(2, '0')}`;
    const journalId = `JRN-${batchId}`;

    await insertPayoutBatchRowInTx(tx, {
      batchId,
      tenantId: params.tenantId,
      batchCode,
      totalAmountPaise: totalAmountPaise.toString(),
      itemCount: payableRows.length,
      nowIso,
    });

    const items: Array<{ itemId: string; beneficiaryId: string; accountId: string; amountPaise: string }> = [];
    const journalEntries: JournalEntryDraft[] = [];

    for (const row of payableRows) {
      const itemId = `PBI-${crypto.randomUUID()}`;
      const beneficiaryId = row.owner_entity_id ?? row.account_id;
      const amtPaise = BigInt(row.balance_paise);

      await insertPayoutBatchItemRowInTx(tx, {
        itemId,
        batchId,
        tenantId: params.tenantId,
        fishermanId: beneficiaryId,
        accountId: row.account_id,
        amountPaise: amtPaise.toString(),
      });

      items.push({ itemId, beneficiaryId, accountId: row.account_id, amountPaise: amtPaise.toString() });
      journalEntries.push({ accountId: row.account_id, direction: 'D', amountPaise: amtPaise });
    }

    journalEntries.push({ accountId: bankAccountId, direction: 'C', amountPaise: totalAmountPaise });

    await postJournalInTx(tx, {
      tenantId: params.tenantId,
      journalId,
      referenceType: 'PAYOUT_BATCH',
      referenceId: batchId,
      description: `Fisherman net settlement payout batch ${batchCode} (${items.length} beneficiaries)`,
      entries: journalEntries,
      createdAtIso: nowIso,
    });

    await auditInTx(tx, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionCode: 'PAYOUT_BATCH_GENERATED',
      targetType: 'PAYOUT_BATCH',
      targetId: batchId,
      details: { batchCode, journalId, totalAmountPaise: totalAmountPaise.toString(), itemCount: items.length },
    });

    return { batchId, batchCode, journalId, totalAmountPaise: totalAmountPaise.toString(), itemCount: items.length, items };
  });
}

export async function recordBuyerReceipt(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
    buyerId: string;
    amountPaise: bigint;
    paymentChannel: 'UPI_ESCROW' | 'NEFT' | 'RTGS' | 'IMPS' | 'NODAL_TRANSFER';
    referenceNo: string;
    idempotencyKey: string;
  }
) {
  if (!params.idempotencyKey.trim()) {
    throw new AppError('VALIDATION_ERROR', 'Idempotency-Key header is required for buyer receipt postings.', 400);
  }
  if (params.amountPaise <= 0n) {
    throw new AppError('VALIDATION_ERROR', 'amountPaise must be > 0', 400);
  }

  return db.transaction(async (tx) => {
    const existing = await findBuyerReceiptByIdempotencyInTx(tx, params.tenantId, params.idempotencyKey.trim());
    if (existing) {
      const unsettled = await fetchBuyerUnsettledPayablesInTx(tx, params.tenantId, existing.buyer_id);
      return {
        receiptId: existing.receipt_id,
        buyerId: existing.buyer_id,
        journalId: existing.journal_id,
        amountPaise: existing.amount_paise,
        unsettledPayablesPaise: unsettled,
        paymentChannel: params.paymentChannel,
        referenceNo: existing.payment_reference,
        idempotentReplay: true,
      };
    }

    const buyer = await lockBuyerForReceiptInTx(tx, params.tenantId, params.buyerId);
    if (!buyer) throw new AppError('NOT_FOUND', `Buyer ${params.buyerId} not found`, 404);

    const currentUnsettled = BigInt(buyer.unsettled_payables_paise);
    if (params.amountPaise > currentUnsettled) {
      throw new AppError(
        'OVERPAYMENT_REJECTED',
        `Receipt amount (${params.amountPaise.toString()} paise) exceeds buyer unsettled payables (${currentUnsettled.toString()} paise).`,
        422
      );
    }

    const bankAccountId = await resolveOrCreateBankClearingAccountInPayoutsTx(tx, params.tenantId);
    const receiptId = `RCPT-${crypto.randomUUID()}`;
    const journalId = `JRN-${receiptId}`;
    const nowIso = new Date().toISOString();

    await postJournalInTx(tx, {
      tenantId: params.tenantId,
      journalId,
      referenceType: 'BUYER_RECEIPT',
      referenceId: receiptId,
      description: `Buyer settlement receipt ${receiptId} from ${buyer.buyer_id} (${params.paymentChannel} ${params.referenceNo})`,
      entries: [
        { accountId: bankAccountId, direction: 'D', amountPaise: params.amountPaise },
        { accountId: buyer.receivable_account_id, direction: 'C', amountPaise: params.amountPaise },
      ],
      createdAtIso: nowIso,
    });

    const newUnsettled = currentUnsettled - params.amountPaise;
    await finalizeBuyerReceiptInTx(tx, {
      tenantId: params.tenantId,
      buyerId: params.buyerId,
      newUnsettledPaise: newUnsettled.toString(),
      receiptId,
      amountPaise: params.amountPaise.toString(),
      referenceNo: params.referenceNo,
      idempotencyKey: params.idempotencyKey.trim(),
      journalId,
      actorUserId: params.actorUserId,
      nowIso,
    });

    await auditInTx(tx, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionCode: 'BUYER_RECEIPT_RECORDED',
      targetType: 'BUYER_RECEIPT',
      targetId: receiptId,
      details: {
        buyerId: params.buyerId,
        amountPaise: params.amountPaise.toString(),
        unsettledPayablesPaise: newUnsettled.toString(),
        paymentChannel: params.paymentChannel,
        referenceNo: params.referenceNo,
        journalId,
      },
    });

    return {
      receiptId,
      buyerId: params.buyerId,
      journalId,
      amountPaise: params.amountPaise.toString(),
      unsettledPayablesPaise: newUnsettled.toString(),
      paymentChannel: params.paymentChannel,
      referenceNo: params.referenceNo,
      idempotentReplay: false,
    };
  });
}

export async function reconcileSinglePayoutBatch(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
    batchId: string;
    rawBankUtr: unknown;
    confirmTotalPaise?: unknown;
  }
): Promise<ReconciledBatchSummary> {
  const batchRef = params.batchId.trim();
  if (!batchRef) throw new AppError('VALIDATION_ERROR', 'Payout batch ID is required', 400);

  const utrCheck = validateAndNormalizeBankUtr(params.rawBankUtr);
  if (!utrCheck.valid) throw new AppError('VALIDATION_ERROR', utrCheck.reason, 400);

  return db.transaction(async (tx) => {
    const batch = await lockPayoutBatchByRefInTx(tx, params.tenantId, batchRef);
    if (!batch) throw new AppError('NOT_FOUND', `Payout batch "${batchRef}" not found for tenant`, 404);
    if (batch.status !== 'GENERATED_CSV') {
      throw new AppError('CONFLICT', `Payout batch "${batch.batch_code}" is already in status ${batch.status}`, 409);
    }

    if (params.confirmTotalPaise !== undefined && params.confirmTotalPaise !== null) {
      let confirmedPaise: bigint;
      try {
        confirmedPaise = BigInt(String(params.confirmTotalPaise).trim());
      } catch {
        throw new AppError('VALIDATION_ERROR', 'confirmTotalPaise must be an integer paise string', 400);
      }
      if (confirmedPaise !== BigInt(batch.total_amount_paise)) {
        throw new AppError(
          'AMOUNT_MISMATCH',
          `confirmTotalPaise (${confirmedPaise.toString()}) does not match batch total (${batch.total_amount_paise}).`,
          422
        );
      }
    }

    const dupUtr = await findDuplicateBatchUtrInTx(tx, params.tenantId, utrCheck.normalizedUtr, batch.batch_id);
    if (dupUtr) {
      throw new AppError(
        'DUPLICATE_BANK_UTR',
        `Bank UTR "${utrCheck.normalizedUtr}" is already assigned to another payout batch in this harbour.`,
        409
      );
    }

    const nowIso = new Date().toISOString();
    const row = await updatePayoutBatchReconciledInTx(tx, {
      tenantId: params.tenantId,
      batchRef: batch.batch_id,
      byExactId: true,
      bankUtr: utrCheck.normalizedUtr,
      nowIso,
    });

    await enqueuePayoutReadyOutboxEventsInTx(tx, {
      tenantId: params.tenantId,
      batchId: batch.batch_id,
      batchCode: batch.batch_code,
      bankUtr: utrCheck.normalizedUtr,
      nowIso,
    });

    await auditInTx(tx, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionCode: 'PAYOUT_BATCH_UTR_RECONCILED',
      targetType: 'PAYOUT_BATCH',
      targetId: row!.batch_id,
      details: { actorName: params.actorFullName, batchCode: row!.batch_code, bankUtr: row!.bank_utr },
    });

    return { batchId: row!.batch_id, batchCode: row!.batch_code, status: row!.status, bankUtr: row!.bank_utr };
  });
}

export async function executeRobustBulkUtrReconcile(
  db: DbPort,
  params: {
    tenantId: string;
    actorUserId: string;
    actorRole: string;
    actorFullName: string;
    rawBody: Record<string, unknown> | null | undefined;
    headerIdempotencyKey?: string | null;
  }
): Promise<BulkReconcileResult> {
  const sanitized = sanitizeBulkReconcilePayload(params.rawBody, params.headerIdempotencyKey);
  if (sanitized.validItems.length === 0 && sanitized.rejectedItems.length === 0 && sanitized.clientInvalidItems.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'At least one mapped payout batch UTR row is required', 400);
  }

  const runCoreWork = async (tx: DbPort): Promise<BulkReconcileResult> => {
    const nowIso = new Date().toISOString();
    const reconciled: ReconciledBatchSummary[] = [];
    const invalidItems: SanitizedBulkInvalidItem[] = [...sanitized.clientInvalidItems, ...sanitized.rejectedItems];

    for (const item of sanitized.validItems) {
      const row = await updatePayoutBatchReconciledInTx(tx, {
        tenantId: params.tenantId,
        batchRef: item.batchId,
        byExactId: false,
        bankUtr: item.bankUtr,
        nowIso,
      });

      if (row) {
        reconciled.push({ batchId: row.batch_id, batchCode: row.batch_code, status: row.status, bankUtr: row.bank_utr });
      } else {
        invalidItems.push({
          batchCode: item.batchId,
          batchId: null,
          bankUtr: item.bankUtr,
          status: 'UNMATCHED_BATCH',
          reason: `No payout batch matched "${item.batchId}" in tenant ledger`,
        });
      }
    }

    if (reconciled.length === 0) {
      throw new AppError('VALIDATION_ERROR', invalidItems[0]?.reason ?? 'No matching payout batches were found to reconcile', 422);
    }

    const invalidOrUnmatchedCount = Math.max(invalidItems.length, Number(params.rawBody?.invalidOrUnmatchedCount ?? 0));
    const totalRowsParsed = Math.max(reconciled.length + invalidOrUnmatchedCount, sanitized.totalRowsParsed);

    const auditId = await auditInTx(tx, {
      tenantId: params.tenantId,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      actionCode: 'PAYOUT_BATCH_BULK_UTR_RECONCILED',
      targetType: 'PAYOUT_BATCH',
      targetId: `BULK-${reconciled.length}-BATCHES`,
      details: {
        actorName: params.actorFullName,
        sourceLabel: sanitized.sourceLabel,
        reconciledCount: reconciled.length,
        totalRowsParsed,
        invalidOrUnmatchedCount,
        duplicatesSkipped: sanitized.duplicatesSkipped,
        reconciled,
        invalidItems,
      },
    });

    return {
      auditId,
      timestampIso: new Date().toISOString(),
      sourceLabel: sanitized.sourceLabel,
      reconciledCount: reconciled.length,
      totalRowsParsed,
      invalidOrUnmatchedCount,
      duplicatesSkipped: sanitized.duplicatesSkipped,
      idempotentReplay: false,
      reconciled,
      invalidItems,
    } satisfies BulkReconcileResult;
  };

  return db.transaction(async (tx) => {
    if (sanitized.idempotencyKey) {
      const reqHash = computeCanonicalRequestHash({ validItems: sanitized.validItems, rejectedItems: sanitized.rejectedItems });
      const idemRes = await executeWithDbIdempotency<BulkReconcileResult & Record<string, unknown>>(
        tx,
        { tenantId: params.tenantId, scope: 'BULK_UTR_RECONCILE', key: sanitized.idempotencyKey, requestHash: reqHash },
        async () => ({ status: 200, body: (await runCoreWork(tx)) as BulkReconcileResult & Record<string, unknown> })
      );
      return idemRes.body;
    }
    return runCoreWork(tx);
  });
}

export async function handleBankNodalWebhook(
  db: DbPort,
  params: {
    rawBody: Partial<BankNodalWebhookPayload> & { simulateSigned?: boolean | undefined };
    signatureHeader: string;
    timestampHeader: string;
    idempotencyKeyHeader?: string | undefined;
  }
) {
  const body = params.rawBody ?? {};
  const tenantId = String(body.tenantId || DEMO_TENANT_ID).trim();
  const eventId = String(body.eventId || `EVT-NODAL-${crypto.randomUUID()}`).trim();
  const bankCode = String(body.bankCode || 'HMS-NODAL-GATEWAY').trim().toUpperCase();
  const timestampSec = typeof body.timestampSec === 'number' && body.timestampSec > 0 ? body.timestampSec : Math.floor(Date.now() / 1000);

  return withTenant(db, tenantId, async (tenantTx) => {
    let rawSettlements = Array.isArray(body.settlements) ? body.settlements : [];
    if (rawSettlements.length === 0) {
      const pendingRows = await listTenantPayoutBatchesInTx(tenantTx, tenantId);
      rawSettlements = pendingRows.map((b, idx) => ({
        batchCodeOrId: b.batch_code,
        bankUtr: `FDRL2611099988${String(idx + 10).padStart(2, '0')}`,
        channel: 'ISO20022_CAMT054' as const,
      }));
    }

    const webhookPayload: BankNodalWebhookPayload = { eventId, bankCode, tenantId, timestampSec, settlements: rawSettlements };
    let signatureHeader = params.signatureHeader;
    let timestampHeader = params.timestampHeader;

    if (config.DEMO_MODE && (body.simulateSigned || !signatureHeader)) {
      const signed = signBankNodalWebhookPayload(webhookPayload, config.QR_HMAC_SECRET);
      signatureHeader = signed.headers['X-HarbourOS-Webhook-Signature'];
      timestampHeader = signed.headers['X-HarbourOS-Webhook-Timestamp'];
    }

    const verification = verifyBankNodalWebhookSignature({
      payload: webhookPayload,
      signatureHeader,
      timestampHeader,
      webhookSecret: config.QR_HMAC_SECRET,
    });
    if (!verification.valid) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', verification.reason, 401);
    }

    const idempotencyKey = String(params.idempotencyKeyHeader || `${tenantId}:${eventId}`).trim();
    const requestHash = computeCanonicalRequestHash(webhookPayload);

    const idemRes = await executeWithDbIdempotency<Record<string, unknown>>(
      tenantTx,
      { tenantId, scope: 'BANK_NODAL_WEBHOOK', key: idempotencyKey, requestHash },
      async () => {
        const batchesRows = await listTenantPayoutBatchesInTx(tenantTx, tenantId);
        const matchedItems: Array<{ batchId: string; bankUtr: string }> = [];
        for (const s of webhookPayload.settlements) {
          const ref = s.batchCodeOrId.trim().toUpperCase();
          const found = batchesRows.find((b) => b.batch_code.toUpperCase() === ref || b.batch_id.toUpperCase() === ref);
          if (found) matchedItems.push({ batchId: found.batch_id, bankUtr: s.bankUtr.trim().toUpperCase() });
        }

        const reconciled =
          matchedItems.length > 0
            ? await executeRobustBulkUtrReconcile(tenantTx, {
                tenantId,
                actorUserId: 'SYSTEM-WEBHOOK',
                actorRole: 'ACCOUNTANT',
                actorFullName: `${bankCode} Nodal Gateway (Webhook)`,
                headerIdempotencyKey: `${idempotencyKey}:bulk`,
                rawBody: {
                  items: matchedItems,
                  sourceLabel: `${bankCode} Webhook (${eventId})`,
                  totalRowsParsed: webhookPayload.settlements.length,
                  invalidOrUnmatchedCount: webhookPayload.settlements.length - matchedItems.length,
                },
              })
            : {
                auditId: `AUD-WHK-${crypto.randomUUID()}`,
                timestampIso: new Date().toISOString(),
                sourceLabel: `${bankCode} Webhook (${eventId})`,
                reconciledCount: 0,
                reconciled: [],
              };

        invalidateLedgerAuditSqlLruCache(tenantId);

        return {
          status: 200,
          body: {
            webhookStatus: 'VERIFIED_AND_PROCESSED',
            sdkVersion: HARBOUROS_SDK_VERSION,
            idempotentReplay: false,
            eventId,
            bankCode,
            signatureVerified: true,
            timestampDriftSec: Math.abs(Math.floor(Date.now() / 1000) - timestampSec),
            reconciledCount: reconciled.reconciledCount,
            auditId: reconciled.auditId,
            reconciled: reconciled.reconciled,
          },
        };
      }
    );

    return idemRes.body;
  });
}
