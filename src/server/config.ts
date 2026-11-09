import crypto from 'node:crypto';
import { z } from 'zod';

const RawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional().default(''),
  PG_CONNECTION_STRING: z.string().optional().default(''),
  PGLITE_DATA_DIR: z.string().default('./.data/pglite'),
  JWT_ACCESS_SECRET: z.string().optional().default(''),
  JWT_REFRESH_SECRET: z.string().optional().default(''),
  JWT_HS256_SECRET: z.string().optional().default(''),
  QR_HMAC_SECRET: z.string().optional().default(''),
  OTP_DEV_ECHO: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  DEMO_MODE: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  LLM_PROVIDER: z.enum(['none', 'gemini']).default('none'),
  LLM_MODEL_VISION: z.string().default('gemini-2.5-flash'),
  GEMINI_API_KEY: z.string().optional().default(''),
  SMS_PROVIDER: z.enum(['console', 'noop']).default('console'),
  WHATSAPP_PROVIDER: z.enum(['console', 'noop']).default('console'),
  DISABLE_HMR: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
});

export interface AppConfig {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly PORT: number;
  readonly DATABASE_URL: string;
  readonly PGLITE_DATA_DIR: string;
  readonly JWT_ACCESS_SECRET: string;
  readonly JWT_REFRESH_SECRET: string;
  readonly QR_HMAC_SECRET: string;
  readonly OTP_DEV_ECHO: boolean;
  readonly DEMO_MODE: boolean;
  readonly LLM_PROVIDER: 'none' | 'gemini';
  readonly LLM_MODEL_VISION: string;
  readonly GEMINI_API_KEY: string;
  readonly SMS_PROVIDER: 'console' | 'noop';
  readonly WHATSAPP_PROVIDER: 'console' | 'noop';
  readonly DISABLE_HMR: boolean;
}

export function parseEnvConfig(rawEnv: Record<string, string | undefined>): AppConfig {
  const parsed = RawEnvSchema.parse(rawEnv);

  if (parsed.NODE_ENV === 'production' && parsed.OTP_DEV_ECHO) {
    throw new Error(
      'FATAL [config]: OTP_DEV_ECHO=true is strictly forbidden when NODE_ENV=production.'
    );
  }

  const rawAccess = (parsed.JWT_ACCESS_SECRET || parsed.JWT_HS256_SECRET).trim();
  if (parsed.NODE_ENV === 'production' && Buffer.byteLength(rawAccess, 'utf8') < 32) {
    throw new Error(
      'FATAL [config]: JWT_ACCESS_SECRET must be at least 32 bytes when NODE_ENV=production.'
    );
  }

  const ensureSecret = (val: string): string =>
    Buffer.byteLength(val.trim(), 'utf8') >= 32
      ? val.trim()
      : crypto.randomBytes(32).toString('hex');

  return {
    NODE_ENV: parsed.NODE_ENV,
    PORT: parsed.PORT,
    DATABASE_URL: parsed.DATABASE_URL || parsed.PG_CONNECTION_STRING,
    PGLITE_DATA_DIR: parsed.PGLITE_DATA_DIR,
    JWT_ACCESS_SECRET: ensureSecret(rawAccess),
    JWT_REFRESH_SECRET: ensureSecret(parsed.JWT_REFRESH_SECRET),
    QR_HMAC_SECRET: ensureSecret(parsed.QR_HMAC_SECRET),
    OTP_DEV_ECHO: parsed.NODE_ENV === 'production' ? false : parsed.OTP_DEV_ECHO,
    DEMO_MODE: parsed.NODE_ENV === 'production' ? false : parsed.DEMO_MODE,
    LLM_PROVIDER: parsed.LLM_PROVIDER,
    LLM_MODEL_VISION: parsed.LLM_MODEL_VISION,
    GEMINI_API_KEY: parsed.GEMINI_API_KEY,
    SMS_PROVIDER: parsed.SMS_PROVIDER,
    WHATSAPP_PROVIDER: parsed.WHATSAPP_PROVIDER,
    DISABLE_HMR: parsed.DISABLE_HMR,
  };
}

export const config: AppConfig = parseEnvConfig(process.env);
