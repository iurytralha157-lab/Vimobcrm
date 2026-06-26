'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'

const isThemeMode = (value: unknown): value is 'light' | 'dark' | 'system' =>
  value === 'light' || value === 'dark' || value === 'system'

export function UserThemeSync() {
  const { profile } = useAuth()
  const { setTheme } = useTheme()

  useEffect(() => {
    if (isThemeMode(profile?.theme_mode)) {
      setTheme(profile.theme_mode)
    }
  }, [profile?.theme_mode, setTheme])

  return null
}
