import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { config } from '@server/config.ts';
import { createTenantBoundDb, withPlatform, type DbPort } from '@server/ports/db.ts';
import { AppError } from '@server/platform/errors.ts';
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
const USER_STATUS_CACHE_TTL_MS = 15_000; // <= 15s

export const REFRESH_COOKIE_NAME = 'harbouros_refresh';

const secretKey = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

interface CachedUserStatus {
  exists: boolean;
  isActive: boolean;
  role: Role;
  tenantId: string;
  expiresAtMs: number;
}

const authUserCache = new Map<string, CachedUserStatus>();

export function clearAuthUserCache(userId?: string): void {
  if (userId) {
    authUserCache.delete(userId);
  } else {
    authUserCache.clear();
  }
}

function hashOtpWithSalt(code: string, saltHex: string): string {
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
 * Issues a CSPRNG 6-digit OTP challenge persisted in `core.otp_challenges`
 * with a per-challenge salt, SHA-256 hash, 5-minute TTL, and attempt counter.
 */
export async function issueOtpChallenge(
  db: DbPort,
  phoneE164: string
): Promise<{ otpCode: string; challengeId: string; expiresAtIso: string }> {
  const clean = phoneE164.replace(/\s+/g, '');
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Check if phone currently has an active lockout
  const lockRes = await db.query<{ locked_until: string | null }>(
    `SELECT locked_until::text AS locked_until
     FROM core.otp_challenges
     WHERE phone_e164 = $1 AND locked_until IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [clean]
  );
  const lockedUntil = lockRes.rows[0]?.locked_until;
  if (lockedUntil && new Date(lockedUntil).getTime() > nowMs) {
    throw new AppError(
      'OTP_LOCKED',
      'Too many failed OTP attempts for this phone number. Please wait 15 minutes.',
      429
    );
  }

  // Expire any previous unconsumed challenges for this phone
  await db.query(
    `UPDATE core.otp_challenges
     SET consumed_at = $2
     WHERE phone_e164 = $1 AND consumed_at IS NULL`,
    [clean, nowIso]
  );

  const otpCode = String(crypto.randomInt(100_000, 1_000_000));
  const saltHex = crypto.randomBytes(16).toString('hex');
  const codeHash = hashOtpWithSalt(otpCode, saltHex);
  const challengeId = `OTP-CH-${crypto.randomUUID()}`;
  const expiresAtIso = new Date(nowMs + OTP_TTL_MS).toISOString();

  await db.query(
    `INSERT INTO core.otp_challenges (
      challenge_id, phone_e164, code_hash, salt, expires_at,
      attempts, max_attempts, consumed_at, locked_until, created_at
    ) VALUES ($1, $2, $3, $4, $5, 0, $6, NULL, NULL, $7)`,
    [challengeId, clean, codeHash, saltHex, expiresAtIso, OTP_MAX_ATTEMPTS, nowIso]
  );

  return { otpCode, challengeId, expiresAtIso };
}

/**
 * Verifies a 6-digit OTP code against `core.otp_challenges`.
 */
export async function verifyOtpChallenge(
  db: DbPort,
  phoneE164: string,
  code: string
): Promise<boolean> {
  const clean = phoneE164.replace(/\s+/g, '');
  const trimmedCode = code.trim();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const latestRes = await db.query<{
    challenge_id: string;
    code_hash: string;
    salt: string;
    expires_at: string;
    attempts: number;
    max_attempts: number;
    consumed_at: string | null;
    locked_until: string | null;
  }>(
    `SELECT challenge_id, code_hash, salt, expires_at::text AS expires_at,
            attempts, max_attempts, consumed_at::text AS consumed_at,
            locked_until::text AS locked_until
     FROM core.otp_challenges
     WHERE phone_e164 = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [clean]
  );

  const challenge = latestRes.rows[0];
  if (!challenge) {
    return false;
  }

  if (challenge.locked_until && new Date(challenge.locked_until).getTime() > nowMs) {
    throw new AppError(
      'OTP_LOCKED',
      'Too many failed OTP verification attempts. Phone is temporarily locked.',
      429
    );
  }

  if (challenge.consumed_at !== null) {
    return false;
  }

  if (new Date(challenge.expires_at).getTime() < nowMs) {
    return false;
  }

  const candidateHash = hashOtpWithSalt(trimmedCode, challenge.salt);
  const matches = constantTimeHexEqual(candidateHash, challenge.code_hash);

  if (!matches) {
    const nextAttempts = challenge.attempts + 1;
    if (nextAttempts >= challenge.max_attempts) {
      const lockUntilIso = new Date(nowMs + OTP_LOCKOUT_MS).toISOString();
      await db.query(
        `UPDATE core.otp_challenges
         SET attempts = $1, locked_until = $2
         WHERE challenge_id = $3`,
        [nextAttempts, lockUntilIso, challenge.challenge_id]
      );
      throw new AppError(
        'OTP_LOCKED',
        'Maximum OTP verification attempts exceeded. Challenge locked for 15 minutes.',
        429
      );
    }

    await db.query(
      `UPDATE core.otp_challenges SET attempts = $1 WHERE challenge_id = $2`,
      [nextAttempts, challenge.challenge_id]
    );
    return false;
  }

  const consumeRes = await db.query<{ challenge_id: string }>(
    `UPDATE core.otp_challenges
     SET consumed_at = $1
     WHERE challenge_id = $2 AND consumed_at IS NULL
     RETURNING challenge_id`,
    [nowIso, challenge.challenge_id]
  );

  return consumeRes.rows.length > 0;
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

  await withPlatform(db, async (tx) => {
    await tx.query(
      `INSERT INTO core.refresh_tokens (
        token_hash, user_id, tenant_id, family_id, expires_at, rotated_at, revoked_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)`,
      [tokenHash, params.userId, params.tenantId, familyId, expiresAtIso, nowIso]
    );
  });

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
    const tokenRes = await tx.query<{
      token_hash: string;
      user_id: string;
      tenant_id: string;
      family_id: string;
      expires_at: string;
      rotated_at: string | null;
      revoked_at: string | null;
    }>(
      `SELECT token_hash, user_id, tenant_id, family_id,
              expires_at::text AS expires_at,
              rotated_at::text AS rotated_at,
              revoked_at::text AS revoked_at
       FROM core.refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );

    const row = tokenRes.rows[0];
    if (!row) {
      throw new AppError('UNAUTHORIZED', 'Invalid refresh token', 401);
    }

    // Reuse detection: if an already-rotated token is presented again, revoke the entire family!
    if (row.rotated_at !== null) {
      await tx.query(
        `UPDATE core.refresh_tokens
         SET revoked_at = $1
         WHERE family_id = $2 AND revoked_at IS NULL`,
        [nowIso, row.family_id]
      );
      reuseDetected = true;
      return null;
    }

    if (row.revoked_at !== null || new Date(row.expires_at).getTime() <= nowMs) {
      throw new AppError('UNAUTHORIZED', 'Refresh token is expired or revoked', 401);
    }

    const userRes = await tx.query<{
      user_id: string;
      tenant_id: string;
      phone_e164: string;
      full_name: string;
      role: Role;
      entity_ref_id: string | null;
      is_active: boolean;
    }>(
      `SELECT user_id, tenant_id, phone_e164, full_name, role, entity_ref_id, is_active
       FROM core.users
       WHERE user_id = $1
       LIMIT 1`,
      [row.user_id]
    );
    const user = userRes.rows[0];
    if (!user || !user.is_active) {
      await tx.query(
        `UPDATE core.refresh_tokens
         SET revoked_at = $1
         WHERE family_id = $2 AND revoked_at IS NULL`,
        [nowIso, row.family_id]
      );
      reuseDetected = true;
      return null;
    }

    await tx.query(
      `UPDATE core.refresh_tokens
       SET rotated_at = $1
       WHERE token_hash = $2`,
      [nowIso, tokenHash]
    );

    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = hashRefreshToken(newRawRefreshToken);
    const newExpiresAtIso = new Date(nowMs + REFRESH_TTL_MS).toISOString();

    await tx.query(
      `INSERT INTO core.refresh_tokens (
        token_hash, user_id, tenant_id, family_id, expires_at, rotated_at, revoked_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6)`,
      [newTokenHash, user.user_id, user.tenant_id, row.family_id, newExpiresAtIso, nowIso]
    );

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

export async function revokeRefreshToken(db: DbPort, rawToken: string): Promise<void> {
  if (!rawToken || !rawToken.trim()) return;
  const tokenHash = hashRefreshToken(rawToken);
  const nowIso = new Date().toISOString();
  await withPlatform(db, async (tx) => {
    await tx.query(
      `UPDATE core.refresh_tokens
       SET revoked_at = $1
       WHERE token_hash = $2 AND revoked_at IS NULL`,
      [nowIso, tokenHash]
    );
  });
}

export async function revokeAllUserRefreshTokens(db: DbPort, userId: string): Promise<void> {
  clearAuthUserCache(userId);
  const nowIso = new Date().toISOString();
  await withPlatform(db, async (tx) => {
    await tx.query(
      `UPDATE core.refresh_tokens
       SET revoked_at = $1
       WHERE user_id = $2 AND revoked_at IS NULL`,
      [nowIso, userId]
    );
  });
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
  const parts = cookieHeader.split(';');
  for (const part of parts) {
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
    if (!payload.sub || typeof payload.tenantId !== 'string' || typeof payload.role !== 'string') {
      throw new AppError('UNAUTHORIZED', 'Malformed JWT claims', 401);
    }
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role as Role,
      fullName: typeof payload.fullName === 'string' ? payload.fullName : 'Operator',
      phoneE164: typeof payload.phoneE164 === 'string' ? payload.phoneE164 : '',
      entityRefId: typeof payload.entityRefId === 'string' ? payload.entityRefId : null,
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
    const parts = storedPinHash.split(':');
    const salt = parts[1];
    const expectedHex = parts[2];
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

async function resolveUserActiveStatus(
  baseDb: DbPort,
  userId: string
): Promise<CachedUserStatus> {
  const nowMs = Date.now();
  const cached = authUserCache.get(userId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached;
  }

  const row = await withPlatform(baseDb, async (tx) => {
    const res = await tx.query<{
      user_id: string;
      tenant_id: string;
      role: Role;
      is_active: boolean;
    }>(
      `SELECT user_id, tenant_id, role, is_active
       FROM core.users
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    return res.rows[0] ?? null;
  });

  const status: CachedUserStatus = row
    ? {
        exists: true,
        isActive: Boolean(row.is_active),
        role: row.role,
        tenantId: row.tenant_id,
        expiresAtMs: nowMs + USER_STATUS_CACHE_TTL_MS,
      }
    : {
        exists: false,
        isActive: true,
        role: 'WHOLESALE_BUYER',
        tenantId: '',
        expiresAtMs: nowMs + USER_STATUS_CACHE_TTL_MS,
      };

  authUserCache.set(userId, status);
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
        const userStatus = await resolveUserActiveStatus(baseDb, claims.sub);
        if (userStatus.exists) {
          if (!userStatus.isActive) {
            throw new AppError('UNAUTHORIZED', 'Operator account is deactivated', 401);
          }
          if (userStatus.tenantId === claims.tenantId) {
            claims = {
              ...claims,
              role: userStatus.role,
            };
          }
        }
        req.db = createTenantBoundDb(baseDb, claims.tenantId);
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
