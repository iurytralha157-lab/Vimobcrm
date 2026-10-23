"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

export type PropertyFormScope = { actorId?: string; organizationId?: string | null };
type CapturedScope = PropertyFormScope & { generation: symbol; resourceId: string; accessSignature: string };

/** Stop follow-up writes and navigation after the form's actor, tenant or mount changes. */
export function usePropertyFormScope({ actorId, organizationId, resourceId, accessSignature }: PropertyFormScope & { resourceId: string; accessSignature: string }) {
  const scope = useMemo<CapturedScope>(() => ({ actorId, organizationId, resourceId, accessSignature, generation: Symbol() }), [actorId, organizationId, resourceId, accessSignature]);
  const current = useRef<CapturedScope & { mounted: boolean }>({ ...scope, mounted: false });
  useLayoutEffect(() => {
    current.current = { ...scope, mounted: true };
    return () => { current.current.mounted = false; };
  }, [scope]);
  const isCurrent = useCallback((captured: CapturedScope) => current.current.mounted
    && Boolean(captured.actorId && captured.organizationId)
    && current.current.generation === captured.generation
    && current.current.actorId === captured.actorId
    && current.current.organizationId === captured.organizationId, []);
  return { scope, isCurrent };
}
