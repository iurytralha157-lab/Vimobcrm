import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { stageConfigAPI, type JsonValue } from "@/lib/api/stage-config";
import { toast } from "sonner";

export type Json = JsonValue;

export type OperationContext =
  | "comercial"
  | "financeiro"
  | "arquitetura"
  | "compras"
  | "documental"
  | "juridico"
  | "pos-venda";

export interface StageOperationalConfig {
  id?: string;
  organization_id: string;
  stage_id: string;
  operation_context: OperationContext;
  responsible_sector: string | null;
  sla_hours: number;
  automatic_tasks: Json | null;
  automatic_notifications: Json | null;
  automatic_operational_requests: Json | null;
  checklist_template: Json | null;
  approval_flow: Json | null;
  dashboard_destination: string | null;
  visibility_rules: Json | null;
}

type StageOperationalConfigWithStage = StageOperationalConfig & {
  stage: {
    id?: string;
    name: string;
    pipeline_id?: string | null;
  } | null;
};

type StageOperationalConfigUpsert = Partial<StageOperationalConfig> & Pick<StageOperationalConfig, "stage_id">;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

function normalizeOperationContext(value: string): OperationContext {
  const allowed: OperationContext[] = [
    "comercial",
    "financeiro",
    "arquitetura",
    "compras",
    "documental",
    "juridico",
    "pos-venda",
  ];
  return allowed.includes(value as OperationContext) ? (value as OperationContext) : "comercial";
}

export function useStageOperationalConfigs(pipelineId?: string, stageId?: string) {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ["stage-operational-configs", organizationId, pipelineId, stageId],
    queryFn: async () => {
      if (!organizationId) return [];

      const configs = await stageConfigAPI.listOperationalConfigs({
        organizationId,
        pipelineId,
        stageId,
      });

      return configs.map((config) => ({
        ...config,
        operation_context: normalizeOperationContext(config.operation_context),
      })) as StageOperationalConfigWithStage[];
    },
    enabled: !!organizationId,
  });
}

export function useUpsertStageOperationalConfig() {
  const queryClient = useQueryClient();
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: async (values: StageOperationalConfigUpsert) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      return stageConfigAPI.upsertOperationalConfig(values, organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stage-operational-configs"] });
      toast.success("Configuração do estágio salva!");
    },
    onError: (error: unknown) => {
      toast.error("Erro ao salvar configuração: " + getErrorMessage(error));
    },
  });
}
