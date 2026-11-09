import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useMutation, useQueryClient, useIsMutating, type Query, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { whatsappAPI, type SendWhatsAppMessageResult, type WhatsAppContactCard, type WhatsAppLocation, type WhatsAppQuotedMessage } from "@/lib/api/whatsapp";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { reportErrorEvent } from "@/lib/api/telemetry";
import { canSubscribeToWhatsAppRealtime } from "@/lib/access/whatsapp-realtime";
import { createClientId } from "@/lib/client-id";
import { fingerprintWhatsAppFile, getWhatsAppFileIntentStore, getWhatsAppFileIntentOwnerKey, runWhatsAppFileIntent, settleWhatsAppFileIntent } from '@/lib/whatsapp-file-send-intent';
import { reserveWhatsAppSendAdmission } from '@/lib/whatsapp-send-admission';
import { sortWhatsAppMessages } from "@/lib/whatsapp-message-order";
import { canDiscardFailedLocalWhatsAppMessage, getWhatsAppSendIntentResolution, isWhatsAppSendScopeCurrent, type WhatsAppSendIntentResolution } from "@/lib/whatsapp-send-intent";
import { canReactToWhatsAppMessage } from "@/lib/whatsapp-reactions";
import { createClient } from "@/lib/supabase/client";
import { getPrivateBroadcastRegistry } from "@/lib/supabase/private-broadcast";
import type {
  PrivateBroadcastDiagnostic,
  PrivateBroadcastStatus,
} from "@/lib/realtime/private-broadcast-registry";
import {
  createWhatsAppInboxSubscriptionCatchUp,
  WhatsAppRealtimeRefreshCoordinator,
  type WhatsAppRealtimeRefreshRequest,
} from "@/lib/realtime/whatsapp-refresh-coordinator";
import {
  getWhatsAppSendFailureStatus,
  matchesLeadMessagesQueryKey,
  matchesWhatsAppAttendanceQueryKey,
  matchesPaginatedWhatsAppMessagesQueryKey,
  matchesWhatsAppMessageRefreshQueryKey,
  matchesWhatsAppMessagesQueryKey,
  isWhatsAppInboxWakePayload,
  isWhatsAppQueryKeyForScope,
  mergeWhatsAppMessagesWithLocalState,
  WHATSAPP_MESSAGES_RECONCILE_EVENT,
  whatsappInboxTopic,
  whatsappQueryKeys,
  type WhatsAppQueryScope,
} from "@/lib/whatsapp-query-cache";
import { WHATSAPP_UNLINKED_LEAD_SNAPSHOT } from "@/lib/whatsapp-message-input";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { mergeWhatsAppFilterOptionPages } from "@/lib/filters/whatsapp-filter-options";
import { refreshWhatsAppQueries } from "@/lib/realtime/whatsapp-query-refresh";
import { readWhatsAppInbox } from '@/lib/whatsapp-inbox-access';
import { getWhatsAppLocalSendPreviewStore, getWhatsAppLocalSendPreviewText, type SendPreviewOwner } from '@/lib/whatsapp-local-send-preview';

import { runWhatsAppRequestIntent, abortWhatsAppRequestIntents } from '@/lib/whatsapp-request-intent';

import { useWhatsAppIntentMutation } from '@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent';
import { isWhatsAppArchiveInvocation, matchesWhatsAppArchiveQuery, runExclusiveWhatsAppArchive } from '@/lib/whatsapp-archive';

const WHATSAPP_SEND_RECONCILE_DELAYS_MS = [4_000, 15_000] as const;
const WHATSAPP_UNCERTAIN_SEND_RECONCILE_DELAYS_MS = [0, 4_000, 15_000, 60_000] as const;
const WHATSAPP_CONVERSATIONS_REFETCH_MS = 90_000;
const WHATSAPP_CONVERSATIONS_PAGINATED_REFETCH_MS = 5 * 60_000;
const WHATSAPP_ACTIVE_MESSAGES_REFETCH_MS = 30_000;
const WHATSAPP_ACTIVE_MESSAGES_STALE_MS = 10_000;
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
  last_message_id?: string | null;
  last_message_sent_at?: string | null;
  last_message_from_me?: boolean | null;
  last_message_status?: string | null;
  unread_count: number;
  is_group: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
	historical_lead_view?: boolean;
  supervisory_lead_view?: boolean;
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
    source?: string | null;
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
  media_filename?: string | null;
  contacts?: WhatsAppContactCard[];
  location?: WhatsAppLocation;
  quoted_message?: WhatsAppQuotedMessage;
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
  can_quote?: boolean;
  can_react?: boolean;
  delivery_error_code?: "recipient_not_registered" | "outcome_unknown" | "send_failed" | null;
  delivery_error_reason?: "media_integrity_unverified";
  delivery_failed_at?: string | null;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  sender_jid: string | null;
  sender_name: string | null;
  sender_user_id?: string | null;
}

export interface ConversationFilters {
  pipelineId?: string;
  teamId?: string;
  userId?: string;
  leadSource?: string;
  tagIds?: string[];
  dealStatus?: 'open' | 'won' | 'lost';
  pageId?: string;
  campaignIds?: string[];
  adSetId?: string;
  adId?: string;
  leadCreatedFrom?: string;
  leadCreatedTo?: string;
  hideGroups?: boolean;
  showArchived?: boolean;
  onlyLeads?: boolean;
  withoutLead?: boolean;
  pendingReply?: boolean;
  search?: string;
  lastMessageFrom?: string;
  lastMessageTo?: string;
}

export function useWhatsAppConversationFilterOptions(
  sessionId?: string,
  accessibleSessionIds?: string[],
  context?: Pick<ConversationFilters, 'showArchived' | 'lastMessageFrom' | 'lastMessageTo' | 'pageId' | 'campaignIds' | 'adSetId' | 'leadCreatedFrom' | 'leadCreatedTo'> & { optionsSearch?: string; includeSupervisoryLeads?: boolean },
  enabled = false,
) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const accessibleSessionKey = accessibleSessionIds
    ? [...accessibleSessionIds].sort().join(',')
    : 'backend-visibility';

  const query = useInfiniteQuery({
    queryKey: [...whatsappQueryKeys.conversationsScope(scope), 'filter-options', sessionId ?? '', accessibleSessionKey, context?.showArchived ?? false, context?.lastMessageFrom ?? '', context?.lastMessageTo ?? '', context?.pageId ?? '', [...(context?.campaignIds ?? [])].sort(), context?.adSetId ?? '', context?.leadCreatedFrom ?? '', context?.leadCreatedTo ?? '', context?.optionsSearch ?? '', context?.includeSupervisoryLeads ?? false],
    queryFn: ({ signal, pageParam, queryKey }) => readWhatsAppInbox(queryClient, scope, queryKey, signal, () => accessibleSessionIds?.length === 0
      ? Promise.resolve({ pipelines: [], teams: [], users: [], sources: [], tags: [], pages: [], campaigns: [], adSets: [], ads: [], hasMore: false, nextOffset: null })
      : whatsappAPI.getConversationFilterOptions({
        organizationId: scope.organizationId,
        sessionId,
        accessibleSessionIds,
        showArchived: context?.showArchived,
        includeSupervisoryLeads: context?.includeSupervisoryLeads,
        lastMessageFrom: context?.lastMessageFrom,
        lastMessageTo: context?.lastMessageTo,
        pageId: context?.pageId,
        campaignIds: context?.campaignIds,
        adSetId: context?.adSetId,
        leadCreatedFrom: context?.leadCreatedFrom,
        leadCreatedTo: context?.leadCreatedTo,
        optionsSearch: context?.optionsSearch,
        optionsOffset: pageParam,
        optionsLimit: 100,
      }, { signal, expectedUserId: scope.userId })),
    enabled: enabled && !!scope.organizationId && !!scope.userId &&
      accessibleSessionIds?.length !== 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    initialPageParam: 0,
    getNextPageParam: (page) => page.nextOffset ?? undefined,
  });
  const data = useMemo(() => mergeWhatsAppFilterOptionPages(query.data?.pages ?? []), [query.data]);
  return { ...query, data };
}

type WhatsAppConversationsQueryOptions = {
  includeSupervisoryLeads?: boolean;
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
  _scope?: WhatsAppQueryScope;
  _scopeGeneration?: number;
};

type UseWhatsAppMessagesOptions = {
  includeLeadHistory?: boolean;
  refetchIntervalMs?: number | false;
  refetchOnWindowFocus?: boolean;
  refetchOnMount?: boolean | "always";
};

const getConversationLeadId = (conversation?: WhatsAppConversation | null) =>
  conversation?.lead_id || conversation?.lead?.id || null;

const requireConversationLeadId = (conversation?: WhatsAppConversation | null) => {
  if (conversation?.historical_lead_view || conversation?.supervisory_lead_view) {
    throw new Error("WHATSAPP_HISTORICAL_CONVERSATION_READ_ONLY");
  }
  const leadId = getConversationLeadId(conversation);
  if (!leadId) throw new Error("WHATSAPP_CONVERSATION_LEAD_UNAVAILABLE");
  return leadId;
};

const requireConversationBindingSnapshot = (conversation?: WhatsAppConversation | null) => {
  if (!conversation?.id) {
    throw new Error("WHATSAPP_CONVERSATION_UNAVAILABLE");
  }
  if (conversation.historical_lead_view || conversation.supervisory_lead_view) {
    throw new Error("WHATSAPP_HISTORICAL_CONVERSATION_READ_ONLY");
  }
  return getConversationLeadId(conversation) || WHATSAPP_UNLINKED_LEAD_SNAPSHOT;
};

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
  return sortWhatsAppMessages(next);
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

  if (existingIndex < 0) return sortWhatsAppMessages([...messages, optimisticMessage]);
  if (!RETRYABLE_LOCAL_MESSAGE_STATUSES.has(messages[existingIndex].status)) return messages;

  const next = [...messages];
  next[existingIndex] = {
    ...next[existingIndex],
    status: "pending",
    sent_at: optimisticMessage.sent_at,
    media_error: null,
    delivery_error_code: null,
    delivery_failed_at: null,
    metadata: {
      ...(next[existingIndex].metadata ?? {}),
      local_delivery_state: "retrying_same_client_id",
    },
  };
  return sortWhatsAppMessages(next);
};

const matchesWhatsAppMessagesQuery = (
  query: Query,
  scope: WhatsAppQueryScope,
  conversationId?: string | null,
  leadId?: string | null,
) => matchesWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId, leadId);

function dispatchWhatsAppMessagesReconcile(scope: WhatsAppQueryScope, conversationIds?: readonly string[]) {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT, {
    detail: { scope, ...(conversationIds?.length ? { conversationIds: [...new Set(conversationIds)] } : {}) },
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
      refreshWhatsAppQueries(queryClient, whatsappQueryKeys.conversationsScope(scope));
    }

    if (batch.refreshMessages) {
      if (batch.conversationIds.length || batch.leadIds.length) {
        void queryClient.invalidateQueries({
          predicate: (query) => query.isActive() && matchesWhatsAppAttendanceQueryKey(
            query.queryKey,
            scope,
            batch.conversationIds,
            batch.leadIds,
          ),
          refetchType: "active",
        });
      }
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
        scope,
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
  refreshWhatsAppQueries(queryClient, whatsappQueryKeys.conversationsScope(scope));
  void queryClient.invalidateQueries({
    predicate: (query) => query.isActive() && matchesWhatsAppAttendanceQueryKey(
      query.queryKey,
      scope,
      uniqueConversationIds,
      leadId ? [leadId] : [],
    ),
    refetchType: "active",
  });
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

  if (!dispatchWhatsAppMessagesReconcile(scope, uniqueConversationIds)) {
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
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const accessibleSessionKey = accessibleSessionIds
    ? [...accessibleSessionIds].sort().join(",")
    : "pending";

  const query = useInfiniteQuery({
    queryKey: whatsappQueryKeys.conversations(scope, {
      sessionId,
      pipelineId: filters?.pipelineId ?? '',
      teamId: filters?.teamId ?? '',
      userId: filters?.userId ?? '',
      leadSource: filters?.leadSource ?? "",
      tagIds: JSON.stringify([...(filters?.tagIds ?? [])].sort()),
      dealStatus: filters?.dealStatus ?? '',
      pageId: filters?.pageId ?? '',
      campaignIds: JSON.stringify([...(filters?.campaignIds ?? [])].sort()),
      adSetId: filters?.adSetId ?? '',
      adId: filters?.adId ?? '',
      leadCreatedFrom: filters?.leadCreatedFrom ?? '',
      leadCreatedTo: filters?.leadCreatedTo ?? '',
      hideGroups: filters?.hideGroups ?? false,
      showArchived: filters?.showArchived ?? false,
      onlyLeads: filters?.onlyLeads ?? false,
      withoutLead: filters?.withoutLead ?? false,
      pendingReply: filters?.pendingReply ?? false,
      search: filters?.search?.trim() ?? "",
      lastMessageFrom: filters?.lastMessageFrom ?? "",
      lastMessageTo: filters?.lastMessageTo ?? "",
      accessibleSessionKey,
      includeSupervisoryLeads: options?.includeSupervisoryLeads ?? false,
      limit,
    }),
    queryFn: ({ pageParam, signal, queryKey }) => readWhatsAppInbox(queryClient, scope, queryKey, signal, async () => {
      if (!scope.organizationId) return { conversations: [], nextCursor: null };
      if (!sessionId && accessibleSessionIds !== undefined && accessibleSessionIds.length === 0) {
        return { conversations: [], nextCursor: null };
      }

      return whatsappAPI.getConversationsPage({
        organizationId: scope.organizationId,
        sessionId,
        filters,
        accessibleSessionIds,
        includeSupervisoryLeads: options?.includeSupervisoryLeads,
        limit,
        cursor: pageParam,
      }, { signal, expectedUserId: scope.userId }) as Promise<{ conversations: WhatsAppConversation[]; nextCursor: string | null }>;
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!scope.organizationId && !!scope.userId && (options?.enabled ?? true),
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data as { pages?: unknown[] } | undefined;
      return (data?.pages?.length ?? 0) <= 1
        ? WHATSAPP_CONVERSATIONS_REFETCH_MS
        : WHATSAPP_CONVERSATIONS_PAGINATED_REFETCH_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
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
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const accessibleSessionKey = accessibleSessionIds
    ? [...accessibleSessionIds].sort().join(",")
    : "all";

  return useQuery({
    queryKey: whatsappQueryKeys.unreadCount(scope, {
      sessionId,
      pipelineId: filters?.pipelineId ?? '',
      teamId: filters?.teamId ?? '',
      userId: filters?.userId ?? '',
      leadSource: filters?.leadSource ?? "",
      tagIds: JSON.stringify([...(filters?.tagIds ?? [])].sort()),
      dealStatus: filters?.dealStatus ?? '',
      pageId: filters?.pageId ?? '',
      campaignIds: JSON.stringify([...(filters?.campaignIds ?? [])].sort()),
      adSetId: filters?.adSetId ?? '',
      adId: filters?.adId ?? '',
      leadCreatedFrom: filters?.leadCreatedFrom ?? '',
      leadCreatedTo: filters?.leadCreatedTo ?? '',
      hideGroups: filters?.hideGroups ?? false,
      showArchived: filters?.showArchived ?? false,
      onlyLeads: filters?.onlyLeads ?? false,
      withoutLead: filters?.withoutLead ?? false,
      pendingReply: filters?.pendingReply ?? false,
      search: filters?.search?.trim() ?? "",
      lastMessageFrom: filters?.lastMessageFrom ?? "",
      lastMessageTo: filters?.lastMessageTo ?? "",
      accessibleSessionKey,
    }),
    queryFn: ({ signal, queryKey }) => readWhatsAppInbox(queryClient, scope, queryKey, signal, async () => {
      if (!scope.organizationId) return 0;
      if (!sessionId && accessibleSessionIds !== undefined && accessibleSessionIds.length === 0) {
        return 0;
      }

      return whatsappAPI.getUnreadCount({
        organizationId: scope.organizationId,
        sessionId,
        filters,
        accessibleSessionIds,
      }, { signal, expectedUserId: scope.userId });
    }),
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

export function useWhatsAppConversation(conversationId: string | null, expectedLeadId: string | null) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
	queryKey: whatsappQueryKeys.conversation(scope, conversationId, expectedLeadId),
    queryFn: async ({ signal }) => {
	  if (!conversationId || !expectedLeadId) return null;
	  return whatsappAPI.getConversation(conversationId, expectedLeadId, scope.organizationId, { signal, expectedUserId: scope.userId }) as Promise<WhatsAppConversation>;
    },
	enabled: !!conversationId && !!expectedLeadId && !!scope.organizationId && !!scope.userId,
  });
}

export function useWhatsAppConversationSnapshot(conversationId: string | null) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: whatsappQueryKeys.conversationSnapshot(scope, conversationId),
    queryFn: async ({ signal }) => {
      if (!conversationId) return null;
      return whatsappAPI.getConversationSnapshot(
        conversationId,
        scope.organizationId, { signal, expectedUserId: scope.userId },
      ) as Promise<WhatsAppConversation>;
    },
    enabled: !!conversationId && !!scope.organizationId && !!scope.userId,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
}

export function useWhatsAppConversationForLead(
  leadId: string | null | undefined,
  conversationId?: string | null,
) {
  const scope = useWhatsAppQueryScope();

  return useQuery({
    queryKey: conversationId
      ? whatsappQueryKeys.conversationHistoryProjection(scope, conversationId, leadId ?? null)
      : whatsappQueryKeys.conversationForLead(scope, leadId ?? null),
    queryFn: async ({ signal }) => {
      if (!leadId || !scope.organizationId) return null;
	  if (conversationId) {
		const history = await whatsappAPI.getHistoryAccess({
		  conversationId,
		  leadId,
		  limit: 1,
		  organizationId: scope.organizationId,
		}, { signal, expectedUserId: scope.userId });
		const conversation = history.conversations?.find((item) => item.id === conversationId)
		  ?? (history.conversation?.id === conversationId ? history.conversation : null);
		return conversation as WhatsAppConversation | null;
	  }
      return whatsappAPI.findConversation({
        leadId,
        phone: "",
        organizationId: scope.organizationId,
      }, { signal, expectedUserId: scope.userId }) as Promise<WhatsAppConversation | null>;
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
    queryFn: async ({ signal }) => {
      if (!conversationId && !leadId) return [];

      if (conversationId && !includeLeadHistory) {
		if (!leadId) return [];
        const page = await whatsappAPI.getMessages({
          conversationId,
          organizationId: scope.organizationId,
          limit,
		  expectedLeadId: leadId,
        }, { signal, expectedUserId: scope.userId });
        return mergeWithLocalState(page.messages as WhatsAppMessage[]);
      }

      if (leadId) {
        const history = await whatsappAPI.getHistoryAccess({
          conversationId,
          leadId,
          limit,
          organizationId: scope.organizationId,
        }, { signal, expectedUserId: scope.userId });
        return mergeWithLocalState((history.messages || []) as WhatsAppMessage[]);
      }

	  if (!leadId) return [];
	  const page = await whatsappAPI.getMessages({
        conversationId: conversationId!,
        organizationId: scope.organizationId,
        limit,
		expectedLeadId: leadId,
      }, { signal, expectedUserId: scope.userId });
      return mergeWithLocalState(page.messages as WhatsAppMessage[]);
    },
	enabled: !!scope.organizationId && !!scope.userId && !!leadId,
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
  const previewStore = getWhatsAppLocalSendPreviewStore(queryClient);
  const previewOwner = useRef<SendPreviewOwner | null>(null);
  const { organizationId: previewOrganizationId, userId: previewUserId, accessScope: previewAccessScope } = scope;
  useLayoutEffect(() => {
    const owner = previewStore.createOwner({ organizationId: previewOrganizationId, userId: previewUserId, accessScope: previewAccessScope });
    previewOwner.current = owner;
    return () => {
      previewStore.retireOwner(owner, true);
      if (previewOwner.current === owner) previewOwner.current = null;
    };
  }, [previewStore, previewOrganizationId, previewUserId, previewAccessScope]);
  const resolveFileIntent = useResolveWhatsAppSendIntent();
  const resolveFileIntentRef = useRef(resolveFileIntent);
  useLayoutEffect(() => { resolveFileIntentRef.current = resolveFileIntent; }, [resolveFileIntent]);
  const currentScopeRef = useRef(scope);
  const originalOrganizationRef = useRef(profile?.organization_id ?? null);
  const currentScopeGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const requestsRef = useRef(new Set<AbortController>());
  const [pendingAdmissions, setPendingAdmissions] = useState(() => ({ generation: 0, tokens: new Map<symbol, number>() }));
  useLayoutEffect(() => {
    const requests = requestsRef.current;
    mountedRef.current = true;
    const generation = currentScopeGenerationRef.current;
    setPendingAdmissions(current => current.generation === generation ? current : { ...current, generation });
    return () => { mountedRef.current = false; currentScopeGenerationRef.current += 1; abortWhatsAppRequestIntents(requests); };
  }, []);
  useLayoutEffect(() => {
    if (!isWhatsAppSendScopeCurrent(scope, currentScopeRef.current)
      || originalOrganizationRef.current !== (profile?.organization_id ?? null)) {
      currentScopeGenerationRef.current += 1;
      abortWhatsAppRequestIntents(requestsRef.current);
      const generation = currentScopeGenerationRef.current;
      setPendingAdmissions(current => ({ ...current, generation }));
    }
    currentScopeRef.current = scope;
    originalOrganizationRef.current = profile?.organization_id ?? null;
  }, [profile?.organization_id, scope]);

  const mutation = useMutation({
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
      quotedMessageId,
      _scope,
      _scopeGeneration,
      _optimisticId,
      _admissionQueued,
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
      quotedMessageId?: string;
      optimisticQuotedMessage?: WhatsAppQuotedMessage;
      fileIntentSource?: File;
      fileIntentIsCurrent?: () => boolean;
      fileIntentVerificationOnly?: boolean;
      _scope?: WhatsAppQueryScope;
      _scopeGeneration?: number;
      _optimisticId?: string;
      _admissionQueued?: boolean;
    }): Promise<SendWhatsAppMessageResult> => {
      const sendScope = _scope ?? scope;
      if (!sendScope.organizationId || sendScope.organizationId !== originalOrganizationRef.current) {
        throw new VimobAPIError("O atendimento WhatsApp está disponível somente na organização original do seu cadastro.", { status: 403, code: "whatsapp_original_organization_required" });
      }
      if (!mountedRef.current || !isWhatsAppSendScopeCurrent(sendScope, currentScopeRef.current)
        || (_scopeGeneration !== undefined && _scopeGeneration !== currentScopeGenerationRef.current)) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }
      if (!conversation.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
	  const expectedLeadId = requireConversationLeadId(conversation);
      if (_admissionQueued) {
        // An admission waited behind another hook/gesture. Recheck attendance
        // after that wait and asynchronous onMutate; the POST rechecks grants.
        const sessionId = sendSessionId || conversation.session_id;
        const [attendance, authorized] = await runWhatsAppRequestIntent(sendScope, requestsRef.current, intent => Promise.all([
          whatsappAPI.getConversationAttendance(conversation.id, { expectedLeadId, sendSessionId: sessionId }, sendScope.organizationId, intent),
          whatsappAPI.getSessions(sendScope.organizationId, undefined, intent),
        ]));
        if (!mountedRef.current || !isWhatsAppSendScopeCurrent(sendScope, currentScopeRef.current)
          || _scopeGeneration !== currentScopeGenerationRef.current) {
          throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
        }
        if (!attendance.joined) throw new VimobAPIError("Confirme o início do atendimento antes de enviar.", { status: 409, code: "whatsapp_attendance_required" });
        const freshSession = authorized.data.find(session => session.id === sessionId && session.organization_id === sendScope.organizationId);
        if (!freshSession || freshSession.is_active === false || freshSession.provider !== "evolution_go") {
          throw new VimobAPIError("Você não tem mais acesso para enviar por este WhatsApp.", { status: 403, code: "whatsapp_session_access_revoked" });
        }
        if (freshSession.status !== "connected") throw new VimobAPIError("WhatsApp desconectado.", { status: 400, code: "whatsapp_disconnected" });
        if (freshSession.can_send !== true) throw new VimobAPIError("Você não tem mais acesso para enviar por este WhatsApp.", { status: 403, code: "whatsapp_session_access_revoked" });
      }

      return runWhatsAppRequestIntent(sendScope, requestsRef.current, (intent) => whatsappAPI.sendMessage(
        conversation.id,
        {
          text,
		  expectedLeadId,
          mediaUrl,
          mediaType,
          base64,
          mimetype,
          filename,
          sendSessionId,
          clientMessageId: clientMessageId || _optimisticId,
          quotedMessageId,
        },
        sendScope.organizationId,
        intent,
      ));
    },
    onMutate: async (variables) => {
      const scope = variables._scope ?? currentScopeRef.current;
      const scopeGeneration = variables._scopeGeneration ?? currentScopeGenerationRef.current;
      if (!mountedRef.current) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }
      if (!scope.organizationId || scope.organizationId !== originalOrganizationRef.current) {
        throw new VimobAPIError("O atendimento WhatsApp está disponível somente na organização original do seu cadastro.", { status: 403, code: "whatsapp_original_organization_required" });
      }
      if (!variables.conversation.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }

      const conversationId = variables.conversation.id;
	  const leadId = requireConversationLeadId(variables.conversation);
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
      if (!mountedRef.current || !isWhatsAppSendScopeCurrent(scope, currentScopeRef.current)
        || scopeGeneration !== currentScopeGenerationRef.current) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }

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
        media_filename: variables.filename || null,
        quoted_message: variables.optimisticQuotedMessage,
        remote_jid: variables.conversation.remote_jid,
        status: "pending",
        sent_at: new Date().toISOString(),
        delivered_at: null,
        read_at: null,
        sender_jid: null,
        sender_name: profile?.name || null,
        sender_user_id: scope.userId || null,
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
            matchesPaginatedWhatsAppMessagesQueryKey(query.queryKey, scope, conversationId, leadId),
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

      const previewToken = previewOwner.current ? previewStore.begin(previewOwner.current, variables.conversation, {
        clientId: optimisticId, sessionId: optimisticMessage.session_id!, sentAt: optimisticMessage.sent_at,
        preview: getWhatsAppLocalSendPreviewText(optimisticContent, variables.mediaType),
      }) : undefined;
      return { optimisticId, conversationId, scope, scopeGeneration, previewToken };
    },
    onSuccess: (result, variables, context) => {
      const scope = context?.scope ?? variables._scope ?? currentScopeRef.current;
      const conversationId = result?.conversationId || variables.conversation.id;
      const originalConversationId = context?.conversationId || variables.conversation.id;
      const leadId = getConversationLeadId(variables.conversation);
      const messageKeys = new Set([conversationId, originalConversationId]);
      const acceptedMessage = result.message;
      if (conversationId !== originalConversationId) previewStore.discard(context?.previewToken);
      else previewStore.advance(context?.previewToken, {
        status: acceptedMessage?.status || result.status || 'confirming', messageId: acceptedMessage?.id,
        conversationId, sessionId: acceptedMessage?.session_id, sentAt: acceptedMessage?.sent_at, fromMe: acceptedMessage?.from_me,
        clientId: acceptedMessage?.client_message_id || result.clientMessageId, canonical: Boolean(acceptedMessage?.id),
      });

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
                leadId,
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
      const scope = context?.scope ?? variables._scope ?? currentScopeRef.current;
      const errorMessage = error.message || "";
      const leadId = getConversationLeadId(variables.conversation);
      const failureStatus = getWhatsAppSendFailureStatus(error);
      const accessRevoked = error instanceof VimobAPIError && error.code === "whatsapp_session_access_revoked";
      if (accessRevoked) previewStore.discard(context?.previewToken);
      else previewStore.advance(context?.previewToken, { status: failureStatus });
      if (accessRevoked) {
        // The active composer must reflect the revocation immediately. The
        // caller keeps its draft after this definite send failure.
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.sessions(scope) }),
          queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.accessibleSessions(scope) }),
        ]);
      }

      if (context?.optimisticId) {
        const updateFailedMessage = (msg: WhatsAppMessage): WhatsAppMessage =>
          msg.id === context.optimisticId
            ? {
                ...msg,
                status: failureStatus,
                // A send error is not a media-processing error, and its raw
                // provider text can contain the recipient phone.
                media_error: msg.media_error,
                delivery_error_code: failureStatus === "failed" ? "send_failed" : null,
                delivery_failed_at: failureStatus === "failed" ? new Date().toISOString() : null,
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
              leadId,
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
      let description = "Não foi possível enviar esta mensagem. Confira a conexão e tente novamente.";

      if (failureStatus === "confirming") {
        title = "Confirmando envio";
        description = "Ainda não recebemos a confirmação. A mensagem continuará visível; não reenvie agora.";
      } else if (accessRevoked) {
        title = "Acesso ao WhatsApp revogado";
        description = "Você não tem mais acesso a este número. Inicie pelo seu WhatsApp ou conecte um número.";
      } else if (isDisconnected) {
        title = "WhatsApp Desconectado";
        description = "Vá em Configurações > WhatsApp e escaneie o QR Code novamente.";
      } else if (isNumberNotExists) {
        title = "Contato sem WhatsApp";
        description = "Este número não está no WhatsApp. Tente ligar ou enviar SMS.";
      } else if (isRateLimited) {
        title = "Aguarde um instante";
        description = "Você está enviando mensagens muito rápido. Tente novamente em alguns segundos.";
      }

      if (!isWhatsAppSendScopeCurrent(scope, currentScopeRef.current)
        || (context?.scopeGeneration ?? variables._scopeGeneration) !== currentScopeGenerationRef.current) return;
      toast({
        title,
        description,
        variant: failureStatus === "confirming" ? "default" : "destructive",
      });
    },
  });
  // TanStack may replace mutation callbacks while onMutate is awaiting cache
  // cancellation. Snapshot the tenant synchronously at the user's send gesture.
  type Variables = Parameters<typeof mutation.mutate>[0];
  const { mutateAsync } = mutation;
  const stableMutateAsync = useCallback(async (variables: Variables, options?: Parameters<typeof mutateAsync>[1]): Promise<SendWhatsAppMessageResult> => {
    const snapshot = {
      ...variables,
      conversation: {
        ...variables.conversation,
        lead: variables.conversation.lead ? { ...variables.conversation.lead,
          assignee: variables.conversation.lead.assignee ? { ...variables.conversation.lead.assignee } : variables.conversation.lead.assignee,
        } : variables.conversation.lead,
        session: variables.conversation.session ? { ...variables.conversation.session } : variables.conversation.session,
      },
      _scope: { ...currentScopeRef.current },
      _scopeGeneration: currentScopeGenerationRef.current,
    };
    const admission = reserveWhatsAppSendAdmission(snapshot._scope, snapshot.sendSessionId || snapshot.conversation.session_id, snapshot.conversation.id);
    const pendingToken = Symbol();
    if (mountedRef.current) setPendingAdmissions(current => ({ ...current,
      tokens: new Map(current.tokens).set(pendingToken, snapshot._scopeGeneration),
    }));
    const admittedSend = async (value: Variables) => {
      await admission.wait();
      if (!mountedRef.current || snapshot._scopeGeneration !== currentScopeGenerationRef.current
        || !isWhatsAppSendScopeCurrent(snapshot._scope, currentScopeRef.current)
        || (snapshot.fileIntentIsCurrent && !snapshot.fileIntentIsCurrent())) {
        throw new VimobAPIError("O contexto do atendimento mudou. Reabra a conversa antes de enviar.", { status: 409, code: "whatsapp_send_context_changed" });
      }
      if (!snapshot._scope.organizationId || snapshot._scope.organizationId !== originalOrganizationRef.current) {
        throw new VimobAPIError("O atendimento WhatsApp está disponível somente na organização original do seu cadastro.", { status: 403, code: "whatsapp_original_organization_required" });
      }
      return mutateAsync({ ...value, _admissionQueued: admission.queued }, options);
    };
    try {
      if (!snapshot.fileIntentSource) {
        if (snapshot.fileIntentVerificationOnly) return { clientMessageId: snapshot.clientMessageId || '',
          conversationId: snapshot.conversation.id, fileIntentChecked: true, fileIntentResolution: 'pending' };
        return await admittedSend(snapshot);
      }
      const isCurrent = () => mountedRef.current && snapshot._scopeGeneration === currentScopeGenerationRef.current
        && isWhatsAppSendScopeCurrent(snapshot._scope, currentScopeRef.current)
        && snapshot._scope.organizationId === originalOrganizationRef.current
        && (!snapshot.fileIntentIsCurrent || snapshot.fileIntentIsCurrent());
      await admission.wait();
      if (!isCurrent()) return { clientMessageId: '', conversationId: snapshot.conversation.id, fileIntentChecked: true, fileIntentResolution: 'cancelled' };
      const fingerprint = await fingerprintWhatsAppFile(snapshot.fileIntentSource);
      if (!isCurrent()) return { clientMessageId: '', conversationId: snapshot.conversation.id, fileIntentChecked: true, fileIntentResolution: 'cancelled' };
      const store = getWhatsAppFileIntentStore(getWhatsAppFileIntentOwnerKey(snapshot._scope));
      const key = JSON.stringify([snapshot.conversation.id, requireConversationLeadId(snapshot.conversation),
        snapshot.sendSessionId || snapshot.conversation.session_id, fingerprint]);
      const originalId = admission.fileIntent(key);
      const outcome = originalId ? { kind: 'checked' as const, clientMessageId: originalId,
        resolution: await resolveFileIntentRef.current({ conversation: snapshot.conversation, clientMessageId: originalId }),
      } : await runWhatsAppFileIntent(store, key, {
        isCurrent,
        verificationOnly: snapshot.fileIntentVerificationOnly,
        send: clientMessageId => {
          admission.rememberFileIntent(key, clientMessageId);
          return admittedSend({ ...snapshot, clientMessageId });
        },
        check: clientMessageId => resolveFileIntentRef.current({ conversation: snapshot.conversation, clientMessageId }),
        isUnconfirmed: result => getWhatsAppSendIntentResolution(result, {
          conversationId: snapshot.conversation.id, clientMessageId: result.clientMessageId,
        }) === 'pending',
      });
      if (outcome.kind === 'sent') return outcome.result;
      // Checking an earlier unknown intent may settle/remove its store entry.
      // Gestures already overlapping this original check still use that ID;
      // a duplicate checking F1's receipt must not widen F1's overlap boundary.
      if (!originalId && outcome.clientMessageId) admission.rememberFileIntent(key, outcome.clientMessageId);
      if (isCurrent() && outcome.resolution !== 'cancelled') toast({
        title: outcome.resolution === 'pending' ? 'Confirmando envio' : 'Envio verificado',
        description: outcome.resolution === 'pending'
          ? outcome.clientMessageId
            ? 'Ainda não foi possível confirmar o envio original. Confira o estado na conversa antes de enviar novamente.'
            : 'A referência da tentativa não está disponível. Reabra a conversa e confira o envio original antes de continuar.'
          : outcome.resolution === 'accepted' ? 'O envio original está registrado na conversa.' : 'A tentativa original falhou. Você pode escolher o arquivo novamente.',
      });
      return { clientMessageId: outcome.clientMessageId, conversationId: snapshot.conversation.id,
        fileIntentChecked: true, fileIntentResolution: outcome.resolution };
    } finally {
      admission.release();
      if (mountedRef.current) setPendingAdmissions(current => {
        const tokens = new Map(current.tokens);
        tokens.delete(pendingToken);
        return { ...current, tokens };
      });
    }
  }, [mutateAsync]);
  const stableMutate = useCallback((variables: Variables, options?: Parameters<typeof mutateAsync>[1]) => {
    void stableMutateAsync(variables, options).catch(() => {});
  }, [stableMutateAsync]);
  return {
    ...mutation,
    isPending: [...pendingAdmissions.tokens.values()].some(generation => generation === pendingAdmissions.generation)
      || (mutation.isPending && mutation.variables?._scopeGeneration === pendingAdmissions.generation),
    mutate: stableMutate,
    mutateAsync: stableMutateAsync,
  };
}

export function useResolveWhatsAppSendIntent() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scope = useWhatsAppQueryScope();
  const currentRef = useRef({ scope, originalOrganization: profile?.organization_id ?? null, generation: 0, mounted: false });
  const pendingRef = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    const lifecycle = currentRef.current;
    lifecycle.mounted = true;
    const pending = pendingRef.current;
    return () => {
      lifecycle.mounted = false;
      lifecycle.generation += 1;
      for (const controller of pending) controller.abort();
      pending.clear();
    };
  }, []);
  useLayoutEffect(() => {
    if (!isWhatsAppSendScopeCurrent(scope, currentRef.current.scope)) {
      currentRef.current.generation += 1;
      for (const controller of pendingRef.current) controller.abort();
      pendingRef.current.clear();
    }
    currentRef.current.scope = scope;
    currentRef.current.originalOrganization = profile?.organization_id ?? null;
  }, [profile?.organization_id, scope]);
  return async ({ conversation, clientMessageId }: {
    conversation: WhatsAppConversation; clientMessageId: string;
  }): Promise<WhatsAppSendIntentResolution> => {
    const generation = currentRef.current.generation;
    const isCurrent = () => currentRef.current.mounted
      && generation === currentRef.current.generation
      && isWhatsAppSendScopeCurrent(scope, currentRef.current.scope);
    if (!isCurrent()) return 'cancelled';
    const leadId = requireConversationLeadId(conversation);
    const controller = new AbortController();
    pendingRef.current.add(controller);
    try {
      const result = await whatsappAPI.getSendStatus({
        conversationId: conversation.id, expectedLeadId: leadId, clientMessageId,
        organizationId: scope.organizationId,
        signal: controller.signal,
      }, { expectedUserId: scope.userId });
      if (!isCurrent()) return 'cancelled';
      const resolution = getWhatsAppSendIntentResolution(result, { conversationId: conversation.id, clientMessageId });
      if (resolution === 'accepted' || resolution === 'failed') {
        settleWhatsAppFileIntent(getWhatsAppFileIntentStore(getWhatsAppFileIntentOwnerKey(scope)), clientMessageId);
      }
      if (resolution !== 'pending' && result.message) {
        // Canonical data replaces a local attempt only in its original scope.
        scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
          refreshConversations: true, refreshMessages: true, refreshLeadMessages: true,
          conversationIds: [conversation.id], leadIds: [leadId],
        });
      }
      return resolution;
    } catch (error) {
      if (!isCurrent()) return 'cancelled';
      if (error instanceof VimobAPIError) {
        if (error.status === 404 && error.code === 'whatsapp_message_not_found') return 'pending';
        if (error.code === 'api_request_identity_changed') return 'cancelled';
        if (error.status === 403 || error.status === 404 || error.status === 410
          || (error.status === 400 && error.code === 'invalid_whatsapp_reference')) return 'cancelled';
      }
      return 'pending';
    } finally {
      pendingRef.current.delete(controller);
    }
  };
}

export function useDiscardFailedLocalWhatsAppMessage() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  return ({ conversation, message }: { conversation: WhatsAppConversation; message: WhatsAppMessage }) => {
    if (!canDiscardFailedLocalWhatsAppMessage(message)) return;
    const leadId = requireConversationLeadId(conversation);
    const remove = (messages: WhatsAppMessage[]) => messages.filter((current) =>
      current.id !== message.id || !canDiscardFailedLocalWhatsAppMessage(current));
    const predicate = (query: Query) => matchesWhatsAppMessagesQuery(query, scope, conversation.id, leadId)
      || matchesPaginatedWhatsAppMessagesQueryKey(query.queryKey, scope, conversation.id, leadId)
      || matchesLeadMessagesQueryKey(query.queryKey, scope, leadId);
    queryClient.setQueriesData<WhatsAppMessage[] | PaginatedWhatsAppMessages>({ predicate }, (old) => {
      if (Array.isArray(old)) return remove(old);
      return old ? { ...old, pages: old.pages.map((page) => ({ ...page, messages: remove(page.messages) })) } : old;
    });
  };
}

export function useReactToWhatsAppMessage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const scope = useWhatsAppQueryScope();
  const lifecycleRef = useRef({ scope, original: profile?.organization_id ?? null, generation: 0, mounted: false });
  const requestsRef = useRef(new Set<AbortController>());
  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
    const requests = requestsRef.current;
    lifecycle.mounted = true;
    return () => { lifecycle.mounted = false; lifecycle.generation += 1; abortWhatsAppRequestIntents(requests); };
  }, []);
  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
    if (!isWhatsAppSendScopeCurrent(scope, lifecycle.scope) || lifecycle.original !== (profile?.organization_id ?? null)) {
      lifecycle.generation += 1;
      abortWhatsAppRequestIntents(requestsRef.current);
    }
    lifecycle.scope = scope;
    lifecycle.original = profile?.organization_id ?? null;
  }, [profile?.organization_id, scope]);
  const isCurrent = (variables: ReactToWhatsAppMessageVariables) => lifecycleRef.current.mounted
    && variables._scopeGeneration === lifecycleRef.current.generation
    && !!variables._scope && isWhatsAppSendScopeCurrent(variables._scope, lifecycleRef.current.scope);
  const assertCurrent = (variables: ReactToWhatsAppMessageVariables) => {
    if (!isCurrent(variables)) throw new VimobAPIError('O contexto do atendimento mudou. Reabra a conversa antes de reagir.', { status: 409, code: 'whatsapp_send_context_changed' });
    if (!variables._scope?.organizationId || variables._scope.organizationId !== lifecycleRef.current.original) {
      throw new VimobAPIError('O atendimento WhatsApp está disponível somente na organização original do cadastro.', { status: 403, code: 'whatsapp_original_organization_required' });
    }
  };

  const updateReactionCaches = (
    scope: WhatsAppQueryScope,
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
          leadId,
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

  const refreshReactionCaches = (scope: WhatsAppQueryScope, conversationId: string, leadId: string | null) => {
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

  const mutation = useMutation({
    mutationFn: async (variables: ReactToWhatsAppMessageVariables) => {
      assertCurrent(variables);
      const reactionScope = variables._scope!;
      if (!variables.conversation.session_id || !variables.targetMessage.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
      if (!canReactToWhatsAppMessage(variables.targetMessage)) {
        throw new Error("WHATSAPP_MESSAGE_NOT_READY_FOR_REACTION");
      }
	  const expectedLeadId = requireConversationLeadId(variables.conversation);

      return runWhatsAppRequestIntent(reactionScope, requestsRef.current, (intent) => whatsappAPI.reactToMessage(
        variables.conversation.id,
        variables.targetMessage.id,
        {
          emoji: variables.emoji,
          clientReactionId: variables._clientReactionId || createClientId('reaction'),
		  expectedLeadId,
        },
        reactionScope.organizationId,
        intent,
      ));
    },
    onMutate: async (variables) => {
      assertCurrent(variables);
      const scope = variables._scope!;
      if (!variables.conversation.session_id || !variables.targetMessage.session_id) {
        throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
      }
      if (!canReactToWhatsAppMessage(variables.targetMessage)) {
        throw new Error("WHATSAPP_MESSAGE_NOT_READY_FOR_REACTION");
      }

      const conversationId = variables.conversation.id;
	  const leadId = requireConversationLeadId(variables.conversation);
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

      assertCurrent(variables);
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
        scope,
        conversationId,
        leadId,
        (messages) => upsertCachedWhatsAppMessage(messages, optimisticReaction),
      );

      return { clientReactionId, conversationId, leadId, scope };
    },
    onSuccess: (result, variables, context) => {
      const conversationId = result.conversationId || context?.conversationId || variables.conversation.id;
      const leadId = context?.leadId ?? getConversationLeadId(variables.conversation);
      const scope = context?.scope ?? variables._scope!;
      updateReactionCaches(
        scope,
        conversationId,
        leadId,
        (messages) => upsertCachedWhatsAppMessage(messages, result.reaction as WhatsAppMessage),
      );

      const refresh = () => refreshReactionCaches(scope, conversationId, leadId);
      if (typeof window === 'undefined') refresh();
      else window.setTimeout(refresh, 4_000);
    },
    onError: (error: Error, variables, context) => {
      if (!context?.clientReactionId) return;
      const status = getWhatsAppSendFailureStatus(error);
      const isDefinitive = status === 'failed';
      updateReactionCaches(
        context.scope,
        context.conversationId,
        context.leadId,
        (messages) => isDefinitive
          ? messages.filter((message) => message.id !== context.clientReactionId)
          : messages.map((message) => message.id === context.clientReactionId
            ? { ...message, status: 'confirming' }
            : message),
      );
      refreshReactionCaches(context.scope, context.conversationId, context.leadId);
      if (!isCurrent(variables)) return;
      toast({
        title: isDefinitive ? 'Reacao nao enviada' : 'Confirmando reacao',
        description: isDefinitive
          ? 'Não foi possível aplicar esta reação.'
          : 'A confirmacao ainda nao chegou. A reacao sera atualizada automaticamente.',
        variant: isDefinitive ? 'destructive' : 'default',
      });
    },
  });
  const { mutate, mutateAsync } = mutation;
  const stableMutate = useCallback((variables: ReactToWhatsAppMessageVariables, options?: Parameters<typeof mutate>[1]) =>
    mutate({ ...variables, _scope: { ...lifecycleRef.current.scope }, _scopeGeneration: lifecycleRef.current.generation }, options), [mutate]);
  const stableMutateAsync = useCallback((variables: ReactToWhatsAppMessageVariables, options?: Parameters<typeof mutateAsync>[1]) =>
    mutateAsync({ ...variables, _scope: { ...lifecycleRef.current.scope }, _scopeGeneration: lifecycleRef.current.generation }, options), [mutateAsync]);
  return {
    ...mutation,
    mutate: stableMutate,
    mutateAsync: stableMutateAsync,
  };
}

export function useMarkConversationAsRead() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useWhatsAppIntentMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string | null;
      remote_jid: string;
      is_group?: boolean;
	  lead_id?: string | null;
	  lead?: { id: string };
    }, intent) => {
	  const expectedLeadId = requireConversationBindingSnapshot(conversation as WhatsAppConversation);
	  await whatsappAPI.markConversationAsRead(conversation.id, expectedLeadId, scope.organizationId, intent);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
    },
  });
}

export function useMarkAsSeenOnWhatsApp() {
  const scope = useWhatsAppQueryScope();

  return useWhatsAppIntentMutation({
    mutationFn: async (conversation: {
      id: string;
      session_id: string | null;
      remote_jid: string;
      is_group?: boolean;
	  lead_id?: string | null;
	  lead?: { id: string };
    }, intent) => {
	  if (!conversation.session_id) {
		throw new Error("WHATSAPP_SESSION_UNAVAILABLE");
	  }
	  const expectedLeadId = requireConversationBindingSnapshot(conversation as WhatsAppConversation);
	  await whatsappAPI.markAsSeenOnWhatsApp(conversation.id, expectedLeadId, scope.organizationId, intent);
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
  useIsMutating({ predicate: mutation => isWhatsAppArchiveInvocation(mutation.state.variables, scope) });

	const mutation = useWhatsAppIntentMutation({
	mutationFn: async ({ conversation, archive }: { conversation: WhatsAppConversation; archive: boolean }, intent) => {
	  const expectedLeadId = requireConversationBindingSnapshot(conversation);
	  return runExclusiveWhatsAppArchive(queryClient, intent.scope, conversation.id, async () => {
	    try {
	      await whatsappAPI.archiveConversation(conversation.id, archive, expectedLeadId, intent.scope.organizationId, intent);
	    } finally {
	      // A transport abort after HTTP cannot undo a server effect. Mark only the
	      // captured owner's entries stale, including inactive physical snapshots.
	      await queryClient.invalidateQueries({ refetchType: 'none', predicate: query =>
	        matchesWhatsAppArchiveQuery(query.queryKey, intent.scope, conversation.id, expectedLeadId) });
	    }
	  });
    },
    onSuccess: async (_, variables, _context, intent) => {
      const expectedLeadId = requireConversationBindingSnapshot(variables.conversation);
      await queryClient.invalidateQueries({ predicate: query =>
        matchesWhatsAppArchiveQuery(query.queryKey, intent.scope, variables.conversation.id, expectedLeadId) });
      if (!intent.isCurrent()) return;
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
  return { ...mutation, isPendingFor: (conversation: Pick<WhatsAppConversation, 'id'>) =>
    queryClient.getMutationCache().findAll({ status: 'pending', predicate: entry =>
      isWhatsAppArchiveInvocation(entry.state.variables, scope, conversation.id) }).length > 0 };
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();

  return useWhatsAppIntentMutation({
	mutationFn: async (conversation: WhatsAppConversation, intent) => {
	  const expectedLeadId = requireConversationBindingSnapshot(conversation);
	  await whatsappAPI.deleteConversation(conversation.id, expectedLeadId, scope.organizationId, intent);
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

  return useWhatsAppIntentMutation({
    mutationFn: async ({ conversation, leadId, expectedPreviousLeadId, ownSessionOnly }: {
      conversation: WhatsAppConversation;
      leadId: string;
      expectedPreviousLeadId: string;
      ownSessionOnly?: boolean;
    }, intent) => {
      if (requireConversationBindingSnapshot(conversation) !== expectedPreviousLeadId) {
        throw new Error('A conversa mudou depois da prévia de vínculo');
      }
      return whatsappAPI.linkConversationToLead(
        conversation.id,
        leadId,
        expectedPreviousLeadId,
        scope.organizationId, intent, ownSessionOnly,
      );
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({
		queryKey: whatsappQueryKeys.conversation(scope, variables.conversation.id, variables.leadId),
      });
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      queryClient.invalidateQueries({ queryKey: whatsappQueryKeys.leadMessagesScope(scope, variables.leadId) });
      queryClient.invalidateQueries({ queryKey: ['lead-history-v2', variables.leadId] });
      toast({
        title: result.bindingMode === 'history_only' ? "Histórico vinculado" : "Conversa vinculada",
        description: result.attachedMessageCount > 0
          ? result.attachedMessageCount === 1
            ? "1 mensagem preservada foi anexada ao lead."
            : `${result.attachedMessageCount} mensagens preservadas foram anexadas ao lead.`
          : "Nenhuma mensagem preservada foi anexada ao lead.",
      });
    },
    onError: () => {
      toast({
        title: "A conversa mudou",
        description: "Atualize a conversa antes de tentar vinculá-la novamente.",
        variant: "destructive",
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
    hasWhatsAppViewPermission: hasPermission("whatsapp_view") || hasPermission("whatsapp_operate"),
  });
}

export function useWhatsAppInboxRealtime(enabled: boolean = true, activeInbox: boolean = false) {
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
    const catchUp = createWhatsAppInboxSubscriptionCatchUp(reconcileInbox);
    // The app shell may already own a subscribed physical channel. An active
    // inbox must reconcile on mount even if the registry sends no new status.
    if (activeInbox) catchUp.start(true);

    // The organization inbox channel is only a content-free wake-up signal.
    // Canonical data still comes from the scoped API.
    const lease = registry.acquire({
      topic: whatsappInboxTopic(organizationId),
      event: "whatsapp.inbox.changed",
      onPayload: (payload) => {
        if (!isWhatsAppInboxWakePayload(payload)) return;
        catchUp.hint();
      },
      onStatus: (status: PrivateBroadcastStatus) => {
        if (status !== "SUBSCRIBED") return;
        catchUp.start(activeInbox);
      },
    });

    return () => {
      cancelled = true;
      catchUp.dispose();
      lease.release();
    };
  }, [activeInbox, canSubscribe, scope, queryClient]);
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

    const handleLeadChange = (browserEvent: Event) => {
      const change = (browserEvent as CustomEvent<{
        organizationId?: string; leadId?: string; reason?: string;
      }>).detail;
      if (cancelled || change?.organizationId !== organizationId
        || (change.leadId && !scopedLeadIds.includes(change.leadId))
        || !change.reason?.startsWith("lead.") || change.reason === "lead.whatsapp_activity") return;
      const changedLeadIds = change.leadId ? [change.leadId] : scopedLeadIds;
      // The lead bus carries IDs/reasons only. Refetch current authorization;
      // neither the event nor an older cached card grants conversation access.
      window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT, {
        detail: { scope, leadIds: changedLeadIds, authorizationChanged: true },
      }));
      // Authorization changes must supersede an older authorized list read;
      // ordinary content hints below can wait for the current read to finish.
      void queryClient.cancelQueries({ queryKey: whatsappQueryKeys.conversationsScope(scope) });
      void queryClient.invalidateQueries({
        queryKey: whatsappQueryKeys.conversationsScope(scope), refetchType: "active",
      }, { cancelRefetch: true });
      scheduleWhatsAppRealtimeRefresh(queryClient, scope, {
        refreshMessages: true,
        refreshLeadMessages: true,
        leadIds: changedLeadIds,
      });
      void queryClient.invalidateQueries({
        predicate: (query) => query.isActive() && isWhatsAppQueryKeyForScope(query.queryKey, scope)
          && ["whatsapp-conversation", "whatsapp-conversation-snapshot", "whatsapp-conversation-history"].includes(String(query.queryKey[0])),
        refetchType: "active",
      });
    };
    window.addEventListener("vimob:lead-realtime-change", handleLeadChange);

    return () => {
      cancelled = true;
      window.removeEventListener("vimob:lead-realtime-change", handleLeadChange);
      reconcileTimers.forEach((timer) => clearTimeout(timer));
      leases.forEach((lease) => lease.release());
    };
  }, [canSubscribe, leadKey, queryClient, reconcileOnSubscribe, scope]);
}
