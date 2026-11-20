import { useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { whatsappAPI } from "@/lib/api/whatsapp";
import { mergeWhatsAppMessagesWithLocalState, whatsappQueryKeys } from "@/lib/whatsapp-query-cache";
import { useWhatsAppQueryScope } from "@/hooks/use-whatsapp-query-scope";
import { mergeWhatsAppFilterOptionPages } from "@/lib/filters/whatsapp-filter-options";
import { readWhatsAppInbox } from '@/lib/whatsapp-inbox-access';
import type { WhatsAppConversation, WhatsAppMessage, ConversationFilters } from "@/hooks/whatsapp/whatsapp-conversation-types";

const WHATSAPP_CONVERSATIONS_REFETCH_MS = 90_000;

const WHATSAPP_CONVERSATIONS_PAGINATED_REFETCH_MS = 5 * 60_000;

const WHATSAPP_ACTIVE_MESSAGES_REFETCH_MS = 30_000;

const WHATSAPP_ACTIVE_MESSAGES_STALE_MS = 10_000;

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

type UseWhatsAppMessagesOptions = {
  includeLeadHistory?: boolean;
  refetchIntervalMs?: number | false;
  refetchOnWindowFocus?: boolean;
  refetchOnMount?: boolean | "always";
};

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
