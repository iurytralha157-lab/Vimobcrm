'use client'

import { ReactNode } from 'react'
import { QueryProvider } from './query-provider'
import { AuthProviderWrapper } from './auth-provider-wrapper'
import { ThemeProviderWrapper } from './theme-provider'
import { TelemetryProvider } from './telemetry-provider'
import { Toaster } from 'sonner'
import { LanguageProvider } from '@/contexts/LanguageContext'

export function RootProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProviderWrapper>
      <AuthProviderWrapper>
        <QueryProvider>
          <TelemetryProvider />
          <LanguageProvider>{children}</LanguageProvider>
          <Toaster />
        </QueryProvider>
      </AuthProviderWrapper>
    </ThemeProviderWrapper>
  )
}
