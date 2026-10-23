import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { getVimobAPIAccessTokenSessionId } from '@/lib/api/vimob-client';

export type PushDeviceIntent = {
  userId: string;
  organizationId: string;
  sessionId: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
  assertCurrent: () => void;
  finish: () => void;
  cancel: () => void;
};

/** A device gesture cannot borrow a later login or tenant after an await. */
export function usePushDeviceIntent(userId: string | null | undefined, organizationId: string | null | undefined) {
  const sessionId = getVimobAPIAccessTokenSessionId();
  const fingerprint = useMemo(() => JSON.stringify([userId, organizationId, sessionId]), [userId, organizationId, sessionId]);
  const committed = useRef({ fingerprint, generation: 0, mounted: false });
  const controllers = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    const pendingControllers = controllers.current;
    committed.current = { fingerprint, generation: committed.current.generation + 1, mounted: true };
    return () => {
      committed.current.mounted = false;
      committed.current.generation += 1;
      pendingControllers.forEach(controller => controller.abort());
      pendingControllers.clear();
    };
  }, [fingerprint]);
  return useCallback((): PushDeviceIntent => {
    if (!userId || !organizationId || !sessionId) throw new DOMException('Cancelled', 'AbortError');
    const generation = committed.current.generation;
    const controller = new AbortController();
    const isCurrent = () => !controller.signal.aborted && committed.current.mounted
      && committed.current.fingerprint === fingerprint && committed.current.generation === generation
      && getVimobAPIAccessTokenSessionId() === sessionId;
    const assertCurrent = () => {
      if (!userId || !organizationId || !isCurrent()) throw new DOMException('Cancelled', 'AbortError');
    };
    assertCurrent();
    controllers.current.add(controller);
    return { userId, organizationId, sessionId, signal: controller.signal,
      isCurrent, assertCurrent, finish: () => { controllers.current.delete(controller); },
      cancel: () => { controller.abort(); controllers.current.delete(controller); } };
  }, [fingerprint, organizationId, sessionId, userId]);
}
