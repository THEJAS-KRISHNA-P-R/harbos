import crypto from 'node:crypto';
import type { DbPort } from '../../src/server/ports/db.ts';
import { hashSupervisorPin } from '../../src/server/platform/auth.ts';
import { GENESIS_PREV_HASH } from '../../src/shared/domain/ledger-hash.ts';
import { ACT_16_2021_CITATIONS } from '../../src/shared/contracts/statute.ts';
import type { Role } from '../../src/shared/contracts/rbac.ts';

export interface IsolatedTenantFixture {
  readonly tenantId: string;
  readonly slug: string;
  readonly nameEn: string;
  readonly nameMl: string;
  readonly users: ReadonlyArray<{
    readonly userId: string;
    readonly phoneE164: string;
    readonly fullName: string;
    readonly role: Role;
    readonly entityRefId: string | null;
  }>;
  readonly buyerId: string;
  readonly fishermanId: string;
  readonly speciesId: string;
  readonly sessionId: string;
}

/**
 * Creates a completely isolated tenant with unique ID and slug, dedicated ledger heads/accounts,
 * and its own operators, vessel, fisherman, buyer, species, and auction licence.
 * All operations execute through the platformDb connection to ensure zero state collision
 * with the seeded demo tenant or other test suites.
 */
export async function createIsolatedTenant(
  platformDb: DbPort,
  prefix = 'iso'
): Promise<IsolatedTenantFixture> {
  const nonce = crypto.randomBytes(4).toString('hex');
  const tenantId = `ten-${prefix}-${nonce}`;
  const slug = `${prefix}-${nonce}`;
  const nameEn = `Isolated Harbour ${nonce.toUpperCase()}`;
  const nameMl = `പ്രത്യേക തുറമുഖം ${nonce.toUpperCase()}`;
  const policyId = `POL-${tenantId}-V1`;

  // 1. Insert isolated tenant
  await platformDb.query(
    `INSERT INTO core.tenants (
      tenant_id, slug, name_en, name_ml, centre_type, floor_enforcement,
      active_policy_id, hms_account_id, coop_pool_account_id,
      harbouros_revenue_account_id, gst_payable_account_id
    ) VALUES (
      $1, $2, $3, $4, 'KERALA_HARBOUR', 'WARN',
      $5, $6, $7, $8, $9
    )`,
    [
      tenantId,
      slug,
      nameEn,
      nameMl,
      policyId,
      `ACC-HMS-${tenantId}`,
      `ACC-COOP-${tenantId}`,
      `ACC-REV-${tenantId}`,
      `ACC-GST-${tenantId}`,
    ]
  );

  // 2. Insert commission policy
  await platformDb.query(
    `INSERT INTO core.commission_policies (
      policy_id, tenant_id, version_num, commercial_mode, commission_bps,
      auctioneer_share_bps, hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
      institutional_tech_share_bps, buyer_fee_bps, gst_rate_bps,
      notification_ref, legal_basis_ref, legal_signoff_ref, legal_signoff_date, effective_from
    ) VALUES (
      $1, $2, 1, 'FIXED_SAAS_ONLY', 500,
      2000, 2000, 4000, 2000,
      2000, 100, 1800,
      'GO(P) No. 18/2021/F&PD', $3, NULL, NULL, '2026-01-01'
    )`,
    [policyId, tenantId, ACT_16_2021_CITATIONS.HARBOUR_POLICY_LEGAL_BASIS]
  );

  // 3. Initialize ledger.heads
  await platformDb.query(
    `INSERT INTO ledger.heads (tenant_id, last_entry_seq, last_row_hash) VALUES ($1, 0, $2)`,
    [tenantId, GENESIS_PREV_HASH]
  );

  // 4. Insert baseline accounts
  const accounts = [
    [`ACC-HMS-${tenantId}`, 'HMS_FUND', '2100-HMS', 'HMS Fund', `HMS-${tenantId}`],
    [`ACC-COOP-${tenantId}`, 'COOP_SOCIETY_FUND', '2200-COOP', 'Coop Pool', `SOC-${tenantId}`],
    [`ACC-REV-${tenantId}`, 'HARBOUROS_REVENUE', '4000-HOS', 'Platform Revenue', 'HARBOUROS'],
    [`ACC-GST-${tenantId}`, 'GST_PAYABLE', '2400-GST', 'GST Payable', 'TAX-GST'],
    [`ACC-BANK-${tenantId}`, 'BANK_CLEARING', '1100-BANK', 'Bank Clearing', `HMS-${tenantId}`],
  ] as const;

  for (const [accId, kind, code, name, owner] of accounts) {
    await platformDb.query(
      `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
       VALUES ($1, $2, $3, $4, $5, $6, 0)`,
      [accId, tenantId, kind, code, name, owner]
    );
  }

  // 5. Insert isolated species
  const speciesId = `sp-${tenantId}-01`;
  await platformDb.query(
    `INSERT INTO harbour.species (species_id, tenant_id, code, name_en, name_ml, scientific_name, floor_price_paise_per_kg, export_eligible)
     VALUES ($1, $2, 'SKJ', 'Skipjack Tuna', 'ചൂര', 'Katsuwonus pelamis', 18000, true)`,
    [speciesId, tenantId]
  );

  // 6. Insert isolated cooperative
  const societyId = `SOC-${tenantId}-01`;
  await platformDb.query(
    `INSERT INTO harbour.coop_societies (society_id, tenant_id, name_en, name_ml, reg_no)
     VALUES ($1, $2, 'Isolated Co-op Society', 'സഹകരണ സംഘം', 'KL-ISO-01')`,
    [societyId, tenantId]
  );

  // 7. Insert isolated fisherman & accounts
  const fishermanId = `FSH-${tenantId}-01`;
  const fshPayAcc = `ACC-FSH-PAY-${fishermanId}`;
  const fshBonusAcc = `ACC-FSH-BONUS-${fishermanId}`;

  await platformDb.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'FISHERMAN_PAYABLE', '2100-FSH', 'Fisherman Payable', $3, 0)`,
    [fshPayAcc, tenantId, fishermanId]
  );
  await platformDb.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'FISHERMAN_BONUS_ESCROW', '2150-BONUS', 'Fisherman Bonus Escrow', $3, 0)`,
    [fshBonusAcc, tenantId, fishermanId]
  );

  await platformDb.query(
    `INSERT INTO harbour.fishermen (fisherman_id, tenant_id, full_name, phone_e164, welfare_board_no, coop_society_id, payable_account_id, bonus_escrow_account_id)
     VALUES ($1, $2, 'Isolated Boat Fisherman', '+919400000902', 'KFWFB-ISO-01', $3, $4, $5)`,
    [fishermanId, tenantId, societyId, fshPayAcc, fshBonusAcc]
  );

  // 8. Insert isolated vessel
  await platformDb.query(
    `INSERT INTO harbour.vessels (vessel_id, tenant_id, registration_no, vessel_name_en, vessel_name_ml, owner_fisherman_id, qr_token)
     VALUES ($1, $2, 'IND-KL-07-MM-9999', 'Sea Queen Iso', 'സീ ക്വീൻ', $3, 'QR-ISO-01')`,
    [`VES-${tenantId}-01`, tenantId, fishermanId]
  );

  // 9. Insert isolated buyer & receivable account
  const buyerId = `BUY-${tenantId}-01`;
  const buyRecAcc = `ACC-BUY-REC-${buyerId}`;
  await platformDb.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'BUYER_RECEIVABLE', '1200-BUY', 'Buyer Receivable', $3, 0)`,
    [buyRecAcc, tenantId, buyerId]
  );

  await platformDb.query(
    `INSERT INTO harbour.buyers (
      buyer_id, tenant_id, buyer_name, paddle_no, gstin,
      export_reg_no, escrow_balance_paise, approved_credit_paise,
      unsettled_payables_paise, active_holds_paise, receivable_account_id
    ) VALUES ($1, $2, 'Isolated Export Buyer', 901, '32AAAAA0000A1Z5', 'MPEDA-ISO-01', 5000000, 10000000, 0, 0, $3)`,
    [buyerId, tenantId, buyRecAcc]
  );

  // 10. Insert isolated auctioneer licence & payable account
  const licenceId = `LIC-${tenantId}-01`;
  const auctPayAcc = `ACC-AUCT-PAY-${licenceId}`;
  await platformDb.query(
    `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
     VALUES ($1, $2, 'AUCTIONEER_PAYABLE', '2300-AUCT', 'Auctioneer Commission Payable', $3, 0)`,
    [auctPayAcc, tenantId, licenceId]
  );

  await platformDb.query(
    `INSERT INTO harbour.auctioneer_licences (licence_id, tenant_id, auctioneer_user_id, auctioneer_name, licence_no, status, valid_from, valid_until, payable_account_id)
     VALUES ($1, $2, $3, 'Isolated Licensed Auctioneer', 'LIC-ISO-01', 'ACTIVE', '2026-01-01', '2027-12-31', $4)`,
    [licenceId, tenantId, `USR-${tenantId}-2`, auctPayAcc]
  );

  // 11. Insert dedicated users across all standard operational roles
  const rolesList: ReadonlyArray<Role> = [
    'WEIGHING_OPERATOR',
    'LICENSED_AUCTIONEER',
    'WHOLESALE_BUYER',
    'FISHERMAN_BOAT_OWNER',
    'AUTHORIZED_INSPECTOR',
    'HARBOUR_ADMIN',
    'ACCOUNTANT',
    'SUPER_ADMIN',
  ];

  const pinHash = hashSupervisorPin('1234', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
  const users: Array<{
    userId: string;
    phoneE164: string;
    fullName: string;
    role: Role;
    entityRefId: string | null;
  }> = [];

  for (let idx = 0; idx < rolesList.length; idx++) {
    const role = rolesList[idx]!;
    const uId = `USR-${tenantId}-${idx + 1}`;
    const randomDigits = crypto.randomInt(100000000, 999999999);
    const phone = `+917${randomDigits}`;
    const fullName = `Iso ${role.replace(/_/g, ' ')}`;
    const refId =
      role === 'WHOLESALE_BUYER'
        ? buyerId
        : role === 'FISHERMAN_BOAT_OWNER'
          ? fishermanId
          : role === 'LICENSED_AUCTIONEER'
            ? licenceId
            : null;

    await platformDb.query(
      `INSERT INTO core.users (user_id, tenant_id, phone_e164, full_name, role, pin_code, supervisor_pin_hash, entity_ref_id, is_active)
       VALUES ($1, $2, $3, $4, $5, '1234', $6, $7, true)`,
      [uId, tenantId, phone, fullName, role, pinHash, refId]
    );

    users.push({ userId: uId, phoneE164: phone, fullName, role, entityRefId: refId });
  }

  // 12. Insert isolated auction session
  const sessionId = `SES-${tenantId}-01`;
  await platformDb.query(
    `INSERT INTO auction.sessions (
      session_id, tenant_id, session_code, auction_mode, leader_device_id,
      fencing_token, lease_expires_at, status
    ) VALUES (
      $1, $2, 'SES-01', 'PHYSICAL_SHOUT', 'DEV-ISO-01',
      1, '2099-12-31T23:59:59.000Z', 'OPEN'
    )`,
    [sessionId, tenantId]
  );

  return {
    tenantId,
    slug,
    nameEn,
    nameMl,
    users,
    buyerId,
    fishermanId,
    speciesId,
    sessionId,
  };
}

/**
 * Creates an isolated single user attached to a given tenant.
 */
export async function createIsolatedUser(
  platformDb: DbPort,
  tenantId: string,
  role: Role,
  customSuffix = ''
): Promise<{
  userId: string;
  phoneE164: string;
  fullName: string;
  role: Role;
}> {
  const nonce = crypto.randomBytes(3).toString('hex');
  const userId = `USR-ISO-${nonce}${customSuffix ? `-${customSuffix}` : ''}`;
  const phoneE164 = `+9193${Math.floor(10000000 + Math.random() * 89999999)}`;
  const fullName = `Isolated Test User ${nonce.toUpperCase()}`;
  const pinHash = hashSupervisorPin('1234', 'a1b2c3d4e5f60718293a4b5c6d7e8f90');

  await platformDb.query(
    `INSERT INTO core.users (user_id, tenant_id, phone_e164, full_name, role, pin_code, supervisor_pin_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, '1234', $6, true)`,
    [userId, tenantId, phoneE164, fullName, role, pinHash]
  );

  return { userId, phoneE164, fullName, role };
}
