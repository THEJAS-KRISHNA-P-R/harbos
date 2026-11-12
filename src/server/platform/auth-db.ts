import { type DbPort, withPlatform } from '@server/ports/db.ts';
import { findActiveUserByPhoneInTx } from '@server/modules/identity/index.ts';
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

export class PlatformAuthDb {
  constructor(private readonly platformDb: DbPort) {}

  public async lookupUserByPhone(
    phoneE164: string
  ): Promise<PreAuthUserRecord | null> {
    const clean = phoneE164.replace(/\s+/g, '');
    return withPlatform(this.platformDb, (tx) =>
      findActiveUserByPhoneInTx(tx, clean)
    );
  }

  public async issueOtp(phoneE164: string) {
    return issueOtpChallenge(this.platformDb, phoneE164);
  }

  public async verifyOtp(phoneE164: string, code: string): Promise<boolean> {
    return verifyOtpChallenge(this.platformDb, phoneE164, code);
  }

  public async issueRefresh(params: {
    userId: string;
    tenantId: string;
    familyId?: string;
  }) {
    return issueRefreshToken(this.platformDb, params);
  }

  public async rotateRefresh(rawToken: string) {
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
