import crypto from 'node:crypto';
import { config } from '@server/config.ts';
import { logger } from '@server/platform/logger.ts';
import type {
  SmsDispatchInput,
  SmsDispatchResult,
  SmsPort,
} from '@server/ports/sms.ts';

export interface Msg91AdapterOptions {
  authKey?: string;
  senderId?: string;
  otpTemplateId?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class Msg91SmsAdapter implements SmsPort {
  private readonly authKey: string;
  private readonly senderId: string;
  private readonly otpTemplateId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options?: Msg91AdapterOptions) {
    this.authKey = (options?.authKey ?? config.MSG91_AUTH_KEY).trim();
    this.senderId = (options?.senderId ?? config.MSG91_SENDER_ID).trim() || 'HRBROS';
    this.otpTemplateId =
      (options?.otpTemplateId ?? config.MSG91_OTP_TEMPLATE_ID).trim() ||
      'DLT-TPL-HARBOUROS-01';
    this.baseUrl = (options?.baseUrl ?? config.MSG91_BASE_URL)
      .trim()
      .replace(/\/+$/, '');
    this.timeoutMs = options?.timeoutMs ?? 5_000;
  }

  public async sendSms(input: SmsDispatchInput): Promise<SmsDispatchResult> {
    const cleanPhone = input.phoneE164.replace(/^\+/, '').replace(/\s+/g, '');
    const endpoint = `${this.baseUrl}/api/v5/flow/`;

    const bodyPayload = {
      template_id: this.otpTemplateId,
      sender: this.senderId,
      short_url: '0',
      recipients: [
        {
          mobiles: cleanPhone,
          ...input.variables,
          message: input.messageText,
          locale: input.locale,
          templateCode: input.templateCode,
          eventId: input.eventId,
        },
      ],
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authkey: this.authKey,
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const rawText = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = { raw: rawText };
    }

    if (!res.ok || parsed.type === 'error') {
      const errMessage = String(
        parsed.message ?? `MSG91 HTTP ${res.status}: ${rawText.slice(0, 180)}`
      );
      throw new Error(`MSG91_DISPATCH_FAILED: ${errMessage}`);
    }

    const providerMessageId = String(
      parsed.request_id ?? parsed.message ?? `msg91-${crypto.randomUUID()}`
    );

    return {
      providerMessageId,
      provider: 'msg91',
    };
  }
}

export class ConsoleSmsAdapter implements SmsPort {
  public async sendSms(input: SmsDispatchInput): Promise<SmsDispatchResult> {
    const providerMessageId = `console-${input.eventId}`;
    logger.info('Console SMS dispatched', {
      eventId: input.eventId,
      templateCode: input.templateCode,
      locale: input.locale,
      phoneMasked: `${input.phoneE164.slice(0, 5)}****${input.phoneE164.slice(-2)}`,
      providerMessageId,
    });
    return {
      providerMessageId,
      provider: 'console',
    };
  }
}

export function createDefaultSmsAdapter(): SmsPort {
  if (config.SMS_PROVIDER === 'msg91') {
    return new Msg91SmsAdapter();
  }
  return new ConsoleSmsAdapter();
}
