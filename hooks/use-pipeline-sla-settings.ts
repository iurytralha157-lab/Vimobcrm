import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { stageConfigAPI } from "@/lib/api/stage-config";

export interface PipelineSlaSettings {
  id: string;
  pipeline_id: string;
  stage_id: string | null;
  warning_hours: number | null;
  critical_hours: number | null;
  sla_start_field: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SlaSettingsInput {
  pipeline_id: string;
  stage_id?: string | null;
  warning_hours?: number;
  critical_hours?: number;
  sla_start_field?: string;
}

export function usePipelineSlaSettings(pipelineId: string | null) {
  return useQuery({
    queryKey: ["pipeline-sla-settings", pipelineId],
    queryFn: async () => {
      if (!pipelineId) return null;
      const rows = await stageConfigAPI.listPipelineSLASettings(pipelineId);
      return (rows[0] || null) satisfies PipelineSlaSettings | null;
    },
    enabled: !!pipelineId,
  });
}

export function useAllPipelineSlaSettings() {
  return useQuery({
    queryKey: ["all-pipeline-sla-settings"],
    queryFn: () => stageConfigAPI.listPipelineSLASettings(),
  });
}

export function useUpsertPipelineSlaSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: SlaSettingsInput) => stageConfigAPI.upsertPipelineSLASettings(input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-sla-settings", variables.pipeline_id] });
      queryClient.invalidateQueries({ queryKey: ["all-pipeline-sla-settings"] });
      toast({
        title: "Configurações de SLA salvas",
        description: "As configurações foram atualizadas com sucesso.",
      });
    },
    onError: (error: Error) => {
      console.error("Error saving SLA settings:", error);
      toast({
        title: "Erro ao salvar",
        description: "Não foi possível salvar as configurações de SLA.",
        variant: "destructive",
      });
    },
  });
}
