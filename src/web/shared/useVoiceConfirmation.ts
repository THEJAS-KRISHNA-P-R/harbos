import { useCallback, useEffect, useState } from 'react';

export interface UseVoiceConfirmationOptions {
  readonly lang?: 'en' | 'ml';
  readonly rate?: number;
  readonly pitch?: number;
}

export interface UseVoiceConfirmationReturn {
  readonly isSupported: boolean;
  readonly isSpeaking: boolean;
  readonly speakAnnouncement: (textEn: string, textMl?: string) => void;
  readonly cancelSpeech: () => void;
}

/**
 * Hook for dockside hands-free voice confirmations (e.g. "Lot 14 knocked down to Buyer 101 at 420 rupees per kg").
 * Queries available voices on `speechSynthesis` and detects native Malayalam (`ml-IN`) voice,
 * falling back gracefully to English (`en-IN` / `en-US`).
 */
export function useVoiceConfirmation(options: UseVoiceConfirmationOptions = {}): UseVoiceConfirmationReturn {
  const { lang = 'en', rate = 1.0, pitch = 1.0 } = options;
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setIsSupported(true);
      const updateVoices = () => {
        setVoices(window.speechSynthesis.getVoices());
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  const speakAnnouncement = useCallback(
    (textEn: string, textMl?: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

      window.speechSynthesis.cancel();

      const useMl = lang === 'ml' && Boolean(textMl);
      const spokenText = useMl ? (textMl as string) : textEn;
      const utterance = new SpeechSynthesisUtterance(spokenText);

      // Attempt to find ml-IN voice if Malayalam requested, else en-IN or fallback
      if (useMl) {
        const mlVoice = voices.find((v) => v.lang === 'ml-IN' || v.lang.startsWith('ml'));
        if (mlVoice) {
          utterance.voice = mlVoice;
          utterance.lang = 'ml-IN';
        } else {
          // Indian English fallback for phonetic clarity
          const inVoice = voices.find((v) => v.lang === 'en-IN');
          if (inVoice) utterance.voice = inVoice;
          utterance.lang = 'en-IN';
        }
      } else {
        const enInVoice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang.startsWith('en'));
        if (enInVoice) utterance.voice = enInVoice;
        utterance.lang = 'en-IN';
      }

      utterance.rate = rate;
      utterance.pitch = pitch;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    },
    [lang, rate, pitch, voices]
  );

  return {
    isSupported,
    isSpeaking,
    speakAnnouncement,
    cancelSpeech,
  };
}
