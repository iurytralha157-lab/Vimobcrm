"use client";

import { ReactNode } from "react";
import { AuthProviderWrapper } from './auth-provider-wrapper'
import { ThemeProviderWrapper } from './theme-provider'
import { TelemetryProvider } from './telemetry-provider'
import { Toaster } from 'sonner'
import { Toaster as LegacyToaster } from '@/components/ui/toaster'
import { InstallPrompt } from '@/components/features/pwa/InstallPrompt'

export function RootProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProviderWrapper>
      <AuthProviderWrapper>
        {children}
        <TelemetryProvider />
        <InstallPrompt />
        <Toaster />
        <LegacyToaster />
      </AuthProviderWrapper>
    </ThemeProviderWrapper>
  );
}
