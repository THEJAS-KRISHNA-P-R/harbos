import type { Role } from '@shared/contracts/rbac.ts';
import type {
  AuctionMode,
  CentreType,
  CommercialMode,
  FloorEnforcement,
  InspectionGrade,
} from '@shared/ids.ts';
import type { OperatorRow } from '@web/lib/operator-directory.ts';

export { formatInrFromPaise, formatKgFromGrams } from '@shared/domain/money.ts';
export {
  getRoleDisplayMeta,
  formatOperatorInitials,
  type OperatorRow,
  type OperatorProfileResponse,
  type RoleDisplayMeta,
} from '@web/lib/operator-directory.ts';
export {
  validateAndNormalizeBankUtr,
  sanitizeBulkReconcilePayload,
  type UtrValidationResult,
  type SanitizedBulkInvalidItem,
  type SanitizedBulkValidItem,
  type SanitizedBulkReconcilePayload,
} from '@shared/domain/utr-validation.ts';
export {
  parseCsvLine,
  parseAndMapBankUtrCsv,
  detectUtrStatusTransitions,
  generateSampleBankUtrCsv,
  generateInvalidSampleBankUtrCsv,
  escapeCsvCell,
  formatLedgerInspectorCsv,
  buildUtrImportHistory,
  filterUtrImportHistory,
  countUtrImportHistoryByFilter,
  isSuccessfullyMappedImport,
  isInvalidImport,
  filterAuditLogsByActionOrTarget,
  type BankUtrRowStatus,
  type BankUtrCsvMappedRow,
  type BankUtrCsvParseResult,
  type UtrStatusTransition,
  type LedgerCsvExportScope,
  type LedgerCsvExportPayload,
  type UtrImportHistoryStatus,
  type UtrImportHistoryFilter,
  type UtrImportBreakdownItem,
  type UtrImportHistoryEntry,
} from '@web/lib/utr-reconciliation.ts';
export {
  buildCommandPaletteItems,
  type CommandPaletteCategory,
  type CommandPaletteItem,
} from '@web/lib/command-palette.ts';

export interface TenantRow {
  tenant_id: string;
  slug: string;
  name_en: string;
  name_ml: string;
  centre_type: CentreType;
  floor_enforcement: FloorEnforcement;
  active_policy_id: string;
}

export interface PolicyRow {
  policy_id: string;
  tenant_id: string;
  version_num: number;
  commercial_mode: CommercialMode;
  commission_bps: number;
  auctioneer_share_bps: number;
  hms_share_bps: number;
  fisher_bonus_share_bps: number;
  coop_share_bps: number;
  institutional_tech_share_bps: number;
  buyer_fee_bps: number;
  gst_rate_bps: number;
  notification_ref: string;
  legal_basis_ref: string;
  legal_signoff_ref: string | null;
  legal_signoff_date: string | null;
  effective_from: string;
}

export interface VesselRow {
  vessel_id: string;
  registration_no: string;
  vessel_name_en: string;
  vessel_name_ml: string;
  owner_fisherman_id: string;
  has_active_society_loan: boolean;
  loan_coop_society_id: string | null;
  qr_token: string;
}

export interface FishermanRow {
  fisherman_id: string;
  full_name: string;
  phone_e164: string;
  welfare_board_no: string;
  coop_society_id: string;
  payable_account_id: string;
  bonus_escrow_account_id: string;
}

export interface LicenceRow {
  licence_id: string;
  auctioneer_name: string;
  licence_no: string;
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  valid_from: string;
  valid_until: string;
  deputed_by_society_id: string | null;
  payable_account_id: string;
}

export interface BuyerRow {
  buyer_id: string;
  buyer_name: string;
  paddle_no: number;
  gstin: string;
  export_reg_no: string | null;
  escrow_balance_paise: string;
  approved_credit_paise: string;
  unsettled_payables_paise: string;
  active_holds_paise: string;
  receivable_account_id: string;
}

export interface SpeciesRow {
  species_id: string;
  code: string;
  name_en: string;
  name_ml: string;
  scientific_name: string;
  floor_price_paise_per_kg: string;
  export_eligible: boolean;
}

export interface LotRow {
  lot_id: string;
  lot_code: string;
  vessel_id: string;
  fisherman_id: string;
  species_id: string;
  sale_unit_type: string;
  total_boxes: number;
  available_boxes: number;
  net_grams: string;
  available_grams: string;
  core_temp_c: number | string;
  inspection_grade: InspectionGrade;
  inspection_notes: string;
  weight_source: string;
  qr_signature: string;
  status: string;
  created_at: string;
}

export interface AllocationRow {
  allocation_id: string;
  lot_id: string;
  allocation_seq: number;
  session_id: string;
  auction_mode: AuctionMode;
  policy_id: string;
  auctioneer_licence_id: string;
  buyer_id: string;
  boxes_allocated: number;
  grams_allocated: string;
  price_per_kg_paise: string;
  hammer_paise: string;
  buyer_payable_paise: string;
  fisherman_net_paise: string;
  bonus_escrow_paise: string;
  auctioneer_paise: string;
  hms_net_paise: string;
  coop_net_paise: string;
  harbouros_revenue_paise: string;
  gst_paise: string;
  floor_warning_triggered: boolean;
  idempotency_key: string;
  fencing_token: number;
  journal_id: string;
  server_latency_ms: number;
  created_at: string;
}

export interface AccountRow {
  account_id: string;
  kind: string;
  code: string;
  name_en: string;
  owner_entity_id: string;
  balance_paise: string;
}

export interface JournalRow {
  journal_id: string;
  reference_type: string;
  reference_id: string;
  description: string;
  reverses_journal_id: string | null;
  authorized_by_user_1: string | null;
  authorized_by_user_2: string | null;
  reason_note: string | null;
  total_amount_paise: string;
  created_at: string;
}

export interface EntryRow {
  entry_seq: string;
  journal_id: string;
  account_id: string;
  direction: 'D' | 'C';
  amount_paise: string;
  prev_row_hash: string;
  row_hash: string;
  created_at_utc_iso_ms: string;
}

export interface ReversalRow {
  reversal_id: string;
  original_journal_id: string;
  reason_note: string;
  requested_by_user_id: string;
  requested_by_name: string;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  compensating_journal_id: string | null;
  status: 'PENDING_SECOND_APPROVAL' | 'EXECUTED';
  created_at: string;
}

export interface PayoutBatchRow {
  batch_id: string;
  batch_code: string;
  beneficiary_kind: string;
  total_amount_paise: string;
  item_count: number;
  status: 'GENERATED_CSV' | 'RECONCILED_UTR';
  bank_utr: string | null;
  reconciled_at: string | null;
  created_at: string;
}

export interface OutboxEventRow {
  event_id: string;
  channel: string;
  recipient: string;
  template_code: string;
  payload_json: string;
  status: string;
  created_at: string;
}

export interface AuditLogRow {
  audit_id: string;
  tenant_id: string;
  actor_user_id: string;
  actor_name?: string;
  actor_role: string;
  action_code: string;
  target_type: string;
  target_id: string;
  details_json: string;
  created_at: string;
}

export function filterAuditLogs(
  logs: ReadonlyArray<AuditLogRow>,
  searchQuery: string,
  roleFilter = 'ALL'
): ReadonlyArray<AuditLogRow> {
  const q = searchQuery.trim().toLowerCase();
  return logs.filter((entry) => {
    if (roleFilter !== 'ALL' && entry.actor_role !== roleFilter) {
      return false;
    }
    if (!q) {
      return true;
    }
    const actorText = `${entry.actor_name ?? ''} ${entry.actor_user_id} ${entry.actor_role}`.toLowerCase();
    const actionText = entry.action_code.toLowerCase();
    const targetText = `${entry.target_type} ${entry.target_id}`.toLowerCase();
    const detailsText = entry.details_json.toLowerCase();
    return (
      actorText.includes(q) ||
      actionText.includes(q) ||
      targetText.includes(q) ||
      detailsText.includes(q)
    );
  });
}

export interface BootstrapData {
  tenant: TenantRow | null;
  allTenants: ReadonlyArray<TenantRow>;
  policies: ReadonlyArray<PolicyRow>;
  users?: ReadonlyArray<OperatorRow>;
  fishermen: ReadonlyArray<FishermanRow>;
  vessels: ReadonlyArray<VesselRow>;
  licences: ReadonlyArray<LicenceRow>;
  buyers: ReadonlyArray<BuyerRow>;
  species: ReadonlyArray<SpeciesRow>;
  lots: ReadonlyArray<LotRow>;
  allocations: ReadonlyArray<AllocationRow>;
  accounts: ReadonlyArray<AccountRow>;
  journals: ReadonlyArray<JournalRow>;
  entries: ReadonlyArray<EntryRow>;
  reversals: ReadonlyArray<ReversalRow>;
  payoutBatches: ReadonlyArray<PayoutBatchRow>;
  outboxEvents: ReadonlyArray<OutboxEventRow>;
  auditLogs?: ReadonlyArray<AuditLogRow>;
  ledgerVerification: {
    verified: boolean;
    entryCount: number;
    lastEntrySeq: string;
    headHash: string;
    failedAtSeq?: string;
    failureReason?: string;
  };
}

export interface SessionUser {
  userId: string;
  tenantId: string;
  phoneE164: string;
  fullName: string;
  role: Role;
  entityRefId?: string | null;
}

export {
  HARBOUROS_SDK_VERSION,
  hmacSha256HexUtf8,
  constantTimeEqualHex,
  signBankNodalWebhookPayload,
  verifyBankNodalWebhookSignature,
  generateDeterministicIdempotencyKey,
  computeSdkBackoffMs,
  buildStatutorySettlementVoucher,
  computeCrossHarbourBenchmarks,
  generateExternalSdkStarterCode,
  type BankNodalSettlementItem,
  type BankNodalWebhookPayload,
  type SignedBankNodalWebhookEnvelope,
  type StatutorySettlementVoucher,
  type CrossHarbourBenchmarkRow,
} from '@shared/sdk/harbouros-sdk.ts';

const inFlightGetRequests = new Map<string, Promise<unknown>>();

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    token?: string | null;
    body?: unknown;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const method = options.method ?? 'GET';
  const coalesceKey = method === 'GET' ? `${options.token ?? 'anon'}:${path}` : null;

  if (coalesceKey) {
    const existing = inFlightGetRequests.get(coalesceKey);
    if (existing) {
      return existing as Promise<T>;
    }
  }

  const executeFetch = async (): Promise<T> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-HarbourOS-SDK-Version': '2.4.0-statutory',
    };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const res = await fetch(path, {
      method,
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const data = (await res.json()) as T & { error?: { code?: string; message?: string } };
    if (!res.ok) {
      throw new Error(data.error?.message ?? `Request failed (${res.status})`);
    }
    return data;
  };

  if (!coalesceKey) {
    return executeFetch();
  }

  const promise = executeFetch().finally(() => {
    inFlightGetRequests.delete(coalesceKey);
  });
  inFlightGetRequests.set(coalesceKey, promise);
  return promise;
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType = 'text/csv;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface ExportableLogEntry {
  id: string;
  timestampIso: string;
  level: string;
  service: string;
  actionCode: string;
  message: string;
  durationMs?: number;
  traceId: string;
}

function escapeCsvCell(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function formatCentralizedLogsCsv(
  logs: ReadonlyArray<ExportableLogEntry>
): string {
  const headers = [
    'log_id',
    'timestamp_iso',
    'level',
    'service',
    'action_code',
    'duration_ms',
    'trace_id',
    'message',
  ];
  const rows = logs.map((entry) =>
    [
      escapeCsvCell(entry.id),
      escapeCsvCell(entry.timestampIso),
      escapeCsvCell(entry.level),
      escapeCsvCell(entry.service),
      escapeCsvCell(entry.actionCode),
      entry.durationMs !== undefined ? String(entry.durationMs) : '',
      escapeCsvCell(entry.traceId),
      escapeCsvCell(entry.message),
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function formatObservabilityBundleJson(
  snapshot: Record<string, unknown>,
  exportedAtIso = new Date().toISOString()
): string {
  return JSON.stringify(
    {
      bundleVersion: 'harbouros-observability-v1',
      exportedAtIso,
      ...snapshot,
    },
    null,
    2
  );
}

export type GlobalShortcutIntent =
  | { type: 'NONE' }
  | { type: 'TOGGLE_COMMAND_PALETTE' }
  | { type: 'TOGGLE_LEDGER_DRAWER' }
  | { type: 'FOCUS_AUDIT_FILTER' }
  | { type: 'SWITCH_WORKSPACE'; workspaceIndex: number };

export function resolveGlobalKeyboardShortcut(input: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isEditableTarget: boolean;
  ledgerDrawerOpen: boolean;
}): GlobalShortcutIntent {
  const lower = input.key.toLowerCase();
  if ((input.metaKey || input.ctrlKey) && lower === 'k') {
    return { type: 'TOGGLE_COMMAND_PALETTE' };
  }
  if (input.isEditableTarget) {
    return { type: 'NONE' };
  }
  if (!input.metaKey && !input.ctrlKey && lower === 'l') {
    return { type: 'TOGGLE_LEDGER_DRAWER' };
  }
  if (!input.metaKey && !input.ctrlKey && (input.key === '/' || lower === 'f') && input.ledgerDrawerOpen) {
    return { type: 'FOCUS_AUDIT_FILTER' };
  }
  if (!input.metaKey && !input.ctrlKey && !input.altKey && /^[1-7]$/.test(input.key)) {
    return { type: 'SWITCH_WORKSPACE', workspaceIndex: Number(input.key) - 1 };
  }
  return { type: 'NONE' };
}

