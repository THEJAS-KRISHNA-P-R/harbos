import { GoogleGenAI } from '@google/genai';
import { config } from '@server/config.ts';

export interface CatchAssistResult {
  readonly available: boolean;
  readonly suggestedSpeciesCode?: string;
  readonly suggestedGrade?: 'A_EXPORT' | 'A_DOMESTIC' | 'B_PROCESS';
  readonly confidenceNote?: string;
  readonly advisoryDisclaimer: string;
}

export async function runCatchPhotoAssist(params: {
  speciesNameEn: string;
  coreTempC: number;
  inspectorNotes: string;
}): Promise<CatchAssistResult> {
  const disclaimer = 'AI suggestion — inspector must confirm before grading (ADR-009)';
  if (config.LLM_PROVIDER !== 'gemini' || !config.GEMINI_API_KEY) {
    return {
      available: false,
      advisoryDisclaimer: `${disclaimer}. Status: UNAVAILABLE (LLM_PROVIDER=${config.LLM_PROVIDER}, no canned fallback per §3 P7).`,
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: config.LLM_MODEL_VISION,
      contents: `Act as an advisory fisheries quality assistant under Kerala Act 16 of 2021 s.21. Species: ${params.speciesNameEn}, Core Temp: ${params.coreTempC}C, Notes: ${params.inspectorNotes}. Suggest grade (A_EXPORT, A_DOMESTIC, or B_PROCESS) in 1 short sentence.`,
    });
    return {
      available: true,
      suggestedGrade: params.coreTempC <= 2.5 ? 'A_EXPORT' : 'A_DOMESTIC',
      confidenceNote: response.text ?? 'Organoleptic check recommended.',
      advisoryDisclaimer: disclaimer,
    };
  } catch {
    return {
      available: false,
      advisoryDisclaimer: `${disclaimer}. Status: UNAVAILABLE (upstream LLM error).`,
    };
  }
}
