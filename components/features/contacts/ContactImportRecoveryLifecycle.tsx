'use client';

import { useContactImportRecoverySession } from '@/hooks/leads/use-contact-import-recovery-session';

/** Lives under global Auth, including public routes after the protected tree unmounts. */
export function ContactImportRecoveryLifecycle() {
  useContactImportRecoverySession();
  return null;
}
