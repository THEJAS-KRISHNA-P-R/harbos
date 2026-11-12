import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { config } from '@server/config.ts';
import {
  withPlatform,
  withTenant,
  type DbPort,
} from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
import { recordRateLimitEvent } from '@server/platform/observability.ts';
import {
  consumeOtpChallengeRow,
  consumePriorOtpChallengesAndInsertNew,
  fetchLatestOtpChallengeRow,
  fetchLatestOtpLockout,
  fetchUserActiveStatusInTenantTx,
  fetchUserByIdInTx,
  insertRefreshTokenRowInTx,
  lockRefreshTokenByHashInTx,
  markRefreshTokenRotatedInTx,
  revokeAllUserRefreshTokensInTx,
  revokeRefreshTokenByHashInTx,
  revokeRefreshTokenFamilyInTx,
  updateOtpChallengeAttemptOrLock,
  upsertAuthRateLimitBucketInTx,
} from '@server/modules/identity/index.ts';
import type { Role } from '@shared/contracts/rbac.ts';

export interface AuthSessionClaims {
  readonly sub: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly fullName: string;
  readonly phoneE164: string;
  readonly entityRefId?: string | null;
}

const JWT_ISSUER = 'harbouros';
const JWT_AUDIENCE = 'harbouros-api';
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export const REFRESH_COOKIE_NAME = 'harbouros_refresh';

const secretKey = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

export interface CachedUserStatus {
  exists: boolean;
  isActive: boolean;
  role: Role;
  tenantId: string;
  expiresAtMs: number;
}

const authUserCache = new Map<string, CachedUserStatus>();

export function clearAuthUserCache(userId?: string): void {
  if (userId) {
    for (const k of authUserCache.keys()) {
      if (k === userId || k.endsWith(`:${userId}`)) {
        authUserCache.delete(k);
      }
    }
  } else {
    authUserCache.clear();
  }
}

export function hashOtpWithSalt(code: string, saltHex: string): string {
  return crypto
    .createHash('sha256')
    .update(`${saltHex}:${code.trim()}`)
    .digest('hex');
}

export function hashRefreshToken(rawToken: string): string {
  return crypto
    .createHash('sha256')
    .update(`${config.JWT_REFRESH_SECRET}:${rawToken.trim()}`)
    .digest('hex');
}

function constantTimeHexEqual(hexA: string, hexB: string): boolean {
  const bufA = Buffer.from(hexA, 'utf8');
  const bufB = Buffer.from(hexB, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Phase 2.5: Multi-instance auth rate limit check backed by `core.auth_rate_limits` UNLOGGED table.
 */
export async function enforceCrossInstanceAuthRateLimit(
  platformDb: DbPort,
  params: {
    clientIp: string;
    path: string;
    windowSeconds?: number;
    maxRequests?: number;
  }
): Promise<void> {
  const windowSeconds = params.windowSeconds ?? 900;
  const maxRequests = params.maxRequests ?? 25;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowSlot = Math.floor(nowSec / windowSeconds) * windowSeconds;
  const bucketKey = `auth:${params.clientIp}:${windowSlot}`;
  const windowStartIso = new Date(windowSlot * 1000).toISOString();
  const expiresAtIso = new Date((windowSlot + windowSeconds) * 1000).toISOString();

  const hitCount = await withPlatform(platformDb, (tx) =>
    upsertAuthRateLimitBucketInTx(tx, {
      bucketKey,
      windowStartIso,
      expiresAtIso,
    })
  );

  if (hitCount > maxRequests) {
    recordRateLimitEvent({
      scope: 'AUTH',
      allowed: false,
      clientIp: params.clientIp,
      path: params.path,
    });
    throw new AppError(
      'RATE_LIMIT_EXCEEDED',
      'Too many authentication attempts from this IP. Please wait 15 minutes before retrying.',
      429
    );
  }

  recordRateLimitEvent({
    scope: 'AUTH',
    allowed: true,
    clientIp: params.clientIp,
    path: params.path,
  });
}

export async function issueOtpChallenge(
  db: DbPort,
  phoneE164: string
): Promise<{ otpCode: string; challengeId: string; expiresAtIso: string }> {
  const clean = phoneE164.replace(/\s+/g, '');
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const lockedUntil = await fetchLatestOtpLockout(db, clean);
  if (lockedUntil && new Date(lockedUntil).getTime() > nowMs) {
    throw new AppError(
      'OTP_LOCKED',
      'Too many failed OTP attempts for this phone number. Please wait 15 minutes.',
      429
    );
  }

  const otpCode = String(crypto.randomInt(100_000, 1_000_000));
  const saltHex = crypto.randomBytes(16).toString('hex');
  const codeHash = hashOtpWithSalt(otpCode, saltHex);
  const challengeId = `OTP-CH-${crypto.randomUUID()}`;
  const expiresAtIso = new Date(nowMs + OTP_TTL_MS).toISOString();

  await consumePriorOtpChallengesAndInsertNew(db, {
    challengeId,
    phoneE164: clean,
    codeHash,
    saltHex,
    expiresAtIso,
    maxAttempts: OTP_MAX_ATTEMPTS,
    nowIso,
  });

  return { otpCode, challengeId, expiresAtIso };
}

export async function verifyOtpChallenge(
  db: DbPort,
  phoneE164: string,
  code: string
): Promise<boolean> {
  const clean = phoneE164.replace(/\s+/g, '');
  const trimmedCode = code.trim();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const challenge = await fetchLatestOtpChallengeRow(db, clean);
  if (!challenge) {
    return false;
  }

  if (
    challenge.locked_until &&
    new Date(challenge.locked_until).getTime() > nowMs
  ) {
    throw new AppError(
      'OTP_LOCKED',
      'Too many failed OTP verification attempts. Phone is temporarily locked.',
      429
    );
  }

  if (
    challenge.consumed_at !== null ||
    new Date(challenge.expires_at).getTime() < nowMs
  ) {
    return false;
  }

  const candidateHash = hashOtpWithSalt(trimmedCode, challenge.salt);
  const matches = constantTimeHexEqual(candidateHash, challenge.code_hash);

  if (!matches) {
    const nextAttempts = challenge.attempts + 1;
    if (nextAttempts >= challenge.max_attempts) {
      const lockUntilIso = new Date(nowMs + OTP_LOCKOUT_MS).toISOString();
      await updateOtpChallengeAttemptOrLock(db, {
        challengeId: challenge.challenge_id,
        attempts: nextAttempts,
        lockedUntilIso: lockUntilIso,
      });
      throw new AppError(
        'OTP_LOCKED',
        'Maximum OTP verification attempts exceeded. Challenge locked for 15 minutes.',
        429
      );
    }

    await updateOtpChallengeAttemptOrLock(db, {
      challengeId: challenge.challenge_id,
      attempts: nextAttempts,
    });
    return false;
  }

  return consumeOtpChallengeRow(db, challenge.challenge_id, nowIso);
}

export async function issueRefreshToken(
  db: DbPort,
  params: {
    userId: string;
    tenantId: string;
    familyId?: string;
  }
): Promise<{
  rawToken: string;
  tokenHash: string;
  familyId: string;
  expiresAtIso: string;
}> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashRefreshToken(rawToken);
  const familyId = params.familyId ?? `FAM-${crypto.randomUUID()}`;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const expiresAtIso = new Date(nowMs + REFRESH_TTL_MS).toISOString();

  await withPlatform(db, (tx) =>
    insertRefreshTokenRowInTx(tx, {
      tokenHash,
      userId: params.userId,
      tenantId: params.tenantId,
      familyId,
      expiresAtIso,
      nowIso,
    })
  );

  return { rawToken, tokenHash, familyId, expiresAtIso };
}

export async function rotateRefreshToken(
  db: DbPort,
  rawToken: string
): Promise<{
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
  if (!rawToken || !rawToken.trim()) {
    throw new AppError('UNAUTHORIZED', 'Missing refresh token', 401);
  }
  const tokenHash = hashRefreshToken(rawToken);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let reuseDetected = false;

  const result = await withPlatform(db, async (tx) => {
    const row = await lockRefreshTokenByHashInTx(tx, tokenHash);
    if (!row) {
      throw new AppError('UNAUTHORIZED', 'Invalid refresh token', 401);
    }

    if (row.rotated_at !== null) {
      await revokeRefreshTokenFamilyInTx(tx, row.family_id, nowIso);
      reuseDetected = true;
      return null;
    }

    if (row.revoked_at !== null || new Date(row.expires_at).getTime() <= nowMs) {
      throw new AppError(
        'UNAUTHORIZED',
        'Refresh token is expired or revoked',
        401
      );
    }

    const user = await fetchUserByIdInTx(tx, row.user_id);
    if (!user || !user.is_active) {
      await revokeRefreshTokenFamilyInTx(tx, row.family_id, nowIso);
      reuseDetected = true;
      return null;
    }

    await markRefreshTokenRotatedInTx(tx, tokenHash, nowIso);

    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashRefreshToken(newRawRefreshToken);
    const newExpiresAtIso = new Date(nowMs + REFRESH_TTL_MS).toISOString();

    await insertRefreshTokenRowInTx(tx, {
      tokenHash: newTokenHash,
      userId: user.user_id,
      tenantId: user.tenant_id,
      familyId: row.family_id,
      expiresAtIso: newExpiresAtIso,
      nowIso,
    });

    const accessToken = await signAccessJwt({
      sub: user.user_id,
      tenantId: user.tenant_id,
      role: user.role,
      fullName: user.full_name,
      phoneE164: user.phone_e164,
      entityRefId: user.entity_ref_id,
    });

    return {
      accessToken,
      newRawRefreshToken,
      user: {
        userId: user.user_id,
        tenantId: user.tenant_id,
        phoneE164: user.phone_e164,
        fullName: user.full_name,
        role: user.role,
        entityRefId: user.entity_ref_id,
      },
    };
  });

  if (reuseDetected || !result) {
    throw new AppError(
      'UNAUTHORIZED',
      'Refresh token reuse or deactivated user detected; token family revoked.',
      401
    );
  }

  return result;
}

export async function revokeRefreshToken(
  db: DbPort,
  rawToken: string
): Promise<void> {
  if (!rawToken || !rawToken.trim()) return;
  const tokenHash = hashRefreshToken(rawToken);
  const nowIso = new Date().toISOString();
  await withPlatform(db, (tx) =>
    revokeRefreshTokenByHashInTx(tx, tokenHash, nowIso)
  );
}

export async function revokeAllUserRefreshTokens(
  db: DbPort,
  userId: string
): Promise<void> {
  clearAuthUserCache(userId);
  const nowIso = new Date().toISOString();
  await withPlatform(db, (tx) =>
    revokeAllUserRefreshTokensInTx(tx, userId, nowIso)
  );
}

export function setRefreshTokenCookie(res: Response, rawToken: string): void {
  res.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=${rawToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=1209600`
  );
}

export function clearRefreshTokenCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=0`
  );
}

export function parseRefreshTokenCookie(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...vParts] = part.trim().split('=');
    if (k === REFRESH_COOKIE_NAME) {
      return vParts.join('=').trim() || null;
    }
  }
  return null;
}

export async function signAccessJwt(claims: AuthSessionClaims): Promise<string> {
  return new SignJWT({
    tenantId: claims.tenantId,
    role: claims.role,
    fullName: claims.fullName,
    phoneE164: claims.phoneE164,
    entityRefId: claims.entityRefId ?? null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setJti(crypto.randomUUID())
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secretKey);
}

export async function verifyAccessJwt(token: string): Promise<AuthSessionClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (
      !payload.sub ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.role !== 'string'
    ) {
      throw new AppError('UNAUTHORIZED', 'Malformed JWT claims', 401);
    }
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role as Role,
      fullName:
        typeof payload.fullName === 'string' ? payload.fullName : 'Operator',
      phoneE164:
        typeof payload.phoneE164 === 'string' ? payload.phoneE164 : '',
      entityRefId:
        typeof payload.entityRefId === 'string' ? payload.entityRefId : null,
    };
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired access token', 401);
  }
}

export function hashSupervisorPin(pin: string, saltHex?: string): string {
  const salt = saltHex ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin.trim(), salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifySupervisorPin(
  candidatePin: string,
  storedPinHash: string | null | undefined,
  legacyPinCode: string | null | undefined
): boolean {
  const cleanCandidate = candidatePin.trim();
  if (!cleanCandidate) return false;
  if (storedPinHash && storedPinHash.startsWith('scrypt:')) {
    const [, salt, expectedHex] = storedPinHash.split(':');
    if (!salt || !expectedHex) return false;
    const actualHex = crypto.scryptSync(cleanCandidate, salt, 32).toString('hex');
    return constantTimeHexEqual(actualHex, expectedHex);
  }
  if (legacyPinCode) {
    return constantTimeHexEqual(
      crypto.createHash('sha256').update(cleanCandidate).digest('hex'),
      crypto.createHash('sha256').update(legacyPinCode.trim()).digest('hex')
    );
  }
  return false;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthSessionClaims;
  db?: DbPort;
}

export async function resolveUserActiveStatusForAuth(
  baseDb: DbPort,
  tenantId: string,
  userId: string
): Promise<CachedUserStatus> {
  const ttlMs = config.AUTH_CACHE_TTL_MS;
  const cacheKey = `${tenantId}:${userId}`;
  const nowMs = Date.now();
  if (ttlMs > 0) {
    const cached = authUserCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) return cached;
  }

  const row = await withTenant(
    baseDb,
    tenantId,
    (tx) => fetchUserActiveStatusInTenantTx(tx, tenantId, userId),
    { readOnly: true }
  );

  const status: CachedUserStatus = row
    ? { exists: true, isActive: Boolean(row.is_active), role: row.role, tenantId: row.tenant_id, expiresAtMs: nowMs + ttlMs }
    : { exists: false, isActive: true, role: 'WHOLESALE_BUYER', tenantId: '', expiresAtMs: nowMs + ttlMs };

  if (ttlMs > 0) authUserCache.set(cacheKey, status);
  return status;
}

export function requireAuth(allowedRoles?: ReadonlyArray<Role>) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        throw new AppError('UNAUTHORIZED', 'Missing Bearer access token', 401);
      }
      const token = header.slice('Bearer '.length).trim();
      let claims = await verifyAccessJwt(token);

      const baseDb = req.app?.locals?.db as DbPort | undefined;
      if (baseDb) {
        const userStatus = await resolveUserActiveStatusForAuth(baseDb, claims.tenantId, claims.sub);
        if (userStatus.exists) {
          if (!userStatus.isActive) {
            throw new AppError('UNAUTHORIZED', 'Operator account is deactivated', 401);
          }
          if (userStatus.tenantId === claims.tenantId) {
            claims = { ...claims, role: userStatus.role };
          }
        }
      }

      if (allowedRoles && !allowedRoles.includes(claims.role)) {
        throw new AppError(
          'FORBIDDEN',
          `Role ${claims.role} is not permitted for this endpoint. Required: ${allowedRoles.join(', ')}`,
          403
        );
      }

      req.auth = claims;
      next();
    } catch (err) {
      next(err);
    }
  };
}

