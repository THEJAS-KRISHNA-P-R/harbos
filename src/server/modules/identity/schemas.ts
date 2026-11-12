import { z } from 'zod';

export const OtpRequestBodySchema = z.object({
  phoneE164: z.string().optional(),
});

export const OtpVerifyBodySchema = z.object({
  phoneE164: z.string().optional(),
  otpCode: z.string().optional(),
});

export const PersonaSwitchBodySchema = z.object({
  role: z.string().optional(),
  tenantId: z.string().optional(),
});

export const UpdateProfileBodySchema = z.object({
  fullName: z.string().optional(),
  phoneE164: z.string().optional(),
});

export const UpdateLocaleBodySchema = z.object({
  locale: z.enum(['ml', 'en']),
});

export const RecordConsentBodySchema = z.object({
  consentVersion: z.string().min(1).max(32).default('DPDP-2023-v1.0'),
});

export const PrivacyEraseBodySchema = z.object({
  reason: z
    .string()
    .min(3)
    .max(500)
    .optional()
    .default('User requested DPDP personal data erasure'),
});
