import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLeadRequestScope } from '@/hooks/leads/use-lead-request-scope';
import { usePipelineEditorVisit, type PipelineEditorOperation } from '@/hooks/pipelines/use-pipeline-editor-visit';

type RetryReadResult = { isError: boolean; error: unknown };
type CatalogRetryResult = RetryReadResult & {
  isSuccess: boolean;
  data?: readonly { id: string }[];
};
type CriticalLoadRetryOptions = {
  organizationId: string | null;
  resourceKey: string;
  selectedPipelineId: string | null;
  catalogHasError: boolean;
  boardError: unknown;
  refetchPipelines: (options?: { cancelRefetch?: boolean }) => Promise<CatalogRetryResult>;
  reads: readonly (() => Promise<RetryReadResult>)[];
  onError: (error: unknown) => void;
};

/** Recover references before retrying a board tied to the captured selection. */
export function usePipelineCriticalLoadRetry({
  organizationId, resourceKey, selectedPipelineId, catalogHasError, boardError,
  refetchPipelines, reads, onError,
}: CriticalLoadRetryOptions) {
  const queryClient = useQueryClient();
  const requestScope = useLeadRequestScope();
  const visit = usePipelineEditorVisit(queryClient, resourceKey, () => {
    const access = requestScope.capture();
    return () => access.organizationId === organizationId && access.isCurrent();
  });
  const inFlight = useRef<{ visit: object } | null>(null);
  const [pendingVisit, setPendingVisit] = useState<object | null>(null);

  const retry = useCallback(async () => {
    if (inFlight.current?.visit === visit.key) return;
    let operation: PipelineEditorOperation;
    try { operation = visit.capture(); } catch { return; }
    if (!operation.isCurrent()) return;

    const pending = { visit: visit.key };
    inFlight.current = pending;
    setPendingVisit(visit.key);
    try {
      const invalidReference = typeof boardError === 'object' && boardError !== null &&
        'code' in boardError && boardError.code === 'invalid_lead_reference';
      if (catalogHasError || invalidReference) {
        const queryKey = ['pipelines', organizationId];
        const catalogQuery = queryClient.getQueryCache().find({ queryKey, exact: true });
        const updateCount = catalogQuery?.state.dataUpdateCount;
        const errorCount = catalogQuery?.state.errorUpdateCount;
        const result = await refetchPipelines({ cancelRefetch: false });
        if (!operation.isCurrent()) return;
        if (!catalogQuery ||
          queryClient.getQueryCache().find({ queryKey, exact: true }) !== catalogQuery) return;
        if (result.isError) {
          if (errorCount !== undefined && catalogQuery.state.errorUpdateCount > errorCount) onError(result.error);
          return;
        }
        // A cancelled refetch can resolve as success with the previous cache.
        if (!result.isSuccess || updateCount === undefined ||
          catalogQuery.state.dataUpdateCount <= updateCount) return;
        if (!selectedPipelineId || !result.data?.some(item => item.id === selectedPipelineId)) {
          // The existing selection effect owns local fallback/global "all".
          return;
        }
      }

      if (!operation.isCurrent()) return;
      const results = await Promise.all(reads.map(read => read()));
      if (!operation.isCurrent()) return;
      const failure = results.find(result => result.isError);
      if (failure) onError(failure.error);
    } catch (error: unknown) {
      if (operation.isCurrent()) onError(error);
    } finally {
      if (inFlight.current === pending) {
        inFlight.current = null;
        if (operation.isCurrent()) setPendingVisit(null);
      }
    }
  }, [boardError, catalogHasError, onError, organizationId, queryClient, reads,
    refetchPipelines, selectedPipelineId, visit]);

  return { retry, isRetrying: pendingVisit === visit.key };
}
