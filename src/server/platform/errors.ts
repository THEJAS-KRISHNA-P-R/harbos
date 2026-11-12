export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OTP_LOCKED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'INVALID_SUPERVISOR_PIN'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'LOT_REJECTED_UNFIT_S21'
  | 'SELF_INSPECTION_FORBIDDEN'
  | 'NOTHING_PAYABLE'
  | 'OVERPAYMENT_REJECTED'
  | 'AMOUNT_MISMATCH'
  | 'DUPLICATE_BANK_UTR'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'STATUTORY_CAP_BREACH'
  | 'BASIC_PRICE_BREACH'
  | 'UNBALANCED_LEDGER_ENTRY'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode = 400,
    details?: Record<string, unknown> | undefined
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
