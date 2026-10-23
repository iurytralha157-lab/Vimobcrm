import { useLayoutEffect, useMemo, useRef } from 'react';

export type PipelineEditorOperation = {
  readonly visit: object;
  isCurrent: () => boolean;
};

/** UI ownership is narrower than the provider's cache/access lifetime. */
export function usePipelineEditorVisit(
  scopeKey: object,
  resourceKey: string,
  captureScopeGuard: () => () => boolean,
) {
  const visit = useMemo(() => ({ scopeKey, resourceKey }), [scopeKey, resourceKey]);
  const active = useRef<typeof visit | null>(null);
  useLayoutEffect(() => {
    active.current = visit;
    return () => { if (active.current === visit) active.current = null; };
  }, [visit]);

  return {
    key: visit,
    capture: (): PipelineEditorOperation => {
      const hasAccess = captureScopeGuard();
      return { visit, isCurrent: () => active.current === visit && hasAccess() };
    },
  };
}
