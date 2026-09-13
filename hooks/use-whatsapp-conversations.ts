import { useEffect, useMemo } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { whatsappAPI, type SendWhatsAppMessageResult } from "@/lib/api/whatsapp";
import { reportErrorEvent } from "@/lib/api/telemetry";
import { canSubscribeToWhatsAppRealtime } from "@/lib/access/whatsapp-realtime";
import { createClientId } from "@/lib/client-id";
import { canReactToWhatsAppMessage } from "@/lib/whatsapp-reactions";
import { createClient } from "@/lib/supabase/client";
import { getPrivateBroadcastRegistry } from "@/lib/supabase/private-broadcast";
import type {
  PrivateBroadcastDiagnostic,
  PrivateBroadcastStatus,
} from "@/lib/realtime/private-broadcast-registry";
import {
  WhatsAppRealtimeRefreshCoordinator,
  type WhatsAppRealtimeRefreshRequest,
} from "@/lib/realtime/whatsapp-refresh-coordinator";
import {
  getWhatsAppSendFailureStatus,
  matchesLeadMessagesQueryKey,
  matchesPaginatedWhatsAppMessagesQueryKey,
  matchesWhatsAppMessageRefreshQueryKey,
  matchesWhatsAppMessagesQueryKey,
  isWhatsAppInboxWakePayload,
  mergeWhatsAppMessagesWithLocalState,
  WHATSAPP_MESSAGES_RECONCILE_EVENT,
  whatsappInboxTopic,
  whatsappQueryKeys,
  type WhatsAppQueryScope,
} from "@/lib/whatsapp-query-cache";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";

const WHATSAPP_SEND_COOLDOWN_MS = 1000;
const WHATSAPP_SEND_RECONCILE_DELAYS_MS = [4_000, 15_000] as const;
const WHATSAPP_UNCERTAIN_SEND_RECONCILE_DELAYS_MS = [0, 4_000, 15_000, 60_000] as const;
const WHATSAPP_CONVERSATIONS_REFETCH_MS = 90_000;
const WHATSAPP_ACTIVE_MESSAGES_REFETCH_MS = 30_000;
const WHATSAPP_ACTIVE_MESSAGES_STALE_MS = 10_000;
const lastWhatsAppSendByUser = new Map<string, number>();
const realtimeDiagnosticReportedAt = new Map<string, number>();
const scheduledMessageReconciliations = new Map<string, ReturnType<typeof setTimeout>>();
const WHATSAPP_REALTIME_DIAGNOSTIC_THROTTLE_MS = 60_000;
const whatsappRealtimeRefreshCoordinators = new WeakMap<
  QueryClient,
  WhatsAppRealtimeRefreshCoordinator<WhatsAppQueryScope>
>();

export interface WhatsAppConversation {
  id: string;
  session_id: string | null;
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
  session_id: string | null;
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
  onlyLeads?: boolean;
  withoutLead?: boolean;
  pendingReply?: boolean;
  search?: string;
}

type WhatsAppConversationsQueryOptions = {
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
};

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

const RETRYABLE_LOCAL_MESSAGE_STATUSES = new Set([
  "queued",
  "pending",
  "sending",
  "confirming",
  "failed",
  "error",
]);

const upsertOptimisticWhatsAppMessage = (
  messages: WhatsAppMessage[],
  optimisticMessage: WhatsAppMessage,
) => {
  const optimisticAliases = new Set(messageIdentityAliases(optimisticMessage));
  const existingIndex = messages.findIndex((message) =>
    messageIdentityAliases(message).some((alias) => optimisticAliases.has(alias)),
  );

  if (existingIndex < 0) return [...messages, optimisticMessage];
  if (!RETRYABLE_LOCAL_MESSAGE_STATUSES.has(messages[existingIndex].status)) return messages;

  const next = [...messages];
  next[existingIndex] = {
    ...next[existingIndex],
    status: "pending",
    sent_at: optimisticMessage.sent_at,
    media_error: null,
    metadata: {
      ...(next[existingIndex].metadata ?? {}),
      local_delivery_state: "retrying_same_client_id",
    },
  };
  return next;
};

const matchesWhatsAppMessagesQuery = (
  query: Query,
  scope: WhatsAppQueryScope,
  conversationId?: string | null,
  leadId?: string | null,
) => matchesWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId, leadId);

function dispatchWhatsAppMessagesReconcile(conversationIds?: readonly string[]) {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT, {
    detail: conversationIds?.length ? { conversationIds: [...new Set(conversationIds)] } : undefined,
  }));
  return true;
}

const getWhatsAppRealtimeScopeKey = (scope: WhatsAppQueryScope) => JSON.stringify([
  scope.organizationId ?? "none",
  scope.userId ?? "none",
  scope.accessScope,
]);

function getWhatsAppRealtimeRefreshCoordinator(queryClient: QueryClient) {
  let coordinator = whatsappRealtimeRefreshCoordinators.get(queryClient);
  if (coordinator) return coordinator;

  coordinator = new WhatsAppRealtimeRefreshCoordinator((batch) => {
    const { scope } = batch;

    if (batch.refreshConversations) {
      void queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.conversationsScope(scope),
        refetchType: "active",
      });
    }

    if (batch.refreshMessages) {
      if (batch.allMessages) {
        void queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.messagesScope(scope),
          refetchType: "active",
        });
      } else if (batch.conversationIds.length || batch.leadIds.length) {
        void queryClient.invalidateQueries({
          predicate: (query) => batch.conversationIds.some((conversationId) =>
            matchesWhatsAppMessagesQuery(query, scope, conversationId),
          ) || batch.leadIds.some((leadId) =>
            matchesWhatsAppMessagesQuery(query, scope, null, leadId),
          ),
          refetchType: "active",
        });
      }

      const refreshEveryPaginatedConversation = batch.allMessages
        || batch.conversationIds.length === 0;
      if (!dispatchWhatsAppMessagesReconcile(
        refreshEveryPaginatedConversation ? undefined : batch.conversationIds,
      )) {
        void queryClient.invalidateQueries({
          ...(refreshEveryPaginatedConversation
            ? { queryKey: whatsappQueryKeys.paginatedMessagesScope(scope) }
            : {
                predicate: (query: Query) => batch.conversationIds.some((conversationId) =>
                  matchesPaginatedWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId),
                ),
              }),
          refetchType: "active",
        });
      }
    }

    if (batch.refreshLeadMessages) {
      if (batch.allLeadMessages) {
        void queryClient.invalidateQueries({
          queryKey: whatsappQueryKeys.leadMessagesScope(scope),
          refetchType: "active",
        });
      } else if (batch.leadIds.length) {
        void queryClient.invalidateQueries({
          predicate: (query) => batch.leadIds.some((leadId) =>
            matchesLeadMessagesQueryKey(query.queryKey, scope, leadId),
          ),
          refetchType: "active",
        });
      }
    }
  });
  whatsappRealtimeRefreshCoordinators.set(queryClient, coordinator);
  return coordinator;
}

export function scheduleWhatsAppRealtimeRefresh(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  request: Omit<WhatsAppRealtimeRefreshRequest<WhatsAppQueryScope>, "scopeKey" | "scope">,
) {
  getWhatsAppRealtimeRefreshCoordinator(queryClient).schedule({
    ...request,
    scope,
    scopeKey: getWhatsAppRealtimeScopeKey(scope),
  });
}

function reconcileWhatsAppMessageQueries(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  conversationIds: readonly string[],
  leadId?: string | null,
) {
  const uniqueConversationIds = [...new Set(conversationIds.filter(Boolean))];
  void queryClient.invalidateQueries({
    predicate: (query) => uniqueConversationIds.some((conversationId) =>
      matchesWhatsAppMessagesQuery(query, scope, conversationId, leadId),
    ) || Boolean(leadId && matchesWhatsAppMessagesQuery(query, scope, null, leadId)),
    refetchType: "active",
  });

  if (leadId) {
    void queryClient.invalidateQueries({
      queryKey: whatsappQueryKeys.leadMessagesScope(scope, leadId),
      refetchType: "active",
    });
  }

  if (!dispatchWhatsAppMessagesReconcile(uniqueConversationIds)) {
    void queryClient.invalidateQueries({
      predicate: (query) => matchesWhatsAppMessageRefreshQueryKey(
        query.queryKey,
        scope,
        uniqueConversationIds,
        leadId,
      ),
      refetchType: "active",
    });
  }
}

function scheduleWhatsAppMessageReconciliation(
  queryClient: QueryClient,
  scope: WhatsAppQueryScope,
  conversationIds: readonly string[],
  leadId: string | null,
  delays: readonly number[],
) {
  const uniqueConversationIds = [...new Set(conversationIds.filter(Boolean))].sort();
  const targetKey = [
    scope.organizationId ?? "none",
    scope.userId ?? "none",
    scope.accessScope,
    uniqueConversationIds.join(","),
    leadId ?? "none",
  ].join(":");

  delays.forEach((delay) => {
    const run = () => reconcileWhatsAppMessageQueries(
      queryClient,
      scope,
      uniqueConversationIds,
      leadId,
    );
    if (delay <= 0) {
      run();
      return;
    }

    const timerKey = `${targetKey}:${delay}`;
    if (scheduledMessageReconciliations.has(timerKey)) return;
    const timer = setTimeout(() => {
      scheduledMessageReconciliations.delete(timerKey);
      run();
    }, delay);
    scheduledMessageReconciliations.set(timerKey, timer);
  });
}

export function useWhatsAppConversations(
  sessionId?: string,
  filters?: ConversationFilters,
  accessibleSessionIds?: string[],
  limit: number = 80,
  options?: WhatsAppConversationsQueryOptions,
) {
  const scope = useWhatsAppQueryScope();
  const accessibleSessionKey = accessibleSessionIds
    ? [...accessibleSessionIds].sort().join(",")
    : "pending";

  const query = useInfiniteQuery({
    queryKey: whatsappQueryKeys.conversations(scope, {
      sessionId,
      hideGroups: filters?.hideGroups ?? false,
      showArchived: filters?.showArchived ?? false,
      onlyLeads: filters?.onlyLeads ?? false,
      withoutLead: filters?.withoutLead ?? false,
      pendingReply: filters?.pendingReply ?? false,
      search: filters?.search?.trim() ?? "",
      accessibleSessionKey,
      limit,
    }),
    queryFn: async ({ pageParam }) => {
      if (!scope.organizationId) return { conversations: [], nextCursor: null };
      if (!sessionId && accessibleSessionIds !== undefined && accessibleSessionIds.length === 0) {
        return { conversations: [], nextCursor: null };
      }

      return whatsappAPI.getConversationsPage({
        organizationId: scope.organizationId,
        sessionId,
        filters,
        accessibleSessionIds,
        limit,
        cursor: pageParam,
      }) as Promise<{ conversations: WhatsAppConversation[]; nextCursor: string | null }>;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!scope.organizationId && !!scope.userId && (options?.enabled ?? true),
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data as { pages?: unknown[] } | undefined;
      return (data?.pages?.length ?? 0) <= 1 ? WHATSAPP_CONVERSATIONS_REFETCH_MS : false;
    },
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false,
    staleTime: 30_000,
    gcTime: 1000 * 60 * 10,
    retry: false,
  });

  const conversations = useMemo(() => {
    const seen = new Set<string>();
    return (query.data?.pages ?? []).flatMap((page) => page.conversations).filter((conversation) => {
      if (seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    });
  }, [query.data?.pages]);

  return {
    ...query,
    data: conversations,
    hasMoreConversations: query.hasNextPage,
    loadMoreConversations: query.fetchNextPage,
    isLoadingMoreConversations: query.isFetchingNextPage,
  };
}

export function useWhatsAppUnreadCount(
  sessionId?: string,
  filters?: ConversationFilters,
  accessibleSessionIds?: string[],
  options?: WhatsAppConversationsQueryOptions,
) {
  const scope = useWhatsAppQueryScope();
  const accessibleSessionKey = accessibleSessionIds
    ? [...accessibleSessionIds].sort().join(",")
    : "all";

  return useQuery({
    queryKey: whatsappQueryKeys.unreadCount(scope, {
      sessionId,
      hideGroups: filters?.hideGroups ?? false,
      showArchived: filters?.showArchived ?? false,
      onlyLeads: filters?.onlyLeads ?? false,
      withoutLead: filters?.withoutLead ?? false,
      pendingReply: filters?.pendingReply ?? false,
      search: filters?.search?.trim() ?? "",
      accessibleSessionKey,
    }),
    queryFn: async () => {
      if (!scope.organizationId) return 0;
      if (!sessionId && accessibleSessionIds !== undefined && accessibleSessionIds.length === 0) {
        return 0;
      }

      return whatsappAPI.getUnreadCount({
        organizationId: scope.organizationId,
        sessionId,
        filters,
        accessibleSessionIds,
      });
    },
    enabled: !!scope.organizationId && !!scope.userId && (options?.enabled ?? true),
    refetchInterval: WHATSAPP_CONVERSATIONS_REFETCH_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
    staleTime: 30_000,
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

export function useWhatsAppConversationForLead(leadId: string | null | undefined) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: whatsappQueryKeys.conversationForLead(scope, leadId ?? null),
    queryFn: async () => {
      if (!leadId || !scope.organizationId) return null;
      return whatsappAPI.findConversation({
        leadId,
        phone: "",
        organizationId: scope.organizationId,
      }) as Promise<WhatsAppConversation | null>;
    },
    enabled: !!leadId && !!scope.organizationId && !!scope.userId,
    retry: false,
    staleTime: 30_000,
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
  const refetchInterval = options.refetchIntervalMs ?? (conversationId || leadId ? WHATSAPP_ACTIVE_MESSAGES_REFETCH_MS : false);
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
    refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
    staleTime: WHATSAPP_ACTIVE_MESSAGES_STALE_MS,
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
      clientMessageId,
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
      clientMessageId?: string;
      _optimisticId?: string;
    }): Promise<SendWhatsAppMessageResult> => {
      if (!conversation.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }

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
          clientMessageId: clientMessageId || _optimisticId,
        },
        scope.organizationId,
      );
    },
    onMutate: async (variables) => {
      if (!variables.conversation.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }

      const conversationId = variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const optimisticId = variables.clientMessageId || variables._optimisticId || createClientId('message');
      variables.clientMessageId = optimisticId;
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
          return old
            ? upsertOptimisticWhatsAppMessage(old, optimisticMessage)
            : [optimisticMessage];
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
          return {
            ...old,
            pages: [
              {
                ...firstPage,
                messages: upsertOptimisticWhatsAppMessage(firstPage.messages, optimisticMessage),
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
            return {
              ...old,
              pages: [
                {
                  ...firstPage,
                  messages: upsertOptimisticWhatsAppMessage(firstPage.messages, optimisticMessage),
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
      scheduleWhatsAppMessageReconciliation(
        queryClient,
        scope,
        [...messageKeys],
        leadId,
        WHATSAPP_SEND_RECONCILE_DELAYS_MS,
      );
    },
    onError: (error: Error, variables, context) => {
      const errorMessage = error.message || "";
      const leadId = getConversationLeadId(variables.conversation);
      const failureStatus = getWhatsAppSendFailureStatus(error);

      if (context?.optimisticId) {
        const updateFailedMessage = (msg: WhatsAppMessage) =>
          msg.id === context.optimisticId
            ? {
                ...msg,
                status: failureStatus,
                media_error: errorMessage,
                metadata: {
                  ...(msg.metadata ?? {}),
                  local_delivery_state: failureStatus === "confirming"
                    ? "awaiting_reconciliation"
                    : "failed",
                },
              }
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

      if (failureStatus === "confirming") {
        queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
        scheduleWhatsAppMessageReconciliation(
          queryClient,
          scope,
          [variables.conversation.id],
          leadId,
          WHATSAPP_UNCERTAIN_SEND_RECONCILE_DELAYS_MS,
        );
      }

      const normalizedErrorMessage = errorMessage.toLowerCase();
      const isRateLimited = normalizedErrorMessage.includes("rate_limit_local") ||
                            normalizedErrorMessage.includes("rate_limit_exceeded") ||
                            normalizedErrorMessage.includes("muitas requisi");
      const isDisconnected = normalizedErrorMessage.includes("whatsapp_disconnected") ||
                             normalizedErrorMessage.includes("desconectad") ||
                             normalizedErrorMessage.includes("qr code") ||
                             normalizedErrorMessage.includes("not connected");
      const isNumberNotExists = normalizedErrorMessage.includes("nao possui whatsapp") ||
                                normalizedErrorMessage.includes("nao esta registrado") ||
                                normalizedErrorMessage.includes("not exist") ||
                                normalizedErrorMessage.includes("invalid number");

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
      if (!variables.conversation.session_id || !variables.targetMessage.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
      if (!canReactToWhatsAppMessage(variables.targetMessage)) {
        throw new Error("WHATSAPP_MESSAGE_NOT_READY_FOR_REACTION");
      }

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
      if (!variables.conversation.session_id || !variables.targetMessage.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
      if (!canReactToWhatsAppMessage(variables.targetMessage)) {
        throw new Error("WHATSAPP_MESSAGE_NOT_READY_FOR_REACTION");
      }

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
      const status = getWhatsAppSendFailureStatus(error);
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
    onError: () => {
      toast({
        title: "Não foi possível atualizar a conversa",
        description: "Tente novamente em alguns instantes.",
        variant: "destructive",
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
    onError: () => {
      toast({
        title: "Não foi possível remover a conversa",
        description: "A conversa foi mantida. Tente novamente.",
        variant: "destructive",
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

function getWhatsAppRealtimeChannelScope(topic: string) {
  return topic.split(":")[2] === "lead" ? "lead" : "inbox";
}

function getWhatsAppRealtimeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name.slice(0, 120),
      message: error.message.slice(0, 500),
    };
  }
  return {
    name: "UnknownError",
    message: String(error ?? "Unknown Realtime error").slice(0, 500),
  };
}

function reportWhatsAppRealtimeDiagnostic(diagnostic: PrivateBroadcastDiagnostic) {
  const channelScope = getWhatsAppRealtimeChannelScope(diagnostic.topic);
  const organizationId = diagnostic.topic.split(":")[1] || undefined;
  const throttleKey = `${organizationId ?? "unknown"}:${diagnostic.kind}:${channelScope}`;
  const now = Date.now();
  const lastReportedAt = realtimeDiagnosticReportedAt.get(throttleKey) ?? 0;
  if (now - lastReportedAt < WHATSAPP_REALTIME_DIAGNOSTIC_THROTTLE_MS) return;
  realtimeDiagnosticReportedAt.set(throttleKey, now);

  const normalizedError = getWhatsAppRealtimeError(diagnostic.error);
  void reportErrorEvent({
    organizationId,
    source: "frontend",
    severity: diagnostic.kind === "auth_error" || diagnostic.kind === "open_error"
      ? "error"
      : "warning",
    category: "supabase_realtime",
    message: `WhatsApp Realtime ${diagnostic.kind}: ${normalizedError.message}`,
    errorCode: `WHATSAPP_REALTIME_${diagnostic.kind.toUpperCase()}`,
    component: "WhatsAppPrivateRealtime",
    fingerprint: `frontend:whatsapp-realtime:${diagnostic.kind}:${channelScope}`,
    metadata: {
      channelScope,
      event: diagnostic.event,
      status: diagnostic.status,
      errorName: normalizedError.name,
    },
  }).catch(() => undefined);
}

function useCanSubscribeWhatsAppRealtime(enabled: boolean) {
  const { isLoading: modulesLoading, hasModule } = useOrganizationModules();
  const { isLoading: permissionsLoading, hasPermission } = useUserPermissions();

  return canSubscribeToWhatsAppRealtime({
    enabled,
    modulesLoading,
    permissionsLoading,
    hasWhatsAppModule: hasModule("whatsapp"),
    hasWhatsAppViewPermission: hasPermission("whatsapp_view"),
  });
}

export function useWhatsAppInboxRealtime(enabled: boolean = true) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const canSubscribe = useCanSubscribeWhatsAppRealtime(enabled);

  useEffect(() => {
    if (!canSubscribe || !scope.organizationId || !scope.userId) return;
    const organizationId = scope.organizationId;

    scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
      refreshConversations: true,
    });
    const supabase = createClient();
    const registry = getPrivateBroadcastRegistry(supabase, reportWhatsAppRealtimeDiagnostic);
    const reconcileTimers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const reconcileInbox = () => {
      if (cancelled) return;
      scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
        refreshConversations: true,
        refreshMessages: true,
        refreshLeadMessages: true,
        allMessages: true,
        allLeadMessages: true,
      });
    };

    // The organization inbox channel is only a content-free wake-up signal.
    // Canonical data still comes from the scoped API.
    const lease = registry.acquire({
      topic: whatsappInboxTopic(organizationId),
      event: "whatsapp.inbox.changed",
      onPayload: (payload) => {
        if (!isWhatsAppInboxWakePayload(payload)) return;
        reconcileInbox();
      },
      onStatus: (status: PrivateBroadcastStatus) => {
        if (status !== "SUBSCRIBED") return;
        reconcileInbox();
        reconcileTimers.push(setTimeout(reconcileInbox, 1_000));
      },
    });

    return () => {
      cancelled = true;
      reconcileTimers.forEach((timer) => clearTimeout(timer));
      lease.release();
    };
  }, [canSubscribe, scope, queryClient]);
}

export function useWhatsAppLeadRealtime(
  enabled: boolean = true,
  leadIds: string[] = [],
  options: { reconcileOnSubscribe?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const canSubscribe = useCanSubscribeWhatsAppRealtime(enabled);
  const leadKey = [...new Set(leadIds.filter(Boolean))].sort().join("|");
  const reconcileOnSubscribe = options.reconcileOnSubscribe ?? true;

  useEffect(() => {
    if (!canSubscribe || !scope.organizationId || !scope.userId || !leadKey) return;
    const organizationId = scope.organizationId;
    const scopedLeadIds = leadKey.split("|");
    const registry = getPrivateBroadcastRegistry(createClient(), reportWhatsAppRealtimeDiagnostic);
    const reconcileTimers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;

    const leases = scopedLeadIds.map((leadId) => registry.acquire({
      topic: `whatsapp:${organizationId}:lead:${leadId}`,
      event: "whatsapp.message.changed",
      onPayload: (payload) => {
        const event = (payload || {}) as Record<string, unknown>;
        const conversationId = typeof event.conversationId === "string" ? event.conversationId : null;
        scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
          refreshConversations: true,
          refreshMessages: true,
          refreshLeadMessages: true,
          conversationIds: conversationId ? [conversationId] : undefined,
          leadIds: [leadId],
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("vimob:whatsapp-message-changed", {
            detail: { ...event, leadId, conversationId },
          }));
        }
      },
      onStatus: (status: PrivateBroadcastStatus) => {
        if (status !== "SUBSCRIBED" || !reconcileOnSubscribe) return;
        // Broadcast is a low-latency hint. Reconcile once immediately and once
        // after a cold subscription to close the commit-before-join window.
        const reconcile = () => {
          if (cancelled) return;
          scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
            refreshConversations: true,
            refreshMessages: true,
            refreshLeadMessages: true,
            leadIds: [leadId],
          });
        };
        reconcile();
        reconcileTimers.push(setTimeout(reconcile, 1_000));
      },
    }));

    return () => {
      cancelled = true;
      reconcileTimers.forEach((timer) => clearTimeout(timer));
      leases.forEach((lease) => lease.release());
    };
  }, [canSubscribe, leadKey, queryClient, reconcileOnSubscribe, scope]);
}
