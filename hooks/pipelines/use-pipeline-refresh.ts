import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLeadRequestScope } from '@/hooks/leads/use-lead-request-scope';
import { usePipelineEditorVisit, type PipelineEditorOperation } from '@/hooks/pipelines/use-pipeline-editor-visit';

type PipelineRefreshOptions = {
  reads: readonly (() => Promise<{ isError: boolean; error: unknown }>)[];
  onSuccess: () => void;
  onError: (error: unknown) => void;
};

/** Both manual refresh controls share ownership of the current board visit. */
export function usePipelineRefresh(resourceKey: string) {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();
  const visit = usePipelineEditorVisit(queryClient, resourceKey, () => requestScope.capture().isCurrent);
  const inFlight = useRef<{ visit: object } | null>(null);
  const [pendingVisit, setPendingVisit] = useState<object | null>(null);

  const run = useCallback(async ({ reads, onSuccess, onError }: PipelineRefreshOptions) => {
    if (inFlight.current?.visit === visit.key) return;
    let operation: PipelineEditorOperation;
    try { operation = visit.capture(); } catch { return; }
    if (!operation.isCurrent()) return;

    const pending = { visit: visit.key };
    inFlight.current = pending;
    setPendingVisit(visit.key);
    try {
      const results = await Promise.all(reads.map(read => read()));
      if (!operation.isCurrent()) return;
      const failure = results.find(result => result.isError);
      if (failure) onError(failure.error);
      else onSuccess();
    } catch (error: unknown) {
      if (operation.isCurrent()) onError(error);
    } finally {
      if (inFlight.current === pending) {
        inFlight.current = null;
        if (operation.isCurrent()) setPendingVisit(null);
      }
    }
  }, [visit]);

  return { run, isRefreshing: pendingVisit === visit.key };
}
