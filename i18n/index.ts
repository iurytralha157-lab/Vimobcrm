import { ptBR } from './translations/pt-BR';
import { en } from './translations/en';

export type Language = 'pt-BR' | 'en';

export const translations = {
  'pt-BR': ptBR,
  'en': en,
};

export const languageNames: Record<Language, string> = {
  'pt-BR': 'Português (Brasil)',
  'en': 'English',
};

export type TranslationKeys = typeof ptBR;
