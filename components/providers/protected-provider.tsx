"use client";

import { ReactNode } from "react";
import { BackendRealtimeBus } from "@/contexts/BackendRealtimeBus";
import { FloatingChatProvider } from "@/contexts/FloatingChatContext";
import { WhatsAppCallProvider } from "@/contexts/WhatsAppCallContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { FilterProviderWrapper } from "./filter-provider";
import { QueryProvider } from "./query-provider";
import { UserThemeSync } from "./user-theme-sync";
import { useUserActivitySession } from "@/hooks/presence";

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
      <LanguageProvider>
        <SidebarProvider>
          <WhatsAppCallProvider>
            <FloatingChatProvider>
              <FilterProviderWrapper>{children}</FilterProviderWrapper>
            </FloatingChatProvider>
          </WhatsAppCallProvider>
        </SidebarProvider>
      </LanguageProvider>
    </QueryProvider>
  );
}
