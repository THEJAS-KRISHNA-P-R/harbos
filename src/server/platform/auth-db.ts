import { type DbPort, withPlatform } from '@server/ports/db.ts';
import type { Role } from '@shared/contracts/rbac.ts';
import {
  issueOtpChallenge,
  verifyOtpChallenge,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} from './auth.ts';

export interface PreAuthUserRecord {
  user_id: string;
  tenant_id: string;
  phone_e164: string;
  full_name: string;
  role: Role;
  entity_ref_id: string | null;
}

/**
 * Platform-privileged database port for pre-authentication operations.
 * Must connect as `harbour_platform` (BYPASSRLS) to resolve user identities
 * across tenants and operate on platform-only tables (otp_challenges, refresh_tokens).
 */
export class PlatformAuthDb {
  constructor(private readonly platformDb: DbPort) {}

  public async lookupUserByPhone(phoneE164: string): Promise<PreAuthUserRecord | null> {
    const clean = phoneE164.replace(/\s+/g, '');
    return withPlatform(this.platformDb, async (tx) => {
      const res = await tx.query<PreAuthUserRecord>(
        `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id
         FROM core.users
         WHERE phone_e164 = $1 AND is_active = true
         LIMIT 1`,
        [clean]
      );
      return res.rows[0] ?? null;
    });
  }

  public async issueOtp(phoneE164: string): Promise<{
    otpCode: string;
    challengeId: string;
    expiresAtIso: string;
  }> {
    return issueOtpChallenge(this.platformDb, phoneE164);
  }

  public async verifyOtp(phoneE164: string, code: string): Promise<boolean> {
    return verifyOtpChallenge(this.platformDb, phoneE164, code);
  }

  public async issueRefresh(params: {
    userId: string;
    tenantId: string;
    familyId?: string;
  }): Promise<{
    rawToken: string;
    tokenHash: string;
    familyId: string;
    expiresAtIso: string;
  }> {
    return issueRefreshToken(this.platformDb, params);
  }

  public async rotateRefresh(rawToken: string): Promise<{
    accessToken: string;
    newRawRefreshToken: string;
    user: {
      userId: string;
      tenantId: string;
      phoneE164: string;
      fullName: string;
      role: Role;
      entityRefId: string | null;
    };
  }> {
    return rotateRefreshToken(this.platformDb, rawToken);
  }

  public async revokeRefresh(rawToken: string): Promise<void> {
    return revokeRefreshToken(this.platformDb, rawToken);
  }
}

export {
  issueOtpChallenge,
  verifyOtpChallenge,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
};
