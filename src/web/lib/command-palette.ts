import type { WorkspaceId } from '@shared/contracts/rbac.ts';
import { formatInrFromPaise, formatKgFromGrams } from '@shared/domain/money.ts';
import type { BootstrapData } from '@web/lib/api.ts';

export type CommandPaletteCategory =
  | 'QUICK_ACTION'
  | 'WORKSPACE'
  | 'LOT'
  | 'PAYOUT_BATCH'
  | 'JOURNAL'
  | 'PARTY';

export interface CommandPaletteItem {
  id: string;
  category: CommandPaletteCategory;
  title: string;
  subtitle: string;
  badgeLabel: string;
  badgeTone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
  actionType:
    | 'OPEN_WORKSPACE'
    | 'OPEN_LEDGER_DRAWER'
    | 'OPEN_UTR_CSV_IMPORT'
    | 'OPEN_PROFILE_DRAWER'
    | 'OPEN_LOGIN'
    | 'OPEN_UI_KIT';
  targetWorkspace?: WorkspaceId | undefined;
}

export function buildCommandPaletteItems(
  bootstrap: BootstrapData | null,
  query: string
): ReadonlyArray<CommandPaletteItem> {
  const items: CommandPaletteItem[] = [
    {
      id: 'act-utr-import',
      category: 'QUICK_ACTION',
      title: 'Import Bank UTR CSV for Payout Batch Reconciliation',
      subtitle: 'Bulk map bank UTR references to existing nodal payout batches in the Ledger Inspector',
      badgeLabel: 'CSV RECONCILE',
      badgeTone: 'ok',
      actionType: 'OPEN_UTR_CSV_IMPORT',
    },
    {
      id: 'act-ledger-drawer',
      category: 'QUICK_ACTION',
      title: 'Open Statutory Ledger & SHA-256 Chain Inspector',
      subtitle: 'Inspect append-only double-entry journals, Recharts volume distribution & Golden Vectors',
      badgeLabel: 'SHA-256 LEDGER',
      badgeTone: 'info',
      actionType: 'OPEN_LEDGER_DRAWER',
    },
    {
      id: 'act-profile-drawer',
      category: 'QUICK_ACTION',
      title: 'Open Operator Profile, Persona Switcher & JWT Audit',
      subtitle: 'Edit operator identity in PostgreSQL core.users or switch across 8 statutory harbour roles',
      badgeLabel: 'IDENTITY · RBAC',
      badgeTone: 'neutral',
      actionType: 'OPEN_PROFILE_DRAWER',
    },
    {
      id: 'ws-harbour',
      category: 'WORKSPACE',
      title: 'Harbour Command & Statutory Accounting Workspace',
      subtitle: 'Section 19 basic floor prices, Nodal payout batches, Dual-key reversals & s.22 returns',
      badgeLabel: 'WORKSPACE',
      badgeTone: 'info',
      actionType: 'OPEN_WORKSPACE',
      targetWorkspace: 'harbour',
    },
    {
      id: 'ws-pit',
      category: 'WORKSPACE',
      title: 'Live Auction Pit Pad & 8-Gate Statutory Clearing',
      subtitle: 'Pit shout, remote hybrid & Dutch clock allocation with atomic 5% commission split',
      badgeLabel: 'WORKSPACE',
      badgeTone: 'info',
      actionType: 'OPEN_WORKSPACE',
      targetWorkspace: 'pit',
    },
    {
      id: 'ws-weighing',
      category: 'WORKSPACE',
      title: 'Dockside Weighing & HMAC-SHA256 QR Lot Tagging',
      subtitle: 'Capture integer gram catch weights and queue offline dockside lots',
      badgeLabel: 'WORKSPACE',
      badgeTone: 'info',
      actionType: 'OPEN_WORKSPACE',
      targetWorkspace: 'weighing',
    },
    {
      id: 'ws-platform',
      category: 'WORKSPACE',
      title: 'Platform Governance, Go 1.23 Backend & Live SQL Console',
      subtitle: 'Inspect Golang 1.23 source code, 001–005 SQL migrations & run live PostgreSQL 16 queries',
      badgeLabel: 'GO 1.23 + PG 16',
      badgeTone: 'ok',
      actionType: 'OPEN_WORKSPACE',
      targetWorkspace: 'platform',
    },
  ];

  if (bootstrap) {
    for (const batch of bootstrap.payoutBatches) {
      items.push({
        id: `batch-${batch.batch_id}`,
        category: 'PAYOUT_BATCH',
        title: `Payout Batch ${batch.batch_code} (${batch.batch_id})`,
        subtitle: `Amount: ${formatInrFromPaise(batch.total_amount_paise)} · UTR: ${batch.bank_utr ?? 'Pending CSV Import'}`,
        badgeLabel: batch.status,
        badgeTone: batch.status === 'RECONCILED_UTR' ? 'ok' : 'warn',
        actionType: 'OPEN_UTR_CSV_IMPORT',
      });
    }

    for (const lot of bootstrap.lots) {
      const sp = bootstrap.species.find((s) => s.species_id === lot.species_id);
      items.push({
        id: `lot-${lot.lot_id}`,
        category: 'LOT',
        title: `Lot ${lot.lot_code} · ${sp?.name_en ?? lot.species_id}`,
        subtitle: `${lot.available_boxes}/${lot.total_boxes} boxes · ${formatKgFromGrams(lot.available_grams)} · Grade ${lot.inspection_grade}`,
        badgeLabel: lot.status,
        badgeTone:
          lot.inspection_grade === 'REJECTED_UNFIT'
            ? 'danger'
            : lot.status === 'SETTLED'
              ? 'ok'
              : 'info',
        actionType: 'OPEN_WORKSPACE',
        targetWorkspace: 'pit',
      });
    }

    for (const jrn of bootstrap.journals) {
      items.push({
        id: `jrn-${jrn.journal_id}`,
        category: 'JOURNAL',
        title: `Journal ${jrn.journal_id} · ${formatInrFromPaise(jrn.total_amount_paise)}`,
        subtitle: jrn.description,
        badgeLabel: jrn.reference_type,
        badgeTone: 'ok',
        actionType: 'OPEN_LEDGER_DRAWER',
      });
    }

    for (const buyer of bootstrap.buyers) {
      items.push({
        id: `buyer-${buyer.buyer_id}`,
        category: 'PARTY',
        title: `Paddle #${buyer.paddle_no} · ${buyer.buyer_name}`,
        subtitle: `Escrow: ${formatInrFromPaise(buyer.escrow_balance_paise)} · GSTIN: ${buyer.gstin}`,
        badgeLabel: 'BUYER',
        badgeTone: 'info',
        actionType: 'OPEN_WORKSPACE',
        targetWorkspace: 'buyer',
      });
    }
  }

  const q = query.trim().toLowerCase();
  if (!q) return items;

  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q) ||
      item.badgeLabel.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
  );
}
