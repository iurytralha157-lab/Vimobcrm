'use client'

import { ReactNode } from 'react'
import { QueryProvider } from './query-provider'
import { AuthProviderWrapper } from './auth-provider-wrapper'
import { ThemeProviderWrapper } from './theme-provider'
import { TelemetryProvider } from './telemetry-provider'
import { Toaster } from 'sonner'
import { LanguageProvider } from '@/contexts/LanguageContext'
import { SidebarProvider } from '@/contexts/SidebarContext'
import { UserThemeSync } from './user-theme-sync'

export function RootProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProviderWrapper>
      <AuthProviderWrapper>
        <QueryProvider>
          <TelemetryProvider />
          <UserThemeSync />
          <LanguageProvider>
            <SidebarProvider>{children}</SidebarProvider>
          </LanguageProvider>
          <Toaster />
        </QueryProvider>
      </AuthProviderWrapper>
    </ThemeProviderWrapper>
  )
}
