import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { integrationsAPI } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface MetaIntegration {
  id: string;
  organization_id: string;
  page_id: string | null;
  page_name: string | null;
  is_connected: boolean | null;
  last_error: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
  leads_received: number | null;
  selected_ad_accounts: unknown;
  ad_account_id: string | null;
  integration_type?: string | null;
  instagram_business_account_id?: string | null;
  instagram_username?: string | null;
  health_status?: string | null;
  token_status?: string | null;
  token_expires_at?: string | null;
  last_validated_at?: string | null;
  webhook_subscribed_at?: string | null;
  facebook_user_id?: string | null;
  facebook_user_name?: string | null;
  page_picture_url?: string | null;
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  facebook_user_id?: string;
  facebook_user_name?: string;
}

type MetaAuthURLResponse = { auth_url: string };
type MetaExchangeResponse = { pages: MetaPage[]; user_token: string };

function invokeMeta<T>(endpoint: "meta-oauth" | "instagram-oauth", body: Record<string, unknown>) {
  return integrationsAPI.invokeFunction<T>(endpoint, body);
}

export function useMetaIntegrations() {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["meta-integrations", profile?.organization_id],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      return integrationsAPI.listMetaIntegrations(profile.organization_id) as unknown as Promise<MetaIntegration[]>;
    },
    enabled: !!profile?.organization_id,
  });
}

export function useMetaGetAuthUrl() {
  return useMutation({
    mutationFn: async (params: string | { returnUrl: string; includeInstagram?: boolean }) => {
      const returnUrl = typeof params === "string" ? params : params.returnUrl;
      const includeInstagram = typeof params === "string" ? false : !!params.includeInstagram;
      const endpoint = includeInstagram ? "instagram-oauth" : "meta-oauth";

      return invokeMeta<MetaAuthURLResponse>(endpoint, {
        action: "get_auth_url",
        return_url: returnUrl,
      });
    },
  });
}

export function useMetaExchangeToken() {
  return useMutation({
    mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) =>
      invokeMeta<MetaExchangeResponse>("meta-oauth", {
        action: "exchange_token",
        code,
        redirect_uri: redirectUri,
      }),
  });
}

export function useMetaConnectPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      pageId,
      userToken,
      pipelineId,
      stageId,
      defaultStatus,
      adAccountId,
      selectedAdAccountIds,
      facebookUserId,
      facebookUserName,
      pagePictureUrl,
    }: {
      pageId: string;
      userToken: string;
      pipelineId?: string | null;
      stageId?: string | null;
      defaultStatus?: string | null;
      adAccountId?: string;
      selectedAdAccountIds?: string[];
      facebookUserId?: string;
      facebookUserName?: string;
      pagePictureUrl?: string;
    }) =>
      invokeMeta<{ success?: boolean; messenger_active?: boolean }>("meta-oauth", {
        action: "connect_page",
        page_id: pageId,
        code: userToken,
        pipeline_id: pipelineId || null,
        stage_id: stageId || null,
        default_status: defaultStatus || null,
        ad_account_id: adAccountId,
        selected_ad_accounts: selectedAdAccountIds,
        facebook_user_id: facebookUserId,
        facebook_user_name: facebookUserName,
        page_picture_url: pagePictureUrl,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      queryClient.invalidateQueries({ queryKey: ["meta-form-configs"] });
      if (data.success && data.messenger_active === false) {
        toast.success("A pagina foi conectada para leads. Mensagens do Messenger exigem permissao adicional.");
      } else {
        toast.success("Pagina conectada com sucesso!");
      }
    },
    onError: (error: Error) => {
      toast.error(`Erro ao conectar pagina: ${error.message}`);
    },
  });
}

export function useMetaUpdatePage() {
  const queryClient = useQueryClient();

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
      invokeMeta("meta-oauth", {
        action: "update_page",
        page_id: pageId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        default_status: defaultStatus,
        selected_ad_accounts: selectedAdAccountIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      toast.success("Configuracao atualizada!");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar: ${error.message}`);
    },
  });
}

export function useMetaDisconnectPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pageId: string) =>
      invokeMeta("meta-oauth", {
        action: "disconnect_page",
        page_id: pageId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      toast.success("Pagina desconectada!");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao desconectar: ${error.message}`);
    },
  });
}

export function useMetaTogglePage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pageId, isActive }: { pageId: string; isActive: boolean }) =>
      invokeMeta("meta-oauth", {
        action: "toggle_page",
        page_id: pageId,
        is_active: isActive,
      }),
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

  return useMutation({
    mutationFn: ({ pageId, adAccountIds }: { pageId: string; adAccountIds: string[] }) =>
      invokeMeta("meta-oauth", {
        action: "update_ad_accounts",
        page_id: pageId,
        selected_ad_accounts: adAccountIds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta-integrations"] });
      toast.success("Contas de anuncio atualizadas!");
    },
    onError: (error: Error) => {
      toast.error(`Erro: ${error.message}`);
    },
  });
}

export function useMetaAdAccounts(userToken?: string, integrationId?: string) {
  return useQuery({
    queryKey: ["meta-ad-accounts", userToken, integrationId],
    queryFn: async () => {
      if (!userToken) return [];

      const response = await fetch(
        `https://graph.facebook.com/v25.0/me/adaccounts?fields=id,name,account_id&access_token=${userToken}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch ad accounts from Meta");
      }

      const data = await response.json();
      return data.data || [];
    },
    enabled: !!userToken,
  });
}
