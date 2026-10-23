import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { stageConfigAPI, type StageAutomationRow } from "@/lib/api/stage-config";
import { getStructuredErrorMessage } from "@/lib/api/vimob-error";
import {
  getTenantEnabledModules,
  getTenantPermissions,
  isTenantContextForOrganization,
} from "@/lib/access/tenant-navigation";
import { createTenantQueryAccessSignature } from "@/lib/access/tenant-query-cache";
import { stageAutomationsQueryKey } from "@/lib/stage-automations-query-key";
import { toast } from "sonner";
import { useStageAutomationMutationScope } from '@/hooks/automations/use-stage-automation-mutation-scope';
import { VimobAPIError } from '@/lib/api/vimob-error';
import { useLayoutEffect } from 'react';

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
  inactivity_policy?: StageAutomationRow['inactivity_policy'];
  inactivity_runtime_available?: boolean;
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

export type UpdateAutomationData = Partial<CreateAutomationData> & { id: string; expected_updated_at: string };
export type ToggleAutomationData = { id: string; is_active: boolean; expected_updated_at: string };
export type DeleteAutomationData = { id: string; expected_updated_at: string };

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

function normalizeAutomation(row: StageAutomationRow): StageAutomation {
  const config = isRecord(row.config) ? row.config : {};
  const actionConfig = isRecord(config.action_config) ? config.action_config : config;
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
    inactivity_policy: row.inactivity_policy,
    inactivity_runtime_available: row.inactivity_runtime_available,
  };
}

export function useStageAutomations(stageId?: string) {
  const {
    activeOrganization,
    tenantContext,
    user,
    profile,
    isSuperAdmin,
    impersonating,
  } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const hasCurrentTenantContext = isTenantContextForOrganization(organizationId, tenantContext);
  const currentTenantContext = hasCurrentTenantContext ? tenantContext : null;
  const currentUserId = user?.id ?? profile?.id;
  const enabledModules = hasCurrentTenantContext && tenantContext
    ? getTenantEnabledModules(tenantContext)
    : [];
  const permissions = hasCurrentTenantContext && tenantContext
    ? getTenantPermissions(tenantContext)
    : [];
  const canViewStageAutomations =
    enabledModules.includes("automations") &&
    (permissions.includes("*") ||
      permissions.includes("automations_view"));
  const accessSignature = createTenantQueryAccessSignature({
    userId: currentUserId,
    organizationId,
    memberRole: currentTenantContext?.memberRole,
    permissions: currentTenantContext?.permissions,
    enabledModules: currentTenantContext?.enabledModules,
    isTeamLeader: currentTenantContext?.isTeamLeader,
    ledTeamIds: currentTenantContext?.ledTeamIds,
    ledUserIds: currentTenantContext?.ledUserIds,
    ledPipelineIds: currentTenantContext?.ledPipelineIds,
    isSuperAdmin: currentTenantContext?.isSuperAdmin ?? isSuperAdmin,
    impersonatedOrganizationId: impersonating?.orgId,
  });

  return useQuery({
    queryKey: stageAutomationsQueryKey(stageId, organizationId, currentUserId, accessSignature),
    queryFn: async () => {
      if (!organizationId) return [];
      const data = await stageConfigAPI.listStageAutomations({ stageId, organizationId });
      return data.map(normalizeAutomation);
    },
    enabled: !!organizationId && canViewStageAutomations,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 60,
    refetchOnMount: true,
    retry: false,
  });
}

export function useCreateStageAutomation() {
  const requestScope = useStageAutomationMutationScope<CreateAutomationData>();
  const mutation = useMutation({
    onMutate: (variables: CreateAutomationData) => requestScope.get(variables),
    mutationFn: async (variables: CreateAutomationData) => {
      const operation = requestScope.require(variables);
      const result = await stageConfigAPI.createStageAutomation(variables, operation.organizationId, operation.intent);
      requestScope.require(variables);
      if (result.organization_id !== operation.organizationId || result.stage_id !== variables.stage_id) {
        throw new Error('A resposta não corresponde à coluna solicitada.');
      }
      return normalizeAutomation(result);
    },
    retry: false,
    onSuccess: (_data, _variables, captured) => {
      if (requestScope.isCurrent(captured)) toast.success("Automação criada com sucesso");
    },
    onError: (error, variables, captured) => {
      if (!requestScope.isCurrent(captured || requestScope.get(variables))) return;
      toast.error("Erro ao criar Automação: " + getStructuredErrorMessage(error));
    },
    onSettled: (_data, _error, variables) => requestScope.settledForCurrentAccess(variables),
  });
  const reset = mutation.reset;
  useLayoutEffect(() => { reset(); }, [reset, requestScope.scopeKey]);
  type Options = NonNullable<Parameters<typeof mutation.mutate>[1]>;
  const prepare = (variables: CreateAutomationData, options?: Options) => {
    const capturedVariables = requestScope.capture(variables);
    const captured = requestScope.get(capturedVariables);
    // Per-call callbacks run after onSettled releases the WeakMap entry. Retain
    // the captured visit itself, without aborting successful completion.
    const guardedOptions: Options | undefined = options && {
      ...options,
      onSuccess: (...args) => { if (requestScope.isCurrent(captured)) return options.onSuccess?.(...args); },
      onError: (...args) => { if (requestScope.isCurrent(captured)) return options.onError?.(...args); },
      onSettled: (...args) => { if (requestScope.isCurrent(captured)) return options.onSettled?.(...args); },
    };
    return { variables: capturedVariables, options: guardedOptions };
  };
  return { ...mutation, scopeKey: requestScope.scopeKey, captureScopeGuard: requestScope.captureScopeGuard,
    mutate: (variables: CreateAutomationData, options?: Options) => {
      const prepared = prepare(variables, options);
      mutation.mutate(prepared.variables, prepared.options);
    },
    mutateAsync: (variables: CreateAutomationData, options?: Options) => {
      const prepared = prepare(variables, options);
      return mutation.mutateAsync(prepared.variables, prepared.options);
    },
  };
}

export function useUpdateStageAutomation() {
  const requestScope = useStageAutomationMutationScope<UpdateAutomationData>();
  const mutation = useMutation({
    onMutate: (variables: UpdateAutomationData) => requestScope.get(variables),
    mutationFn: async (variables: UpdateAutomationData) => {
      const { id, ...data } = variables;
      const operation = requestScope.require(variables);
      const result = await stageConfigAPI.updateStageAutomation(id, data, operation.organizationId, operation.intent);
      requestScope.require(variables);
      if (result.id !== id || result.organization_id !== operation.organizationId) throw new Error('A resposta não corresponde à automação solicitada.');
      return normalizeAutomation(result);
    },
    retry: false,
    onSuccess: (_data, _variables, captured) => {
      if (requestScope.isCurrent(captured)) toast.success("Automação atualizada com sucesso");
    },
    onError: (error, variables, captured) => {
      if (!requestScope.isCurrent(captured || requestScope.get(variables))) return;
      toast.error(error instanceof VimobAPIError && error.code === 'stage_automation_changed'
        ? 'Esta automação foi atualizada em outra sessão. Seu rascunho foi preservado; carregue a versão atual para revisar.'
        : "Erro ao atualizar Automação: " + getStructuredErrorMessage(error));
    },
    onSettled: (_data, _error, variables) => requestScope.settled(variables),
  });
  return { ...mutation,
    mutate: (variables: UpdateAutomationData, options?: Parameters<typeof mutation.mutate>[1]) => mutation.mutate(requestScope.capture(variables), options),
    mutateAsync: (variables: UpdateAutomationData, options?: Parameters<typeof mutation.mutateAsync>[1]) => mutation.mutateAsync(requestScope.capture(variables), options),
  };
}

export function useDeleteStageAutomation() {
  const requestScope = useStageAutomationMutationScope<DeleteAutomationData>();
  const mutation = useMutation({
    onMutate: (variables: DeleteAutomationData) => requestScope.get(variables),
    mutationFn: async (variables: DeleteAutomationData) => {
      const operation = requestScope.require(variables);
      await stageConfigAPI.deleteStageAutomation(variables.id, variables.expected_updated_at, operation.organizationId, operation.intent);
      requestScope.require(variables);
    },
    retry: false,
    onSuccess: (_data, _variables, captured) => {
      if (requestScope.isCurrent(captured)) toast.success("Automação excluída com sucesso");
    },
    onError: (error, variables, captured) => {
      if (!requestScope.isCurrent(captured || requestScope.get(variables))) return;
      toast.error(error instanceof VimobAPIError && error.code === 'stage_automation_changed'
        ? 'Esta automação mudou em outra sessão. Feche a confirmação, atualize a lista e confira antes de excluir.'
        : "Erro ao excluir Automação: " + getStructuredErrorMessage(error));
    },
    onSettled: (_data, _error, variables) => requestScope.settled(variables, true),
  });
  // The confirmation captures once when opened. Never recapture a retired intent.
  return { ...mutation, capture: requestScope.capture, discard: requestScope.discard,
    isCurrent: (variables: DeleteAutomationData) => requestScope.isCurrent(requestScope.get(variables)) };
}

export function useToggleStageAutomation() {
  const requestScope = useStageAutomationMutationScope<ToggleAutomationData>();
  const mutation = useMutation({
    onMutate: (variables: ToggleAutomationData) => requestScope.get(variables),
    mutationFn: async (variables: ToggleAutomationData) => {
      const operation = requestScope.require(variables);
      const result = await stageConfigAPI.toggleStageAutomation(variables.id, variables.is_active, variables.expected_updated_at, operation.organizationId, operation.intent);
      requestScope.require(variables);
      if (result.id !== variables.id || result.organization_id !== operation.organizationId) throw new Error('A resposta não corresponde à automação solicitada.');
      return result;
    },
    retry: false,
    onSuccess: (_, variables, captured) => {
      if (requestScope.isCurrent(captured)) toast.success(variables.is_active ? "Automação ativada" : "Automação desativada");
    },
    onError: (error, variables, captured) => {
      if (!requestScope.isCurrent(captured || requestScope.get(variables))) return;
      toast.error(error instanceof VimobAPIError && error.code === 'stage_automation_changed'
        ? 'Esta automação foi atualizada em outra sessão. Atualize a lista e confira antes de ativar ou desativar.'
        : "Erro ao alterar status da Automação: " + getStructuredErrorMessage(error));
    },
    onSettled: (_data, _error, variables) => requestScope.settled(variables),
  });
  return { ...mutation,
    mutate: (variables: ToggleAutomationData, options?: Parameters<typeof mutation.mutate>[1]) => mutation.mutate(requestScope.capture(variables), options),
    mutateAsync: (variables: ToggleAutomationData, options?: Parameters<typeof mutation.mutateAsync>[1]) => mutation.mutateAsync(requestScope.capture(variables), options),
  };
}

export const AUTOMATION_TYPE_LABELS: Record<AutomationType, string> = {
  alert_on_inactivity: "Alertar sobre inatividade",
  change_assignee_on_enter: "Mudar responsável ao entrar",
  change_deal_status_on_enter: "Alterar status (Ganho/Perdido)",
};

export const AUTOMATION_TYPE_DESCRIPTIONS: Record<AutomationType, string> = {
  alert_on_inactivity: "Notifica o responsável quando o lead ficar sem interação humana pelo prazo definido",
  change_assignee_on_enter: "Muda o responsável do lead automaticamente quando ele entra neste estágio",
  change_deal_status_on_enter: "Altera o status do deal (Aberto, Ganho ou Perdido) quando o lead entra",
};

export const DEAL_STATUS_LABELS: Record<string, string> = {
  open: "Aberto",
  won: "Ganho",
  lost: "Perdido",
};
