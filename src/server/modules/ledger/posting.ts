import crypto from 'node:crypto';
import { type DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import {
  GENESIS_PREV_HASH,
  computeLedgerEntryHash,
  buildReversalJournalEntries,
  type JournalEntryDraft,
} from '@shared/domain/ledger-hash.ts';
import {
  fetchJournalEntriesForReversalInTx,
  insertEntryAndUpdateAccountInTx,
  insertJournalRowInTx,
  lockAccountsSortedInTx,
  lockReversalRequestInTx,
  lockTenantHeadInTx,
  markReversalExecutedInTx,
  updateTenantHeadInTx,
} from './repo.ts';

export function signLotQrPayload(
  lotId: string,
  vesselId: string,
  netGrams: bigint,
  secret: string
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${lotId}|${vesselId}|${netGrams.toString()}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Posts a balanced double-entry journal inside an active transaction (`tx`).
 * Enforces Phase 2.7 lock ordering:
 *   1. Involved `ledger.accounts` rows locked in ascending `account_id` order (`FOR UPDATE`)
 *   2. Tenant `ledger.heads` row locked `FOR UPDATE` LAST
 */
export async function postJournalInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    journalId: string;
    referenceType:
      | 'SALE_ALLOCATION'
      | 'REVERSAL'
      | 'PAYOUT_BATCH'
      | 'BONUS_RELEASE'
      | 'BUYER_RECEIPT';
    referenceId: string;
    description: string;
    entries: ReadonlyArray<JournalEntryDraft>;
    createdAtIso: string;
    reversesJournalId?: string;
    authorizedByUser1?: string;
    authorizedByUser2?: string;
    reasonNote?: string;
  }
): Promise<{ journalId: string; lastEntrySeq: bigint; lastRowHash: string }> {
  if (params.entries.length < 2) {
    throw new AppError(
      'UNBALANCED_LEDGER_ENTRY',
      'Journal requires at least 2 entries',
      400
    );
  }

  let sumD = 0n;
  let sumC = 0n;
  for (const e of params.entries) {
    if (e.amountPaise <= 0n) {
      throw new AppError(
        'UNBALANCED_LEDGER_ENTRY',
        'Entry amount_paise must be > 0',
        400
      );
    }
    if (e.direction === 'D') sumD += e.amountPaise;
    else sumC += e.amountPaise;
  }

  if (sumD !== sumC) {
    throw new AppError(
      'UNBALANCED_LEDGER_ENTRY',
      `Double-entry violation: Debits (${sumD.toString()}) !== Credits (${sumC.toString()})`,
      400
    );
  }

  // Phase 2.7: Lock accounts in deterministic ascending ID order BEFORE locking tenant head
  const accountMap = await lockAccountsSortedInTx(
    tx,
    params.tenantId,
    params.entries.map((e) => e.accountId)
  );

  // Lock tenant head row FOR UPDATE LAST to serialize SHA-256 chain sequence numbers
  const head = await lockTenantHeadInTx(
    tx,
    params.tenantId,
    GENESIS_PREV_HASH
  );
  let currentSeq = head.currentSeq;
  let prevHash = head.prevHash;

  await insertJournalRowInTx(tx, {
    journalId: params.journalId,
    tenantId: params.tenantId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    description: params.description,
    reversesJournalId: params.reversesJournalId ?? null,
    authorizedByUser1: params.authorizedByUser1 ?? null,
    authorizedByUser2: params.authorizedByUser2 ?? null,
    reasonNote: params.reasonNote ?? null,
    totalAmountPaise: sumD.toString(),
    createdAtIso: params.createdAtIso,
  });

  for (const entry of params.entries) {
    currentSeq += 1n;
    const rowHash = computeLedgerEntryHash({
      tenantId: params.tenantId,
      entrySeq: currentSeq,
      prevRowHash: prevHash,
      journalId: params.journalId,
      accountId: entry.accountId,
      direction: entry.direction,
      amountPaise: entry.amountPaise,
      createdAtUtcIsoMs: params.createdAtIso,
    });

    const acct = accountMap.get(entry.accountId);
    let newBalanceStr: string | null = null;
    if (acct) {
      const isDebitNormal =
        acct.kind === 'BUYER_RECEIVABLE' || acct.kind === 'BANK_CLEARING';
      const delta =
        (isDebitNormal && entry.direction === 'D') ||
        (!isDebitNormal && entry.direction === 'C')
          ? entry.amountPaise
          : -entry.amountPaise;
      const updatedBal = acct.balancePaise + delta;
      acct.balancePaise = updatedBal;
      newBalanceStr = updatedBal.toString();
    }

    await insertEntryAndUpdateAccountInTx(tx, {
      entrySeq: currentSeq.toString(),
      tenantId: params.tenantId,
      journalId: params.journalId,
      accountId: entry.accountId,
      direction: entry.direction,
      amountPaise: entry.amountPaise.toString(),
      prevRowHash: prevHash,
      rowHash,
      createdAtIso: params.createdAtIso,
      newBalancePaise: newBalanceStr,
    });

    prevHash = rowHash;
  }

  await updateTenantHeadInTx(
    tx,
    params.tenantId,
    currentSeq.toString(),
    prevHash
  );

  return {
    journalId: params.journalId,
    lastEntrySeq: currentSeq,
    lastRowHash: prevHash,
  };
}

export async function executeDualKeyReversal(
  db: DbPort,
  params: {
    tenantId: string;
    reversalId: string;
    approverUserId: string;
    approverName: string;
    nowIso: string;
  }
): Promise<{ compensatingJournalId: string }> {
  return db.transaction(async (tx) => {
    const rev = await lockReversalRequestInTx(
      tx,
      params.tenantId,
      params.reversalId
    );
    if (!rev) {
      throw new AppError('NOT_FOUND', 'Reversal request not found', 404);
    }
    if (rev.status !== 'PENDING_SECOND_APPROVAL') {
      throw new AppError(
        'CONFLICT',
        'Reversal request is already executed',
        409
      );
    }
    if (rev.requested_by_user_id === params.approverUserId) {
      throw new AppError(
        'FORBIDDEN',
        'Dual-key control violation (§7 Reversals): Second authorizing user must differ from requesting user.',
        422
      );
    }

    const origEntriesRows = await fetchJournalEntriesForReversalInTx(
      tx,
      params.tenantId,
      rev.original_journal_id
    );

    const originalDrafts: JournalEntryDraft[] = origEntriesRows.map((r) => ({
      accountId: r.account_id,
      direction: r.direction,
      amountPaise: BigInt(r.amount_paise),
    }));

    const compensatingEntries = buildReversalJournalEntries(originalDrafts);
    const compensatingJournalId = `JRN-REV-${params.reversalId}`;

    await postJournalInTx(tx, {
      tenantId: params.tenantId,
      journalId: compensatingJournalId,
      referenceType: 'REVERSAL',
      referenceId: params.reversalId,
      description: `Dual-key compensating reversal of ${rev.original_journal_id}: ${rev.reason_note}`,
      entries: compensatingEntries,
      createdAtIso: params.nowIso,
      reversesJournalId: rev.original_journal_id,
      authorizedByUser1: rev.requested_by_user_id,
      authorizedByUser2: params.approverUserId,
      reasonNote: rev.reason_note,
    });

    await markReversalExecutedInTx(tx, {
      tenantId: params.tenantId,
      reversalId: params.reversalId,
      approverUserId: params.approverUserId,
      approverName: params.approverName,
      compensatingJournalId,
    });

    return { compensatingJournalId };
  });
}
