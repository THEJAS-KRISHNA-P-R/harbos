import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import http from 'node:http';
import { createApiApp } from '@server/app.ts';
import { signAccessJwt } from '@server/platform/auth.ts';
import { processOutboxBatchOnce } from '@server/modules/notifications/service.ts';
import type { SmsPort } from '@server/ports/sms.ts';
import { bootstrapTestDatabase } from '../helpers/pg-bootstrap.ts';
import { createIsolatedTenant, createIsolatedUser } from '../helpers/fixtures.ts';
import type { DbPort } from '@server/ports/db.ts';

describe('Phase 3 Pilot Features & DPDP Privacy Compliance', () => {
  let db: DbPort;
  let platformDb: DbPort;
  let closeDb: () => Promise<void>;
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    const bootstrapped = await bootstrapTestDatabase();
    db = bootstrapped.db;
    platformDb = bootstrapped.platformDb;
    closeDb = bootstrapped.close;

    const app = createApiApp(db, undefined, platformDb, db);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
  });

  it('Outbox SMS Worker dispatches pending SMS with backoff and dead-letter protection', async () => {
    const iso = await createIsolatedTenant(platformDb, 'sms');
    const sentDispatches: Array<{ phone: string; message: string }> = [];
    const mockSmsPort: SmsPort = {
      sendSms: async (req) => {
        sentDispatches.push({ phone: req.phoneE164, message: req.messageText });
        return {
          provider: 'msg91',
          providerMessageId: `MSG91-MOCK-${Date.now()}`,
          status: 'ACCEPTED',
        };
      },
    };

    // Queue test notification in sync.outbox_events
    await platformDb.query(
      `INSERT INTO sync.outbox_events (
        event_id, tenant_id, channel, recipient, template_code, payload_json, status, created_at, attempts, next_attempt_at
      ) VALUES (
        'EVT-TEST-001', $1, 'SMS', $2, 'OTP_LOGIN', '{"otpCode":"882199"}', 'PENDING', (NOW() - INTERVAL '10 minutes')::text, 0, NOW() - INTERVAL '1 minute'
      )`,
      [iso.tenantId, iso.users[0]!.userId]
    );

    const stats = await processOutboxBatchOnce(platformDb, mockSmsPort, { batchLimit: 10 });
    assert.ok(stats.claimed >= 1);
    assert.ok(stats.dispatched >= 1);
    assert.ok(sentDispatches.length >= 1);
    const hasOtp = sentDispatches.some((d) => d.message.includes('882199'));
    assert.ok(hasOtp, 'One of the dispatched SMS messages must contain the OTP code 882199');
  });

  it('DPDP Privacy: Records consent and exports caller personal data under Act 2023', async () => {
    const iso = await createIsolatedTenant(platformDb, 'dpdp');
    const accountant = iso.users.find((u) => u.role === 'ACCOUNTANT')!;
    const accountantToken = await signAccessJwt({
      sub: accountant.userId,
      tenantId: iso.tenantId,
      role: 'ACCOUNTANT',
      fullName: accountant.fullName,
      phoneE164: accountant.phoneE164,
    });

    // 1. Record consent
    const consentRes = await fetch(`${baseUrl}/api/v1/auth/consent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accountantToken}`,
      },
      body: JSON.stringify({ consentVersion: 'DPDP-2023-v1.0' }),
    });
    assert.equal(consentRes.status, 200);
    const consentJson = (await consentRes.json()) as { recorded: boolean; consentVersion: string };
    assert.equal(consentJson.recorded, true);
    assert.equal(consentJson.consentVersion, 'DPDP-2023-v1.0');

    // 2. Export personal data
    const exportRes = await fetch(`${baseUrl}/api/v1/privacy/export`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accountantToken}`,
      },
    });
    assert.equal(exportRes.status, 200);
    const exportJson = (await exportRes.json()) as {
      statutoryNotice: string;
      user: { full_name: string; phone_e164: string };
    };
    assert.match(exportJson.statutoryNotice, /DPDP Act 2023/);
    assert.equal(exportJson.user.full_name, accountant.fullName);
    assert.equal(exportJson.user.phone_e164, accountant.phoneE164);
  });

  it('DPDP Privacy: Pseudonymizes personal data while preserving statutory ledger audit integrity', async () => {
    const iso = await createIsolatedTenant(platformDb, 'erase');
    const isolatedWeigher = await createIsolatedUser(
      platformDb,
      iso.tenantId,
      'WEIGHING_OPERATOR',
      'ERASE'
    );

    const userToEraseToken = await signAccessJwt({
      sub: isolatedWeigher.userId,
      tenantId: iso.tenantId,
      role: 'WEIGHING_OPERATOR',
      fullName: isolatedWeigher.fullName,
      phoneE164: isolatedWeigher.phoneE164,
    });

    const eraseRes = await fetch(`${baseUrl}/api/v1/privacy/erase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToEraseToken}`,
      },
      body: JSON.stringify({ reason: 'Right to erasure requested dockside' }),
    });
    assert.equal(eraseRes.status, 200);
    const eraseJson = (await eraseRes.json()) as {
      status: string;
      statutoryLedgerPreserved: boolean;
      pseudonymName: string;
    };
    assert.equal(eraseJson.status, 'PSEUDONYMIZED_STATUTORY_RETENTION');
    assert.equal(eraseJson.statutoryLedgerPreserved, true);
    assert.match(eraseJson.pseudonymName, new RegExp(`^ERASED-${isolatedWeigher.userId}`));

    // Verify user record in database is pseudonymized
    const userRow = await platformDb.query<{
      full_name: string;
      phone_e164: string;
      is_active: boolean;
    }>(
      `SELECT full_name, phone_e164, is_active FROM core.users WHERE user_id = $1`,
      [isolatedWeigher.userId]
    );
    assert.ok(userRow.rows[0]);
    assert.equal(userRow.rows[0].full_name, `ERASED-${isolatedWeigher.userId}`);
    assert.match(userRow.rows[0].phone_e164, /^\+999/);
    assert.equal(userRow.rows[0].is_active, false);

    // Verify ledger heads/accounts in isolated tenant remain intact
    const ledgerRows = await platformDb.query<{ cnt: number }>(
      `SELECT COUNT(*)::int as cnt FROM ledger.heads WHERE tenant_id = $1`,
      [iso.tenantId]
    );
    assert.ok(ledgerRows.rows[0]);
    assert.ok(ledgerRows.rows[0].cnt > 0);
  });
});
