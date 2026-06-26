import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  automationsAPI,
  type AutomationConnection,
  type AutomationNode,
  type CreateAutomationInput,
  type FlowDefinition,
  type TriggerType,
  type UpdateAutomationInput,
} from "@/lib/api/automations";
import { toast } from "sonner";

export type {
  ActionType,
  Automation,
  AutomationConnection,
  AutomationExecution,
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
  message_received: "Dispara quando uma mensagem e recebida no WhatsApp",
  scheduled: "Dispara em horarios programados (cron)",
  lead_stage_changed: "Dispara quando um lead muda de etapa",
  lead_created: "Dispara quando um novo lead e criado",
  tag_added: "Dispara quando uma tag e adicionada a um lead",
  inactivity: "Dispara apos periodo de inatividade do lead",
  manual: "Disparo manual por acao do usuario",
};

export function useAutomations() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["automations", profile?.organization_id],
    queryFn: () => automationsAPI.listAutomations(profile?.organization_id),
    enabled: !!profile?.organization_id,
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

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateAutomationInput) => {
      if (!profile?.organization_id) throw new Error("No organization");
      return automationsAPI.createAutomation(data, profile.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      toast.success("Automacao criada com sucesso!");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao criar automacao: ${error.message}`);
    },
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (data: UpdateAutomationInput) => {
      return automationsAPI.updateAutomation(data, profile?.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      queryClient.invalidateQueries({ queryKey: ["automation", variables.id] });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => automationsAPI.deleteAutomation(id, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      toast.success("Automacao excluida!");
    },
  });
}

export function useDuplicateAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => automationsAPI.duplicateAutomation(id, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
      toast.success("Automacao duplicada com sucesso!");
    },
  });
}

export function useToggleAutomation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      return automationsAPI.updateAutomation({ id, is_active }, profile?.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations"] });
    },
  });
}

export function useSaveAutomationFlowJSON() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ automationId, flowDefinition }: { automationId: string; flowDefinition: FlowDefinition }) =>
      automationsAPI.saveAutomationFlow(automationId, flowDefinition, profile?.organization_id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["automation", variables.automationId] });
      queryClient.invalidateQueries({ queryKey: ["automations"] });
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
    }: {
      automationId: string;
      nodes: Partial<AutomationNode>[];
      connections: Partial<AutomationConnection>[];
    }) => {
      const flowDefinition: FlowDefinition = {
        nodes: nodes.map((node) => ({
          id: node.id || "",
          type: node.node_type || "action",
          action_type: node.action_type || null,
          position: { x: node.position_x || 0, y: node.position_y || 0 },
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

      return automationsAPI.saveAutomationFlow(automationId, flowDefinition, profile?.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["automation", variables.automationId] });
      queryClient.invalidateQueries({ queryKey: ["automations"] });
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
      if (!profile?.organization_id) throw new Error("No organization");
      return automationsAPI.createTemplate(data, profile.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-templates"] });
      toast.success("Template criado!");
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => automationsAPI.deleteTemplate(id, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-templates"] });
      toast.success("Template excluido!");
    },
  });
}

export function useCancelExecution() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (executionId: string) => automationsAPI.cancelExecution(executionId, profile?.organization_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-executions"] });
      toast.success("Automacao interrompida!");
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
    refetchInterval: 10000,
  });
}
