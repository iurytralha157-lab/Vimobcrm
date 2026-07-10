import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { createClientId } from "@/lib/client-id";
import { supabase } from "@/integrations/supabase/client";

const WHATSAPP_SEND_COOLDOWN_MS = 1000;
const lastWhatsAppSendByUser = new Map<string, number>();

export interface WhatsAppConversation {
  id: string;
  session_id: string;
  lead_id: string | null;
  remote_jid: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_picture: string | null;
  contact_presence: string | null;
  presence_updated_at: string | null;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  is_group: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  session?: {
    id: string;
    instance_name: string;
    phone_number: string | null;
    status: string;
    organization_id: string;
    provider?: "evolution" | "evolution_go" | null;
  };
  lead?: {
    id: string;
    name: string;
    whatsapp_avatar_url?: string | null;
    pipeline_id?: string | null;
    stage_id?: string | null;
    pipeline?: {
      id: string;
      name: string;
    } | null;
    stage?: {
      id: string;
      name: string;
      color: string | null;
    } | null;
    assignee?: {
      id: string;
      name: string;
      avatar_url?: string | null;
    } | null;
    tags?: Array<{
      tag: {
        id: string;
        name: string;
        color: string;
      };
    }>;
  };
}

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  session_id: string;
  message_id: string;
  client_message_id?: string | null;
  from_me: boolean;
  content: string | null;
  message_type: string;
  media_url: string | null;
  media_mime_type: string | null;
  media_status?: "pending" | "ready" | "failed" | null;
  media_error?: string | null;
  media_size?: number | null;
  media_storage_path?: string | null;
  remote_jid?: string | null;
  reaction_to_message_id?: string | null;
  reaction_emoji?: string | null;
  reaction_sender_jid?: string | null;
  reaction_sender_name?: string | null;
  metadata?: Record<string, unknown>;
  status: string;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  sender_jid: string | null;
  sender_name: string | null;
}

export interface ConversationFilters {
  hideGroups?: boolean;
  showArchived?: boolean;
}

type WhatsAppMessagePage = {
  messages: WhatsAppMessage[];
};

type PaginatedWhatsAppMessages = {
  pages: WhatsAppMessagePage[];
};

type SendWhatsAppMessageResult = Record<string, unknown> & {
  clientMessageId: string;
  conversationId: string;
};

type UseWhatsAppMessagesOptions = {
  includeLeadHistory?: boolean;
  refetchIntervalMs?: number | false;
  refetchOnWindowFocus?: boolean;
  refetchOnMount?: boolean | "always";
};

const getConversationLeadId = (conversation?: WhatsAppConversation | null) =>
  conversation?.lead_id || conversation?.lead?.id || null;

const matchesWhatsAppMessagesQuery = (
  query: Query,
  conversationId?: string | null,
  leadId?: string | null,
) => {
  if (!Array.isArray(query.queryKey) || query.queryKey[0] !== "whatsapp-messages") {
    return false;
  }

  return Boolean(
    (conversationId && query.queryKey[1] === conversationId) ||
      (leadId && query.queryKey[2] === leadId),
  );
};

export function useWhatsAppConversations(
  sessionId?: string,
  filters?: ConversationFilters,
  accessibleSessionIds?: string[],
  limit: number = 80,
) {
  const { profile } = useAuth();
  const accessibleSessionKey = accessibleSessionIds?.join(",") ?? "pending";

  return useQuery({
    queryKey: [
      "whatsapp-conversations",
      sessionId ?? "all",
      filters?.hideGroups ?? false,
      filters?.showArchived ?? false,
      accessibleSessionKey,
      limit,
    ],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      if (!sessionId && accessibleSessionIds !== undefined && accessibleSessionIds.length === 0) return [];

      return whatsappAPI.getConversations({
        organizationId: profile.organization_id,
        sessionId,
        filters,
        accessibleSessionIds,
        limit,
      }) as Promise<WhatsAppConversation[]>;
    },
    enabled: !!profile?.organization_id,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    gcTime: 1000 * 60 * 10,
    retry: false,
    placeholderData: previousData => previousData ?? [],
  });
}

export function useWhatsAppConversation(conversationId: string | null) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-conversation", conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      return whatsappAPI.getConversation(conversationId, profile?.organization_id) as Promise<WhatsAppConversation>;
    },
    enabled: !!conversationId && !!profile?.organization_id,
  });
}

export function useWhatsAppMessages(
  conversationId: string | null,
  leadId?: string | null,
  limit: number = 50,
  options: UseWhatsAppMessagesOptions = {},
) {
  const { profile } = useAuth();
  const includeLeadHistory = options.includeLeadHistory ?? true;
  const refetchInterval = options.refetchIntervalMs ?? (conversationId || leadId ? 5_000 : false);

  return useQuery({
    queryKey: [
      "whatsapp-messages",
      conversationId,
      leadId,
      limit,
      includeLeadHistory ? "lead-history" : "conversation-page",
    ],
    queryFn: async () => {
      if (!conversationId && !leadId) return [];

      if (conversationId && !includeLeadHistory) {
        const page = await whatsappAPI.getMessages({
          conversationId,
          organizationId: profile?.organization_id,
          limit,
        });
        return page.messages as WhatsAppMessage[];
      }

      if (leadId) {
        const history = await whatsappAPI.getHistoryAccess({
          conversationId,
          leadId,
          allMessages: true,
          organizationId: profile?.organization_id,
        });
        return (history.messages || []) as WhatsAppMessage[];
      }

      const page = await whatsappAPI.getMessages({
        conversationId: conversationId!,
        organizationId: profile?.organization_id,
        limit,
      });
      return page.messages as WhatsAppMessage[];
    },
    enabled: (!!conversationId && !!profile?.organization_id) || (!!leadId && !!profile?.organization_id),
    refetchInterval,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? true,
    staleTime: 2_000,
    gcTime: 1000 * 60 * 15,
    refetchOnMount: options.refetchOnMount ?? true,
  });
}

export function useSendWhatsAppMessage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      conversation,
      text,
      mediaUrl,
      mediaType,
      base64,
      mimetype,
      filename,
      sendSessionId,
      _optimisticId,
    }: {
      conversation: WhatsAppConversation;
      text: string;
      mediaUrl?: string;
      mediaType?: string;
      base64?: string;
      mimetype?: string;
      filename?: string;
      sendSessionId?: string;
      previewMediaUrl?: string;
      _optimisticId?: string;
    }): Promise<SendWhatsAppMessageResult> => {
      const rateLimitUserId = profile?.id || "anonymous";
      const now = Date.now();
      const lastSendAt = lastWhatsAppSendByUser.get(rateLimitUserId) || 0;

      if (now - lastSendAt < WHATSAPP_SEND_COOLDOWN_MS) {
        throw new Error("RATE_LIMIT_LOCAL");
      }

      lastWhatsAppSendByUser.set(rateLimitUserId, now);

      return whatsappAPI.sendMessage(
        conversation.id,
        {
          text,
          mediaUrl,
          mediaType,
          base64,
          mimetype,
          filename,
          sendSessionId,
          clientMessageId: _optimisticId,
        },
        profile?.organization_id,
      );
    },
    onMutate: async (variables) => {
      const conversationId = variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const optimisticId = createClientId('message');
      variables._optimisticId = optimisticId;

      const messagesPredicate = (q: Query) => matchesWhatsAppMessagesQuery(q, conversationId, leadId);
      await queryClient.cancelQueries({ predicate: messagesPredicate });

      const previousMessages =
        queryClient.getQueriesData<WhatsAppMessage[]>({ predicate: messagesPredicate })[0]?.[1];

      const isMediaMessage = !!(variables.mediaType && variables.mediaType !== "text");
      const isFilenameContent = variables.text && (
        variables.text === variables.filename ||
        variables.text.match(/^[a-f0-9-]+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|pdf|doc|docx)$/i) ||
        variables.text.match(/^\S+\.(png|jpg|jpeg|gif|webp|mp4|mp3|ogg|pdf|doc|docx)$/i)
      );
      const optimisticContent = isMediaMessage && isFilenameContent ? null : variables.text;

      const optimisticMessage: WhatsAppMessage & { client_message_id?: string } = {
        id: optimisticId,
        conversation_id: conversationId,
        session_id: variables.sendSessionId || variables.conversation.session_id,
        message_id: optimisticId,
        client_message_id: optimisticId,
        from_me: true,
        content: optimisticContent,
        message_type: variables.mediaType || "text",
        media_url: variables.previewMediaUrl || variables.mediaUrl || null,
        media_mime_type: variables.mimetype || null,
        remote_jid: variables.conversation.remote_jid,
        status: "pending",
        sent_at: new Date().toISOString(),
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: profile?.name || null,
        media_status: (variables.previewMediaUrl || variables.mediaUrl) ? "ready" : null,
        media_storage_path: null,
        media_error: null,
      };

      queryClient.setQueriesData<WhatsAppMessage[]>(
        {
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "whatsapp-messages" &&
            q.queryKey[1] === conversationId,
        },
        (old) => (old ? [...old, optimisticMessage] : [optimisticMessage]),
      );

      queryClient.setQueryData<PaginatedWhatsAppMessages>(
        ["whatsapp-messages-paginated", conversationId],
        (old) => {
          const firstPage = old?.pages?.[0];
          if (!old?.pages || !firstPage) return old;
          return {
            ...old,
            pages: [
              {
                ...firstPage,
                messages: [...firstPage.messages, optimisticMessage],
              },
              ...old.pages.slice(1),
            ],
          };
        },
      );

      return { previousMessages, optimisticId, conversationId };
    },
    onSuccess: (result, variables, context) => {
      const conversationId = result?.conversationId || variables.conversation.id;
      const originalConversationId = context?.conversationId || variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const messageKeys = new Set([conversationId, originalConversationId]);

      if (context?.optimisticId) {
        for (const cacheConversationId of messageKeys) {
          queryClient.setQueriesData<WhatsAppMessage[]>(
            {
              predicate: (q) => matchesWhatsAppMessagesQuery(q, cacheConversationId, leadId),
            },
            (old) => old?.map((msg) =>
              msg.id === context.optimisticId
                ? {
                    ...msg,
                    id: result?.clientMessageId || msg.id,
                    conversation_id: conversationId,
                    status: "sent",
                    media_url: variables.mediaUrl || variables.previewMediaUrl || msg.media_url,
                    media_status: variables.mediaUrl || variables.previewMediaUrl || msg.media_url ? "ready" : msg.media_status,
                  }
                : msg,
            ),
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      const refreshMessages = () => queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "whatsapp-messages" &&
          (
            messageKeys.has(q.queryKey[1] as string) ||
            Boolean(leadId && q.queryKey[2] === leadId)
          ),
      });
      if (typeof window === "undefined") {
        refreshMessages();
      } else {
        window.setTimeout(refreshMessages, 4_000);
      }
      if (leadId && profile?.organization_id) {
        queryClient.invalidateQueries({ queryKey: ["lead-messages", profile.organization_id, leadId] });
      }
    },
    onError: (error: Error, variables, context) => {
      const errorMessage = error.message || "";
      const sentButNotPersisted = errorMessage.includes("Mensagem enviada no WhatsApp, mas");
      const leadId = getConversationLeadId(variables.conversation);

      if (sentButNotPersisted && context?.optimisticId) {
        queryClient.setQueriesData<WhatsAppMessage[]>(
          {
            predicate: (q) => matchesWhatsAppMessagesQuery(q, variables.conversation.id, leadId),
          },
          (old) => old?.map((msg) =>
            msg.id === context.optimisticId
              ? { ...msg, status: "error", media_error: errorMessage }
              : msg,
          ),
        );
      } else if (context?.previousMessages) {
        queryClient.setQueriesData(
          {
            predicate: (q) => matchesWhatsAppMessagesQuery(q, variables.conversation.id, leadId),
          },
          context.previousMessages,
        );
      }

      const isRateLimited = errorMessage.includes("RATE_LIMIT_LOCAL") ||
                            errorMessage.includes("rate_limit_exceeded") ||
                            errorMessage.includes("Muitas requisi");
      const isDisconnected = errorMessage.includes("WHATSAPP_DISCONNECTED") ||
                             errorMessage.includes("desconectada") ||
                             errorMessage.includes("QR Code") ||
                             errorMessage.includes("not connected");
      const isNumberNotExists = errorMessage.includes("nao possui WhatsApp") ||
                                errorMessage.includes("nao esta registrado") ||
                                errorMessage.includes("not exist") ||
                                errorMessage.includes("invalid number");

      let title = "Erro ao enviar mensagem";
      let description = errorMessage;

      if (isDisconnected) {
        title = "WhatsApp Desconectado";
        description = "Va em Configuracoes > WhatsApp e escaneie o QR Code novamente.";
      } else if (isNumberNotExists) {
        title = "Contato sem WhatsApp";
        description = "Este numero nao esta no WhatsApp. Tente ligar ou enviar SMS.";
      } else if (isRateLimited) {
        title = "Aguarde um instante";
        description = "Voce esta enviando mensagens muito rapido. Tente novamente em alguns segundos.";
      }

      toast({ title, description, variant: "destructive" });
    },
  });
}

export function useMarkConversationAsRead() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string;
      remote_jid: string;
      is_group?: boolean;
    }) => {
      await whatsappAPI.markConversationAsRead(conversation.id, profile?.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
  });
}

export function useMarkAsSeenOnWhatsApp() {
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string;
      remote_jid: string;
      is_group?: boolean;
    }) => {
      await whatsappAPI.markAsSeenOnWhatsApp(conversation.id, profile?.organization_id);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Nao foi possivel marcar como lida no WhatsApp",
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({
        title: "Sucesso",
        description: "Mensagem marcada como lida no WhatsApp",
      });
    },
  });
}

export function useArchiveConversation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ conversationId, archive }: { conversationId: string; archive: boolean }) => {
      await whatsappAPI.archiveConversation(conversationId, archive, profile?.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      toast({
        title: variables.archive ? "Conversa arquivada" : "Conversa desarquivada",
        description: variables.archive
          ? "A conversa foi movida para o arquivo"
          : "A conversa foi restaurada",
      });
    },
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      await whatsappAPI.deleteConversation(conversationId, profile?.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      toast({
        title: "Conversa removida",
        description: "A conversa foi removida da lista",
      });
    },
  });
}

export function useLinkConversationToLead() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({ conversationId, leadId }: { conversationId: string; leadId: string }) => {
      await whatsappAPI.linkConversationToLead(conversationId, leadId, profile?.organization_id);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversation", variables.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      toast({
        title: "Conversa vinculada",
        description: "A conversa foi vinculada ao lead",
      });
    },
  });
}

export function useWhatsAppRealtimeConversations(enabled: boolean = true, accessibleSessionIds?: string[]) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const accessibleSessionKey = accessibleSessionIds ? accessibleSessionIds.join("|") : null;

  useEffect(() => {
    if (!enabled || !profile?.organization_id) return;

    // WhatsApp uses polling here; postgres_changes for these tables overloaded Realtime RLS.
    queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    return;
    /*

    const scopedSessionIds = accessibleSessionKey === null
      ? undefined
      : accessibleSessionKey
        ? accessibleSessionKey.split("|").filter(Boolean)
        : [];
    if (scopedSessionIds && scopedSessionIds.length === 0) return;

    const organizationId = profile.organization_id;
    let conversationRefreshTimer: number | null = null;
    const invalidateConversations = () => {
      if (conversationRefreshTimer) window.clearTimeout(conversationRefreshTimer);
      conversationRefreshTimer = window.setTimeout(() => {
        conversationRefreshTimer = null;
        queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
      }, 250);
    };
    const normalizeRealtimeId = (value: unknown) => typeof value === "string" && value ? value : null;
    const invalidateMessages = (conversationId?: unknown, leadId?: unknown) => {
      const scopedConversationId = normalizeRealtimeId(conversationId);
      const scopedLeadId = normalizeRealtimeId(leadId);

      if (!scopedConversationId && !scopedLeadId) {
        queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] });
        return;
      }

      queryClient.invalidateQueries({
        predicate: (q) => matchesWhatsAppMessagesQuery(q, scopedConversationId, scopedLeadId),
      });
      if (scopedConversationId) {
        queryClient.invalidateQueries({ queryKey: ["whatsapp-messages-paginated", scopedConversationId] });
      }
      if (scopedLeadId) {
        queryClient.invalidateQueries({ queryKey: ["lead-messages", organizationId, scopedLeadId] });
      }
    };
    const messageRefreshTimers = new Map<string, number>();
    const scheduleInvalidateMessages = (conversationId?: unknown, leadId?: unknown) => {
      const scopedConversationId = normalizeRealtimeId(conversationId);
      const scopedLeadId = normalizeRealtimeId(leadId);
      if (!scopedConversationId && !scopedLeadId) {
        invalidateMessages(conversationId, leadId);
        return;
      }

      const timerKey = `${scopedConversationId || "conversation:none"}:${scopedLeadId || "lead:none"}`;
      const existingTimer = messageRefreshTimers.get(timerKey);
      if (existingTimer) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        messageRefreshTimers.delete(timerKey);
        invalidateMessages(scopedConversationId, scopedLeadId);
      }, 900);
      messageRefreshTimers.set(timerKey, timer);
    };
    const upsertRealtimeMessage = (row: Record<string, unknown> | null) => {
      if (!row || typeof row.conversation_id !== "string") return;
      const conversationId = row.conversation_id;
      const leadId = normalizeRealtimeId(row.lead_id);
      const message = row as unknown as WhatsAppMessage;
      queryClient.setQueriesData<WhatsAppMessage[]>(
        {
          predicate: (q) => matchesWhatsAppMessagesQuery(q, conversationId, leadId),
        },
        (old) => {
          if (!old) return old;
          const messageKey = message.id || message.message_id || message.client_message_id;
          const next = [...old];
          const existingIndex = next.findIndex((item) =>
            item.id === message.id ||
            item.message_id === message.message_id ||
            (message.client_message_id && item.client_message_id === message.client_message_id) ||
            (messageKey && (item.id === messageKey || item.message_id === messageKey)),
          );
          if (existingIndex >= 0) {
            next[existingIndex] = { ...next[existingIndex], ...message };
          } else {
            next.push(message);
          }
          return next.sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        },
      );
    };

    const channelName = `whatsapp-live:${organizationId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    let channel = supabase.channel(channelName);
    const sessionFilters = [`organization_id=eq.${organizationId}`];

    sessionFilters.forEach((filter) => {
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_conversations",
          filter,
        },
        () => {
          invalidateConversations();
        },
      );
      channel = channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
          filter,
        },
        (payload) => {
          const row = (payload.new || payload.old) as Record<string, unknown> | null;
          invalidateConversations();
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            upsertRealtimeMessage(row);
          }
          scheduleInvalidateMessages(row?.conversation_id, row?.lead_id);
          if (payload.eventType === "INSERT" && typeof window !== "undefined" && row) {
            window.dispatchEvent(new CustomEvent("vimob:whatsapp-message-insert", { detail: row }));
          }
        },
      );
    });
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      invalidateConversations();
      invalidateMessages();
    });

    return () => {
      if (conversationRefreshTimer) window.clearTimeout(conversationRefreshTimer);
      messageRefreshTimers.forEach((timer) => window.clearTimeout(timer));
      messageRefreshTimers.clear();
      void supabase.removeChannel(channel);
    };
    */
  }, [enabled, profile?.organization_id, queryClient, accessibleSessionKey]);
}
