'use client';

import { type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { FilterPanelLayoutProvider } from '@/contexts/FilterPanelLayoutContext';

/** Scope only temporary placement; authentication and chat data stay unchanged. */
export function ScopedFilterPanelLayoutProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, profile, activeOrganization } = useAuth();
  const scopeKey = JSON.stringify([pathname, user?.id ?? profile?.id, activeOrganization.organizationId]);
  return <FilterPanelLayoutProvider scopeKey={scopeKey}>{children}</FilterPanelLayoutProvider>;
}
