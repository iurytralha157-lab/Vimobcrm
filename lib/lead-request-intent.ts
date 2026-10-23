import type { VimobAPIRequestIntent } from '@/lib/api/vimob-client';

/** Capture from the initiating UI session, before an asynchronous mutation. */
export function captureLeadRequestIntent(userId?: string | null, sessionId?: string | null): VimobAPIRequestIntent {
  if (!userId || !sessionId) throw new Error('Não foi possível confirmar a sessão. Entre novamente antes de continuar.');
  return Object.freeze({ expectedUserId: userId, expectedSessionId: sessionId });
}
