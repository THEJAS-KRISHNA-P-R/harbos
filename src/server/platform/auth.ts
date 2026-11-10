import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import { config } from '@server/config.ts';
import type { DbPort } from '@server/ports/db.ts';
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

const secretKey = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

function hashOtpWithSalt(code: string, saltHex: string): string {
  return crypto
    .createHash('sha256')
    .update(`${saltHex}:${code.trim()}`)
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
 * Enforces:
 *  - No hardcoded backdoor code (never accepts any code if no challenge was issued)
 *  - Per-phone lockout after 5 failed attempts (`429 OTP_LOCKED`)
 *  - Constant-time comparison via `crypto.timingSafeEqual`
 *  - Single-use consumption (`consumed_at` set atomically; replay rejected with `401`)
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

  // Check if latest challenge for this phone is locked out
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
}

export function requireAuth(allowedRoles?: ReadonlyArray<Role>) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        throw new AppError('UNAUTHORIZED', 'Missing Bearer access token', 401);
      }
      const token = header.slice('Bearer '.length).trim();
      const claims = await verifyAccessJwt(token);

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
