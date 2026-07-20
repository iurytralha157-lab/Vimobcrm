import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { useState, useEffect, useCallback } from "react";
import type { Json } from "@/integrations/supabase/types";
import { whatsappAPI, type AIAutoReplySessionInput, type WhatsAppSessionQuota } from "@/lib/api/whatsapp";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { whatsappQueryKeys } from "@/lib/whatsapp-query-cache";

export const EVOLUTION_GO_CREATION_ENABLED = true;
export const WHATSAPP_LEGACY_EVOLUTION_ENABLED = false;

export type WhatsAppProvider = "evolution" | "evolution_go";

export interface WhatsAppSession {
  id: string;
  organization_id: string;
  owner_user_id: string;
  instance_name: string;
  display_name: string | null;
  instance_id: string | null;
  status: string;
  phone_number: string | null;
  profile_name: string | null;
  profile_picture: string | null;
  is_active: boolean;
  is_notification_session?: boolean;
  provider?: WhatsAppProvider;
  advanced_settings?: Json | null;
  created_at: string;
  updated_at: string;
  last_connected_at?: string | null;
  owner?: {
    id: string;
    name: string;
    email: string;
  };
}

export type WhatsAppSessionList = WhatsAppSession[] & {
  meta?: WhatsAppSessionQuota;
};

export interface WhatsAppSessionAccess {
  id: string;
  session_id: string;
  user_id: string;
  access_mode?: WhatsAppAccessMode;
  can_view: boolean;
  can_send: boolean;
  only_leads_access: boolean;
  granted_by: string | null;
  created_at: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export type WhatsAppAccessMode = "assigned_leads_only";

function normalizeSession(session: WhatsAppSession): WhatsAppSession {
  return {
    ...session,
    display_name: session.display_name || null,
    last_connected_at: session.last_connected_at || null,
    is_notification_session: session.is_notification_session || false,
  };
}

function removeSessionFromCache(old: WhatsAppSession[] | undefined, sessionId: string) {
  if (!Array.isArray(old)) return old;
  return old.filter((session) => session.id !== sessionId);
}

export function useWhatsAppSessions(options: { enabled?: boolean } = {}) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: whatsappQueryKeys.sessions(scope),
    queryFn: async () => {
      if (!scope.userId || !scope.organizationId) return [] as WhatsAppSessionList;
      const response = await whatsappAPI.getSessions(scope.organizationId);
      const sessions = (response.data || []).map((session) => normalizeSession(session as WhatsAppSession)) as WhatsAppSessionList;
      sessions.meta = response.meta;
      return sessions;
    },
    enabled: options.enabled !== false && !!scope.organizationId && !!scope.userId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    gcTime: 1000 * 60 * 10,
    refetchOnReconnect: true,
  });
}

export function useWhatsAppSession(sessionId: string | null) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: whatsappQueryKeys.session(scope, sessionId),
    queryFn: async () => {
      if (!sessionId) return null;
      const data = await whatsappAPI.getSession(sessionId, scope.organizationId);
      return normalizeSession(data as WhatsAppSession);
    },
    enabled: !!sessionId && !!scope.organizationId && !!scope.userId,
    refetchOnReconnect: true,
  });
}

export function useSessionAccess(sessionId: string | null) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: whatsappQueryKeys.sessionAccess(scope, sessionId),
    queryFn: async () => {
      if (!sessionId) return [];
      return whatsappAPI.getSessionAccess(sessionId, scope.organizationId) as Promise<WhatsAppSessionAccess[]>;
    },
    enabled: !!sessionId && !!scope.organizationId && !!scope.userId,
    refetchOnReconnect: true,
  });
}

export function useCreateWhatsAppSession() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (input: string | { displayName: string; provider?: WhatsAppProvider }) => {
      if (!scope.organizationId || !scope.userId) {
        throw new Error("Usuário não autenticado.");
      }

      const displayName = typeof input === "string" ? input : input.displayName;
      const requestedProvider: WhatsAppProvider =
        typeof input === "string" ? "evolution_go" : input.provider || "evolution_go";

      if (requestedProvider !== "evolution_go") {
        console.warn("Legacy Evolution creation is disabled. Forcing Evolution Go.");
      }

      const result = await whatsappAPI.createSession(
        { displayName, provider: "evolution_go" },
        scope.organizationId,
      );

      return {
        ...result,
        session: normalizeSession({
          ...result.session,
          display_name: result.session.display_name || displayName,
        } as WhatsAppSession),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
      toast({
        title: "Sessao criada",
        description: "Escaneie o QR Code para conectar",
      });
    },
  });
}

export function useDeleteWhatsAppSession() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (session: WhatsAppSession) => {
      await whatsappAPI.deleteSession(session.id, scope.organizationId);
    },
    onMutate: async (session) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["whatsapp-sessions"] }),
        queryClient.cancelQueries({ queryKey: ["accessible-sessions"] }),
      ]);

      const previousSessions = queryClient.getQueriesData<WhatsAppSession[]>({ queryKey: ["whatsapp-sessions"] });
      const previousAccessibleSessions = queryClient.getQueriesData<WhatsAppSession[]>({ queryKey: ["accessible-sessions"] });

      queryClient.setQueriesData<WhatsAppSession[]>(
        { queryKey: ["whatsapp-sessions"] },
        (old) => removeSessionFromCache(old, session.id),
      );
      queryClient.setQueriesData<WhatsAppSession[]>(
        { queryKey: ["accessible-sessions"] },
        (old) => removeSessionFromCache(old, session.id),
      );

      return { previousSessions, previousAccessibleSessions };
    },
    onSuccess: (_data, session) => {
      queryClient.setQueriesData<WhatsAppSession[]>(
        { queryKey: ["whatsapp-sessions"] },
        (old) => removeSessionFromCache(old, session.id),
      );
      queryClient.setQueriesData<WhatsAppSession[]>(
        { queryKey: ["accessible-sessions"] },
        (old) => removeSessionFromCache(old, session.id),
      );
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
      toast({
        title: "Sessao excluida",
        description: "A conexão WhatsApp foi removida",
      });
    },
    onError: (error: Error, _session, context) => {
      context?.previousSessions?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousAccessibleSessions?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      toast({
        title: "Erro ao excluir sessao",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
    },
  });
}

export function useGetQRCode() {
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (
      arg: string | { provider: WhatsAppProvider; instanceName: string; sessionId?: string; instanceId?: string | null },
    ) => {
      if (typeof arg === "string" || arg.provider !== "evolution_go" || !arg.sessionId) {
        throw new Error("Evolution legada está desativada. Crie uma nova conexão Evolution Go.");
      }

      return whatsappAPI.getQRCode(arg.sessionId, scope.organizationId);
    },
  });
}

export function useGetConnectionStatus() {
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (
      arg: string | { provider: WhatsAppProvider; instanceName: string; sessionId?: string; instanceId?: string | null },
    ) => {
      if (typeof arg === "string" || arg.provider !== "evolution_go" || !arg.sessionId) {
        throw new Error("Evolution legada está desativada. Crie uma nova conexão Evolution Go.");
      }

      return whatsappAPI.getConnectionStatus(arg.sessionId, scope.organizationId);
    },
  });
}

export function useSetWebhook() {
  return useMutation({
    mutationFn: async (args: { instanceName: string; webhookUrl: string }) => {
      void args;
      throw new Error("Evolution legada esta desativada. Webhook deve usar evolution-go-webhook.");
    },
  });
}

export function useGrantSessionAccess() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async ({
      sessionId,
      userId,
      canView = true,
      canSend = true,
      accessMode = "assigned_leads_only",
    }: {
      sessionId: string;
      userId: string;
      canView?: boolean;
      canSend?: boolean;
      accessMode?: WhatsAppAccessMode;
    }) => {
      await whatsappAPI.grantSessionAccess(
        sessionId,
        { userId, canView, canSend, accessMode },
        scope.organizationId,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-session-access"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
      toast({
        title: "Acesso atualizado",
        description: "Permissoes salvas com sucesso",
      });
    },
  });
}

export function useRevokeSessionAccess() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async ({ sessionId, userId }: { sessionId: string; userId: string }) => {
      await whatsappAPI.revokeSessionAccess(sessionId, userId, scope.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-session-access"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
      toast({
        title: "Acesso revogado",
        description: "O usuário não tem mais acesso à sessão",
      });
    },
  });
}

export function useRecreateWhatsAppInstance() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (session: WhatsAppSession) => {
      if (session.provider !== "evolution_go") {
        throw new Error("Evolution legada esta desativada. Exclua esta sessao e crie uma nova Evolution Go.");
      }

      return whatsappAPI.recreateSession(session.id, scope.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      toast({
        title: "Instancia recriada",
        description: "Escaneie o QR Code para conectar",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao recriar instancia",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useLogoutSession() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (session: WhatsAppSession) => {
      if (session.provider !== "evolution_go") {
        throw new Error("Evolution legada esta desativada. Exclua esta sessao e crie uma nova Evolution Go.");
      }

      const result = await whatsappAPI.logoutSession(session.id, scope.organizationId);

      try {
        const { notificationService } = await import("@/services/NotificationService");
        await notificationService.send({
          eventKey: "whatsapp_disconnected",
          organizationId: session.organization_id,
          userId: session.owner_user_id,
          variables: {
            session_name: session.display_name || session.instance_name,
            display_name: session.display_name || session.instance_name,
          },
        });
      } catch (err) {
        console.warn("Disconnection notification failed:", err);
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      toast({
        title: "Desconectado",
        description: "A sessao foi desconectada",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao desconectar sessao",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useQRCodePolling(session: WhatsAppSession | null) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");
  const [needsRecreate, setNeedsRecreate] = useState(false);
  const queryClient = useQueryClient();
  const getQRCode = useGetQRCode();
  const getStatus = useGetConnectionStatus();

  const startPolling = useCallback(async () => {
    if (!session || isPolling) return;

    setIsPolling(true);
    setNeedsRecreate(false);

    const pollQRCode = async () => {
      try {
        const provider = (session.provider || "evolution_go") as WhatsAppProvider;
        const arg = {
          provider,
          instanceName: session.instance_name,
          sessionId: session.id,
          instanceId: session.instance_id,
        };

        const status = await getStatus.mutateAsync(arg);

        if (status?.instanceNotFound) {
          setConnectionStatus("instance_not_found");
          setNeedsRecreate(true);
          setIsPolling(false);
          return true;
        }

        const isConnected = status?.connected === true || status?.state === "open";

        if (isConnected) {
          setConnectionStatus("connected");
          setQrCode(null);
          setIsPolling(false);
          queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
          return true;
        }

        const qrData = await getQRCode.mutateAsync(arg);
        if (qrData?.qrcode) {
          setQrCode(qrData.qrcode);
          setConnectionStatus("waiting_qr");
        } else if (qrData?.base64) {
          setQrCode(qrData.base64);
          setConnectionStatus("waiting_qr");
        }

        return false;
      } catch (error) {
        console.warn("WhatsApp QR polling failed:", error);
        return false;
      }
    };

    const connected = await pollQRCode();

    if (!connected && !needsRecreate) {
      const interval = setInterval(async () => {
        const isConnected = await pollQRCode();
        if (isConnected || needsRecreate) {
          clearInterval(interval);
        }
      }, 3000);

      setTimeout(() => {
        clearInterval(interval);
        setIsPolling(false);
      }, 120000);
    }
  }, [session, isPolling, getQRCode, getStatus, queryClient, needsRecreate]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    setQrCode(null);
    setNeedsRecreate(false);
  }, []);

  useEffect(() => {
    return () => {
      setIsPolling(false);
    };
  }, []);

  return {
    qrCode,
    isPolling,
    connectionStatus,
    startPolling,
    stopPolling,
    needsRecreate,
  };
}

export function useToggleNotificationSession() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async ({ sessionId, enabled }: { sessionId: string; enabled: boolean }) => {
      await whatsappAPI.toggleNotificationSession(sessionId, enabled, scope.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      toast({
        title: "Configuração atualizada",
        description: "Sessao de notificacao alterada com sucesso",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useToggleAIAutoReplySession() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async ({ sessionId, ...input }: { sessionId: string } & AIAutoReplySessionInput) => {
      await whatsappAPI.toggleAIAutoReplySession(sessionId, input, scope.organizationId);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["accessible-sessions"] });
      toast({
        title: "IA atualizada",
        description: variables.enabled
          ? "A IA vai atender esta conexão WhatsApp."
          : "A IA foi desligada nesta conexão WhatsApp.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao atualizar IA",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
