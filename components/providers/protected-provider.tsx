"use client";

import { ReactNode } from "react";
import { BackendRealtimeBus } from "@/contexts/BackendRealtimeBus";
import { FloatingChatProvider } from "@/contexts/FloatingChatContext";
import { ScopedFilterPanelLayoutProvider } from "./filter-panel-layout-provider";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { FilterProviderWrapper } from "./filter-provider";
import { QueryProvider } from "./query-provider";
import { UserThemeSync } from "./user-theme-sync";
import { useUserActivitySession } from "@/hooks/presence";
import { NotificationSoundProvider } from '@/components/features/notifications/NotificationSoundProvider';

function UserActivityTracker() {
  useUserActivitySession();
  return null;
}

export function ProtectedProvider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <BackendRealtimeBus />
      <UserActivityTracker />
      <UserThemeSync />
      <NotificationSoundProvider>
        <LanguageProvider>
          <SidebarProvider>
            <FloatingChatProvider>
              <ScopedFilterPanelLayoutProvider>
                <FilterProviderWrapper>{children}</FilterProviderWrapper>
              </ScopedFilterPanelLayoutProvider>
            </FloatingChatProvider>
          </SidebarProvider>
        </LanguageProvider>
      </NotificationSoundProvider>
    </QueryProvider>
  );
}
