/**
 * Pure statutory Bank UTR validation, normalization, and bulk payload sanitization.
 * Shared across client CSV mapping and backend reconciliation endpoints.
 */

export interface UtrValidationResult {
  valid: boolean;
  normalizedUtr: string;
  errorCode:
    | 'OK'
    | 'EMPTY_UTR'
    | 'UTR_TOO_SHORT'
    | 'UTR_TOO_LONG'
    | 'UTR_INVALID_CHARS'
    | 'UTR_PLACEHOLDER_REJECTED';
  reason: string;
}

export interface RawBulkReconcileItem {
  batchId?: unknown;
  bankUtr?: unknown;
}

export interface SanitizedBulkInvalidItem {
  batchCode: string;
  batchId: string | null;
  bankUtr: string;
  status: 'INVALID_UTR' | 'UNMATCHED_BATCH';
  reason: string;
}

export interface SanitizedBulkValidItem {
  batchId: string;
  bankUtr: string;
}

export interface SanitizedBulkReconcilePayload {
  sourceLabel: string;
  idempotencyKey: string | null;
  validItems: ReadonlyArray<SanitizedBulkValidItem>;
  rejectedItems: ReadonlyArray<SanitizedBulkInvalidItem>;
  clientInvalidItems: ReadonlyArray<SanitizedBulkInvalidItem>;
  duplicatesSkipped: number;
  totalRowsParsed: number;
}

const VALID_UTR_REGEX = /^[A-Z0-9][A-Z0-9\-_/]{5,31}$/;
const PLACEHOLDER_UTR_REGEX = /^(0+|1+|X+|TEST.*|DUMMY.*|INVALID.*|NULL|NONE|NA)$/i;
const MAX_BULK_RECONCILE_ITEMS = 500;

export function validateAndNormalizeBankUtr(rawUtr: unknown): UtrValidationResult {
  const str = typeof rawUtr === 'string' || typeof rawUtr === 'number' ? String(rawUtr) : '';
  // Strip ASCII control characters and trim whitespace
  const cleaned = str.replace(/[\u0000-\u001F\u007F]/g, '').trim().toUpperCase();

  if (!cleaned) {
    return {
      valid: false,
      normalizedUtr: '',
      errorCode: 'EMPTY_UTR',
      reason: 'Bank UTR reference is empty',
    };
  }

  if (cleaned.length < 6) {
    return {
      valid: false,
      normalizedUtr: cleaned,
      errorCode: 'UTR_TOO_SHORT',
      reason: `Bank UTR must be at least 6 characters (received ${cleaned.length} chars)`,
    };
  }

  if (cleaned.length > 32) {
    return {
      valid: false,
      normalizedUtr: cleaned.slice(0, 32),
      errorCode: 'UTR_TOO_LONG',
      reason: `Bank UTR exceeds maximum 32-character nodal reference limit (received ${cleaned.length} chars)`,
    };
  }

  if (!VALID_UTR_REGEX.test(cleaned)) {
    return {
      valid: false,
      normalizedUtr: cleaned,
      errorCode: 'UTR_INVALID_CHARS',
      reason: 'Bank UTR contains invalid characters (only A–Z, 0–9, -, _, / allowed)',
    };
  }

  if (PLACEHOLDER_UTR_REGEX.test(cleaned)) {
    return {
      valid: false,
      normalizedUtr: cleaned,
      errorCode: 'UTR_PLACEHOLDER_REJECTED',
      reason: 'Placeholder or test UTR value rejected by statutory clearing guard',
    };
  }

  return {
    valid: true,
    normalizedUtr: cleaned,
    errorCode: 'OK',
    reason: 'Valid nodal bank UTR reference',
  };
}

export function sanitizeBulkReconcilePayload(
  rawBody: Record<string, unknown> | null | undefined,
  headerIdempotencyKey?: string | null
): SanitizedBulkReconcilePayload {
  const body = rawBody ?? {};
  const rawSourceLabel =
    typeof body.sourceLabel === 'string' ? body.sourceLabel.trim() : '';
  const sourceLabel = rawSourceLabel
    ? rawSourceLabel.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120)
    : 'Inline Bank UTR CSV';

  const rawIdem =
    (typeof headerIdempotencyKey === 'string' && headerIdempotencyKey.trim()) ||
    (typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()) ||
    '';
  const idempotencyKey = rawIdem ? rawIdem.slice(0, 128) : null;

  const rawItems = Array.isArray(body.items)
    ? (body.items.slice(0, MAX_BULK_RECONCILE_ITEMS) as RawBulkReconcileItem[])
    : [];

  const clientInvalidRaw = Array.isArray(body.invalidItems)
    ? (body.invalidItems.slice(0, MAX_BULK_RECONCILE_ITEMS) as Array<Record<string, unknown>>)
    : [];

  const clientInvalidItems: SanitizedBulkInvalidItem[] = clientInvalidRaw.map((inv) => {
    const bCode = String(inv?.batchCode ?? inv?.batchId ?? 'UNMATCHED_REF').trim() || 'UNMATCHED_REF';
    const bId = inv?.batchId ? String(inv.batchId).trim() : null;
    const bUtr = String(inv?.bankUtr ?? '—').trim() || '—';
    const status =
      inv?.status === 'UNMATCHED_BATCH' ? 'UNMATCHED_BATCH' : 'INVALID_UTR';
    const reason =
      (typeof inv?.reason === 'string' && inv.reason.trim()) ||
      (status === 'UNMATCHED_BATCH'
        ? 'No payout batch matched reference in CSV row'
        : 'Bank UTR failed nodal clearing validation');
    return {
      batchCode: bCode,
      batchId: bId,
      bankUtr: bUtr,
      status,
      reason,
    };
  });

  const seenBatches = new Set<string>();
  const seenUtrs = new Set<string>();
  const validItems: SanitizedBulkValidItem[] = [];
  const rejectedItems: SanitizedBulkInvalidItem[] = [];
  let duplicatesSkipped = 0;

  for (const item of rawItems) {
    const batchRef = String(item?.batchId ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim();
    const utrCheck = validateAndNormalizeBankUtr(item?.bankUtr);

    if (!batchRef) {
      rejectedItems.push({
        batchCode: 'MISSING_BATCH_REF',
        batchId: null,
        bankUtr: utrCheck.normalizedUtr || '—',
        status: 'UNMATCHED_BATCH',
        reason: 'Missing payout batch reference in bulk reconciliation payload',
      });
      continue;
    }

    if (!utrCheck.valid) {
      rejectedItems.push({
        batchCode: batchRef,
        batchId: batchRef,
        bankUtr: utrCheck.normalizedUtr || '—',
        status: 'INVALID_UTR',
        reason: utrCheck.reason,
      });
      continue;
    }

    const batchKey = batchRef.toUpperCase();
    if (seenBatches.has(batchKey)) {
      duplicatesSkipped += 1;
      rejectedItems.push({
        batchCode: batchRef,
        batchId: batchRef,
        bankUtr: utrCheck.normalizedUtr,
        status: 'INVALID_UTR',
        reason: `Duplicate batch reference (${batchRef}) in the same bulk upload`,
      });
      continue;
    }

    if (seenUtrs.has(utrCheck.normalizedUtr)) {
      duplicatesSkipped += 1;
      rejectedItems.push({
        batchCode: batchRef,
        batchId: batchRef,
        bankUtr: utrCheck.normalizedUtr,
        status: 'INVALID_UTR',
        reason: `Duplicate Bank UTR (${utrCheck.normalizedUtr}) assigned to multiple batches in upload`,
      });
      continue;
    }

    seenBatches.add(batchKey);
    seenUtrs.add(utrCheck.normalizedUtr);
    validItems.push({
      batchId: batchRef,
      bankUtr: utrCheck.normalizedUtr,
    });
  }

  const explicitTotal = Number(body.totalRowsParsed ?? 0);
  const computedTotal =
    validItems.length + rejectedItems.length + clientInvalidItems.length;
  const totalRowsParsed = Math.max(
    computedTotal,
    Number.isFinite(explicitTotal) ? Math.max(0, Math.trunc(explicitTotal)) : 0
  );

  return {
    sourceLabel,
    idempotencyKey,
    validItems,
    rejectedItems,
    clientInvalidItems,
    duplicatesSkipped,
    totalRowsParsed,
  };
}
