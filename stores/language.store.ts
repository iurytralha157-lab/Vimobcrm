import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Language = 'pt-BR' | 'en'

interface LanguageStore {
  language: Language
  setLanguage: (lang: Language) => void
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      language: 'pt-BR',
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'language-store',
    }
  )
)
