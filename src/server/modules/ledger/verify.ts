import type { DbPort } from '@server/ports/db.ts';
import {
  GENESIS_PREV_HASH,
  computeLedgerEntryHash,
} from '@shared/domain/ledger-hash.ts';
import {
  fetchEntriesPage,
  fetchEntryCountAndAnchorRow,
  fetchLatestAnchor,
} from './repo.ts';

/**
 * Phase 2.9: Streaming SHA-256 chain verifier.
 * Pages `ledger.entries` by `entry_seq` in batches (default 5,000 rows) with O(1) memory,
 * and optionally resumes from the latest verified row in `ledger.daily_anchors`.
 */
export async function verifyTenantLedgerChain(
  db: DbPort,
  tenantId: string,
  options?: {
    batchSize?: number;
    useLatestAnchor?: boolean;
  }
): Promise<{
  verified: boolean;
  entryCount: number;
  lastEntrySeq: string;
  headHash: string;
  resumedFromAnchorSeq?: string;
  failedAtSeq?: string;
  failureReason?: string;
}> {
  const batchSize = Math.max(1, options?.batchSize ?? 5_000);
  let cursorSeq = 0n;
  let expectedPrev = GENESIS_PREV_HASH;
  let lastSeq = '0';
  let totalEntriesCount = 0;
  let resumedFromAnchorSeq: string | undefined;

  if (options?.useLatestAnchor !== false) {
    const anchor = await fetchLatestAnchor(db, tenantId);
    if (anchor && BigInt(anchor.last_entry_seq) > 0n) {
      const anchorSeq = BigInt(anchor.last_entry_seq);
      const check = await fetchEntryCountAndAnchorRow(db, tenantId, anchorSeq);
      if (check.anchorRowHash === anchor.head_hash) {
        cursorSeq = anchorSeq;
        expectedPrev = anchor.head_hash;
        lastSeq = anchor.last_entry_seq;
        totalEntriesCount = check.priorCount;
        resumedFromAnchorSeq = anchor.last_entry_seq;
      } else {
        return {
          verified: false,
          entryCount: check.priorCount,
          lastEntrySeq: anchor.last_entry_seq,
          headHash: anchor.head_hash,
          failedAtSeq: anchor.last_entry_seq,
          failureReason: `Daily anchor head_hash mismatch at seq ${anchor.last_entry_seq}`,
        };
      }
    }
  }

  for (;;) {
    const page = await fetchEntriesPage(db, tenantId, cursorSeq, batchSize);
    if (page.length === 0) {
      break;
    }

    for (const row of page) {
      totalEntriesCount += 1;
      if (row.prev_row_hash !== expectedPrev) {
        return {
          verified: false,
          entryCount: totalEntriesCount,
          lastEntrySeq: lastSeq,
          headHash: expectedPrev,
          failedAtSeq: String(row.entry_seq),
          failureReason: `prev_row_hash mismatch at seq ${String(row.entry_seq)}`,
        };
      }

      const recomputed = computeLedgerEntryHash({
        tenantId,
        entrySeq: BigInt(row.entry_seq),
        prevRowHash: row.prev_row_hash,
        journalId: row.journal_id,
        accountId: row.account_id,
        direction: row.direction,
        amountPaise: BigInt(row.amount_paise),
        createdAtUtcIsoMs: row.created_at_utc_iso_ms,
      });

      if (recomputed !== row.row_hash) {
        return {
          verified: false,
          entryCount: totalEntriesCount,
          lastEntrySeq: lastSeq,
          headHash: expectedPrev,
          failedAtSeq: String(row.entry_seq),
          failureReason: `SHA-256 digest mismatch at seq ${String(row.entry_seq)}`,
        };
      }

      expectedPrev = row.row_hash;
      lastSeq = String(row.entry_seq);
      cursorSeq = BigInt(row.entry_seq);
    }

    if (page.length < batchSize) {
      break;
    }
  }

  return {
    verified: true,
    entryCount: totalEntriesCount,
    lastEntrySeq: lastSeq,
    headHash: expectedPrev,
    ...(resumedFromAnchorSeq ? { resumedFromAnchorSeq } : {}),
  };
}
