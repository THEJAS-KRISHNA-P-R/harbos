import { PgPoolAdapter } from '../src/server/adapters/db-pg.ts';
import { PGliteAdapter } from '../src/server/adapters/db-pglite.ts';
import { config } from '../src/server/config.ts';
import {
  GENESIS_PREV_HASH,
  computeLedgerEntryHash,
} from '../src/shared/domain/ledger-hash.ts';
import { logger } from '../src/server/platform/logger.ts';
import type { DbPort } from '../src/server/ports/db.ts';

export interface ScaleFixtureOptions {
  readonly tenantCount?: number;
  readonly days?: number;
  readonly lotsPerTenantDay?: number;
}

export interface ScaleFixtureSummary {
  readonly tenantCount: number;
  readonly days: number;
  readonly lotsCreated: number;
  readonly allocationsCreated: number;
  readonly journalsCreated: number;
  readonly entriesCreated: number;
  readonly auditLogsCreated: number;
  readonly outboxEventsCreated: number;
  readonly payoutBatchesCreated: number;
  readonly elapsedMs: number;
}

/**
 * Multi-tenant realistic scale fixture generator (default: 10 tenants x 30 days x 70 lots/day).
 * Produces:
 * - 10 synthetic tenants (`scale-harbour-01` .. `scale-harbour-10`)
 * - 21,000 auction.lots
 * - 21,000 auction.sale_allocations
 * - 21,000 balanced ledger.journals
 * - 126,000 cryptographically valid SHA-256 hash-chained ledger.entries (> 100k scale target)
 * - 21,000 core.audit_logs & 21,000 sync.outbox_events
 * - 300 ledger.payout_batches, 3,000 ledger.payout_batch_items, 300 ledger.buyer_receipts
 * Followed by ANALYZE on all populated tables so PostgreSQL query plans reflect real scale.
 */
export async function seedScaleFixture(
  db: DbPort,
  options: ScaleFixtureOptions = {}
): Promise<ScaleFixtureSummary> {
  const tenantCount = options.tenantCount ?? 10;
  const days = options.days ?? 30;
  const lotsPerTenantDay = options.lotsPerTenantDay ?? 70;
  const startTime = Date.now();

  logger.info('Starting multi-tenant scale fixture generation', {
    tenantCount,
    days,
    lotsPerTenantDay,
    targetLots: tenantCount * days * lotsPerTenantDay,
    targetEntries: tenantCount * days * lotsPerTenantDay * 6,
  });

  const baseNowMs = Date.now();
  const msPerDay = 86_400_000;

  let lotsCreated = 0;
  let allocationsCreated = 0;
  let journalsCreated = 0;
  let entriesCreated = 0;
  let auditLogsCreated = 0;
  let outboxEventsCreated = 0;
  let payoutBatchesCreated = 0;

  const speciesTemplates = [
    { code: 'SEER', en: 'Seer Fish', ml: 'നെയ്മീൻ', sci: 'Scomberomorus commerson', floor: 52000 },
    { code: 'PRAW', en: 'Tiger Prawns', ml: 'കാരച്ചെമ്മീൻ', sci: 'Penaeus monodon', floor: 68000 },
    { code: 'TUNA', en: 'Yellowfin Tuna', ml: 'കേര', sci: 'Thunnus albacares', floor: 32000 },
    { code: 'MACK', en: 'Indian Mackerel', ml: 'അയല', sci: 'Rastrelliger kanagurta', floor: 21000 },
    { code: 'SARD', en: 'Oil Sardine', ml: 'മത്തി', sci: 'Sardinella longiceps', floor: 16000 },
  ];

  const statuses = [
    'FULLY_SOLD',
    'FULLY_SOLD',
    'FULLY_SOLD',
    'PARTIALLY_SOLD',
    'OPEN_FOR_AUCTION',
    'WEIGHED_PENDING_INSPECTION',
  ] as const;

  for (let t = 1; t <= tenantCount; t++) {
    const tPad = String(t).padStart(2, '0');
    const tenantId = `scale-harbour-${tPad}`;
    const shortCode = `SC${tPad}`;
    const policyId = `POL-${tenantId}-V1`;
    const societyId = `SOC-${tenantId}-01`;
    const sessionId = `SES-${tenantId}-01`;
    const hmsAccId = `ACC-HMS-${tenantId}`;
    const coopAccId = `ACC-COOP-${tenantId}`;
    const revAccId = `ACC-REV-${tenantId}`;
    const gstAccId = `ACC-GST-${tenantId}`;
    const bankAccId = `ACC-BANK-${tenantId}`;
    const auctAccId = `ACC-AUCT-${tenantId}-01`;
    const auctUserId = `USR-AUCT-${tenantId}-01`;
    const licId = `LIC-${tenantId}-01`;

    // Skip tenant if already fully seeded by a previous idempotent run
    const existingEntriesRes = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM ledger.entries WHERE tenant_id = $1`,
      [tenantId]
    );
    const existingEntries = Number(existingEntriesRes.rows[0]?.cnt ?? 0);
    const expectedEntries = days * lotsPerTenantDay * 6;
    if (existingEntries >= expectedEntries) {
      lotsCreated += days * lotsPerTenantDay;
      allocationsCreated += days * lotsPerTenantDay;
      journalsCreated += days * lotsPerTenantDay;
      entriesCreated += existingEntries;
      auditLogsCreated += days * lotsPerTenantDay;
      outboxEventsCreated += days * lotsPerTenantDay;
      payoutBatchesCreated += days;
      continue;
    }

    await db.transaction(async (tx) => {
      // 1. Tenant + Policy + Society + Session + System Accounts
      await tx.query(
        `INSERT INTO core.tenants (
          tenant_id, slug, short_code, name_en, name_ml, centre_type, floor_enforcement,
          active_policy_id, hms_account_id, coop_pool_account_id,
          harbouros_revenue_account_id, gst_payable_account_id
        ) VALUES ($1, $2, $3, $4, $5, 'KERALA_HARBOUR', 'WARN', $6, $7, $8, $9, $10)
        ON CONFLICT (tenant_id) DO NOTHING`,
        [
          tenantId,
          tenantId,
          shortCode,
          `Scale Harbour ${tPad}`,
          `സ്കെയിൽ ഹാർബർ ${tPad}`,
          policyId,
          hmsAccId,
          coopAccId,
          revAccId,
          gstAccId,
        ]
      );

      await tx.query(
        `INSERT INTO core.commission_policies (
          policy_id, tenant_id, version_num, commercial_mode, commission_bps,
          auctioneer_share_bps, hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
          institutional_tech_share_bps, buyer_fee_bps, gst_rate_bps,
          notification_ref, legal_basis_ref, effective_from
        ) VALUES ($1, $2, 1, 'FIXED_SAAS_ONLY', 500, 5000, 2000, 1500, 1500, 0, 100, 1800,
          'G.O.(P) SCALE-TEST', 'Act 16 of 2021', '2026-01-01T00:00:00.000Z')
        ON CONFLICT (policy_id) DO NOTHING`,
        [policyId, tenantId]
      );

      await tx.query(
        `INSERT INTO core.users (user_id, tenant_id, phone_e164, full_name, role, pin_code, entity_ref_id, is_active)
         VALUES ($1, $2, $3, $4, 'LICENSED_AUCTIONEER', '1234', $5, true)
         ON CONFLICT (user_id) DO NOTHING`,
        [auctUserId, tenantId, `+919800${tPad}0001`, `Scale Auctioneer ${tPad}`, licId]
      );

      await tx.query(
        `INSERT INTO harbour.coop_societies (society_id, tenant_id, name_en, name_ml, reg_no)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (society_id) DO NOTHING`,
        [societyId, tenantId, `Scale Co-op ${tPad}`, `സ്കെയിൽ സൊസൈറ്റി ${tPad}`, `KL-COOP-${tPad}`]
      );

      const sysAccounts = [
        [hmsAccId, 'HMS_FUND', '2200-HMS', 'HMS Management Fund', tenantId],
        [coopAccId, 'COOP_SOCIETY_FUND', '2300-COOP', 'Co-op Society Pool', societyId],
        [revAccId, 'HARBOUROS_REVENUE', '4100-REV', 'HarbourOS Platform Revenue', tenantId],
        [gstAccId, 'GST_PAYABLE', '2400-GST', 'GST Payable', tenantId],
        [bankAccId, 'BANK_CLEARING', '1100-BANK', 'Nodal Bank Clearing', tenantId],
        [auctAccId, 'AUCTIONEER_PAYABLE', '2150-AUCT', 'Auctioneer Commission Payable', licId],
      ] as const;

      for (const [accId, kind, code, nameEn, ownerId] of sysAccounts) {
        await tx.query(
          `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
           VALUES ($1, $2, $3, $4, $5, $6, 0)
           ON CONFLICT (account_id) DO NOTHING`,
          [accId, tenantId, kind, code, nameEn, ownerId]
        );
      }

      await tx.query(
        `INSERT INTO harbour.auctioneer_licences (
          licence_id, tenant_id, auctioneer_user_id, auctioneer_name, licence_no,
          status, valid_from, valid_until, deputed_by_society_id, payable_account_id
        ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', '2026-01-01', '2028-12-31', $6, $7)
        ON CONFLICT (licence_id) DO NOTHING`,
        [licId, tenantId, auctUserId, `Scale Auctioneer ${tPad}`, `LIC-SC-${tPad}`, societyId, auctAccId]
      );

      // 10 fishermen + 10 vessels + 10 buyers + 5 species per tenant
      const fishermenIds: string[] = [];
      const vesselIds: string[] = [];
      const fisherPayableAccs: string[] = [];
      const fisherBonusAccs: string[] = [];
      const buyerIds: string[] = [];
      const buyerRecvAccs: string[] = [];
      const speciesIds: string[] = [];

      for (let f = 1; f <= 10; f++) {
        const fPad = String(f).padStart(2, '0');
        const fishermanId = `FSH-${tenantId}-${fPad}`;
        const vesselId = `VES-${tenantId}-${fPad}`;
        const payAcc = `ACC-FSH-PAY-${tenantId}-${fPad}`;
        const bonusAcc = `ACC-FSH-BON-${tenantId}-${fPad}`;

        fishermenIds.push(fishermanId);
        vesselIds.push(vesselId);
        fisherPayableAccs.push(payAcc);
        fisherBonusAccs.push(bonusAcc);

        await tx.query(
          `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
           VALUES ($1, $2, 'FISHERMAN_PAYABLE', $3, $4, $5, 250000),
                  ($6, $2, 'FISHERMAN_BONUS_ESCROW', $7, $8, $5, 15000)
           ON CONFLICT (account_id) DO NOTHING`,
          [
            payAcc,
            tenantId,
            `2100-FSH-${fPad}`,
            `Fisherman ${fPad} Payable`,
            fishermanId,
            bonusAcc,
            `2110-BON-${fPad}`,
            `Fisherman ${fPad} Bonus Escrow`,
          ]
        );

        await tx.query(
          `INSERT INTO harbour.fishermen (
            fisherman_id, tenant_id, full_name, phone_e164, welfare_board_no,
            coop_society_id, payable_account_id, bonus_escrow_account_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (fisherman_id) DO NOTHING`,
          [
            fishermanId,
            tenantId,
            `Fisher ${tPad}-${fPad}`,
            `+919801${tPad}${fPad}01`,
            `KFWB-${tPad}-${fPad}`,
            societyId,
            payAcc,
            bonusAcc,
          ]
        );

        await tx.query(
          `INSERT INTO harbour.vessels (
            vessel_id, tenant_id, registration_no, vessel_name_en, vessel_name_ml,
            owner_fisherman_id, has_active_society_loan, loan_coop_society_id, qr_token
          ) VALUES ($1, $2, $3, $4, $5, $6, false, NULL, $7)
          ON CONFLICT (vessel_id) DO NOTHING`,
          [
            vesselId,
            tenantId,
            `IND-KL-${tPad}-MM-${fPad}`,
            `Sea Star ${tPad}-${fPad}`,
            `സീ സ്റ്റാർ ${tPad}-${fPad}`,
            fishermanId,
            `QR-VES-${tenantId}-${fPad}`,
          ]
        );
      }

      for (let b = 1; b <= 10; b++) {
        const bPad = String(b).padStart(2, '0');
        const buyerId = `BUY-${tenantId}-${bPad}`;
        const recvAcc = `ACC-BUY-REC-${tenantId}-${bPad}`;
        buyerIds.push(buyerId);
        buyerRecvAccs.push(recvAcc);

        await tx.query(
          `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
           VALUES ($1, $2, 'BUYER_RECEIVABLE', $3, $4, $5, 500000)
           ON CONFLICT (account_id) DO NOTHING`,
          [recvAcc, tenantId, `1200-BUY-${bPad}`, `Buyer ${bPad} Receivable`, buyerId]
        );

        await tx.query(
          `INSERT INTO harbour.buyers (
            buyer_id, tenant_id, buyer_name, paddle_no, gstin,
            escrow_balance_paise, approved_credit_paise, unsettled_payables_paise,
            active_holds_paise, receivable_account_id
          ) VALUES ($1, $2, $3, $4, $5, 10000000, 50000000, 500000, 0, $6)
          ON CONFLICT (buyer_id) DO NOTHING`,
          [buyerId, tenantId, `Seafood Exporter ${tPad}-${bPad}`, b, `32AABCS${tPad}${bPad}K1Z5`, recvAcc]
        );
      }

      for (let s = 0; s < speciesTemplates.length; s++) {
        const sp = speciesTemplates[s]!;
        const spId = `SP-${tenantId}-${sp.code}`;
        speciesIds.push(spId);
        await tx.query(
          `INSERT INTO harbour.species (
            species_id, tenant_id, code, name_en, name_ml, scientific_name, floor_price_paise_per_kg, export_eligible
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
          ON CONFLICT (species_id) DO NOTHING`,
          [spId, tenantId, sp.code, sp.en, sp.ml, sp.sci, sp.floor]
        );
      }

      await tx.query(
        `INSERT INTO auction.sessions (
          session_id, tenant_id, session_code, auction_mode, leader_device_id,
          fencing_token, lease_expires_at, status
        ) VALUES ($1, $2, $3, 'PHYSICAL_SHOUT', $4, 1, '2027-01-01T00:00:00.000Z', 'OPEN')
        ON CONFLICT (session_id) DO NOTHING`,
        [sessionId, tenantId, `SES-${shortCode}-01`, `DEV-${tenantId}-01`]
      );

      // 2. Prepare bulk arrays for 30 days x 70 lots/day = 2,100 lots, 2,100 allocations, 2,100 journals, 12,600 entries
      const lotIds: string[] = [];
      const lotCodes: string[] = [];
      const lotVesselIds: string[] = [];
      const lotFisherIds: string[] = [];
      const lotSpeciesIds: string[] = [];
      const lotAvailBoxes: number[] = [];
      const lotAvailGrams: string[] = [];
      const lotStatuses: string[] = [];
      const lotCreatedAts: string[] = [];

      const allocIds: string[] = [];
      const allocBuyerIds: string[] = [];
      const allocJournalIds: string[] = [];
      const allocIdempKeys: string[] = [];

      const journalDescs: string[] = [];

      const entrySeqs: string[] = [];
      const entryJournalIds: string[] = [];
      const entryAccountIds: string[] = [];
      const entryDirs: string[] = [];
      const entryAmounts: string[] = [];
      const entryPrevHashes: string[] = [];
      const entryRowHashes: string[] = [];
      const entryCreatedAts: string[] = [];

      const auditIds: string[] = [];
      const outboxIds: string[] = [];
      const outboxStatuses: string[] = [];
      const outboxNextAttempts: string[] = [];

      let seq = 0n;
      let prevHash = GENESIS_PREV_HASH;
      let lotCounter = 0;

      for (let d = days - 1; d >= 0; d--) {
        const dayBaseMs = baseNowMs - d * msPerDay;
        for (let l = 1; l <= lotsPerTenantDay; l++) {
          lotCounter += 1;
          const idxStr = String(lotCounter).padStart(5, '0');
          const createdAtIso = new Date(dayBaseMs + l * 15_000).toISOString();
          const fIdx = (lotCounter - 1) % 10;
          const bIdx = (lotCounter - 1) % 10;
          const sIdx = (lotCounter - 1) % speciesIds.length;
          const status = statuses[(lotCounter - 1) % statuses.length]!;

          const lotId = `LOT-${tenantId}-${idxStr}`;
          const lotCode = `${shortCode}-${String(d + 1).padStart(2, '0')}-${String(l).padStart(3, '0')}`;
          const allocId = `ALLOC-${tenantId}-${idxStr}`;
          const journalId = `JRN-${tenantId}-${idxStr}`;

          lotIds.push(lotId);
          lotCodes.push(lotCode);
          lotVesselIds.push(vesselIds[fIdx]!);
          lotFisherIds.push(fishermenIds[fIdx]!);
          lotSpeciesIds.push(speciesIds[sIdx]!);
          lotAvailBoxes.push(status === 'FULLY_SOLD' ? 0 : 4);
          lotAvailGrams.push(status === 'FULLY_SOLD' ? '0' : '160000');
          lotStatuses.push(status);
          lotCreatedAts.push(createdAtIso);

          allocIds.push(allocId);
          allocBuyerIds.push(buyerIds[bIdx]!);
          allocJournalIds.push(journalId);
          allocIdempKeys.push(`IDEMP-${tenantId}-${idxStr}`);
          journalDescs.push(`Scale sale allocation ${lotCode}`);

          // 6 balanced entries summing to 100,000 paise (D = 100,000, C = 94,000 + 1,000 + 2,500 + 1,500 + 1,000)
          const legs: ReadonlyArray<readonly [string, 'D' | 'C', bigint]> = [
            [buyerRecvAccs[bIdx]!, 'D', 100_000n],
            [fisherPayableAccs[fIdx]!, 'C', 94_000n],
            [fisherBonusAccs[fIdx]!, 'C', 1_000n],
            [auctAccId, 'C', 2_500n],
            [hmsAccId, 'C', 1_500n],
            [coopAccId, 'C', 1_000n],
          ];

          for (const [accId, dir, amt] of legs) {
            seq += 1n;
            const rowHash = computeLedgerEntryHash({
              tenantId,
              entrySeq: seq,
              prevRowHash: prevHash,
              journalId,
              accountId: accId,
              direction: dir,
              amountPaise: amt,
              createdAtUtcIsoMs: createdAtIso,
            });
            entrySeqs.push(seq.toString());
            entryJournalIds.push(journalId);
            entryAccountIds.push(accId);
            entryDirs.push(dir);
            entryAmounts.push(amt.toString());
            entryPrevHashes.push(prevHash);
            entryRowHashes.push(rowHash);
            entryCreatedAts.push(createdAtIso);
            prevHash = rowHash;
          }

          auditIds.push(`AUD-${tenantId}-${idxStr}`);
          outboxIds.push(`OUT-${tenantId}-${idxStr}`);
          const isPending = d === 0 && l > lotsPerTenantDay - 5;
          outboxStatuses.push(isPending ? 'PENDING' : 'DISPATCHED');
          outboxNextAttempts.push(createdAtIso);
        }
      }

      // Bulk insert auction.lots
      await tx.query(
        `INSERT INTO auction.lots (
          lot_id, tenant_id, lot_code, vessel_id, fisherman_id, species_id,
          sale_unit_type, total_boxes, available_boxes, net_grams, available_grams,
          core_temp_c, inspection_grade, inspection_notes, weight_source, qr_signature, status, created_at
        )
        SELECT
          u.lot_id, $1, u.lot_code, u.vessel_id, u.fisherman_id, u.species_id,
          'BOX', 10, u.avail_boxes, 400000, u.avail_grams,
          1.8, 'A_EXPORT', 'Scale fixture dockside landing', 'BLE_SCALE', 'sig-' || u.lot_id, u.status, u.created_at
        FROM unnest(
          $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
          $7::int[], $8::bigint[], $9::text[], $10::text[]
        ) AS u(lot_id, lot_code, vessel_id, fisherman_id, species_id, avail_boxes, avail_grams, status, created_at)
        ON CONFLICT (lot_id) DO NOTHING`,
        [
          tenantId,
          lotIds,
          lotCodes,
          lotVesselIds,
          lotFisherIds,
          lotSpeciesIds,
          lotAvailBoxes,
          lotAvailGrams,
          lotStatuses,
          lotCreatedAts,
        ]
      );

      // Bulk insert auction.sale_allocations
      await tx.query(
        `INSERT INTO auction.sale_allocations (
          allocation_id, tenant_id, lot_id, allocation_seq, session_id, auction_mode,
          policy_id, auctioneer_licence_id, buyer_id, boxes_allocated, grams_allocated,
          price_per_kg_paise, hammer_paise, buyer_payable_paise, fisherman_net_paise,
          bonus_escrow_paise, auctioneer_paise, hms_net_paise, coop_net_paise,
          harbouros_revenue_paise, gst_paise, floor_warning_triggered,
          idempotency_key, fencing_token, journal_id, server_latency_ms, created_at
        )
        SELECT
          u.alloc_id, $1, u.lot_id, 1, $2, 'PHYSICAL_SHOUT',
          $3, $4, u.buyer_id, 6, 240000,
          41667, 100000, 100000, 94000,
          1000, 2500, 1500, 1000,
          0, 0, false,
          u.idemp_key, 1, u.journal_id, 2, u.created_at
        FROM unnest(
          $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[]
        ) AS u(alloc_id, lot_id, buyer_id, idemp_key, journal_id, created_at)
        ON CONFLICT (allocation_id) DO NOTHING`,
        [
          tenantId,
          sessionId,
          policyId,
          licId,
          allocIds,
          lotIds,
          allocBuyerIds,
          allocIdempKeys,
          allocJournalIds,
          lotCreatedAts,
        ]
      );

      // Bulk insert ledger.journals
      await tx.query(
        `INSERT INTO ledger.journals (
          journal_id, tenant_id, reference_type, reference_id, description, total_amount_paise, created_at
        )
        SELECT
          u.journal_id, $1, 'SALE_ALLOCATION', u.alloc_id, u.descr, 100000, u.created_at
        FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS u(journal_id, alloc_id, descr, created_at)
        ON CONFLICT (journal_id) DO NOTHING`,
        [tenantId, allocJournalIds, allocIds, journalDescs, lotCreatedAts]
      );

      // Bulk insert ledger.entries (12,600 balanced & cryptographically chained rows per tenant)
      await tx.query(
        `INSERT INTO ledger.entries (
          entry_seq, tenant_id, journal_id, account_id, direction,
          amount_paise, prev_row_hash, row_hash, created_at_utc_iso_ms
        )
        SELECT
          u.entry_seq, $1, u.journal_id, u.account_id, u.direction,
          u.amount_paise, u.prev_row_hash, u.row_hash, u.created_at
        FROM unnest(
          $2::bigint[], $3::text[], $4::text[], $5::text[],
          $6::bigint[], $7::text[], $8::text[], $9::text[]
        ) AS u(entry_seq, journal_id, account_id, direction, amount_paise, prev_row_hash, row_hash, created_at)
        ON CONFLICT (tenant_id, entry_seq) DO NOTHING`,
        [
          tenantId,
          entrySeqs,
          entryJournalIds,
          entryAccountIds,
          entryDirs,
          entryAmounts,
          entryPrevHashes,
          entryRowHashes,
          entryCreatedAts,
        ]
      );

      await tx.query(
        `INSERT INTO ledger.heads (tenant_id, last_entry_seq, last_row_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id) DO UPDATE
         SET last_entry_seq = EXCLUDED.last_entry_seq, last_row_hash = EXCLUDED.last_row_hash`,
        [tenantId, seq.toString(), prevHash]
      );

      // Bulk insert core.audit_logs
      await tx.query(
        `INSERT INTO core.audit_logs (
          audit_id, tenant_id, actor_user_id, actor_role, action_code, target_type, target_id, details_json, created_at
        )
        SELECT
          u.audit_id, $1, $2, 'LICENSED_AUCTIONEER', 'SALE_ALLOCATED', 'ALLOCATION', u.alloc_id, '{"scaleFixture":true}', u.created_at
        FROM unnest($3::text[], $4::text[], $5::text[]) AS u(audit_id, alloc_id, created_at)
        ON CONFLICT (audit_id) DO NOTHING`,
        [tenantId, auctUserId, auditIds, allocIds, lotCreatedAts]
      );

      // Bulk insert sync.outbox_events
      await tx.query(
        `INSERT INTO sync.outbox_events (
          event_id, tenant_id, channel, recipient, template_code, payload_json, status, attempts, next_attempt_at, created_at
        )
        SELECT
          u.event_id, $1, 'SMS', u.fisherman_id, 'LOT_SOLD', '{"scaleFixture":true}', u.status, 0, u.next_attempt::timestamptz, u.created_at
        FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(event_id, fisherman_id, status, next_attempt, created_at)
        ON CONFLICT (event_id) DO NOTHING`,
        [tenantId, outboxIds, lotFisherIds, outboxStatuses, outboxNextAttempts, lotCreatedAts]
      );

      // Payout batches (1 per day = 30 batches, 10 items each = 300 items, + 30 buyer receipts per tenant)
      for (let d = 0; d < days; d++) {
        const dPad = String(d + 1).padStart(2, '0');
        const batchId = `PB-${tenantId}-${dPad}`;
        const batchCode = `PAY-${shortCode}-${dPad}`;
        const createdAtIso = new Date(baseNowMs - d * msPerDay).toISOString();
        const isReconciled = d > 1;
        await tx.query(
          `INSERT INTO ledger.payout_batches (
            batch_id, tenant_id, batch_code, beneficiary_kind, total_amount_paise,
            item_count, status, bank_utr, reconciled_at, created_at
          ) VALUES ($1, $2, $3, 'FISHERMAN_NET_SETTLEMENT', 1000000, 10, $4, $5, $6, $7)
          ON CONFLICT (batch_id) DO NOTHING`,
          [
            batchId,
            tenantId,
            batchCode,
            isReconciled ? 'RECONCILED_UTR' : 'GENERATED_CSV',
            isReconciled ? `UTR-${shortCode}-${dPad}` : null,
            isReconciled ? createdAtIso : null,
            createdAtIso,
          ]
        );

        for (let f = 0; f < 10; f++) {
          await tx.query(
            `INSERT INTO ledger.payout_batch_items (
              item_id, batch_id, tenant_id, fisherman_id, account_id, amount_paise
            ) VALUES ($1, $2, $3, $4, $5, 100000)
            ON CONFLICT (item_id) DO NOTHING`,
            [`PBI-${batchId}-${f + 1}`, batchId, tenantId, fishermenIds[f]!, fisherPayableAccs[f]!]
          );
        }

        const recId = `RCPT-${tenantId}-${dPad}`;
        const buyerIdx = d % 10;
        await tx.query(
          `INSERT INTO ledger.buyer_receipts (
            receipt_id, tenant_id, buyer_id, amount_paise, payment_reference,
            idempotency_key, journal_id, recorded_by_user_id, created_at
          ) VALUES ($1, $2, $3, 500000, $4, $5, $6, $7, $8)
          ON CONFLICT (receipt_id) DO NOTHING`,
          [
            recId,
            tenantId,
            buyerIds[buyerIdx]!,
            `NEFT-${shortCode}-${dPad}`,
            `IDEMP-RCPT-${tenantId}-${dPad}`,
            allocJournalIds[d]!,
            auctUserId,
            createdAtIso,
          ]
        );
      }

      lotsCreated += lotIds.length;
      allocationsCreated += allocIds.length;
      journalsCreated += allocJournalIds.length;
      entriesCreated += entrySeqs.length;
      auditLogsCreated += auditIds.length;
      outboxEventsCreated += outboxIds.length;
      payoutBatchesCreated += days;
    });
  }

  // Refresh PostgreSQL planner statistics on all populated tables
  const tablesToAnalyze = [
    'core.tenants',
    'core.users',
    'core.audit_logs',
    'harbour.fishermen',
    'harbour.vessels',
    'harbour.buyers',
    'harbour.species',
    'auction.lots',
    'auction.sale_allocations',
    'ledger.accounts',
    'ledger.heads',
    'ledger.journals',
    'ledger.entries',
    'ledger.payout_batches',
    'ledger.payout_batch_items',
    'ledger.buyer_receipts',
    'sync.outbox_events',
  ];
  for (const tbl of tablesToAnalyze) {
    await db.query(`ANALYZE ${tbl}`);
  }

  const elapsedMs = Date.now() - startTime;
  const summary: ScaleFixtureSummary = {
    tenantCount,
    days,
    lotsCreated,
    allocationsCreated,
    journalsCreated,
    entriesCreated,
    auditLogsCreated,
    outboxEventsCreated,
    payoutBatchesCreated,
    elapsedMs,
  };

  logger.info('Scale fixture generation & ANALYZE completed', { ...summary });
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tenantCount = Number(process.env.SCALE_TENANTS ?? process.argv[2] ?? 10);
  const days = Number(process.env.SCALE_DAYS ?? process.argv[3] ?? 30);
  const lotsPerTenantDay = Number(process.env.SCALE_LOTS_PER_DAY ?? process.argv[4] ?? 70);
  const dbUrl =
    process.env.DATABASE_PLATFORM_URL ||
    config.DATABASE_PLATFORM_URL ||
    process.env.DATABASE_URL ||
    config.DATABASE_URL;
  const db = dbUrl ? new PgPoolAdapter(dbUrl, 60_000) : new PGliteAdapter('memory://');

  seedScaleFixture(db, { tenantCount, days, lotsPerTenantDay })
    .then(async (res) => {
      console.log(
        `[scale-fixture] Seeded ${res.tenantCount} tenants x ${res.days} days: ` +
          `${res.lotsCreated} lots, ${res.allocationsCreated} allocations, ` +
          `${res.journalsCreated} journals, ${res.entriesCreated} ledger.entries, ` +
          `${res.auditLogsCreated} audit_logs, ${res.outboxEventsCreated} outbox_events, ` +
          `${res.payoutBatchesCreated} payout_batches in ${res.elapsedMs}ms`
      );
      if (db.close) await db.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[scale-fixture] FAILED:', err);
      if (db.close) await db.close();
      process.exit(1);
    });
}
