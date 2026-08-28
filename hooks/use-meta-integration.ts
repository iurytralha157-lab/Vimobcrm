import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsAPI } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  metaAdAccountsActionResponseSchema,
  metaOAuthFlowResultSchema,
  metaPublicIntegrationSchema,
  type MetaOAuthAdAccount,
  type MetaOAuthFlowResult as ValidatedMetaOAuthFlowResult,
  type MetaOAuthPage,
  type MetaPublicIntegration,
} from "@/lib/validation";

export type MetaIntegration = MetaPublicIntegration;

export type MetaPage = MetaOAuthPage;
export type MetaAdAccount = MetaOAuthAdAccount;

type MetaAuthURLResponse = { auth_url: string };
export type MetaOAuthFlowResult = ValidatedMetaOAuthFlowResult;

function invokeMeta<T>(body: Record<string, unknown>, organizationId?: string | null) {
  return integrationsAPI.metaOAuthAction<T>(body, organizationId);
}

export function useMetaIntegrations(options: { enabled?: boolean } = {}) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ["meta-integrations", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const result = await integrationsAPI.listMetaIntegrations(organizationId);
      return metaPublicIntegrationSchema.array().parse(result);
    },
    enabled: options.enabled !== false && !!organizationId,
  });
}

export function useMetaGetAuthUrl() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: async (params: string | { returnUrl: string; includeInstagram?: boolean }) => {
      const returnUrl = typeof params === "string" ? params : params.returnUrl;
      const includeInstagram = typeof params === "string" ? false : !!params.includeInstagram;

      return invokeMeta<MetaAuthURLResponse>({
        action: "get_auth_url",
        return_url: returnUrl,
        ...(includeInstagram ? { include_instagram: true } : {}),
      }, organizationId);
    },
  });
}

export function useMetaConnectPage() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: ({
      pageId,
      flowId,
      pipelineId,
      stageId,
      defaultStatus,
      adAccountId,
      selectedAdAccountIds,
    }: {
      pageId: string;
      flowId: string;
      pipelineId?: string | null;
      stageId?: string | null;
      defaultStatus?: string | null;
      adAccountId?: string;
      selectedAdAccountIds?: string[];
    }) =>
      invokeMeta<{ success?: boolean; messenger_active?: boolean }>({
        action: "connect_page",
        page_id: pageId,
        flow_id: flowId,
        pipeline_id: pipelineId || null,
        stage_id: stageId || null,
        default_status: defaultStatus || null,
        ad_account_id: adAccountId,
        selected_ad_accounts: selectedAdAccountIds,
      }, organizationId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs"] });
      if (data.success && data.messenger_active === false) {
        toast.success("A página foi conectada para leads. Mensagens do Messenger exigem permissão adicional.");
      } else {
      toast.success("Página conectada com sucesso!");
      }
    },
    onError: (error: Error) => {
      toast.error(`Erro ao conectar página: ${error.message}`);
    },
  });
}

export function useMetaUpdatePage() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: ({
      pageId,
      pipelineId,
      stageId,
      defaultStatus,
      selectedAdAccountIds,
    }: {
      pageId: string;
      pipelineId: string;
      stageId: string;
      defaultStatus: string;
      selectedAdAccountIds?: string[];
    }) =>
      invokeMeta({
        action: "update_page",
        page_id: pageId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        default_status: defaultStatus,
        selected_ad_accounts: selectedAdAccountIds,
      }, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      toast.success("Configuração atualizada!");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar: ${error.message}`);
    },
  });
}

export function useMetaDisconnectPage() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: (pageId: string) =>
      invokeMeta({
        action: "disconnect_page",
        page_id: pageId,
      }, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      toast.success("Página desconectada!");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao desconectar: ${error.message}`);
    },
  });
}

export function useMetaTogglePage() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: ({ pageId, isActive }: { pageId: string; isActive: boolean }) =>
      invokeMeta({
        action: "toggle_page",
        page_id: pageId,
        is_active: isActive,
      }, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}

export function useMetaUpdateAdAccounts() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: ({ pageId, adAccountIds }: { pageId: string; adAccountIds: string[] }) =>
      invokeMeta({
        action: "update_ad_accounts",
        page_id: pageId,
        selected_ad_accounts: adAccountIds,
      }, organizationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      toast.success("Contas de anúncio atualizadas!");
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}

export function useMetaConversionFeedback() {
  const queryClient = useQueryClient();
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: (input: {
      integrationId: string;
      datasetId?: string | null;
      datasetName?: string | null;
      datasetAccessToken?: string | null;
      enabled: boolean;
      replayRecentFacts: boolean;
      testEventCode?: string;
    }) => integrationsAPI.saveMetaConversionFeedback(input, organizationId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      if (result.recent_facts_replay_requested === true) {
        const queued = typeof result.recent_facts_queued === "number"
          ? result.recent_facts_queued
          : 0;
        toast.success(
          queued === 0
            ? "Integração ativada; nenhum novo fato recente foi enfileirado."
            : `Integração ativada; ${queued} ${queued === 1 ? "fato real enfileirado" : "fatos reais enfileirados"}.`,
        );
        return;
      }
      toast.success("Devolução de qualidade do Meta atualizada.");
    },
    onError: (error: Error) => {
      toast.error(`Não foi possível atualizar a devolução: ${error.message}`);
    },
  });
}

export function useMetaAdAccounts(
  pageId?: string | null,
  options: { enabled: boolean } = { enabled: false },
) {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useQuery({
    queryKey: ["meta-ad-accounts", organizationId, pageId],
    queryFn: async () => {
      if (!organizationId || !pageId) return [];
      const result = await invokeMeta<unknown>({
        action: "list_ad_accounts",
        page_id: pageId,
      }, organizationId);
      return metaAdAccountsActionResponseSchema.parse(result).ad_accounts;
    },
    enabled: options.enabled && !!organizationId && !!pageId,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}

export function useMetaOAuthFlowResult() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;

  return useMutation({
    mutationFn: async (flowId: string) => {
      if (!organizationId) throw new Error("Organização não encontrada");
      const result = await integrationsAPI.getMetaOAuthFlow(flowId, organizationId);
      return metaOAuthFlowResultSchema.parse(result);
    },
  });
}
