import { useLayoutEffect, useMemo, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export function useLeadDetailOperationScope(
  leadId: string | null,
  organizationId: string | null | undefined,
  actorId: string | null,
  client: QueryClient,
  canOperate = true,
  sessionId?: string | null,
) {
  const mounted = useRef(false);
  const identity = useMemo(() => ({ leadId, organizationId, actorId, client, canOperate, sessionId }),
    [leadId, organizationId, actorId, client, canOperate, sessionId]);
  const scope = useRef({ identity });
  useLayoutEffect(() => {
    scope.current = { identity };
  }, [identity]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return () => {
    if (!mounted.current || scope.current.identity !== identity) throw new Error('Operação encerrada. Abra o contato novamente.');
    const operation = scope.current;
    return {
      // A -> B -> A also invalidates the original operation permanently.
      isCurrent: () => mounted.current && scope.current === operation,
    };
  };
}
