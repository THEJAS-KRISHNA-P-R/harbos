import test from 'node:test';
import assert from 'node:assert/strict';
import type { BootstrapData } from '../../src/web/lib/api.ts';
import {
  buildWorkspaceExportDataset,
  sanitizePdfText,
  serializeDatasetToCsv,
  serializeDatasetToPdfBytes,
} from '../../src/web/lib/workspace-export.ts';

function makeMockBootstrap(): BootstrapData {
  return {
    tenant: {
      tenant_id: 'TEN-MUN',
      slug: 'munambam-hms',
      name_en: 'Munambam Fishing Harbour (HMS)',
      name_ml: 'Munambam',
      centre_type: 'KERALA_HARBOUR',
      floor_enforcement: 'WARN',
      active_policy_id: 'POL-01',
    },
    allTenants: [
      {
        tenant_id: 'TEN-MUN',
        slug: 'munambam-hms',
        name_en: 'Munambam Fishing Harbour (HMS)',
        name_ml: 'Munambam',
        centre_type: 'KERALA_HARBOUR',
        floor_enforcement: 'WARN',
        active_policy_id: 'POL-01',
      },
    ],
    policies: [],
    users: [],
    fishermen: [],
    vessels: [
      {
        vessel_id: 'VSL-01',
        registration_no: 'IND-KL-07-MM-1104',
        vessel_name_en: 'St. Antony II',
        vessel_name_ml: 'St. Antony II',
        owner_fisherman_id: 'FSH-01',
        has_active_society_loan: true,
        loan_coop_society_id: 'SOC-MUN-01',
        qr_token: 'QR-VSL-01',
      },
    ],
    licences: [],
    buyers: [
      {
        buyer_id: 'BYR-01',
        buyer_name: 'Kochi Seafoods, Export Co.',
        paddle_no: 101,
        gstin: '32AAACK1234A1Z5',
        export_reg_no: 'MPEDA-KL-99',
        escrow_balance_paise: '50000000',
        approved_credit_paise: '25000000',
        unsettled_payables_paise: '1200000',
        active_holds_paise: '0',
        receivable_account_id: 'ACC-BYR-01',
      },
    ],
    species: [
      {
        species_id: 'SPC-01',
        code: 'AVOLI',
        name_en: 'Silver Pomfret',
        name_ml: 'Avoli',
        scientific_name: 'Pampus argenteus',
        floor_price_paise_per_kg: '72000',
        export_eligible: true,
      },
    ],
    lots: [
      {
        lot_id: 'LOT-01',
        lot_code: 'MUN-261125-001',
        vessel_id: 'VSL-01',
        fisherman_id: 'FSH-01',
        species_id: 'SPC-01',
        sale_unit_type: 'BOX',
        total_boxes: 10,
        available_boxes: 6,
        net_grams: '250000',
        available_grams: '150000',
        core_temp_c: 1.8,
        inspection_grade: 'A_EXPORT',
        inspection_notes: 'Firm flesh, clear eyes',
        weight_source: 'BLE_SCALE',
        qr_signature: 'abcdef123456',
        status: 'PARTIALLY_SOLD',
        created_at: '2026-11-25T08:00:00.000Z',
      },
    ],
    allocations: [
      {
        allocation_id: 'ALC-01',
        lot_id: 'LOT-01',
        allocation_seq: 1,
        session_id: 'SES-01',
        auction_mode: 'PHYSICAL_SHOUT',
        policy_id: 'POL-01',
        auctioneer_licence_id: 'LIC-01',
        buyer_id: 'BYR-01',
        boxes_allocated: 4,
        grams_allocated: '100000',
        price_per_kg_paise: '75000',
        hammer_paise: '7500000',
        buyer_payable_paise: '7500000',
        fisherman_net_paise: '7125000',
        bonus_escrow_paise: '150000',
        auctioneer_paise: '75000',
        hms_net_paise: '75000',
        coop_net_paise: '75000',
        harbouros_revenue_paise: '0',
        gst_paise: '0',
        floor_warning_triggered: false,
        idempotency_key: 'IDEMP-01',
        fencing_token: 1,
        journal_id: 'JRN-01',
        server_latency_ms: 14,
        created_at: '2026-11-25T08:15:00.000Z',
      },
    ],
    accounts: [],
    journals: [
      {
        journal_id: 'JRN-01',
        reference_type: 'ALLOCATION',
        reference_id: 'ALC-01',
        description: 'Auction settlement for MUN-261125-001',
        reverses_journal_id: null,
        authorized_by_user_1: 'USR-01',
        authorized_by_user_2: null,
        reason_note: null,
        total_amount_paise: '7500000',
        created_at: '2026-11-25T08:15:00.000Z',
      },
    ],
    entries: [],
    reversals: [],
    payoutBatches: [],
    outboxEvents: [],
    ledgerVerification: {
      verified: true,
      entryCount: 6,
      lastEntrySeq: '6',
      headHash: '0123456789abcdef',
    },
  };
}

test('buildWorkspaceExportDataset builds tailored rows across all 7 workspaces', () => {
  const bootstrap = makeMockBootstrap();
  const fixedNow = new Date('2026-11-25T10:30:00.000Z');
  const workspaces = [
    'weighing',
    'pit',
    'inspector',
    'buyer',
    'fisher',
    'harbour',
    'platform',
  ] as const;

  for (const ws of workspaces) {
    const dataset = buildWorkspaceExportDataset({
      workspaceId: ws,
      workspaceLabel: ws,
      bootstrap,
      now: fixedNow,
    });
    assert.equal(dataset.filenameBase, `harbouros-munambam-hms-${ws}-2026-11-25`);
    assert.ok(dataset.headers.length >= 6, `${ws} should have structured columns`);
    assert.equal(dataset.rows.length, 1, `${ws} should emit 1 mock row`);
    assert.equal(dataset.rows[0]!.length, dataset.headers.length);
  }
});

test('serializeDatasetToCsv emits UTF-8 BOM and RFC-4180 escaped fields', () => {
  const bootstrap = makeMockBootstrap();
  const dataset = buildWorkspaceExportDataset({
    workspaceId: 'buyer',
    workspaceLabel: 'Buyer Clearing',
    bootstrap,
    now: new Date('2026-11-25T10:30:00.000Z'),
  });
  const csv = serializeDatasetToCsv(dataset);

  assert.ok(csv.startsWith('\uFEFF'), 'CSV should include UTF-8 BOM');
  assert.ok(
    csv.includes('"Kochi Seafoods, Export Co."'),
    'Comma-containing buyer name must be double-quoted'
  );
  assert.ok(csv.includes('32AAACK1234A1Z5'));
});

test('serializeDatasetToPdfBytes creates valid multi-page PDF 1.4 with sanitized currency', () => {
  const bootstrap = makeMockBootstrap();
  const baseDataset = buildWorkspaceExportDataset({
    workspaceId: 'buyer',
    workspaceLabel: 'Buyer Clearing',
    bootstrap,
    now: new Date('2026-11-25T10:30:00.000Z'),
  });
  const manyRows = Array.from({ length: 30 }, (_, idx) => [
    `#${101 + idx}`,
    `Buyer ${idx + 1}`,
    '32AAACK1234A1Z5',
    'Domestic',
    '₹5,00,000.00',
    '₹2,50,000.00',
    '₹12,000.00',
    '₹0.00',
  ]);
  const bytes = serializeDatasetToPdfBytes({ ...baseDataset, rows: manyRows });
  const text = new TextDecoder().decode(bytes);

  assert.ok(text.startsWith('%PDF-1.4\n'), 'PDF must start with %PDF-1.4 header');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'PDF must end with %%EOF marker');
  assert.ok(text.includes('/Count 2'), '30 rows should paginate cleanly across 2 pages');
  assert.ok(text.includes('Page 1 of 2'));
  assert.ok(text.includes('Page 2 of 2'));
  assert.ok(text.includes('Rs. 5,00,000.00'), 'Rupee symbol should convert to ASCII Rs.');
  assert.equal(sanitizePdfText('₹720.00 · Grade — A…'), 'Rs. 720.00 | Grade - A...');
});
