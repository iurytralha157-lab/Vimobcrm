import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { aiAPI, type AIAgentInput, type AIRoutingRuleInput, type AISettingsInput } from "@/lib/api/ai";

function useActiveOrganizationId() {
  const { organization, profile } = useAuth();
  return organization?.id || profile?.organization_id || null;
}

export function useAISettings() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ["ai-settings", organizationId],
    queryFn: () => aiAPI.settings(organizationId),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

export function useAIEvents() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ["ai-events", organizationId],
    queryFn: () => aiAPI.events(organizationId),
    enabled: !!organizationId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useUpdateAISettings() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: AISettingsInput) => aiAPI.updateSettings(input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-settings", organizationId] });
      toast({ title: "IA atualizada", description: "Configuracao salva com sucesso." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao salvar IA", description: error.message, variant: "destructive" });
    },
  });
}

export function useAIOrganizationAgents() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ["ai-organization-agents", organizationId],
    queryFn: () => aiAPI.listOrganizationAgents(organizationId),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

export function useCreateAIOrganizationAgent() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: AIAgentInput) => aiAPI.createOrganizationAgent(input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-organization-agents", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["ai-settings", organizationId] });
      toast({ title: "Agente criado", description: "O agente ja pode ser usado nas regras." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar agente", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateAIOrganizationAgent() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AIAgentInput }) => aiAPI.updateOrganizationAgent(id, input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-organization-agents", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["ai-routing-rules", organizationId] });
      toast({ title: "Agente atualizado", description: "As alteracoes ja valem para os proximos atendimentos." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar agente", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteAIOrganizationAgent() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => aiAPI.deleteOrganizationAgent(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-organization-agents", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["ai-settings", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["ai-routing-rules", organizationId] });
      toast({ title: "Agente removido", description: "O agente saiu da configuracao desta organizacao." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao remover agente", description: error.message, variant: "destructive" });
    },
  });
}

export function useAIRoutingRules() {
  const organizationId = useActiveOrganizationId();

  return useQuery({
    queryKey: ["ai-routing-rules", organizationId],
    queryFn: () => aiAPI.listRoutingRules(organizationId),
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

export function useCreateAIRoutingRule() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (input: AIRoutingRuleInput) => aiAPI.createRoutingRule(input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-routing-rules", organizationId] });
      toast({ title: "Regra criada", description: "A IA vai considerar esta regra nos proximos atendimentos." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao criar regra", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateAIRoutingRule() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AIRoutingRuleInput }) => aiAPI.updateRoutingRule(id, input, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-routing-rules", organizationId] });
      toast({ title: "Regra atualizada", description: "A ordem de atendimento foi salva." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao atualizar regra", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteAIRoutingRule() {
  const queryClient = useQueryClient();
  const organizationId = useActiveOrganizationId();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => aiAPI.deleteRoutingRule(id, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-routing-rules", organizationId] });
      toast({ title: "Regra removida", description: "A IA nao vai mais usar essa rota." });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao remover regra", description: error.message, variant: "destructive" });
    },
  });
}
