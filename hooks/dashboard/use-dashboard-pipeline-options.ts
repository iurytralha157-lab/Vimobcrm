"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { usePipelines } from "@/hooks/use-stages";
import { isSharedFilterOptionsAccessDenied } from "@/lib/filters/shared-filter-options";

type DashboardPipelineScope = {
  organizationId?: string;
  accessSignature: string;
  isReady: boolean;
};

export function useDashboardPipelineOptions(scope: DashboardPipelineScope) {
  const queryClient = useQueryClient();
  const pipelinesQuery = usePipelines();
  const catalogQuery = queryClient.getQueryCache().find({
    queryKey: ["pipelines", scope.organizationId],
    exact: true,
  });
  const dataUpdateCount = catalogQuery?.state.dataUpdateCount ?? 0;
  const errorUpdateCount = catalogQuery?.state.errorUpdateCount ?? 0;
  const [authorization, setAuthorization] = useState({
    query: catalogQuery,
    accessSignature: scope.accessSignature,
    hasAuthorizedResult: false,
    dataUpdateCount,
    errorUpdateCount,
  });
  const sameAccess = authorization.query === catalogQuery
    && authorization.accessSignature === scope.accessSignature;
  const hasAuthorizedResult = scope.isReady
    && !isSharedFilterOptionsAccessDenied(pipelinesQuery.error)
    && (pipelinesQuery.isSuccess || (sameAccess
      && authorization.hasAuthorizedResult
      && dataUpdateCount === authorization.dataUpdateCount
      && errorUpdateCount >= authorization.errorUpdateCount
      && errorUpdateCount <= authorization.errorUpdateCount + 1));

  // A transient failure cannot restore a snapshot previously denied in this visit.
  // On remount with an error, wait for success: that snapshot's history is unknown.
  // Multiple errors between renders may hide a denial; do not trust that gap.
  if (!sameAccess || authorization.hasAuthorizedResult !== hasAuthorizedResult
    || authorization.dataUpdateCount !== dataUpdateCount
    || authorization.errorUpdateCount !== errorUpdateCount) {
    setAuthorization({
      query: catalogQuery,
      accessSignature: scope.accessSignature,
      hasAuthorizedResult,
      dataUpdateCount,
      errorUpdateCount,
    });
  }

  const refresh = () => {
    if (!scope.isReady || !scope.organizationId) return;
    void queryClient.refetchQueries({
      queryKey: ["pipelines", scope.organizationId],
      exact: true,
      type: "active",
      predicate: (query) => query.isStale() || query.state.status === "error",
    }, { cancelRefetch: false });
  };

  return {
    pipelines: hasAuthorizedResult ? pipelinesQuery.data ?? [] : [],
    isError: pipelinesQuery.isError,
    isFetching: pipelinesQuery.isFetching,
    refresh,
  };
}
