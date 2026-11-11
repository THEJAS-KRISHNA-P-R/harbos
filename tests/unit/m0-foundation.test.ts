import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvConfig } from '../../src/server/config.ts';
import { runContrastAudit, contrastRatio } from '../../scripts/check-contrast.ts';
import { checkBoundaries } from '../../scripts/check-boundaries.ts';
import { ROUTE_RBAC_MATRIX } from '../../src/shared/contracts/rbac.ts';
import { filterAuditLogs, type AuditLogRow } from '../../src/web/lib/api.ts';

import crypto from 'node:crypto';

describe('M0 & M3 Foundation — Config Safety, WCAG Contrast, Boundaries & RBAC Matrix', () => {
  it('parseEnvConfig refuses to boot when NODE_ENV=production and OTP_DEV_ECHO=true', () => {
    assert.throws(
      () =>
        parseEnvConfig({
          NODE_ENV: 'production',
          OTP_DEV_ECHO: 'true',
          JWT_ACCESS_SECRET: crypto.randomBytes(32).toString('hex'),
        }),
      /OTP_DEV_ECHO=true is strictly forbidden when NODE_ENV=production/
    );
  });

  it('parseEnvConfig refuses to boot in production when JWT_ACCESS_SECRET is shorter than 32 bytes', () => {
    assert.throws(
      () =>
        parseEnvConfig({
          NODE_ENV: 'production',
          OTP_DEV_ECHO: 'false',
          JWT_ACCESS_SECRET: 'short',
        }),
      /JWT_ACCESS_SECRET must be at least 32 bytes/
    );
  });

  it('verifies all 17 §11.1 Navy-on-Off-White token pairs pass WCAG 2.1 AA contrast thresholds', () => {
    const result = runContrastAudit();
    assert.equal(result.passed, true, `Contrast failures: ${result.failures.join('; ')}`);
    assert.ok(contrastRatio('#0F1F3D', '#F6F6F3') >= 15.0);
    assert.ok(contrastRatio('#5A6882', '#F6F6F3') >= 4.5);
    assert.ok(contrastRatio('#74829F', '#F6F6F3') >= 3.0);
  });

  it('verifies all §6 architectural boundary and §11.3 zero-green/zero-hardcoded-hex rules pass', () => {
    const result = checkBoundaries();
    assert.equal(result.passed, true, `Boundary violations: ${result.violations.join('; ')}`);
  });

  it('verifies every API route in ROUTE_RBAC_MATRIX declares explicit allowed roles (§9)', () => {
    assert.ok(ROUTE_RBAC_MATRIX.length >= 14);
    for (const route of ROUTE_RBAC_MATRIX) {
      if (route.roles !== 'PUBLIC') {
        assert.ok(route.roles.length > 0, `Route ${route.pattern} has empty role list`);
      }
    }
  });

  it('filters audit log entries by actor, action code, target ID, and role', () => {
    const sampleLogs: ReadonlyArray<AuditLogRow> = [
      {
        audit_id: 'AUD-1',
        tenant_id: 'munambam-demo',
        actor_user_id: 'USR-AUCT-01',
        actor_name: 'K. Balakrishnan Nair',
        actor_role: 'LICENSED_AUCTIONEER',
        action_code: 'LOT_ALLOCATED_AND_CLEARED',
        target_type: 'ALLOCATION',
        target_id: 'ALC-MUN-261106-001-1',
        details_json: '{"lotId":"LOT-2026-001"}',
        created_at: '2026-11-06T05:30:05.000Z',
      },
      {
        audit_id: 'AUD-2',
        tenant_id: 'munambam-demo',
        actor_user_id: 'USR-INSP-01',
        actor_name: 'Dr. Lekshmi R.',
        actor_role: 'AUTHORIZED_INSPECTOR',
        action_code: 'QUALITY_INSPECTION_REJECTED_S21',
        target_type: 'LOT',
        target_id: 'LOT-2026-005',
        details_json: '{"grade":"REJECTED_UNFIT"}',
        created_at: '2026-11-06T06:05:22.000Z',
      },
    ];

    assert.equal(filterAuditLogs(sampleLogs, 'Balakrishnan').length, 1);
    assert.equal(filterAuditLogs(sampleLogs, 'REJECTED_S21').length, 1);
    assert.equal(filterAuditLogs(sampleLogs, 'LOT-2026-005')[0]?.audit_id, 'AUD-2');
    assert.equal(filterAuditLogs(sampleLogs, '', 'AUTHORIZED_INSPECTOR').length, 1);
    assert.equal(filterAuditLogs(sampleLogs, 'nonexistent-query').length, 0);
  });
});

