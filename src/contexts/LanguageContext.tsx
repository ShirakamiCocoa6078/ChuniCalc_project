
"use client";

import React, { createContext, useState, useContext, useEffect, type ReactNode } from 'react';
import type { Locale } from '@/lib/translations';

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const LOCAL_STORAGE_LOCALE_KEY = 'chuniCalcApp_locale';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('KR'); // Default to KR

  useEffect(() => {
    // Get stored locale from localStorage on mount
    const storedLocale = localStorage.getItem(LOCAL_STORAGE_LOCALE_KEY) as Locale | null;
    if (storedLocale && (storedLocale === 'KR' || storedLocale === 'JP')) {
      setLocaleState(storedLocale);
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LOCAL_STORAGE_LOCALE_KEY, newLocale);
  };

  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
