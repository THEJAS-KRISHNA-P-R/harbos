import crypto from 'node:crypto';
import { auditInTx, withPlatform, type DbPort } from '@server/ports/db.ts';
import { config } from '@server/config.ts';
import { AppError } from '@server/platform/errors.ts';
import {
  clearAuthUserCache,
  issueOtpChallenge,
  issueRefreshToken,
  signAccessJwt,
  verifyOtpChallenge,
  type AuthSessionClaims,
} from '@server/platform/auth.ts';
import { DEMO_TENANT_ID } from '@server/platform/seed.ts';
import type { Role } from '@shared/contracts/rbac.ts';
import {
  executePersonalDataErasureInTx,
  exportCallerPrivacyData,
  fetchOperatorProfileAndAudit,
  findActiveUserByPhoneInTx,
  findActiveUserByRoleInTx,
  insertOtpOutboxEventInTx,
  listDemoOperatorsInTx,
  updateOperatorConsentInTx,
  updateOperatorLocaleInTx,
  updateOperatorProfileInTx,
} from './repo.ts';

export async function getDemoOperators(platformDb: DbPort) {
  return withPlatform(platformDb, async (tx) => {
    const rows = await listDemoOperatorsInTx(tx, DEMO_TENANT_ID);
    return rows.map((u) => ({
      userId: u.user_id,
      tenantId: u.tenant_id,
      phoneE164: u.phone_e164,
      fullName: u.full_name,
      role: u.role,
    }));
  });
}

export async function requestOtpForPhone(
  platformDb: DbPort,
  rawPhoneInput: string
) {
  const rawPhone = rawPhoneInput.replace(/\s+/g, '');
  if (!/^\+[1-9]\d{9,14}$/.test(rawPhone)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'phoneE164 must be a valid E.164 phone number starting with +',
      400
    );
  }

  const { user, challenge } = await withPlatform(platformDb, async (tx) => {
    const foundUser = await findActiveUserByPhoneInTx(tx, rawPhone);
    const issuedChallenge = await issueOtpChallenge(tx, rawPhone);

    if (foundUser) {
      await insertOtpOutboxEventInTx(tx, {
        eventId: `OTP-${crypto.randomUUID()}`,
        tenantId: foundUser.tenant_id,
        recipient: rawPhone,
        payloadJson: JSON.stringify({
          challengeId: issuedChallenge.challengeId,
          otpCode: issuedChallenge.otpCode,
        }),
        status: config.SMS_PROVIDER === 'msg91' ? 'PENDING' : 'DISPATCHED_CONSOLE',
        nowIso: new Date().toISOString(),
      });
    }

    return { user: foundUser, challenge: issuedChallenge };
  });

  return {
    status: 'OTP_CHALLENGE_ISSUED',
    message:
      'If this phone number is registered, a 6-digit OTP has been dispatched.',
    ...(config.OTP_DEV_ECHO && user ? { devOtpEcho: challenge.otpCode } : {}),
  };
}

export async function verifyOtpAndIssueSession(
  platformDb: DbPort,
  rawPhoneInput: string,
  otpCodeInput: string
) {
  const rawPhone = rawPhoneInput.replace(/\s+/g, '');
  const otpCode = otpCodeInput.trim();
  if (!rawPhone || !otpCode) {
    throw new AppError(
      'VALIDATION_ERROR',
      'phoneE164 and otpCode are required',
      400
    );
  }

  const verified = await verifyOtpChallenge(platformDb, rawPhone, otpCode);
  if (!verified) {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired OTP code', 401);
  }

  const user = await withPlatform(platformDb, (tx) =>
    findActiveUserByPhoneInTx(tx, rawPhone)
  );
  if (!user) {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired OTP code', 401);
  }

  const accessToken = await signAccessJwt({
    sub: user.user_id,
    tenantId: user.tenant_id,
    role: user.role,
    fullName: user.full_name,
    phoneE164: user.phone_e164,
    entityRefId: user.entity_ref_id,
  });

  const refresh = await issueRefreshToken(platformDb, {
    userId: user.user_id,
    tenantId: user.tenant_id,
  });

  return {
    rawRefreshToken: refresh.rawToken,
    body: {
      accessToken,
      user: {
        userId: user.user_id,
        tenantId: user.tenant_id,
        phoneE164: user.phone_e164,
        fullName: user.full_name,
        role: user.role,
        entityRefId: user.entity_ref_id,
      },
    },
  };
}

export async function switchDemoPersona(
  platformDb: DbPort,
  baseDb: DbPort,
  roleInput?: string,
  tenantIdInput?: string
) {
  if (!config.DEMO_MODE || config.NODE_ENV === 'production') {
    throw new AppError(
      'FORBIDDEN',
      'Demo persona switcher is disabled in production',
      403
    );
  }
  const role = String(roleInput ?? 'HARBOUR_ADMIN') as Role;
  const requestedTenantId = String(tenantIdInput ?? DEMO_TENANT_ID);

  const user = await withPlatform(platformDb, (tx) =>
    findActiveUserByRoleInTx(tx, role, requestedTenantId)
  );
  if (!user) {
    throw new AppError('NOT_FOUND', `No persona found for role ${role}`, 404);
  }

  const effectiveTenantId =
    role === 'SUPER_ADMIN' && requestedTenantId
      ? requestedTenantId
      : user.tenant_id;

  const accessToken = await signAccessJwt({
    sub: user.user_id,
    tenantId: effectiveTenantId,
    role: user.role,
    fullName: user.full_name,
    phoneE164: user.phone_e164,
    entityRefId: user.entity_ref_id,
  });

  const refresh = await issueRefreshToken(baseDb, {
    userId: user.user_id,
    tenantId: effectiveTenantId,
  });

  return {
    rawRefreshToken: refresh.rawToken,
    body: {
      accessToken,
      user: {
        userId: user.user_id,
        tenantId: effectiveTenantId,
        phoneE164: user.phone_e164,
        fullName: user.full_name,
        role: user.role,
        entityRefId: user.entity_ref_id,
      },
    },
  };
}

export async function getOperatorProfile(
  db: DbPort,
  claims: AuthSessionClaims
) {
  const { profile, recentAudit } = await fetchOperatorProfileAndAudit(
    db,
    claims.tenantId,
    claims.sub
  );
  if (!profile) {
    throw new AppError(
      'NOT_FOUND',
      'Authenticated operator record not found',
      404
    );
  }
  return {
    profile,
    claims,
    recentAudit,
  };
}

export async function updateOperatorProfile(
  db: DbPort,
  claims: AuthSessionClaims,
  rawFullName: string,
  rawPhoneE164: string
) {
  const fullName = rawFullName.trim();
  const phoneE164 = rawPhoneE164.trim().replace(/\s+/g, '');
  if (fullName.length < 2) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Full name must be at least 2 characters',
      400
    );
  }
  if (!/^\+[1-9]\d{9,14}$/.test(phoneE164)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Phone number must be in E.164 format starting with +',
      400
    );
  }

  await db.transaction(async (tx) => {
    await updateOperatorProfileInTx(tx, {
      tenantId: claims.tenantId,
      userId: claims.sub,
      fullName,
      phoneE164,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'USER_PROFILE_UPDATED',
      targetType: 'USER',
      targetId: claims.sub,
      details: { fullName, phoneE164 },
    });
  });

  clearAuthUserCache(claims.sub);

  const accessToken = await signAccessJwt({
    sub: claims.sub,
    tenantId: claims.tenantId,
    role: claims.role,
    fullName,
    phoneE164,
    entityRefId: claims.entityRefId ?? null,
  });

  return {
    accessToken,
    user: {
      userId: claims.sub,
      tenantId: claims.tenantId,
      phoneE164,
      fullName,
      role: claims.role,
      entityRefId: claims.entityRefId ?? null,
    },
  };
}

export async function updateOperatorLocale(
  db: DbPort,
  claims: AuthSessionClaims,
  locale: 'ml' | 'en'
) {
  await db.transaction(async (tx) => {
    await updateOperatorLocaleInTx(tx, {
      tenantId: claims.tenantId,
      userId: claims.sub,
      locale,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'USER_LOCALE_UPDATED',
      targetType: 'USER',
      targetId: claims.sub,
      details: { preferredLocale: locale },
    });
  });
  return { updated: true, preferredLocale: locale };
}

export async function recordOperatorConsent(
  db: DbPort,
  claims: AuthSessionClaims,
  consentVersion: string
) {
  const nowIso = new Date().toISOString();
  await db.transaction(async (tx) => {
    await updateOperatorConsentInTx(tx, {
      tenantId: claims.tenantId,
      userId: claims.sub,
      consentVersion,
      nowIso,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'DPDP_CONSENT_RECORDED',
      targetType: 'USER',
      targetId: claims.sub,
      details: { consentVersion, consentAt: nowIso },
    });
  });
  return {
    recorded: true,
    consentVersion,
    consentAt: nowIso,
  };
}

export async function exportPersonalData(
  db: DbPort,
  claims: AuthSessionClaims
) {
  const data = await exportCallerPrivacyData(db, {
    tenantId: claims.tenantId,
    userId: claims.sub,
    entityRefId: claims.entityRefId ?? null,
  });
  return {
    exportedAt: new Date().toISOString(),
    statutoryNotice:
      'Exported under DPDP Act 2023. Statutory auction and ledger records are retained for 8 years under Act 16 of 2021 s.22 and Income Tax Act.',
    ...data,
  };
}

export async function erasePersonalData(
  db: DbPort,
  claims: AuthSessionClaims,
  reason: string
) {
  const requestId = `ERA-${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  const phoneDigestDigits = crypto
    .createHash('sha256')
    .update(`${claims.tenantId}:${claims.sub}`)
    .digest('hex')
    .replace(/[^0-9]/g, '')
    .padEnd(11, '9')
    .slice(0, 11);
  const pseudonymPhone = `+999${phoneDigestDigits}`;
  const pseudonymName = `ERASED-${claims.sub}`;

  await db.transaction(async (tx) => {
    await executePersonalDataErasureInTx(tx, {
      requestId,
      tenantId: claims.tenantId,
      userId: claims.sub,
      entityRefId: claims.entityRefId ?? null,
      pseudonymPhone,
      pseudonymName,
      reason,
      nowIso,
    });
    await auditInTx(tx, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      actorRole: claims.role,
      actionCode: 'DPDP_PERSONAL_DATA_PSEUDONYMIZED',
      targetType: 'USER',
      targetId: claims.sub,
      details: {
        requestId,
        status: 'PSEUDONYMIZED_STATUTORY_RETENTION',
        statutoryBasis: 'Act 16 of 2021 s.22 & Income Tax Act (8-year ledger preservation)',
      },
    });
  });

  clearAuthUserCache(claims.sub);

  return {
    requestId,
    status: 'PSEUDONYMIZED_STATUTORY_RETENTION',
    erasedAt: nowIso,
    pseudonymName,
    statutoryLedgerPreserved: true,
  };
}
