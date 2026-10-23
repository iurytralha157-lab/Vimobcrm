"use client";

import { AuthProvider } from '@/contexts/AuthContext';
import { ManagementDraftLifecycle } from '@/components/features/crm-management/ManagementDraftLifecycle';
import { ContactImportRecoveryLifecycle } from '@/components/features/contacts/ContactImportRecoveryLifecycle';

export function AuthProviderWrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ManagementDraftLifecycle /><ContactImportRecoveryLifecycle />{children}</AuthProvider>;
}
