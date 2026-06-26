import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, Language, TranslationKeys } from '@/i18n';
import { AuthContext } from './AuthContext';
import { settingsAPI } from '@/lib/api/settings';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useContext(AuthContext);
  const profile = auth?.profile ?? null;
  const user = auth?.user ?? null;
  const userId = user?.id;
  const organizationId = profile?.organization_id;
  const [language, setLanguageState] = useState<Language>('pt-BR');

  // Initialize language from profile or localStorage
  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      const profileLang = profile?.language;
      if (profileLang && (profileLang === 'pt-BR' || profileLang === 'en')) {
        setLanguageState(profileLang as Language);
      } else {
        const storedLang = localStorage.getItem('language') as Language;
        if (storedLang && (storedLang === 'pt-BR' || storedLang === 'en')) {
          setLanguageState(storedLang);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('language', lang);

    // If user is logged in, save to database
    if (userId) {
      try {
        await settingsAPI.updateProfile({ language: lang }, organizationId);
      } catch (error) {
        console.error('Error saving language preference:', error);
      }
    }
  }, [userId, organizationId]);

  const t = translations[language];

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
