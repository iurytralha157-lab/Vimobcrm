"use client";

import { ReactNode } from "react";
import { BackendRealtimeBus } from "@/contexts/BackendRealtimeBus";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { FilterProviderWrapper } from "./filter-provider";
import { QueryProvider } from "./query-provider";
import { UserThemeSync } from "./user-theme-sync";

export function ProtectedProvider({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <BackendRealtimeBus />
      <UserThemeSync />
      <LanguageProvider>
        <SidebarProvider>
          <FilterProviderWrapper>{children}</FilterProviderWrapper>
        </SidebarProvider>
      </LanguageProvider>
    </QueryProvider>
  );
}
