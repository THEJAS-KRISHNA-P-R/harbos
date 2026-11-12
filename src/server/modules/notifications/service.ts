import crypto from 'node:crypto';
import { withPlatform, type DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { logger } from '@server/platform/logger.ts';
import {
  getOutboxDeadLetterMetric,
  incrementOutboxDeadLetterMetric,
} from '@server/platform/observability.ts';
import type { SmsPort, SmsTemplateCode } from '@server/ports/sms.ts';
import {
  claimPendingOutboxEventsInTx,
  countRecentDispatchedSmsInTx,
  listTenantOutboxEvents,
  markOutboxEventDispatchedInTx,
  markOutboxEventRetryOrDeadLetterInTx,
  resolveRecipientPhoneAndLocaleInTx,
} from './repo.ts';

export function getOutboxDeadLetterTotal(): number {
  return getOutboxDeadLetterMetric();
}

export function renderSmsTemplate(
  templateCode: SmsTemplateCode,
  locale: 'ml' | 'en',
  payload: Record<string, unknown>
): { messageText: string; variables: Record<string, string> } {
  if (templateCode === 'OTP_LOGIN') {
    const otp = String(payload.otpCode ?? '******');
    const messageText =
      locale === 'ml'
        ? `HarbourOS ലോഗിൻ OTP: ${otp}. 5 മിനിറ്റിനുള്ളിൽ ഉപയോഗിക്കുക.` // NEEDS-NATIVE-REVIEW
        : `HarbourOS Login OTP: ${otp}. Valid for 5 minutes. Do not share.`;
    return {
      messageText,
      variables: { VAR1: otp },
    };
  }

  if (templateCode === 'LOT_SOLD') {
    const lotCode = String(payload.lotCode ?? 'LOT');
    const boxes = String(payload.boxes ?? '1');
    const netPaise = BigInt(String(payload.fishermanNetPaise ?? '0'));
    const netRupees = (Number(netPaise) / 100).toFixed(2);
    const messageText =
      locale === 'ml'
        ? `HarbourOS: ലോട്ട് ${lotCode} (${boxes} ബോക്സ്) ലേലം ചെയ്തു. തുക: ₹${netRupees} (95% വിഹിതം).` // NEEDS-NATIVE-REVIEW
        : `HarbourOS: Lot ${lotCode} (${boxes} boxes) sold. Fisherman net (95%): INR ${netRupees}.`;
    return {
      messageText,
      variables: { VAR1: lotCode, VAR2: boxes, VAR3: netRupees },
    };
  }

  const batchCode = String(payload.batchCode ?? 'BATCH');
  const bankUtr = String(payload.bankUtr ?? 'UTR');
  const amtPaise = BigInt(String(payload.amountPaise ?? '0'));
  const amtRupees = (Number(amtPaise) / 100).toFixed(2);
  const messageText =
    locale === 'ml'
      ? `HarbourOS: ബാച്ച് ${batchCode} തീർപ്പാക്കി. തുക ₹${amtRupees} ബാങ്ക് UTR: ${bankUtr}.` // NEEDS-NATIVE-REVIEW
      : `HarbourOS: Payout ${batchCode} settled. INR ${amtRupees} credited via UTR ${bankUtr}.`;
  return {
    messageText,
    variables: { VAR1: batchCode, VAR2: amtRupees, VAR3: bankUtr },
  };
}

/**
 * Phase 3.1: Runs a single outbox poll-and-dispatch batch (`FOR UPDATE SKIP LOCKED`).
 * Enforces:
 *  - Per-phone cap: max 5 SMS/hour, max 10 SMS/day
 *  - Global daily cap: `config.SMS_DAILY_CAP` (default 5,000)
 *  - Exponential backoff: `10s * 2^attempts + jitter`
 *  - Max 5 attempts -> `DEAD_LETTER`
 */
export async function processOutboxBatchOnce(
  platformDb: DbPort,
  smsPort: SmsPort,
  options?: {
    batchLimit?: number;
    maxPhonePerHour?: number;
    maxPhonePerDay?: number;
    maxGlobalPerDay?: number;
  }
): Promise<{
  claimed: number;
  dispatched: number;
  retried: number;
  deadLettered: number;
}> {
  const batchLimit = options?.batchLimit ?? 50;
  const maxPhonePerHour = options?.maxPhonePerHour ?? 5;
  const maxPhonePerDay = options?.maxPhonePerDay ?? 10;
  const maxGlobalPerDay = options?.maxGlobalPerDay ?? config.SMS_DAILY_CAP;

  let claimed = 0;
  let dispatched = 0;
  let retried = 0;
  let deadLettered = 0;

  await withPlatform(platformDb, async (tx) => {
    const events = await claimPendingOutboxEventsInTx(tx, batchLimit);
    claimed = events.length;

    for (const ev of events) {
      let parsedPayload: Record<string, unknown> = {};
      try {
        parsedPayload = JSON.parse(ev.payload_json) as Record<string, unknown>;
      } catch {
        parsedPayload = {};
      }

      const { phoneE164, locale } = await resolveRecipientPhoneAndLocaleInTx(
        tx,
        ev.tenant_id,
        ev.recipient
      );

      const counts = await countRecentDispatchedSmsInTx(
        tx,
        phoneE164,
        ev.recipient
      );

      if (
        counts.phonePastHour >= maxPhonePerHour ||
        counts.phonePastDay >= maxPhonePerDay ||
        counts.globalPastDay >= maxGlobalPerDay
      ) {
        const capReason =
          counts.globalPastDay >= maxGlobalPerDay
            ? `SMS_DAILY_CAP exceeded (${maxGlobalPerDay}/day)`
            : counts.phonePastDay >= maxPhonePerDay
              ? `Per-phone daily cap exceeded (${maxPhonePerDay}/day)`
              : `Per-phone hourly cap exceeded (${maxPhonePerHour}/hour)`;
        const nextAttempts = ev.attempts + 1;
        const isDead = nextAttempts >= 5;
        const backoffMs =
          10_000 * Math.pow(2, nextAttempts) + crypto.randomInt(100, 1_000);
        const nextAttemptAtIso = new Date(Date.now() + backoffMs).toISOString();

        await markOutboxEventRetryOrDeadLetterInTx(tx, {
          eventId: ev.event_id,
          attempts: nextAttempts,
          nextAttemptAtIso,
          lastError: capReason,
          deadLetter: isDead,
        });
        if (isDead) {
          deadLettered += 1;
          incrementOutboxDeadLetterMetric(1);
        } else {
          retried += 1;
        }
        continue;
      }

      const templateCode: SmsTemplateCode =
        ev.template_code === 'OTP_LOGIN' ||
        ev.template_code === 'LOT_SOLD' ||
        ev.template_code === 'PAYOUT_READY'
          ? ev.template_code
          : 'LOT_SOLD';

      const rendered = renderSmsTemplate(templateCode, locale, parsedPayload);

      try {
        const sendRes = await smsPort.sendSms({
          eventId: ev.event_id,
          tenantId: ev.tenant_id,
          phoneE164,
          templateCode,
          locale,
          variables: rendered.variables,
          messageText: rendered.messageText,
        });

        await markOutboxEventDispatchedInTx(tx, {
          eventId: ev.event_id,
          providerMessageId: sendRes.providerMessageId,
          sentAtIso: new Date().toISOString(),
        });
        dispatched += 1;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const nextAttempts = ev.attempts + 1;
        const isDead = nextAttempts >= 5;
        const backoffMs =
          10_000 * Math.pow(2, nextAttempts) + crypto.randomInt(100, 1_000);
        const nextAttemptAtIso = new Date(Date.now() + backoffMs).toISOString();

        await markOutboxEventRetryOrDeadLetterInTx(tx, {
          eventId: ev.event_id,
          attempts: nextAttempts,
          nextAttemptAtIso,
          lastError: errMsg.slice(0, 500),
          deadLetter: isDead,
        });

        if (isDead) {
          deadLettered += 1;
          incrementOutboxDeadLetterMetric(1);
          logger.error('Outbox SMS event moved to DEAD_LETTER after 5 attempts', {
            eventId: ev.event_id,
            tenantId: ev.tenant_id,
            templateCode: ev.template_code,
            lastError: errMsg,
          });
        } else {
          retried += 1;
        }
      }
    }
  });

  return {
    claimed,
    dispatched,
    retried,
    deadLettered,
  };
}

export { listTenantOutboxEvents };
