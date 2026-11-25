import { WORKSPACES, type WorkspaceId } from '@shared/contracts/rbac.ts';
import { formatInrFromPaise, formatKgFromGrams } from '@shared/domain/money.ts';
import type { BootstrapData } from '@web/lib/api.ts';
import { humanizeCode } from '@web/lib/ui-formatters.ts';

export type WorkspaceGroup = 'operations' | 'clearing' | 'governance';

export type CommandPaletteCategory =
  | 'QUICK_ACTION'
  | 'WORKSPACE'
  | 'LOT'
  | 'PAYOUT_BATCH'
  | 'JOURNAL'
  | 'PARTY';

export type CommandPaletteFilterScope = 'all' | 'workspaces' | WorkspaceGroup;

export const WORKSPACE_GROUP_MAP: Record<WorkspaceId, WorkspaceGroup> = {
  weighing: 'operations',
  pit: 'operations',
  inspector: 'operations',
  buyer: 'clearing',
  fisher: 'clearing',
  harbour: 'governance',
  platform: 'governance',
};

export const WORKSPACE_GROUP_META: Record<
  WorkspaceGroup,
  { label: string; navTitle: string; shortLabel: string }
> = {
  operations: {
    label: 'Operations',
    navTitle: 'Dockside & Pit',
    shortLabel: 'OPERATIONS',
  },
  clearing: {
    label: 'Clearing',
    navTitle: 'Clearing & Passbooks',
    shortLabel: 'CLEARING',
  },
  governance: {
    label: 'Governance',
    navTitle: 'Governance & Engine',
    shortLabel: 'GOVERNANCE',
  },
};

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
  workspaceGroup?: WorkspaceGroup | undefined;
  keywords?: ReadonlyArray<string> | undefined;
}

const WORKSPACE_QUICK_JUMP_COPY: Record<
  WorkspaceId,
  { title: string; subtitle: string; keywords: ReadonlyArray<string> }
> = {
  weighing: {
    title: 'Weighing & Lots',
    subtitle: 'Dockside vessel intake, catch species tagging, exact gram weights & signed QR stickers',
    keywords: ['weighing', 'dockside', 'scale', 'qr', 'lots', 'vessels', 'species', 'operations'],
  },
  pit: {
    title: 'Auction Pit Pad',
    subtitle: 'Live pit shout, Dutch clock bids, partial box splits & atomic 5% commission clearing',
    keywords: ['pit', 'auction', 'auctioneer', 'dutch', 'hammer', 'bids', 'operations'],
  },
  inspector: {
    title: 'Quality Inspection',
    subtitle: 'Organoleptic grading, core temperature check, unfit lot quarantine & section 21 QC',
    keywords: ['inspector', 'quality', 'qc', 'grade', 'temperature', 's21', 'operations'],
  },
  buyer: {
    title: 'Buyer Clearing',
    subtitle: 'Real-time escrow trading limit, remote lot bidding, buyer invoices & export dossiers',
    keywords: ['buyer', 'wholesale', 'paddle', 'escrow', 'credit', 'invoices', 'clearing'],
  },
  fisher: {
    title: 'Fisher Passbook',
    subtitle: '95% fisherman net catch settlements, 40% annual bonus escrow & printable statements',
    keywords: ['fisher', 'fisherman', 'boat', 'vessel', 'passbook', 'bonus', 'clearing'],
  },
  harbour: {
    title: 'Harbour & Ledger',
    subtitle: 'Floor price schedules, licensed auctioneers, payout batches, UTR clearing & dual-key reversals',
    keywords: ['harbour', 'hms', 'admin', 'accountant', 'ledger', 'floor', 'payout', 'governance'],
  },
  platform: {
    title: 'Platform Admin',
    subtitle: 'Multi-tenant harbour provisioning, role dashboards, SQL migrations & system telemetry',
    keywords: ['platform', 'super', 'tenant', 'onboarding', 'migrations', 'sdk', 'governance'],
  },
};

const GROUP_SORT_ORDER: Record<WorkspaceGroup, number> = {
  operations: 0,
  clearing: 1,
  governance: 2,
};

export function buildWorkspaceQuickJumpItems(
  allowedWorkspaceIds?: ReadonlySet<WorkspaceId>
): ReadonlyArray<CommandPaletteItem> {
  return WORKSPACES.filter(
    (ws) => !allowedWorkspaceIds || allowedWorkspaceIds.has(ws.id)
  )
    .slice()
    .sort(
      (a, b) =>
        GROUP_SORT_ORDER[WORKSPACE_GROUP_MAP[a.id]] -
        GROUP_SORT_ORDER[WORKSPACE_GROUP_MAP[b.id]]
    )
    .map((ws) => {
      const group = WORKSPACE_GROUP_MAP[ws.id];
      const groupMeta = WORKSPACE_GROUP_META[group];
      const copy = WORKSPACE_QUICK_JUMP_COPY[ws.id];
      return {
        id: `ws-${ws.id}`,
        category: 'WORKSPACE',
        title: copy.title,
        subtitle: copy.subtitle,
        badgeLabel: groupMeta.shortLabel,
        badgeTone: group === 'operations' ? 'info' : group === 'clearing' ? 'ok' : 'neutral',
        actionType: 'OPEN_WORKSPACE',
        targetWorkspace: ws.id,
        workspaceGroup: group,
        keywords: [
          ws.id,
          ws.path,
          ws.titleEn,
          group,
          groupMeta.label,
          groupMeta.navTitle,
          ...copy.keywords,
        ],
      };
    });
}

function scoreCommandPaletteMatch(item: CommandPaletteItem, tokens: ReadonlyArray<string>): number {
  const titleLower = item.title.toLowerCase();
  const subtitleLower = item.subtitle.toLowerCase();
  const badgeLower = item.badgeLabel.toLowerCase();
  const categoryLower = item.category.toLowerCase();
  const groupLower = (item.workspaceGroup ?? '').toLowerCase();
  const targetLower = (item.targetWorkspace ?? '').toLowerCase();
  const keywordsLower = (item.keywords ?? []).join(' ').toLowerCase();
  const haystack = `${titleLower} ${subtitleLower} ${badgeLower} ${categoryLower} ${groupLower} ${targetLower} ${keywordsLower}`;

  for (const token of tokens) {
    if (!haystack.includes(token)) {
      return -1;
    }
  }

  let score = item.category === 'WORKSPACE' ? 40 : 10;
  const fullQuery = tokens.join(' ');
  if (targetLower === fullQuery || titleLower === fullQuery) {
    score += 100;
  } else if (titleLower.startsWith(fullQuery) || targetLower.startsWith(fullQuery)) {
    score += 70;
  } else if (groupLower === fullQuery || badgeLower === fullQuery) {
    score += 60;
  } else if (titleLower.includes(fullQuery)) {
    score += 45;
  } else if (keywordsLower.includes(fullQuery)) {
    score += 25;
  }
  return score;
}

export function filterCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteItem>,
  query: string,
  scope: CommandPaletteFilterScope = 'all'
): ReadonlyArray<CommandPaletteItem> {
  const scoped = items.filter((item) => {
    if (scope === 'all') return true;
    if (scope === 'workspaces') return item.category === 'WORKSPACE';
    return item.category === 'WORKSPACE' && item.workspaceGroup === scope;
  });

  const normalized = query.trim().toLowerCase();
  if (!normalized) return scoped;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const scored: Array<{ item: CommandPaletteItem; score: number; index: number }> = [];

  for (let i = 0; i < scoped.length; i += 1) {
    const item = scoped[i]!;
    const score = scoreCommandPaletteMatch(item, tokens);
    if (score >= 0) {
      scored.push({ item, score, index: i });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.item);
}

export function buildCommandPaletteItems(
  bootstrap: BootstrapData | null,
  query: string,
  scope: CommandPaletteFilterScope = 'all'
): ReadonlyArray<CommandPaletteItem> {
  const items: CommandPaletteItem[] = [
    ...buildWorkspaceQuickJumpItems(),
    {
      id: 'act-utr-import',
      category: 'QUICK_ACTION',
      title: 'Import Bank UTR CSV for Payout Batch Reconciliation',
      subtitle: 'Bulk map bank UTR references to existing nodal payout batches in the Ledger Inspector',
      badgeLabel: 'CSV RECONCILE',
      badgeTone: 'ok',
      actionType: 'OPEN_UTR_CSV_IMPORT',
      keywords: ['utr', 'csv', 'bank', 'reconcile', 'payout', 'clearing'],
    },
    {
      id: 'act-ledger-drawer',
      category: 'QUICK_ACTION',
      title: 'Open Statutory Ledger & SHA-256 Chain Inspector',
      subtitle: 'Inspect append-only double-entry journals, Recharts volume distribution & Golden Vectors',
      badgeLabel: 'SHA-256 LEDGER',
      badgeTone: 'info',
      actionType: 'OPEN_LEDGER_DRAWER',
      keywords: ['ledger', 'sha256', 'chain', 'journals', 'audit', 'governance'],
    },
    {
      id: 'act-profile-drawer',
      category: 'QUICK_ACTION',
      title: 'Open Operator Profile, Persona Switcher & Activity',
      subtitle: 'Edit operator profile details or switch across 8 harbour operator roles',
      badgeLabel: 'IDENTITY · RBAC',
      badgeTone: 'neutral',
      actionType: 'OPEN_PROFILE_DRAWER',
      keywords: ['profile', 'persona', 'role', 'switch', 'session', 'identity'],
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
        subtitle: `${lot.available_boxes}/${lot.total_boxes} boxes · ${formatKgFromGrams(lot.available_grams)} · Grade ${humanizeCode(lot.inspection_grade) || 'Pending'}`,
        badgeLabel: lot.status,
        badgeTone:
          lot.inspection_grade === 'REJECTED_UNFIT'
            ? 'danger'
            : lot.status === 'SETTLED'
              ? 'ok'
              : 'info',
        actionType: 'OPEN_WORKSPACE',
        targetWorkspace: 'pit',
        workspaceGroup: 'operations',
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
        workspaceGroup: 'clearing',
      });
    }
  }

  return filterCommandPaletteItems(items, query, scope);
}
