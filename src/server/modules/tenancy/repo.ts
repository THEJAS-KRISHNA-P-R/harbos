import type { DbPort } from '@server/ports/db.ts';
import type { Role } from '@shared/contracts/rbac.ts';
import type { CentreType, CommercialMode } from '@shared/ids.ts';

export async function insertHonestTenantInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    slug: string;
    nameEn: string;
    nameMl: string;
    preset: CentreType;
    policyId: string;
    hmsAcc: string;
    coopAcc: string;
    revAcc: string;
    gstAcc: string;
    bankAcc: string;
    auctBps: number;
    hmsBps: number;
    bonusBps: number;
    coopBps: number;
    legalBasisRef: string;
    effectiveFromDate: string;
    genesisHash: string;
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO core.tenants (
      tenant_id, slug, name_en, name_ml, centre_type, floor_enforcement,
      active_policy_id, hms_account_id, coop_pool_account_id,
      harbouros_revenue_account_id, gst_payable_account_id
    ) VALUES ($1, $2, $3, $4, $5, 'WARN', $6, $7, $8, $9, $10)`,
    [
      params.tenantId,
      params.slug,
      params.nameEn,
      params.nameMl,
      params.preset,
      params.policyId,
      params.hmsAcc,
      params.coopAcc,
      params.revAcc,
      params.gstAcc,
    ]
  );

  await tx.query(
    `INSERT INTO core.commission_policies (
      policy_id, tenant_id, version_num, commercial_mode, commission_bps,
      auctioneer_share_bps, hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
      notification_ref, legal_basis_ref, effective_from
    ) VALUES ($1, $2, 1, 'FIXED_SAAS_ONLY', 500, $3, $4, $5, $6, 'GO(P) No. 18/2021/F&PD', $7, $8)`,
    [
      params.policyId,
      params.tenantId,
      params.auctBps,
      params.hmsBps,
      params.bonusBps,
      params.coopBps,
      params.legalBasisRef,
      params.effectiveFromDate,
    ]
  );

  await tx.query(
    `INSERT INTO ledger.heads (tenant_id, last_entry_seq, last_row_hash) VALUES ($1, 0, $2)`,
    [params.tenantId, params.genesisHash]
  );

  const institutionalAccounts: ReadonlyArray<
    [string, string, string, string, string]
  > = [
    [
      params.hmsAcc,
      'HMS_FUND',
      `2100-${params.slug}`,
      `${params.nameEn} HMS Account`,
      `HMS-${params.slug}`,
    ],
    [
      params.coopAcc,
      'COOP_SOCIETY_FUND',
      `2200-${params.slug}`,
      `${params.nameEn} Co-op Pool`,
      `COOP-POOL-${params.slug}`,
    ],
    [
      params.revAcc,
      'HARBOUROS_REVENUE',
      `4000-${params.slug}`,
      `${params.nameEn} Platform Revenue`,
      'HARBOUROS',
    ],
    [
      params.gstAcc,
      'GST_PAYABLE',
      `2400-${params.slug}`,
      `${params.nameEn} GST Payable`,
      'TAX-GST',
    ],
    [
      params.bankAcc,
      'BANK_CLEARING',
      `1100-${params.slug}`,
      `${params.nameEn} Nodal Clearing`,
      `HMS-${params.slug}`,
    ],
  ];

  for (const [accId, kind, code, label, ownerId] of institutionalAccounts) {
    await tx.query(
      `INSERT INTO ledger.accounts (account_id, tenant_id, kind, code, name_en, owner_entity_id, balance_paise)
       VALUES ($1, $2, $3, $4, $5, $6, 0)`,
      [accId, params.tenantId, kind, code, label, ownerId]
    );
  }
}

export async function insertTenantUserInTx(
  tx: DbPort,
  params: {
    userId: string;
    tenantId: string;
    phoneE164: string;
    fullName: string;
    role: Role;
    pinCode: string;
    pinHash: string;
    entityRefId: string | null;
    preferredLocale?: 'ml' | 'en';
  }
): Promise<void> {
  await tx.query(
    `INSERT INTO core.users (
      user_id, tenant_id, phone_e164, full_name, role, pin_code,
      supervisor_pin_hash, entity_ref_id, is_active, preferred_locale
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
    [
      params.userId,
      params.tenantId,
      params.phoneE164,
      params.fullName,
      params.role,
      params.pinCode,
      params.pinHash,
      params.entityRefId,
      params.preferredLocale ?? 'ml',
    ]
  );
}

export async function insertCommissionPolicyVersionInTx(
  tx: DbPort,
  params: {
    tenantId: string;
    commercialMode: CommercialMode;
    commissionBps: number;
    auctioneerShareBps: number;
    hmsShareBps: number;
    fisherBonusShareBps: number;
    coopShareBps: number;
    notificationRef: string;
    legalBasisRef: string;
    legalSignoffRef: string | null;
    legalSignoffDate: string | null;
    effectiveFromDate: string;
  }
): Promise<{ ver: number; policyId: string }> {
  const verRes = await tx.query<{ next_ver: number }>(
    `SELECT COALESCE(MAX(version_num), 0) + 1 AS next_ver FROM core.commission_policies WHERE tenant_id = $1`,
    [params.tenantId]
  );
  const ver = verRes.rows[0]?.next_ver ?? 2;
  const policyId = `POL-${params.tenantId.toUpperCase()}-V${ver}`;

  await tx.query(
    `INSERT INTO core.commission_policies (
      policy_id, tenant_id, version_num, commercial_mode, commission_bps,
      auctioneer_share_bps, hms_share_bps, fisher_bonus_share_bps, coop_share_bps,
      notification_ref, legal_basis_ref, legal_signoff_ref, legal_signoff_date, effective_from
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      policyId,
      params.tenantId,
      ver,
      params.commercialMode,
      params.commissionBps,
      params.auctioneerShareBps,
      params.hmsShareBps,
      params.fisherBonusShareBps,
      params.coopShareBps,
      params.notificationRef,
      params.legalBasisRef,
      params.legalSignoffRef,
      params.legalSignoffDate,
      params.effectiveFromDate,
    ]
  );

  await tx.query(
    `UPDATE core.tenants SET active_policy_id = $1 WHERE tenant_id = $2`,
    [policyId, params.tenantId]
  );

  return { ver, policyId };
}

export async function fetchWorkspaceBootstrapCollectionsInTx(
  tx: DbPort,
  tenantId: string
) {
  const [
    tenantRes,
    allTenantsRes,
    policiesRes,
    usersRes,
    societiesRes,
    fishermenRes,
    vesselsRes,
    licencesRes,
    buyersRes,
    speciesRes,
    lotsRes,
    sessionsRes,
    allocationsRes,
    accountsRes,
    journalsRes,
    entriesRes,
    reversalsRes,
    outboxRes,
  ] = await Promise.all([
    tx.query(`SELECT * FROM core.tenants WHERE tenant_id = $1`, [tenantId]),
    tx.query(`SELECT * FROM core.tenants WHERE tenant_id = $1`, [tenantId]),
    tx.query(
      `SELECT * FROM core.commission_policies WHERE tenant_id = $1 ORDER BY version_num DESC LIMIT 50`,
      [tenantId]
    ),
    tx.query(
      `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id, is_active FROM core.users WHERE tenant_id = $1`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM harbour.coop_societies WHERE tenant_id = $1`,
      [tenantId]
    ),
    tx.query(`SELECT * FROM harbour.fishermen WHERE tenant_id = $1`, [
      tenantId,
    ]),
    tx.query(`SELECT * FROM harbour.vessels WHERE tenant_id = $1`, [tenantId]),
    tx.query(
      `SELECT * FROM harbour.auctioneer_licences WHERE tenant_id = $1`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM harbour.buyers WHERE tenant_id = $1 ORDER BY paddle_no ASC`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM harbour.species WHERE tenant_id = $1 ORDER BY code ASC`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM auction.lots WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tenantId]
    ),
    tx.query(`SELECT * FROM auction.sessions WHERE tenant_id = $1`, [tenantId]),
    tx.query(
      `SELECT * FROM auction.sale_allocations WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM ledger.accounts WHERE tenant_id = $1 ORDER BY code ASC`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM ledger.journals WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM ledger.entries WHERE tenant_id = $1 ORDER BY entry_seq DESC LIMIT 50`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM ledger.reversal_requests WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [tenantId]
    ),
    tx.query(
      `SELECT * FROM sync.outbox_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [tenantId]
    ),
  ]);

  return {
    tenantRows: tenantRes.rows,
    allTenantsRows: allTenantsRes.rows,
    policiesRows: policiesRes.rows,
    usersRows: usersRes.rows,
    societiesRows: societiesRes.rows,
    fishermenRows: fishermenRes.rows,
    vesselsRows: vesselsRes.rows,
    licencesRows: licencesRes.rows,
    buyersRows: buyersRes.rows,
    speciesRows: speciesRes.rows,
    lotsRows: lotsRes.rows,
    sessionsRows: sessionsRes.rows,
    allocationsRows: allocationsRes.rows,
    accountsRows: accountsRes.rows,
    journalsRows: journalsRes.rows,
    entriesRows: entriesRes.rows,
    reversalsRows: reversalsRes.rows,
    outboxRows: outboxRes.rows,
  };
}
