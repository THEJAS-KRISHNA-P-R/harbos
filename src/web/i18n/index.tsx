import React, { createContext, useContext, useEffect, useState } from 'react';
import enTranslations from './en.json';
import mlTranslations from './ml.json';

export type Locale = 'en' | 'ml';

type Translations = typeof enTranslations;

interface I18nContextValue {
  readonly locale: Locale;
  readonly setLocale: (loc: Locale) => void;
  readonly t: (path: string, fallback?: string) => string;
}

const translationsMap: Record<Locale, Record<string, unknown>> = {
  en: enTranslations as unknown as Record<string, unknown>,
  ml: mlTranslations as unknown as Record<string, unknown>,
};

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (path, fallback) => fallback ?? path,
});

export function I18nProvider({
  children,
  initialLocale = 'en',
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('harbouros_locale');
    if (saved === 'en' || saved === 'ml') return saved;
    return initialLocale;
  });

  const setLocale = (loc: Locale) => {
    setLocaleState(loc);
    localStorage.setItem('harbouros_locale', loc);
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (path: string, fallback?: string): string => {
    const dict = translationsMap[locale] ?? translationsMap.en;
    const val = getNestedValue(dict, path);
    if (val !== undefined) return val;
    const enVal = getNestedValue(translationsMap.en, path);
    return enVal ?? fallback ?? path;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
