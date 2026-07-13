import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  automationsAPI,
  type AutomationConnection,
  type AutomationExecution,
  type AutomationMediaType,
  type AutomationRuntimeIssueKind,
  type AutomationNode,
  type CreateAutomationInput,
  type FlowDefinition,
  type TriggerType,
  type UpdateAutomationInput,
} from "@/lib/api/automations";
import { saveAutomationFlowInputSchema } from "@/lib/validation";
import { toast } from "sonner";

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Tente novamente em alguns instantes.";
}

function requireOrganizationId(organizationId?: string | null) {
  if (!organizationId) throw new Error("Organização não selecionada.");
  return organizationId;
}

export type {
  ActionType,
  Automation,
  AutomationConnection,
  AutomationExecution,
  AutomationExecutionStep,
  AutomationNode,
  AutomationTemplate,
  AutomationWithNodes,
  FlowConnection,
  FlowDefinition,
  FlowNode,
  Json,
  NodeType,
  TriggerType,
} from "@/lib/api/automations";

export const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  message_received: "Mensagem Recebida",
  scheduled: "Agendado",
  lead_stage_changed: "Lead Mudou de Etapa",
  lead_created: "Lead Criado",
  tag_added: "Tag Adicionada",
  inactivity: "Inatividade",
  manual: "Manual",
};

export const TRIGGER_TYPE_DESCRIPTIONS: Record<TriggerType, string> = {
  message_received: "Dispara quando uma mensagem é recebida no WhatsApp",
  scheduled: "Dispara em horários programados",
  lead_stage_changed: "Dispara quando um lead muda de etapa",
  lead_created: "Dispara quando um novo lead e criado",
  tag_added: "Dispara quando uma tag é adicionada a um lead",
  inactivity: "Dispara após período de inatividade do lead",
  manual: "Disparo manual por ação do usuário",
};

export function useAutomations(enabled = true) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["automations", profile?.organization_id],
    queryFn: () => automationsAPI.listAutomations(profile?.organization_id),
    enabled: enabled && !!profile?.organization_id,
  });
}

export function useAutomation(automationId: string) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["automation", automationId, profile?.organization_id],
    queryFn: () => automationsAPI.getAutomation(automationId, profile?.organization_id),
    enabled: !!automationId && !!profile?.organization_id,
  });
}

export function useAutomationMedia(mediaType: AutomationMediaType) {
  const { profile } = useAuth();
  const organizationId = profile?.organization_id;

  const query = useInfiniteQuery({
    queryKey: ["automation-media", organizationId, mediaType],
    queryFn: ({ pageParam }) => automationsAPI.listMedia(mediaType, {
      limit: 50,
      offset: pageParam,
      organizationId,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    data: query.data?.pages.flatMap((page) => page.files) ?? [],
  };
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateAutomationInput) => {
      return automationsAPI.createAutomation(data, requireOrganizationId(profile?.organization_id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível criar a automação.", { description: getErrorMessage(error) });
    },
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (data: UpdateAutomationInput) => {
      return automationsAPI.updateAutomation(data, requireOrganizationId(profile?.organization_id));
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["automation", variables.id] });
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível atualizar a automação.", { description: getErrorMessage(error) });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => automationsAPI.deleteAutomation(id, requireOrganizationId(profile?.organization_id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      toast.success("Automação excluída!");
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível excluir a automação.", { description: getErrorMessage(error) });
    },
  });
}

export function useDuplicateAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => automationsAPI.duplicateAutomation(id, requireOrganizationId(profile?.organization_id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      toast.success("Automação duplicada com sucesso!");
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível duplicar a automação.", { description: getErrorMessage(error) });
    },
  });
}

export function useToggleAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const organizationId = requireOrganizationId(profile?.organization_id);

      if (is_active) {
        const automation = await automationsAPI.getAutomation(id, organizationId);
        const flowDefinition: FlowDefinition = {
          nodes: automation.nodes.map((node) => ({
            id: node.id,
            type: node.node_type,
            action_type: node.action_type,
            position: { x: node.position_x, y: node.position_y },
            config: (node.config ?? {}) as Record<string, unknown>,
          })),
          connections: automation.connections.map((connection) => ({
            source: connection.source_node_id,
            target: connection.target_node_id,
            source_handle: connection.source_handle,
            condition_branch: connection.condition_branch,
          })),
          settings: {},
        };
        const validation = saveAutomationFlowInputSchema.safeParse({ flowDefinition });
        if (!validation.success) {
          throw new Error(validation.error.issues[0]?.message || "O fluxo está incompleto.");
        }
      }

      return automationsAPI.updateAutomation({ id, is_active }, organizationId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      toast.success(variables.is_active ? "Automação ativada." : "Automação desativada.");
    },
    onError: (error: unknown, variables) => {
      toast.error(variables.is_active ? "A automação não pode ser ativada." : "A automação não pode ser desativada.", {
        description: getErrorMessage(error),
      });
    },
  });
}

export function useSaveAutomationFlowJSON() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ automationId, flowDefinition, ...metadata }: {
      automationId: string;
      flowDefinition: FlowDefinition;
      name?: string;
      description?: string | null;
      isActive?: boolean;
    }) => automationsAPI.saveAutomationFlow(
      automationId,
      { flowDefinition, ...metadata },
      requireOrganizationId(profile?.organization_id),
    ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["automation", variables.automationId] });
      queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível salvar o fluxo.", { description: getErrorMessage(error) });
    },
  });
}

export function useSaveAutomationFlow() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      automationId,
      nodes,
      connections,
      name,
      description,
      isActive,
    }: {
      automationId: string;
      nodes: Partial<AutomationNode>[];
      connections: Partial<AutomationConnection>[];
      name?: string;
      description?: string | null;
      isActive?: boolean;
    }) => {
      const flowDefinition: FlowDefinition = {
        nodes: nodes.map((node) => ({
          id: node.id || "",
          type: node.node_type || "action",
          action_type: node.action_type || null,
          position: { x: node.position_x ?? 0, y: node.position_y ?? 0 },
          config: (node.config || {}) as Record<string, unknown>,
        })),
        connections: connections.map((connection) => ({
          source: connection.source_node_id || "",
          target: connection.target_node_id || "",
          source_handle: connection.source_handle || null,
          condition_branch: connection.condition_branch || null,
        })),
        settings: {},
      };

      return automationsAPI.saveAutomationFlow(
        automationId,
        { flowDefinition, name, description, isActive },
        requireOrganizationId(profile?.organization_id),
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["automation", variables.automationId] });
      queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível salvar o fluxo.", { description: getErrorMessage(error) });
    },
  });
}

export function useAutomationTemplates() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["automation-templates", profile?.organization_id],
    queryFn: () => automationsAPI.listTemplates(profile?.organization_id),
    enabled: !!profile?.organization_id,
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (data: { name: string; content: string; media_url?: string; media_type?: string }) => {
      return automationsAPI.createTemplate(data, requireOrganizationId(profile?.organization_id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-templates"] });
      toast.success("Template criado!");
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível criar o modelo.", { description: getErrorMessage(error) });
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => automationsAPI.deleteTemplate(id, requireOrganizationId(profile?.organization_id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-templates"] });
      toast.success("Template excluido!");
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível excluir o modelo.", { description: getErrorMessage(error) });
    },
  });
}

export function useCancelExecution() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (executionId: string) => automationsAPI.cancelExecution(executionId, requireOrganizationId(profile?.organization_id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-executions"] });
      toast.success("Automação interrompida!");
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível interromper a automação.", { description: getErrorMessage(error) });
    },
  });
}

export function useCancelAutomationExecutions() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: (automationId: string) =>
      automationsAPI.cancelAutomationExecutions(automationId, requireOrganizationId(profile?.organization_id)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["automation-executions"] });
      queryClient.invalidateQueries({ queryKey: ["automation-execution-summaries"] });
      toast.success(result.cancelled === 1 ? "1 execução interrompida." : `${result.cancelled} execuções interrompidas.`);
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível interromper as execuções da automação.", { description: getErrorMessage(error) });
    },
  });
}

export function useAutomationExecutions(automationId?: string, limit = 50) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["automation-executions", automationId, profile?.organization_id, limit],
    queryFn: () =>
      automationsAPI.listExecutions({
        automationId,
        limit,
        organizationId: profile?.organization_id,
      }),
    enabled: !!profile?.organization_id,
    staleTime: 30_000,
    refetchInterval: (query) => {
      const currentExecutions = query.state.data as AutomationExecution[] | undefined;
      const hasActiveExecution = currentExecutions?.some((execution) =>
        ['queued', 'running', 'waiting'].includes(execution.status),
      );
      return hasActiveExecution ? 30_000 : false;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAutomationExecutionSummaries() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["automation-execution-summaries", profile?.organization_id],
    queryFn: () => automationsAPI.listExecutionSummaries(profile?.organization_id),
    enabled: !!profile?.organization_id,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function useAutomationExecutionSteps(
  executionId: string,
  options: { enabled?: boolean; limit?: number; offset?: number; isExecutionActive?: boolean } = {},
) {
  const { profile } = useAuth();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return useQuery({
    queryKey: ["automation-execution-steps", executionId, profile?.organization_id, limit, offset],
    queryFn: () => automationsAPI.listExecutionSteps(executionId, {
      limit,
      offset,
      organizationId: profile?.organization_id,
    }),
    enabled: (options.enabled ?? true) && !!executionId && !!profile?.organization_id,
    staleTime: options.isExecutionActive ? 5_000 : 60_000,
    refetchInterval: options.isExecutionActive ? 15_000 : false,
    refetchIntervalInBackground: false,
  });
}

export function useAutomationRuntimeIssues(offset = 0, limit = 50) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["automation-runtime-issues", profile?.organization_id, limit, offset],
    queryFn: () => automationsAPI.listRuntimeIssues({
      limit,
      offset,
      organizationId: profile?.organization_id,
    }),
    enabled: !!profile?.organization_id,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useRetryAutomationRuntimeIssue() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: ({ kind, id }: { kind: AutomationRuntimeIssueKind; id: string }) =>
      automationsAPI.retryRuntimeIssue(kind, id, requireOrganizationId(profile?.organization_id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-runtime-issues"] });
      queryClient.invalidateQueries({ queryKey: ["automation-executions"] });
      toast.success("Item reenfileirado para processamento seguro.");
    },
    onError: (error: unknown) => {
      toast.error("Não foi possível reprocessar este item.", { description: getErrorMessage(error) });
    },
  });
}
