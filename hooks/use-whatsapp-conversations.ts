import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient, type Query } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { whatsappAPI, type SendWhatsAppMessageResult } from "@/lib/api/whatsapp";
import { createClientId } from "@/lib/client-id";
import { createClient } from "@/lib/supabase/client";
import {
  getWhatsAppSendFailureStatus,
  matchesLeadMessagesQueryKey,
  matchesPaginatedWhatsAppMessagesQueryKey,
  matchesWhatsAppMessagesQueryKey,
  isWhatsAppInboxWakePayload,
  mergeWhatsAppMessagesWithLocalState,
  whatsappInboxTopic,
  whatsappQueryKeys,
  type WhatsAppQueryScope,
} from "@/lib/whatsapp-query-cache";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

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

type ReactToWhatsAppMessageVariables = {
  conversation: WhatsAppConversation;
  targetMessage: WhatsAppMessage;
  emoji: string;
  _clientReactionId?: string;
};

type UseWhatsAppMessagesOptions = {
  includeLeadHistory?: boolean;
  refetchIntervalMs?: number | false;
  refetchOnWindowFocus?: boolean;
  refetchOnMount?: boolean | "always";
};

const getConversationLeadId = (conversation?: WhatsAppConversation | null) =>
  conversation?.lead_id || conversation?.lead?.id || null;

const messageIdentityAliases = (message: WhatsAppMessage) => [
  message.id,
  message.message_id,
  message.client_message_id,
].filter((value): value is string => Boolean(value));

const upsertCachedWhatsAppMessage = (
  messages: WhatsAppMessage[],
  nextMessage: WhatsAppMessage,
) => {
  const nextAliases = new Set(messageIdentityAliases(nextMessage));
  const existingIndex = messages.findIndex((message) =>
    messageIdentityAliases(message).some((alias) => nextAliases.has(alias)),
  );
  const next = [...messages];
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], ...nextMessage };
  } else {
    next.push(nextMessage);
  }
  return next.sort((left, right) => left.sent_at.localeCompare(right.sent_at));
};

const matchesWhatsAppMessagesQuery = (
  query: Query,
  scope: WhatsAppQueryScope,
  conversationId?: string | null,
  leadId?: string | null,
) => matchesWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId, leadId);

export function useWhatsAppConversations(
  sessionId?: string,
  filters?: ConversationFilters,
  accessibleSessionIds?: string[],
  limit: number = 80,
) {
  const scope = useWhatsAppQueryScope();
  const accessibleSessionKey = accessibleSessionIds
    ? [...accessibleSessionIds].sort().join(",")
    : "pending";

  return useQuery({
    queryKey: whatsappQueryKeys.conversations(scope, {
      sessionId,
      hideGroups: filters?.hideGroups ?? false,
      showArchived: filters?.showArchived ?? false,
      accessibleSessionKey,
      limit,
    }),
    queryFn: async () => {
      if (!scope.organizationId) return [];
      if (!sessionId && accessibleSessionIds !== undefined && accessibleSessionIds.length === 0) return [];

      return whatsappAPI.getConversations({
        organizationId: scope.organizationId,
        sessionId,
        filters,
        accessibleSessionIds,
        limit,
      }) as Promise<WhatsAppConversation[]>;
    },
    enabled: !!scope.organizationId && !!scope.userId,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    gcTime: 1000 * 60 * 10,
    retry: false,
  });
}

export function useWhatsAppConversation(conversationId: string | null) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: whatsappQueryKeys.conversation(scope, conversationId),
    queryFn: async () => {
      if (!conversationId) return null;
      return whatsappAPI.getConversation(conversationId, scope.organizationId) as Promise<WhatsAppConversation>;
    },
    enabled: !!conversationId && !!scope.organizationId && !!scope.userId,
  });
}

export function useWhatsAppMessages(
  conversationId: string | null,
  leadId?: string | null,
  limit: number = 50,
  options: UseWhatsAppMessagesOptions = {},
) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const includeLeadHistory = options.includeLeadHistory ?? true;
  const refetchInterval = options.refetchIntervalMs ?? (conversationId || leadId ? 15_000 : false);
  const queryKey = whatsappQueryKeys.messages(scope, {
    conversationId,
    leadId: leadId ?? null,
    limit,
    includeLeadHistory,
  });
  const mergeWithLocalState = (messages: WhatsAppMessage[]) =>
    mergeWhatsAppMessagesWithLocalState(
      messages,
      queryClient.getQueryData<WhatsAppMessage[]>(queryKey),
    );

  return useQuery({
    queryKey,
    queryFn: async () => {
      if (!conversationId && !leadId) return [];

      if (conversationId && !includeLeadHistory) {
        const page = await whatsappAPI.getMessages({
          conversationId,
          organizationId: scope.organizationId,
          limit,
        });
        return mergeWithLocalState(page.messages as WhatsAppMessage[]);
      }

      if (leadId) {
        const history = await whatsappAPI.getHistoryAccess({
          conversationId,
          leadId,
          limit,
          organizationId: scope.organizationId,
        });
        return mergeWithLocalState((history.messages || []) as WhatsAppMessage[]);
      }

      const page = await whatsappAPI.getMessages({
        conversationId: conversationId!,
        organizationId: scope.organizationId,
        limit,
      });
      return mergeWithLocalState(page.messages as WhatsAppMessage[]);
    },
    enabled: !!scope.organizationId && !!scope.userId && (!!conversationId || !!leadId),
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
  const scope = useWhatsAppQueryScope();

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
        scope.organizationId,
      );
    },
    onMutate: async (variables) => {
      const conversationId = variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const optimisticId = createClientId('message');
      variables._optimisticId = optimisticId;

      const messagesPredicate = (q: Query) =>
        matchesWhatsAppMessagesQuery(q, scope, conversationId, leadId);
      const leadMessagesPredicate = (q: Query) => Boolean(
        leadId && matchesLeadMessagesQueryKey(q.queryKey, scope, leadId),
      );
      await Promise.all([
        queryClient.cancelQueries({ predicate: messagesPredicate }),
        queryClient.cancelQueries({ predicate: leadMessagesPredicate }),
      ]);

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
            matchesWhatsAppMessagesQuery(q, scope, conversationId, leadId),
        },
        (old) => {
          if (old?.some((message) => message.id === optimisticId)) return old;
          return old ? [...old, optimisticMessage] : [optimisticMessage];
        },
      );

      queryClient.setQueriesData<PaginatedWhatsAppMessages>(
        {
          predicate: (query) =>
            matchesPaginatedWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId),
        },
        (old) => {
          const firstPage = old?.pages?.[0];
          if (!old?.pages || !firstPage) return old;
          if (firstPage.messages.some((message) => message.id === optimisticId)) return old;
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

      if (leadId) {
        queryClient.setQueriesData<PaginatedWhatsAppMessages>(
          {
            predicate: (query) => matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
          },
          (old) => {
            const firstPage = old?.pages?.[0];
            if (!old?.pages || !firstPage) return old;
            if (firstPage.messages.some((message) => message.id === optimisticId)) return old;
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
      }

      return { optimisticId, conversationId };
    },
    onSuccess: (result, variables, context) => {
      const conversationId = result?.conversationId || variables.conversation.id;
      const originalConversationId = context?.conversationId || variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const messageKeys = new Set([conversationId, originalConversationId]);

      if (context?.optimisticId) {
        const canonicalMessage = result.message as WhatsAppMessage | undefined;
        const updateMessage = (msg: WhatsAppMessage): WhatsAppMessage => {
          if (msg.id !== context.optimisticId) return msg;

          if (canonicalMessage) {
            return {
              ...msg,
              ...canonicalMessage,
              client_message_id: canonicalMessage.client_message_id || result.clientMessageId,
              media_url: canonicalMessage.media_url || variables.mediaUrl || variables.previewMediaUrl || msg.media_url,
              media_status: canonicalMessage.media_status
                || (variables.mediaUrl || variables.previewMediaUrl || msg.media_url ? "ready" : msg.media_status),
            };
          }

          return {
            ...msg,
            client_message_id: result?.clientMessageId || msg.client_message_id,
            conversation_id: conversationId,
            status: result.status || "confirming",
            media_url: variables.mediaUrl || variables.previewMediaUrl || msg.media_url,
            media_status: variables.mediaUrl || variables.previewMediaUrl || msg.media_url ? "ready" : msg.media_status,
          };
        };

        for (const cacheConversationId of messageKeys) {
          queryClient.setQueriesData<WhatsAppMessage[]>(
            {
              predicate: (q) =>
                matchesWhatsAppMessagesQuery(q, scope, cacheConversationId, leadId),
            },
            (old) => old?.map(updateMessage),
          );
          queryClient.setQueriesData<PaginatedWhatsAppMessages>(
            {
              predicate: (query) => matchesPaginatedWhatsAppMessagesQueryKey(
                query.queryKey,
                scope,
                cacheConversationId,
              ),
            },
            (old) => old
              ? {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    messages: page.messages.map(updateMessage),
                  })),
                }
              : old,
          );
        }

        if (leadId) {
          queryClient.setQueriesData<PaginatedWhatsAppMessages>(
            {
              predicate: (query) => matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
            },
            (old) => old
              ? {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    messages: page.messages.map(updateMessage),
                  })),
                }
              : old,
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      const refreshMessages = () => {
        void queryClient.invalidateQueries({
          predicate: (q) => [...messageKeys].some((messageConversationId) =>
            matchesWhatsAppMessagesQuery(q, scope, messageConversationId, leadId),
          ),
        });
        if (leadId) {
          void queryClient.invalidateQueries({
            queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId),
          });
        }
      };
      if (typeof window === "undefined") {
        refreshMessages();
      } else {
        window.setTimeout(refreshMessages, 4_000);
      }
    },
    onError: (error: Error, variables, context) => {
      const errorMessage = error.message || "";
      const leadId = getConversationLeadId(variables.conversation);
      const failureStatus = getWhatsAppSendFailureStatus(errorMessage);

      if (context?.optimisticId) {
        const updateFailedMessage = (msg: WhatsAppMessage) =>
          msg.id === context.optimisticId
            ? { ...msg, status: failureStatus, media_error: errorMessage }
            : msg;

        queryClient.setQueriesData<WhatsAppMessage[]>(
          {
            predicate: (q) =>
              matchesWhatsAppMessagesQuery(q, scope, variables.conversation.id, leadId),
          },
          (old) => old?.map(updateFailedMessage),
        );
        queryClient.setQueriesData<PaginatedWhatsAppMessages>(
          {
            predicate: (query) => matchesPaginatedWhatsAppMessagesQueryKey(
              query.queryKey,
              scope,
              variables.conversation.id,
            ),
          },
          (old) => old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  messages: page.messages.map(updateFailedMessage),
                })),
              }
              : old,
        );

        if (leadId) {
          queryClient.setQueriesData<PaginatedWhatsAppMessages>(
            {
              predicate: (query) => matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
            },
            (old) => old
              ? {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    messages: page.messages.map(updateFailedMessage),
                  })),
                }
              : old,
          );
        }
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
        description = "Vá em Configurações > WhatsApp e escaneie o QR Code novamente.";
      } else if (isNumberNotExists) {
        title = "Contato sem WhatsApp";
        description = "Este número não está no WhatsApp. Tente ligar ou enviar SMS.";
      } else if (isRateLimited) {
        title = "Aguarde um instante";
        description = "Você está enviando mensagens muito rápido. Tente novamente em alguns segundos.";
      } else if (failureStatus === "confirming") {
        title = "Confirmando envio";
        description = "Ainda nao recebemos a confirmacao. A mensagem continuara visivel; nao reenvie agora.";
      }

      toast({
        title,
        description,
        variant: failureStatus === "confirming" ? "default" : "destructive",
      });
    },
  });
}

export function useReactToWhatsAppMessage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scope = useWhatsAppQueryScope();

  const updateReactionCaches = (
    conversationId: string,
    leadId: string | null,
    updater: (messages: WhatsAppMessage[]) => WhatsAppMessage[],
  ) => {
    queryClient.setQueriesData<WhatsAppMessage[]>(
      {
        predicate: (query) => matchesWhatsAppMessagesQuery(
          query,
          scope,
          conversationId,
          leadId,
        ),
      },
      (old) => old ? updater(old) : old,
    );
    queryClient.setQueriesData<PaginatedWhatsAppMessages>(
      {
        predicate: (query) => matchesPaginatedWhatsAppMessagesQueryKey(
          query.queryKey,
          scope,
          conversationId,
        ),
      },
      (old) => {
        const firstPage = old?.pages?.[0];
        if (!old || !firstPage) return old;
        return {
          ...old,
          pages: [
            { ...firstPage, messages: updater(firstPage.messages) },
            ...old.pages.slice(1),
          ],
        };
      },
    );
    if (leadId) {
      queryClient.setQueriesData<PaginatedWhatsAppMessages>(
        {
          predicate: (query) => matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
        },
        (old) => {
          const firstPage = old?.pages?.[0];
          if (!old || !firstPage) return old;
          return {
            ...old,
            pages: [
              { ...firstPage, messages: updater(firstPage.messages) },
              ...old.pages.slice(1),
            ],
          };
        },
      );
    }
  };

  const refreshReactionCaches = (conversationId: string, leadId: string | null) => {
    void queryClient.invalidateQueries({
      predicate: (query) => matchesWhatsAppMessagesQuery(
        query,
        scope,
        conversationId,
        leadId,
      ),
    });
    void queryClient.invalidateQueries({
      queryKey: whatsappQueryKeys.paginatedMessagesForConversation(scope, conversationId),
    });
    if (leadId) {
      void queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId),
      });
    }
  };

  return useMutation({
    mutationFn: async (variables: ReactToWhatsAppMessageVariables) => {
      return whatsappAPI.reactToMessage(
        variables.conversation.id,
        variables.targetMessage.id,
        {
          emoji: variables.emoji,
          clientReactionId: variables._clientReactionId || createClientId('reaction'),
        },
        scope.organizationId,
      );
    },
    onMutate: async (variables) => {
      const conversationId = variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const clientReactionId = createClientId('reaction');
      variables._clientReactionId = clientReactionId;
      const targetProviderMessageId = variables.targetMessage.message_id || variables.targetMessage.id;

      await Promise.all([
        queryClient.cancelQueries({
          predicate: (query) => matchesWhatsAppMessagesQuery(
            query,
            scope,
            conversationId,
            leadId,
          ),
        }),
        queryClient.cancelQueries({
          queryKey: whatsappQueryKeys.paginatedMessagesForConversation(scope, conversationId),
        }),
        leadId
          ? queryClient.cancelQueries({
              queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId),
            })
          : Promise.resolve(),
      ]);

      const optimisticReaction: WhatsAppMessage = {
        id: clientReactionId,
        conversation_id: conversationId,
        session_id: variables.targetMessage.session_id || variables.conversation.session_id,
        message_id: clientReactionId,
        client_message_id: clientReactionId,
        from_me: true,
        content: variables.emoji || null,
        message_type: 'reaction',
        media_url: null,
        media_mime_type: null,
        remote_jid: variables.targetMessage.remote_jid || variables.conversation.remote_jid,
        reaction_to_message_id: targetProviderMessageId,
        reaction_emoji: variables.emoji || null,
        reaction_sender_jid: null,
        reaction_sender_name: profile?.name || null,
        status: 'queued',
        sent_at: new Date().toISOString(),
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: profile?.name || null,
      };

      updateReactionCaches(
        conversationId,
        leadId,
        (messages) => upsertCachedWhatsAppMessage(messages, optimisticReaction),
      );

      return { clientReactionId, conversationId, leadId };
    },
    onSuccess: (result, variables, context) => {
      const conversationId = result.conversationId || context?.conversationId || variables.conversation.id;
      const leadId = context?.leadId ?? getConversationLeadId(variables.conversation);
      updateReactionCaches(
        conversationId,
        leadId,
        (messages) => upsertCachedWhatsAppMessage(messages, result.reaction as WhatsAppMessage),
      );

      const refresh = () => refreshReactionCaches(conversationId, leadId);
      if (typeof window === 'undefined') refresh();
      else window.setTimeout(refresh, 4_000);
    },
    onError: (error: Error, variables, context) => {
      if (!context?.clientReactionId) return;
      const errorMessage = error.message || '';
      const status = getWhatsAppSendFailureStatus(errorMessage);
      const isDefinitive = status === 'failed'
        || /not found|invalid|nao encontrad|não encontrad/i.test(errorMessage);
      updateReactionCaches(
        context.conversationId,
        context.leadId,
        (messages) => isDefinitive
          ? messages.filter((message) => message.id !== context.clientReactionId)
          : messages.map((message) => message.id === context.clientReactionId
            ? { ...message, status: 'confirming', media_error: errorMessage }
            : message),
      );
      refreshReactionCaches(context.conversationId, context.leadId);
      toast({
        title: isDefinitive ? 'Reacao nao enviada' : 'Confirmando reacao',
        description: isDefinitive
          ? 'Não foi possível aplicar esta reação.'
          : 'A confirmacao ainda nao chegou. A reacao sera atualizada automaticamente.',
        variant: isDefinitive ? 'destructive' : 'default',
      });
    },
  });
}

export function useMarkConversationAsRead() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string;
      remote_jid: string;
      is_group?: boolean;
    }) => {
      await whatsappAPI.markConversationAsRead(conversation.id, scope.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
    },
  });
}

export function useMarkAsSeenOnWhatsApp() {
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string;
      remote_jid: string;
      is_group?: boolean;
    }) => {
      await whatsappAPI.markAsSeenOnWhatsApp(conversation.id, scope.organizationId);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível marcar como lida no WhatsApp",
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
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async ({ conversationId, archive }: { conversationId: string; archive: boolean }) => {
      await whatsappAPI.archiveConversation(conversationId, archive, scope.organizationId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
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
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      await whatsappAPI.deleteConversation(conversationId, scope.organizationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      toast({
        title: "Conversa removida",
        description: "A conversa foi removida da lista",
      });
    },
  });
}

export function useLinkConversationToLead() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useMutation({
    mutationFn: async ({ conversationId, leadId }: { conversationId: string; leadId: string }) => {
      await whatsappAPI.linkConversationToLead(conversationId, leadId, scope.organizationId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.conversation(scope, variables.conversationId),
      });
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      toast({
        title: "Conversa vinculada",
        description: "A conversa foi vinculada ao lead",
      });
    },
  });
}

export function useWhatsAppRealtimeConversations(
  enabled: boolean = true,
  accessibleSessionIds?: string[],
  leadIds: string[] = [],
) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const accessibleSessionKey = accessibleSessionIds ? accessibleSessionIds.join("|") : null;
  const leadKey = [...new Set(leadIds.filter(Boolean))].sort().join("|");

  useEffect(() => {
    if (!enabled || !scope.organizationId || !scope.userId) return;
    const organizationId = scope.organizationId;

    queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
    const scopedLeadIds = leadKey ? leadKey.split("|") : [];
    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];
    const reconcileTimers: ReturnType<typeof setTimeout>[] = [];
    let inboxDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const reconcileConversations = () => {
      if (cancelled) return;
      queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.conversationsScope(scope),
        refetchType: "active",
      });
    };

    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;

      // The organization inbox channel is only a content-free wake-up signal.
      // It makes brand-new conversations visible before their lead-specific
      // channel is known locally. Canonical data still comes from the scoped API.
      const inboxChannel = supabase
        .channel(whatsappInboxTopic(organizationId), { config: { private: true } })
        .on("broadcast", { event: "whatsapp.inbox.changed" }, ({ payload }) => {
          if (!isWhatsAppInboxWakePayload(payload)) return;
          if (inboxDebounceTimer) return;
          inboxDebounceTimer = setTimeout(() => {
            inboxDebounceTimer = undefined;
            reconcileConversations();
          }, 150);
        })
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return;
          reconcileConversations();
          reconcileTimers.push(setTimeout(reconcileConversations, 1_000));
        });
      channels.push(inboxChannel);

      scopedLeadIds.forEach((leadId) => {
        const topic = `whatsapp:${organizationId}:lead:${leadId}`;
        const channel = supabase
          .channel(topic, { config: { private: true } })
          .on("broadcast", { event: "whatsapp.message.changed" }, ({ payload }) => {
            const event = (payload || {}) as Record<string, unknown>;
            const conversationId = typeof event.conversationId === "string" ? event.conversationId : null;
            queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
            queryClient.invalidateQueries({
              predicate: (query) => matchesWhatsAppMessagesQuery(query, scope, conversationId, leadId),
            });
            queryClient.invalidateQueries({
              queryKey: conversationId
                ? whatsappQueryKeys.paginatedMessagesForConversation(scope, conversationId)
                : whatsappQueryKeys.paginatedMessagesScope(scope),
              refetchType: "active",
            });
            queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId) });
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("vimob:whatsapp-message-changed", {
                detail: { ...event, leadId, conversationId },
              }));
            }
          })
          .subscribe((status) => {
            if (status !== "SUBSCRIBED") return;
            // Broadcast is only a low-latency hint. A cold/reconnected Realtime
            // tenant can become subscribed after an event was committed, so always
            // reconcile canonical state once the stream reports readiness.
            const reconcile = () => {
              if (cancelled) return;
              queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
              queryClient.invalidateQueries({
                predicate: (query) => matchesWhatsAppMessagesQuery(query, scope, null, leadId),
              });
              queryClient.invalidateQueries({
                queryKey: whatsappQueryKeys.paginatedMessagesScope(scope),
                refetchType: "active",
              });
              queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId) });
            };
            reconcile();
            // Supabase can emit SUBSCRIBED just before a cold replication stream is
            // fully consuming WAL. The delayed reconciliation closes that window.
            reconcileTimers.push(setTimeout(reconcile, 1_000));
          });
        channels.push(channel);
      });
    });

    return () => {
      cancelled = true;
      if (inboxDebounceTimer) clearTimeout(inboxDebounceTimer);
      reconcileTimers.forEach((timer) => clearTimeout(timer));
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [
    enabled,
    scope,
    queryClient,
    accessibleSessionKey,
    leadKey,
  ]);
}
