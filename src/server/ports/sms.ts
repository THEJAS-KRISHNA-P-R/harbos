export type SmsTemplateCode = 'OTP_LOGIN' | 'LOT_SOLD' | 'PAYOUT_READY';

export interface SmsDispatchInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly phoneE164: string;
  readonly templateCode: SmsTemplateCode;
  readonly locale: 'ml' | 'en';
  readonly variables: Record<string, string>;
  readonly messageText: string;
}

export interface SmsDispatchResult {
  readonly providerMessageId: string;
  readonly provider: 'msg91' | 'console';
}

export interface SmsPort {
  sendSms(input: SmsDispatchInput): Promise<SmsDispatchResult>;
}
