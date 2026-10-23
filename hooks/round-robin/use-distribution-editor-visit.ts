'use client';

import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { createDistributionEditorVisit } from '@/lib/round-robin/editor-visit';

export function useDistributionEditorVisit(scopeKey: string | null, open: boolean) {
  const visit = useMemo(() => ({ scopeKey, open, ...createDistributionEditorVisit() }), [scopeKey, open]);
  const [busyVisit, setBusyVisit] = useState<typeof visit | null>(null);
  useLayoutEffect(() => visit.open && visit.scopeKey ? visit.activate() : undefined, [visit]);

  const beginOperation = useCallback(() => {
    const operation = visit.beginOperation();
    if (!operation) return null;
    setBusyVisit(visit);
    return {
      isCurrent: operation.isCurrent,
      finish() {
        if (operation.finish()) setBusyVisit((current) => current === visit ? null : current);
      },
    };
  }, [visit]);

  return { saving: busyVisit === visit, isBusy: visit.isBusy, beginOperation };
}
