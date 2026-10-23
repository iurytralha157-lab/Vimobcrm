'use client';

import { useLayoutEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { contactImportRecovery } from '@/components/features/contacts/contact-import-recovery';

/** Remains mounted outside Contacts, so logging out elsewhere also releases tab-local files. */
export function useContactImportRecoverySession() {
  const { user, session } = useAuth();
  const userId = user?.id ?? null;
  const sessionId = getGlobalSignOutSessionId(session);
  useLayoutEffect(() => {
    contactImportRecovery.retainSession(userId, sessionId);
  }, [userId, sessionId]);
}
