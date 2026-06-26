import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { stageConfigAPI, type StageAutomationRow } from "@/lib/api/stage-config";
import { toast } from "sonner";

// UI type normalized from the current DB contract: trigger_type + config jsonb.
export interface StageAutomation {
  id: string;
  stage_id: string | null;
  organization_id: string | null;
  trigger_type: string;
  action_type: string | null;
  action_config: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  automation_type: string | null;
  trigger_days: number | null;
  target_stage_id: string | null;
  whatsapp_template: string | null;
  alert_message: string | null;
}

export type AutomationType =
  | "alert_on_inactivity"
  | "change_assignee_on_enter"
  | "change_deal_status_on_enter";

export interface CreateAutomationData {
  stage_id: string;
  automation_type: AutomationType;
  trigger_days?: number | null;
  target_stage_id?: string | null;
  whatsapp_template?: string | null;
  alert_message?: string | null;
  target_user_id?: string | null;
  deal_status?: "open" | "won" | "lost" | null;
  action_config?: Record<string, unknown> | null;
  is_active?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (isRecord(error)) {
    const message = asString(error.message);
    const details = asString(error.details);
    const hint = asString(error.hint);
    return [message, details, hint].filter(Boolean).join(" ") || JSON.stringify(error);
  }
  return String(error);
}

function normalizeAutomation(row: StageAutomationRow): StageAutomation {
  const config = isRecord(row.config) ? row.config : {};
  const actionConfig = isRecord(config.action_config) ? config.action_config : null;
  const automationType = asString(config.automation_type) || asString(config.action_type) || row.trigger_type;

  return {
    id: row.id,
    organization_id: row.organization_id,
    stage_id: row.stage_id,
    trigger_type: row.trigger_type,
    action_type: asString(config.action_type) || automationType,
    action_config: actionConfig,
    config,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    automation_type: automationType,
    trigger_days: asNumber(config.trigger_days),
    target_stage_id: asString(config.target_stage_id),
    whatsapp_template: asString(config.whatsapp_template),
    alert_message: asString(config.alert_message),
  };
}

export function useStageAutomations(stageId?: string) {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  return useQuery({
    queryKey: ["stage-automations", stageId, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const data = await stageConfigAPI.listStageAutomations({ stageId, organizationId });
      return data.map(normalizeAutomation);
    },
    enabled: !!organizationId,
  });
}

export function useCreateStageAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateAutomationData) => {
      if (!profile?.organization_id) throw new Error("Organização não encontrada");
      const result = await stageConfigAPI.createStageAutomation(data, profile.organization_id);
      return normalizeAutomation(result);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["stage-automations"], refetchType: "all" });
      queryClient.refetchQueries({ queryKey: ["stage-automations", variables.stage_id] });
      toast.success("Automação criada com sucesso");
    },
    onError: (error) => {
      console.error("Error creating automation:", error);
      toast.error("Erro ao criar Automação: " + getErrorMessage(error));
    },
  });
}

export function useUpdateStageAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<CreateAutomationData> & { id: string }) => {
      const result = await stageConfigAPI.updateStageAutomation(id, data, profile?.organization_id);
      return normalizeAutomation(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stage-automations"], refetchType: "all" });
      toast.success("Automação atualizada com sucesso");
    },
    onError: (error) => {
      console.error("Error updating automation:", error);
      toast.error("Erro ao atualizar Automação: " + getErrorMessage(error));
    },
  });
}

export function useDeleteStageAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      await stageConfigAPI.deleteStageAutomation(id, profile?.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stage-automations"] });
      toast.success("Automação excluída com sucesso");
    },
    onError: (error) => {
      console.error("Error deleting automation:", error);
      toast.error("Erro ao excluir Automação");
    },
  });
}

export function useToggleStageAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      return stageConfigAPI.toggleStageAutomation(id, is_active, profile?.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["stage-automations"] });
      toast.success(variables.is_active ? "Automação ativada" : "Automação desativada");
    },
    onError: (error) => {
      console.error("Error toggling automation:", error);
      toast.error("Erro ao alterar status da Automação");
    },
  });
}

export const AUTOMATION_TYPE_LABELS: Record<AutomationType, string> = {
  alert_on_inactivity: "Alertar sobre inatividade",
  change_assignee_on_enter: "Mudar responsável ao entrar",
  change_deal_status_on_enter: "Alterar status (Ganho/Perdido)",
};

export const AUTOMATION_TYPE_DESCRIPTIONS: Record<AutomationType, string> = {
  alert_on_inactivity: "Cria uma notificação para o corretor quando o lead ficar X dias sem atividade",
  change_assignee_on_enter: "Muda o responsável do lead automaticamente quando ele entra neste estágio",
  change_deal_status_on_enter: "Altera o status do deal (Aberto, Ganho ou Perdido) quando o lead entra",
};

export const DEAL_STATUS_LABELS: Record<string, string> = {
  open: "Aberto",
  won: "Ganho",
  lost: "Perdido",
};
