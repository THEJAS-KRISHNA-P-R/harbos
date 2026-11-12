import { config } from '@server/config.ts';
import { AppError } from '@server/platform/errors.ts';
import { route } from '@server/platform/http-route.ts';
import {
  clearRefreshTokenCookie,
  enforceCrossInstanceAuthRateLimit,
  parseRefreshTokenCookie,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshTokenCookie,
} from '@server/platform/auth.ts';
import { ALL_ROLES } from '@shared/contracts/rbac.ts';
import {
  OtpRequestBodySchema,
  OtpVerifyBodySchema,
  PersonaSwitchBodySchema,
  PrivacyEraseBodySchema,
  RecordConsentBodySchema,
  UpdateLocaleBodySchema,
  UpdateProfileBodySchema,
} from './schemas.ts';
import {
  erasePersonalData,
  exportPersonalData,
  getDemoOperators,
  getOperatorProfile,
  recordOperatorConsent,
  requestOtpForPhone,
  switchDemoPersona,
  updateOperatorLocale,
  updateOperatorProfile,
  verifyOtpAndIssueSession,
} from './service.ts';

export function resolveClientIpFromHeaders(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string | undefined;
  socket?: { remoteAddress?: string | undefined } | undefined;
}): string {
  const forwardedHeader = req.headers['forwarded'];
  const forwardedRaw = Array.isArray(forwardedHeader)
    ? forwardedHeader[0]
    : forwardedHeader;
  if (typeof forwardedRaw === 'string' && forwardedRaw.length > 0) {
    const match = /for=(?:"?\[?([^;,\s"\]]+)\]?"?)/i.exec(forwardedRaw);
    if (match?.[1]) {
      return match[1];
    }
  }
  const xffHeader = req.headers['x-forwarded-for'];
  const xffRaw = Array.isArray(xffHeader) ? xffHeader[0] : xffHeader;
  if (typeof xffRaw === 'string' && xffRaw.length > 0) {
    const firstIp = xffRaw.split(',')[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

export const identityRoutes = [
  route({
    method: 'GET',
    path: '/api/v1/demo/operators',
    roles: 'PUBLIC',
    summary: 'List demo operators (DEMO_MODE && non-production only)',
    tags: ['identity'],
    handler: async (ctx) => {
      if (!config.DEMO_MODE || config.NODE_ENV === 'production') {
        throw new AppError('NOT_FOUND', 'API route not found', 404);
      }
      const operators = await getDemoOperators(ctx.platformDb);
      return { operators };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/otp/request',
    roles: 'PUBLIC',
    summary: 'Request 6-digit OTP challenge (enumeration-safe)',
    tags: ['identity'],
    body: OtpRequestBodySchema,
    handler: async (ctx) => {
      await enforceCrossInstanceAuthRateLimit(ctx.platformDb, {
        clientIp: resolveClientIpFromHeaders(ctx.req),
        path: ctx.req.originalUrl,
      });
      return requestOtpForPhone(
        ctx.platformDb,
        String(ctx.body.phoneE164 ?? '')
      );
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/otp/verify',
    roles: 'PUBLIC',
    summary: 'Verify OTP challenge and issue access JWT + refresh cookie',
    tags: ['identity'],
    body: OtpVerifyBodySchema,
    handler: async (ctx) => {
      await enforceCrossInstanceAuthRateLimit(ctx.platformDb, {
        clientIp: resolveClientIpFromHeaders(ctx.req),
        path: ctx.req.originalUrl,
      });
      const out = await verifyOtpAndIssueSession(
        ctx.platformDb,
        String(ctx.body.phoneE164 ?? ''),
        String(ctx.body.otpCode ?? '')
      );
      setRefreshTokenCookie(ctx.res, out.rawRefreshToken);
      return out.body;
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/refresh',
    roles: 'PUBLIC',
    summary: 'Rotate refresh token cookie and issue fresh access JWT',
    tags: ['identity'],
    handler: async (ctx) => {
      try {
        const rawCookie = parseRefreshTokenCookie(ctx.req);
        if (!rawCookie) {
          throw new AppError(
            'UNAUTHORIZED',
            'Missing refresh token cookie',
            401
          );
        }
        const rotated = await rotateRefreshToken(ctx.platformDb, rawCookie);
        setRefreshTokenCookie(ctx.res, rotated.newRawRefreshToken);
        return {
          accessToken: rotated.accessToken,
          user: rotated.user,
        };
      } catch (err) {
        clearRefreshTokenCookie(ctx.res);
        throw err;
      }
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/logout',
    roles: 'PUBLIC',
    summary: 'Revoke refresh token and clear session cookie',
    tags: ['identity'],
    handler: async (ctx) => {
      const rawCookie = parseRefreshTokenCookie(ctx.req);
      if (rawCookie) {
        await revokeRefreshToken(ctx.platformDb, rawCookie);
      }
      clearRefreshTokenCookie(ctx.res);
      return { loggedOut: true };
    },
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/persona-switch',
    roles: 'PUBLIC',
    summary: 'Switch demo persona (DEMO_MODE && non-production only)',
    tags: ['identity'],
    body: PersonaSwitchBodySchema,
    handler: async (ctx) => {
      const out = await switchDemoPersona(
        ctx.platformDb,
        ctx.db,
        ctx.body.role,
        ctx.body.tenantId
      );
      setRefreshTokenCookie(ctx.res, out.rawRefreshToken);
      return out.body;
    },
  }),

  route({
    method: 'GET',
    path: '/api/v1/me',
    roles: ALL_ROLES,
    summary: 'Return current authenticated user claims',
    tags: ['identity'],
    handler: async (ctx) => ({ user: ctx.auth }),
  }),

  route({
    method: 'GET',
    path: '/api/v1/auth/profile',
    roles: ALL_ROLES,
    summary: 'Fetch operator profile and personal audit trail',
    tags: ['identity'],
    handler: async (ctx) => getOperatorProfile(ctx.db, ctx.auth!),
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/profile',
    roles: ALL_ROLES,
    summary: 'Update operator profile fullName and phoneE164',
    tags: ['identity'],
    body: UpdateProfileBodySchema,
    audit: 'USER_PROFILE_UPDATED',
    handler: async (ctx) =>
      updateOperatorProfile(
        ctx.db,
        ctx.auth!,
        String(ctx.body.fullName ?? ''),
        String(ctx.body.phoneE164 ?? '')
      ),
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/locale',
    roles: ALL_ROLES,
    summary: 'Persist operator preferred locale (ml | en)',
    tags: ['identity'],
    body: UpdateLocaleBodySchema,
    audit: 'USER_LOCALE_UPDATED',
    handler: async (ctx) =>
      updateOperatorLocale(ctx.db, ctx.auth!, ctx.body.locale),
  }),

  route({
    method: 'POST',
    path: '/api/v1/auth/consent',
    roles: ALL_ROLES,
    summary: 'Record DPDP Act 2023 personal data consent',
    tags: ['identity'],
    body: RecordConsentBodySchema,
    audit: 'DPDP_CONSENT_RECORDED',
    handler: async (ctx) =>
      recordOperatorConsent(ctx.db, ctx.auth!, ctx.body.consentVersion),
  }),

  route({
    method: 'GET',
    path: '/api/v1/privacy/export',
    roles: ALL_ROLES,
    summary: 'Export caller personal data under DPDP Act 2023',
    tags: ['identity'],
    handler: async (ctx) => exportPersonalData(ctx.db, ctx.auth!),
  }),

  route({
    method: 'POST',
    path: '/api/v1/privacy/erase',
    roles: ALL_ROLES,
    summary:
      'Pseudonymize caller PII under DPDP Act 2023 while preserving statutory ledger rows',
    tags: ['identity'],
    body: PrivacyEraseBodySchema,
    audit: 'DPDP_PERSONAL_DATA_PSEUDONYMIZED',
    handler: async (ctx) =>
      erasePersonalData(ctx.db, ctx.auth!, ctx.body.reason),
  }),
];
