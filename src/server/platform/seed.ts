import fs from 'node:fs';
import path from 'node:path';
import type { DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { GENESIS_PREV_HASH, sha256HexUtf8 } from '@shared/domain/ledger-hash.ts';
import { allocateLotSale, signLotQrPayload } from '@server/platform/ledger-service.ts';

export const DEMO_TENANT_ID = 'munambam-demo';

export interface MigrationRecord {
  version: string;
  checksum: string;
  status: 'APPLIED' | 'VERIFIED';
}

export async function runSqlMigrations(
  db: DbPort
): Promise<{ appliedCount: number; migrations: MigrationRecord[] }> {
  const migDir = path.resolve(process.cwd(), 'db/migrations');
  const files = fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const records: MigrationRecord[] = [];
  let appliedCount = 0;

  for (const fileName of files) {
    const migrationPath = path.join(migDir, fileName);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const checksum = sha256HexUtf8(sql);

    await db.exec(sql);

    const existingMig = await db.query<{ version: string; checksum: string }>(
      `SELECT version, checksum FROM core.schema_migrations WHERE version = $1`,
      [fileName]
    );
    if (existingMig.rows.length === 0) {
      await db.query(
        `INSERT INTO core.schema_migrations (version, checksum) VALUES ($1, $2)`,
        [fileName, checksum]
      );
      appliedCount += 1;
      records.push({ version: fileName, checksum, status: 'APPLIED' });
    } else {
      records.push({ version: fileName, checksum, status: 'VERIFIED' });
    }
  }

  return { appliedCount, migrations: records };
}

export async function runMigrationsAndSeed(db: DbPort): Promise<void> {
  await runSqlMigrations(db);

  // Check if demo tenant is already seeded
  const tenantCheck = await db.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM core.tenants WHERE tenant_id = $1`,
    [DEMO_TENANT_ID]
  );
  if (tenantCheck.rows.length > 0) {
    await seedAuditLogsIfEmpty(db, DEMO_TENANT_ID);
    return;
  }

  const tId = DEMO_TENANT_ID;

  // 1. Insert Tenant & Default Policy (Mode A FIXED_SAAS_ONLY, Act 16 s.4(5)(a) 20/20/40/20 split)
  await db.query(
    `INSERT INTO core.tenants (
      tenant_id, slug, name_en, name_ml, centre_type, floor_enforcement,
      active_policy_id, hms_account_id, coop_pool_account_id,
      harbouros_revenue_account_id, gst_payable_account_id
    ) VALUES ($1, $2, $3, $4, 'KERALA_HARBOUR', 'WARN', 'POL-MUN-V1', 'ACC-HMS-MUN', 'ACC-COOP-MUN', 'ACC-REV-HOS', 'ACC-GST-HOS')`,
    [
      tId,
      'munambam-harbour',
      'Munambam Fishing Harbour (HMS)',
      'മുനമ്പം ഫിഷിംഗ് ഹാർബർ (HMS)', // TODO-REVIEW-ML
    ]
  );

  await db.query(
    `INSERT INTO core.commission_policies (
      policy_id, tenant_id, version_num, commercial_mode, commission_bps,
      auctioneer_share_bps, hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
      institutional_tech_share_bps, buyer_fee_bps, gst_rate_bps,
      notification_ref, legal_basis_ref, legal_signoff_ref, legal_signoff_date, effective_from
    ) VALUES (
      'POL-MUN-V1', $1, 1, 'FIXED_SAAS_ONLY', 500,
      2000, 2000, 4000, 2000,
      2000, 100, 1800,
      'GO(P) No. 18/2021/F&PD', 'Kerala Act 16 of 2021 s.4(4) & s.4(5)(a)', NULL, NULL, '2026-01-01'
    )`,
    [tId]
  );

  await db.query(
    `INSERT INTO ledger.heads (tenant_id, last_entry_seq, last_row_hash) VALUES ($1, 0, $2)`,
    [tId, GENESIS_PREV_HASH]
  );

  // 2. Insert Institutional Accounts
  const institutionalAccounts = [
    ['ACC-HMS-MUN', 'HMS_FUND', '2100-HMS', 'Munambam HMS Statutory 20% Fund', 'HMS-MUN'],
    ['ACC-COOP-MUN', 'COOP_SOCIETY_FUND', '2200-COOP', 'Primary Co-op Societies 20% Pool', 'SOC-MUN-01'],
    ['ACC-REV-HOS', 'HARBOUROS_REVENUE', '4000-HOS', 'HarbourOS Platform Revenue Account', 'HARBOUROS'],
    ['ACC-GST-HOS', 'GST_PAYABLE', '2400-GST', 'Output GST Payable (18% on Buyer Fee)', 'TAX-GST'],
  ] as const;

  for (const [accId, kind, code, name, owner] of institutionalAccounts) {
    await db.query(
      `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
       VALUES ($1, $2, $3, $4, $5, $6, 0)`,
      [accId, tId, kind, code, name, owner]
    );
  }

  // 3. Insert 8 Role Demo Personas
  const users = [
    ['USR-WEIGH-01', '+919447000001', 'Sajeev K. (Weighing Operator)', 'WEIGHING_OPERATOR', '1234', null],
    ['USR-AUCT-01', '+919447000002', 'K. Balakrishnan Nair (Deputed Auctioneer)', 'LICENSED_AUCTIONEER', '1234', 'LIC-MUN-001'],
    ['USR-BUYER-01', '+919447000003', 'Ramesh Menon (Apex Marine Exports)', 'WHOLESALE_BUYER', '1234', 'BUY-01'],
    ['USR-FISHER-01', '+919447000004', 'Antony Varghese (St. Antony II Owner)', 'FISHERMAN_BOAT_OWNER', '1234', 'FSH-01'],
    ['USR-INSP-01', '+919447000005', 'Dr.lekshmi R. (Food Safety & Quality Inspector)', 'AUTHORIZED_INSPECTOR', '1234', null],
    ['USR-HADMIN-01', '+919447000006', 'Capt. Mathew Thomas (Harbour Secretary)', 'HARBOUR_ADMIN', '2468', null],
    ['USR-ACCT-01', '+919447000007', 'Deepa Krishnan (HMS Chief Accountant)', 'ACCOUNTANT', '3579', null],
    ['USR-SUPER-01', '+919447000008', 'Thejas R. (Platform Super Admin)', 'SUPER_ADMIN', '9999', null],
  ] as const;

  for (const [uId, phone, name, role, pin, refId] of users) {
    await db.query(
      `INSERT INTO core.users (user_id, tenant_id, phone_e164, full_name, role, pin_code, entity_ref_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [uId, tId, phone, name, role, pin, refId]
    );
  }

  // 4. Insert 2 Co-op Societies
  await db.query(
    `INSERT INTO harbour.coop_societies (society_id, tenant_id, name_en, name_ml, reg_no) VALUES
     ('SOC-MUN-01', $1, 'Munambam Matsya Thozhilali Co-op Society', 'മുനമ്പം മത്സ്യത്തൊഴിലാളി സഹകരണ സംഘം', 'KL-EKM-F-104'),
     ('SOC-VYP-02', $1, 'Vypin Coastal Fishermen Co-op Society', 'വൈപ്പിൻ തീരദേശ മത്സ്യത്തൊഴിലാളി സംഘം', 'KL-EKM-F-219')`,
    [tId]
  );

  // 5. Insert Fishermen & Vessels (including Society-Loan Vessel s.4(8))
  const fishermen = [
    ['FSH-01', 'Antony Varghese', '+919447000004', 'KFWFB-EKM-8821', 'SOC-MUN-01'],
    ['FSH-02', 'Babu Karunakaran', '+919447000012', 'KFWFB-EKM-8845', 'SOC-MUN-01'],
    ['FSH-03', 'Xavier Joseph', '+919447000013', 'KFWFB-EKM-8902', 'SOC-VYP-02'],
    ['FSH-04', 'Shaji P.K.', '+919447000014', 'KFWFB-EKM-8950', 'SOC-VYP-02'],
  ] as const;

  for (const [fId, name, phone, wfNo, socId] of fishermen) {
    const payAcc = `ACC-FSH-PAY-${fId}`;
    const escAcc = `ACC-FSH-ESC-${fId}`;
    await db.query(
      `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise) VALUES
       ($1, $3, 'FISHERMAN_PAYABLE', $4, $5, $6, 0),
       ($2, $3, 'FISHERMAN_BONUS_ESCROW', $7, $8, $6, 0)`,
      [
        payAcc,
        escAcc,
        tId,
        `2010-${fId}`,
        `${name} — Net Settlement Payable (95%)`,
        fId,
        `2300-${fId}`,
        `${name} — Act 16 s.4(5) 40% Annual Bonus Escrow`,
      ]
    );
    await db.query(
      `INSERT INTO harbour.fishermen (fisherman_id, tenant_id, full_name, phone_e164, welfare_board_no, coop_society_id, payable_account_id, bonus_escrow_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [fId, tId, name, phone, wfNo, socId, payAcc, escAcc]
    );
  }

  const vessels = [
    ['VSL-01', 'IND-KL-07-MM-1104', 'St. Antony II', 'സെന്റ് ആന്റണി II', 'FSH-01', true, 'SOC-MUN-01', 'QR-VSL-1104'],
    ['VSL-02', 'IND-KL-07-MM-2048', 'Kadalamma', 'കടലമ്മ', 'FSH-02', false, null, 'QR-VSL-2048'],
    ['VSL-03', 'IND-KL-07-MM-3319', 'Sagar Rani', 'സാഗർ റാണി', 'FSH-03', false, null, 'QR-VSL-3319'],
    ['VSL-04', 'IND-KL-07-MM-4090', 'Vypin Star', 'വൈപ്പിൻ സ്റ്റാർ', 'FSH-04', true, 'SOC-VYP-02', 'QR-VSL-4090'],
  ] as const;

  for (const [vId, regNo, nameEn, nameMl, fId, hasLoan, loanSoc, qr] of vessels) {
    await db.query(
      `INSERT INTO harbour.vessels (vessel_id, tenant_id, registration_no, vessel_name_en, vessel_name_ml, owner_fisherman_id, has_active_society_loan, loan_coop_society_id, qr_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [vId, tId, regNo, nameEn, nameMl, fId, hasLoan, loanSoc, qr]
    );
  }

  // 6. Insert 3 Auctioneer Licences (1 active society-deputed, 1 active independent, 1 expired)
  const licences = [
    ['LIC-MUN-001', 'USR-AUCT-01', 'K. Balakrishnan Nair (Deputed - SOC-MUN-01)', 'KL-HMS-MUN-AUCT-2024-01', 'ACTIVE', '2024-04-01', '2028-03-31', 'SOC-MUN-01'],
    ['LIC-MUN-002', 'USR-AUCT-01', 'P. Sreedharan (Private Licensed)', 'KL-HMS-MUN-AUCT-2024-02', 'ACTIVE', '2024-04-01', '2027-12-31', null],
    ['LIC-MUN-003', 'USR-AUCT-01', 'M. Varghese (Expired Licence)', 'KL-HMS-MUN-AUCT-2022-09', 'EXPIRED', '2022-06-01', '2025-05-31', null],
  ] as const;

  for (const [lId, uId, name, licNo, status, vFrom, vUntil, depSoc] of licences) {
    const accId = `ACC-AUCT-${lId}`;
    await db.query(
      `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
       VALUES ($1, $2, 'AUCTIONEER_PAYABLE', $3, $4, $5, 0)`,
      [accId, tId, `2150-${lId}`, `${name} — 20% Commission Account`, lId]
    );
    await db.query(
      `INSERT INTO harbour.auctioneer_licences (licence_id, tenant_id, auctioneer_user_id, auctioneer_name, licence_no, status, valid_from, valid_until, deputed_by_society_id, payable_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [lId, tId, uId, name, licNo, status, vFrom, vUntil, depSoc, accId]
    );
  }

  // 7. Insert 6 Wholesale Buyers with Credit Limits
  const buyers = [
    ['BUY-01', 'Apex Marine Exports Pvt Ltd', 101, '32AABCA8812K1Z5', 'MPEDA/KL/EXP/1092', 2_500_000_00n, 5_000_000_00n],
    ['BUY-02', 'Cochin Seafoods & Cold Chain', 104, '32AAECC2401M1Z2', 'MPEDA/KL/EXP/1148', 1_200_000_00n, 3_500_000_00n],
    ['BUY-03', 'Malabar Pelagic Traders', 108, '32AADCM9910P1Z9', null, 800_000_00n, 1_500_000_00n],
    ['BUY-04', 'Kochi Harbour Wholesale Syndicate', 112, '32AAFKH4412D1Z1', null, 450_000_00n, 1_000_000_00n],
    ['BUY-05', 'BlueWater EU Export House', 115, '32AABCB7721Q1Z8', 'MPEDA/KL/EXP/1205', 3_000_000_00n, 6_000_000_00n],
    ['BUY-06', 'Vembanad Local Market Supplies', 119, '32AACCV3310R1Z4', null, 150_000_00n, 250_000_00n],
  ] as const;

  for (const [bId, name, paddle, gstin, expReg, escrow, credit] of buyers) {
    const recAcc = `ACC-BUY-${bId}`;
    await db.query(
      `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
       VALUES ($1, $2, 'BUYER_RECEIVABLE', $3, $4, $5, 0)`,
      [recAcc, tId, `1200-${bId}`, `${name} — Clearing Receivable`, bId]
    );
    await db.query(
      `INSERT INTO harbour.buyers (buyer_id, tenant_id, buyer_name, paddle_no, gstin, export_reg_no, escrow_balance_paise, approved_credit_paise, unsettled_payables_paise, active_holds_paise, receivable_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, $9)`,
      [bId, tId, name, paddle, gstin, expReg, escrow.toString(), credit.toString(), recAcc]
    );
  }

  // 8. Insert 8 Kerala Species with Malayalam names & Section 19 Floor Prices (paise/kg)
  const speciesList = [
    ['SPC-01', 'NEYMEEN', 'Seer Fish (King Mackerel)', 'നെയ്മീൻ (Neymeen)', 'Scomberomorus commerson', 680_00n, true],
    ['SPC-02', 'NARAN', 'Indian White Prawn', 'നാരൻ ചെമ്മീൻ (Naran Chemmeen)', 'Fenneropenaeus indicus', 520_00n, true],
    ['SPC-03', 'CHOORA', 'Yellowfin Tuna', 'ചൂര (Choora)', 'Thunnus albacares', 340_00n, true],
    ['SPC-04', 'KARIMEEN', 'Pearl Spot', 'കരിമീൻ (Karimeen)', 'Etroplus suratensis', 550_00n, false],
    ['SPC-05', 'AVOLI', 'Silver Pomfret', 'ആവോലി (Avoli)', 'Pampus argenteus', 720_00n, true],
    ['SPC-06', 'KOONTHAL', 'Indian Squid', 'കൂന്തൽ (Koonthal)', 'Uroteuthis duvaucelii', 290_00n, true],
    ['SPC-07', 'AYALA', 'Indian Mackerel', 'അയല (Ayala)', 'Rastrelliger kanagurta', 180_00n, false],
    ['SPC-08', 'MATHI', 'Indian Oil Sardine', 'മത്തി (Mathi)', 'Sardinella longiceps', 120_00n, false],
  ] as const;

  for (const [sId, code, nameEn, nameMl, sci, floorPaise, exp] of speciesList) {
    await db.query(
      `INSERT INTO harbour.species (species_id, tenant_id, code, name_en, name_ml, scientific_name, floor_price_paise_per_kg, export_eligible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sId, tId, code, nameEn, nameMl, sci, floorPaise.toString(), exp]
    );
  }

  // 9. Insert Lots
  const seedLots = [
    {
      lotId: 'LOT-2026-001',
      lotCode: 'MUN-261106-001',
      vesselId: 'VSL-01', // Society-loan vessel (SOC-MUN-01)
      fishermanId: 'FSH-01',
      speciesId: 'SPC-01', // Neymeen (floor ₹680/kg)
      totalBoxes: 10,
      netGrams: 250_000n, // 250 kg
      coreTempC: 1.8,
      grade: 'A_EXPORT',
      status: 'OPEN_FOR_AUCTION',
      createdAt: '2026-11-06T05:15:00.000Z',
    },
    {
      lotId: 'LOT-2026-002',
      lotCode: 'MUN-261106-002',
      vesselId: 'VSL-02',
      fishermanId: 'FSH-02',
      speciesId: 'SPC-02', // Naran Chemmeen (floor ₹520/kg)
      totalBoxes: 8,
      netGrams: 200_000n, // 200 kg
      coreTempC: 2.1,
      grade: 'A_EXPORT',
      status: 'OPEN_FOR_AUCTION',
      createdAt: '2026-11-06T05:25:00.000Z',
    },
    {
      lotId: 'LOT-2026-003',
      lotCode: 'MUN-261106-003',
      vesselId: 'VSL-03',
      fishermanId: 'FSH-03',
      speciesId: 'SPC-03', // Choora (floor ₹340/kg)
      totalBoxes: 12,
      netGrams: 360_000n, // 360 kg
      coreTempC: 1.5,
      grade: 'A_EXPORT',
      status: 'OPEN_FOR_AUCTION',
      createdAt: '2026-11-06T05:40:00.000Z',
    },
    {
      lotId: 'LOT-2026-004',
      lotCode: 'MUN-261106-004',
      vesselId: 'VSL-02',
      fishermanId: 'FSH-02',
      speciesId: 'SPC-05', // Avoli (floor ₹720/kg)
      totalBoxes: 6,
      netGrams: 150_000n, // 150 kg
      coreTempC: 2.0,
      grade: 'A_DOMESTIC',
      status: 'WEIGHED_PENDING_INSPECTION',
      createdAt: '2026-11-06T05:55:00.000Z',
    },
    {
      lotId: 'LOT-2026-005',
      lotCode: 'MUN-261106-005',
      vesselId: 'VSL-03',
      fishermanId: 'FSH-03',
      speciesId: 'SPC-08', // Mathi — graded REJECTED_UNFIT under s.21
      totalBoxes: 5,
      netGrams: 125_000n,
      coreTempC: 9.4,
      grade: 'REJECTED_UNFIT',
      status: 'BLOCKED_UNFIT',
      createdAt: '2026-11-06T06:05:00.000Z',
    },
  ] as const;

  for (const l of seedLots) {
    const qrSig = signLotQrPayload(l.lotId, l.vesselId, l.netGrams, config.QR_HMAC_SECRET);
    await db.query(
      `INSERT INTO auction.lots (
        lot_id, tenant_id, lot_code, vessel_id, fisherman_id, species_id,
        sale_unit_type, total_boxes, available_boxes, net_grams, available_grams,
        core_temp_c, inspection_grade, inspection_notes, inspected_by_user_id,
        weight_source, qr_signature, status, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        'BOX', $7, $7, $8, $8,
        $9, $10, $11, 'USR-INSP-01',
        'MANUAL', $12, $13, $14
      )`,
      [
        l.lotId,
        tId,
        l.lotCode,
        l.vesselId,
        l.fishermanId,
        l.speciesId,
        l.totalBoxes,
        l.netGrams.toString(),
        l.coreTempC,
        l.grade,
        l.grade === 'REJECTED_UNFIT'
          ? 'Core temp > 8C & gill discoloration — rejected under Act 16 s.21'
          : 'Organoleptic & core temperature check passed (Act 16 s.21)',
        qrSig,
        l.status,
        l.createdAt,
      ]
    );
  }

  // 10. Insert Active Auction Session
  await db.query(
    `INSERT INTO auction.sessions (
      session_id, tenant_id, session_code, auction_mode, active_lot_id,
      leader_device_id, fencing_token, lease_expires_at,
      dutch_start_price_paise, dutch_floor_price_paise, status
    ) VALUES (
      'SES-MUN-MORNING-01', $1, 'PIT-01-MORNING', 'PHYSICAL_SHOUT', 'LOT-2026-001',
      'TAB-PIT-01', 10, '2026-12-31T23:59:59.000Z',
      78000, 68000, 'OPEN'
    )`,
    [tId]
  );

  // 11. Execute 2 Real Seeded Sale Allocations so the ledger has real balanced journals & SHA-256 chain
  await allocateLotSale(db, {
    tenantId: tId,
    lotId: 'LOT-2026-001',
    sessionId: 'SES-MUN-MORNING-01',
    auctionMode: 'PHYSICAL_SHOUT',
    auctioneerLicenceId: 'LIC-MUN-001', // Deputed by SOC-MUN-01 (matches VSL-01 loan!)
    buyerId: 'BUY-01',
    boxesRequested: 4, // Partial allocation of 4 out of 10 boxes (100 kg @ ₹740/kg = ₹74,000)
    pricePerKgPaise: 740_00n,
    idempotencyKey: 'SEED-ALLOC-001',
    fencingToken: 10,
    nowIso: '2026-11-06T05:30:00.000Z',
  });

  await allocateLotSale(db, {
    tenantId: tId,
    lotId: 'LOT-2026-002',
    sessionId: 'SES-MUN-MORNING-01',
    auctionMode: 'HYBRID_REMOTE',
    auctioneerLicenceId: 'LIC-MUN-002',
    buyerId: 'BUY-02',
    boxesRequested: 8, // Full 8 boxes (200 kg @ ₹550/kg = ₹1,10,000)
    pricePerKgPaise: 550_00n,
    idempotencyKey: 'SEED-ALLOC-002',
    fencingToken: 10,
    nowIso: '2026-11-06T05:38:00.000Z',
  });

  // 12. Seed 1 Pending Dual-Key Reversal Request & 1 Generated Payout Batch
  await db.query(
    `INSERT INTO ledger.reversal_requests (
      reversal_id, tenant_id, original_journal_id, reason_note,
      requested_by_user_id, requested_by_name, status, created_at
    ) VALUES (
      'REV-REQ-001', $1, 'JRN-ALLOC-MUN-261106-001-1',
      'Paddle number keystroke correction requested by Pit Clerk (requires Harbour Admin second key)',
      'USR-ACCT-01', 'Deepa Krishnan (Accountant)', 'PENDING_SECOND_APPROVAL', '2026-11-06T06:10:00.000Z'
    )`,
    [tId]
  );

  await db.query(
    `INSERT INTO ledger.payout_batches (
      batch_id, tenant_id, batch_code, beneficiary_kind,
      total_amount_paise, item_count, status, bank_utr, reconciled_at, created_at
    ) VALUES (
      'BATCH-20261106-01', $1, 'MUN-PAY-20261106-01', 'FISHERMAN_NET_SETTLEMENT',
      17480000, 2, 'GENERATED_CSV', NULL, NULL, '2026-11-06T06:15:00.000Z'
    )`,
    [tId]
  );

  await seedAuditLogsIfEmpty(db, tId);
}

async function seedAuditLogsIfEmpty(db: DbPort, tenantId: string): Promise<void> {
  const existing = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM core.audit_logs WHERE tenant_id = $1`,
    [tenantId]
  );
  if ((existing.rows[0]?.cnt ?? 0) > 0) {
    return;
  }

  const seedAudits = [
    [
      'AUD-20261106-001',
      tenantId,
      'USR-WEIGH-01',
      'WEIGHING_OPERATOR',
      'LOT_WEIGHED_AND_TAGGED',
      'LOT',
      'LOT-2026-001',
      JSON.stringify({
        actorName: 'Sajeev K. (Weighing Operator)',
        lotCode: 'MUN-261106-001',
        vesselId: 'VSL-01',
        netGrams: '250000',
        weightSource: 'BLE_SCALE',
      }),
      '2026-11-06T05:15:12.000Z',
    ],
    [
      'AUD-20261106-002',
      tenantId,
      'USR-AUCT-01',
      'LICENSED_AUCTIONEER',
      'LOT_ALLOCATED_AND_CLEARED',
      'ALLOCATION',
      'ALC-MUN-261106-001-1',
      JSON.stringify({
        actorName: 'K. Balakrishnan Nair (Deputed Auctioneer)',
        lotId: 'LOT-2026-001',
        buyerId: 'BUY-01',
        hammerPaise: '7400000',
        societyLoanRouted: true,
      }),
      '2026-11-06T05:30:05.000Z',
    ],
    [
      'AUD-20261106-003',
      tenantId,
      'USR-AUCT-01',
      'LICENSED_AUCTIONEER',
      'LOT_ALLOCATED_AND_CLEARED',
      'ALLOCATION',
      'ALC-MUN-261106-002-1',
      JSON.stringify({
        actorName: 'P. Sreedharan (Private Licensed)',
        lotId: 'LOT-2026-002',
        buyerId: 'BUY-02',
        hammerPaise: '11000000',
        auctionMode: 'HYBRID_REMOTE',
      }),
      '2026-11-06T05:38:04.000Z',
    ],
    [
      'AUD-20261106-004',
      tenantId,
      'USR-INSP-01',
      'AUTHORIZED_INSPECTOR',
      'QUALITY_INSPECTION_REJECTED_S21',
      'LOT',
      'LOT-2026-005',
      JSON.stringify({
        actorName: 'Dr. Lekshmi R. (Food Safety & Quality Inspector)',
        grade: 'REJECTED_UNFIT',
        coreTempC: 9.4,
        statutoryRef: 'Act 16 of 2021 s.21',
      }),
      '2026-11-06T06:05:22.000Z',
    ],
    [
      'AUD-20261106-005',
      tenantId,
      'USR-ACCT-01',
      'ACCOUNTANT',
      'REVERSAL_REQUESTED_KEY1',
      'REVERSAL',
      'REV-REQ-001',
      JSON.stringify({
        actorName: 'Deepa Krishnan (HMS Chief Accountant)',
        originalJournalId: 'JRN-ALLOC-MUN-261106-001-1',
        reason: 'Paddle number keystroke correction requested by Pit Clerk',
      }),
      '2026-11-06T06:10:00.000Z',
    ],
    [
      'AUD-20261106-006',
      tenantId,
      'USR-HADMIN-01',
      'HARBOUR_ADMIN',
      'FLOOR_SCHEDULE_VERIFIED_S19',
      'SPECIES',
      'SPC-01',
      JSON.stringify({
        actorName: 'Capt. Mathew Thomas (Harbour Secretary)',
        floorEnforcement: 'WARN',
        floorPricePaisePerKg: '68000',
      }),
      '2026-11-06T06:12:30.000Z',
    ],
    [
      'AUD-20261106-007',
      tenantId,
      'USR-ACCT-01',
      'ACCOUNTANT',
      'PAYOUT_BATCH_GENERATED',
      'PAYOUT_BATCH',
      'BATCH-20261106-01',
      JSON.stringify({
        actorName: 'Deepa Krishnan (HMS Chief Accountant)',
        batchCode: 'MUN-PAY-20261106-01',
        totalAmountPaise: '17480000',
      }),
      '2026-11-06T06:15:00.000Z',
    ],
    [
      'AUD-20261105-UTR-02',
      tenantId,
      'USR-ACCT-01',
      'ACCOUNTANT',
      'PAYOUT_BATCH_BULK_UTR_RECONCILED',
      'PAYOUT_BATCH',
      'BULK-2-BATCHES',
      JSON.stringify({
        actorName: 'Deepa Krishnan (HMS Chief Accountant)',
        sourceLabel: 'FederalBank-Nodal-Evening-261105.csv',
        reconciledCount: 2,
        totalRowsParsed: 2,
        invalidOrUnmatchedCount: 0,
        reconciled: [
          {
            batchId: 'BATCH-20261105-02',
            batchCode: 'MUN-PAY-20261105-02',
            status: 'RECONCILED_UTR',
            bankUtr: 'FDRL261105884201',
          },
          {
            batchId: 'BATCH-20261105-03',
            batchCode: 'MUN-PAY-20261105-03',
            status: 'RECONCILED_UTR',
            bankUtr: 'FDRL261105884202',
          },
        ],
      }),
      '2026-11-05T18:42:10.000Z',
    ],
    [
      'AUD-20261105-UTR-01',
      tenantId,
      'USR-ACCT-01',
      'ACCOUNTANT',
      'PAYOUT_BATCH_BULK_UTR_RECONCILED',
      'PAYOUT_BATCH',
      'BULK-1-BATCHES',
      JSON.stringify({
        actorName: 'Deepa Krishnan (HMS Chief Accountant)',
        sourceLabel: 'SBI-Nodal-Morning-261105.csv',
        reconciledCount: 1,
        totalRowsParsed: 2,
        invalidOrUnmatchedCount: 1,
        reconciled: [
          {
            batchId: 'BATCH-20261105-01',
            batchCode: 'MUN-PAY-20261105-01',
            status: 'RECONCILED_UTR',
            bankUtr: 'SBIN000261105719',
          },
        ],
        invalidItems: [
          {
            batchCode: 'MUN-PAY-20261105-02',
            batchId: 'BATCH-20261105-02',
            bankUtr: 'SB09',
            status: 'INVALID_UTR',
            reason: 'Bank UTR must be at least 6 characters (received 4 chars)',
          },
        ],
      }),
      '2026-11-05T11:20:45.000Z',
    ],
  ] as const;

  for (const [audId, tIdVal, actorId, role, actionCode, targetType, targetId, detailsJson, createdAt] of seedAudits) {
    await db.query(
      `INSERT INTO core.audit_logs (
        audit_id, tenant_id, actor_user_id, actor_role, action_code,
        target_type, target_id, details_json, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [audId, tIdVal, actorId, role, actionCode, targetType, targetId, detailsJson, createdAt]
    );
  }
}

