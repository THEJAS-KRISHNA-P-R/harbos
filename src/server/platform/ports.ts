export interface ClockPort {
  now(): Date;
  nowIso(): string;
}

export interface IdGeneratorPort {
  nextUuid(): string;
}

export interface SmsPort {
  sendOtp(params: { phoneE164: string; otpCode: string; tenantSlug?: string }): Promise<void>;
}

export interface LlmPort {
  generateStructuredAdvisory(params: {
    prompt: string;
    contextJson: string;
  }): Promise<{ text: string; model: string }>;
}
