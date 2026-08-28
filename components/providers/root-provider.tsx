"use client";

import { ReactNode } from "react";
import { AuthProviderWrapper } from './auth-provider-wrapper'
import { ThemeProviderWrapper } from './theme-provider'
import { TelemetryProvider } from './telemetry-provider'
import { Toaster } from 'sonner'
import { InstallPrompt } from '@/components/features/pwa/InstallPrompt'

export function RootProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProviderWrapper>
      <AuthProviderWrapper>
        {children}
        <TelemetryProvider />
        <InstallPrompt />
        <Toaster />
      </AuthProviderWrapper>
    </ThemeProviderWrapper>
  );
}
