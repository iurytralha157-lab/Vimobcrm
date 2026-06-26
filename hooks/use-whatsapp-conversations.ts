import { useQuery, useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { whatsappAPI } from "@/lib/api/whatsapp";

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

export function useWhatsAppConversations(
  sessionId?: string,
  filters?: ConversationFilters,
  accessibleSessionIds?: string[],
) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-conversations", sessionId, filters, accessibleSessionIds],
    queryFn: async () => {
      if (!profile?.organization_id) return [];
      if (!sessionId && accessibleSessionIds !== undefined && accessibleSessionIds.length === 0) return [];

      return whatsappAPI.getConversations({
        organizationId: profile.organization_id,
        sessionId,
        filters,
        accessibleSessionIds,
      }) as Promise<WhatsAppConversation[]>;
    },
    enabled: !!profile?.organization_id,
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    gcTime: 1000 * 60 * 10,
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
) {
  const { profile } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-messages", conversationId, leadId, limit],
    queryFn: async () => {
      if (!conversationId && !leadId) return [];

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
    refetchIntervalInBackground: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 1000 * 60 * 15,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
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
      const optimisticId = crypto.randomUUID();
      variables._optimisticId = optimisticId;

      const messagesPredicate = (q: Query) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "whatsapp-messages" &&
        q.queryKey[1] === conversationId;
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
      const messageKeys = new Set([conversationId, originalConversationId]);

      if (context?.optimisticId) {
        for (const cacheConversationId of messageKeys) {
          queryClient.setQueriesData<WhatsAppMessage[]>(
            {
              predicate: (q) =>
                Array.isArray(q.queryKey) &&
                q.queryKey[0] === "whatsapp-messages" &&
                q.queryKey[1] === cacheConversationId,
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
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "whatsapp-messages" &&
          messageKeys.has(q.queryKey[1] as string),
      });
    },
    onError: (error: Error, variables, context) => {
      const errorMessage = error.message || "";
      const sentButNotPersisted = errorMessage.includes("Mensagem enviada no WhatsApp, mas");

      if (sentButNotPersisted && context?.optimisticId) {
        queryClient.setQueriesData<WhatsAppMessage[]>(
          {
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey[0] === "whatsapp-messages" &&
              q.queryKey[1] === variables.conversation.id,
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
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey[0] === "whatsapp-messages" &&
              q.queryKey[1] === variables.conversation.id,
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

export function useWhatsAppRealtimeConversations() {
  // Realtime is centralized elsewhere; this stays as a compatibility no-op.
}
