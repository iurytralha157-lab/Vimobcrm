"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePipelines } from "@/hooks/use-stages";

export function useFilterOptionsPipelineId(selectedPipelineId?: string | null) {
  const { organization, profile } = useAuth();
  const activeOrganizationId = organization?.id ?? profile?.organization_id;
  const [fallbackPipelineId, setFallbackPipelineId] = useState<string | null>(null);
  const { data: pipelines = [] } = usePipelines();

  const selectedPipelineStorageKey = useMemo(() => {
    const tenantId = activeOrganizationId || "global";
    const userId = profile?.id || "anonymous";
    return `vimob:pipelines:selected:${tenantId}:${userId}`;
  }, [activeOrganizationId, profile?.id]);

  useEffect(() => {
    if (selectedPipelineId) return;

    let isActive = true;

    if (pipelines.length === 0) {
      if (fallbackPipelineId) {
        queueMicrotask(() => {
          if (isActive) setFallbackPipelineId(null);
        });
      }

      return () => {
        isActive = false;
      };
    }

    const selectedStillExists = Boolean(
      fallbackPipelineId && pipelines.some((pipeline) => pipeline.id === fallbackPipelineId),
    );
    if (selectedStillExists) {
      return () => {
        isActive = false;
      };
    }

    let storedPipelineId: string | null = null;
    try {
      storedPipelineId = window.localStorage.getItem(selectedPipelineStorageKey);
    } catch {
      storedPipelineId = null;
    }

    const storedPipeline = storedPipelineId
      ? pipelines.find((pipeline) => pipeline.id === storedPipelineId)
      : null;
    const fallbackPipeline = pipelines.find((pipeline) => pipeline.is_default) || pipelines[0];
    const nextPipelineId = (storedPipeline || fallbackPipeline)?.id || null;

    queueMicrotask(() => {
      if (isActive) setFallbackPipelineId(nextPipelineId);
    });

    return () => {
      isActive = false;
    };
  }, [fallbackPipelineId, pipelines, selectedPipelineId, selectedPipelineStorageKey]);

  return selectedPipelineId || fallbackPipelineId;
}
