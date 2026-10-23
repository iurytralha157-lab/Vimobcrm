import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  CancelledError,
} from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { whatsappAPI, type WhatsAppMessage } from '@/lib/api/whatsapp';
import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope';
import {
  flattenWhatsAppMessagePages,
  mergeWhatsAppMessagesWithLocalState,
  whatsappQueryKeys,
} from '@/lib/whatsapp-query-cache';
import { isWhatsAppMessageCursorRebaseRequired } from '@/lib/whatsapp-message-order';
import { clearUnavailableWhatsAppLeadCache, isWhatsAppAccessUnavailable } from '@/lib/whatsapp-access-revocation';

const DEFAULT_LEAD_HISTORY_PAGE_SIZE = 40;

export interface LeadMessage extends WhatsAppMessage {
  session_owner_name?: string | null;
  session_instance_name?: string | null;
}

type LeadMessagePage = {
  messages: LeadMessage[];
  nextCursor: string | null;
};

type UseLeadMessagesOptions = {
  enabled?: boolean;
  pageSize?: number;
};

export function useLeadMessages(
  leadId: string | null | undefined,
  options: UseLeadMessagesOptions = {},
) {
  const queryClient = useQueryClient();
  const scope = useWhatsAppQueryScope();
  const pageSize = options.pageSize ?? DEFAULT_LEAD_HISTORY_PAGE_SIZE;
  const [cursorGeneration, setCursorGeneration] = useState(0);
  const { organizationId, userId, accessScope } = scope;
  const queryKey = useMemo(() => [
    ...whatsappQueryKeys.leadMessages({ organizationId, userId, accessScope }, leadId ?? null, pageSize),
    `cursor-generation:${cursorGeneration}`,
  ], [accessScope, cursorGeneration, leadId, organizationId, pageSize, userId]);
  const cursorIdentity = JSON.stringify(queryKey.slice(0, -1));
  const currentCursorIdentityRef = useRef(cursorIdentity);
  const cursorRebasedIdentityRef = useRef<string | null>(null);
  const [unavailableIdentity, setUnavailableIdentity] = useState<string | null>(null);
  useLayoutEffect(() => {
    currentCursorIdentityRef.current = cursorIdentity;
    return () => { currentCursorIdentityRef.current = ''; };
  }, [cursorIdentity]);

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<LeadMessagePage> => {
      if (!leadId || !scope.organizationId) {
        return { messages: [], nextCursor: null };
      }

      let history: Awaited<ReturnType<typeof whatsappAPI.getHistoryAccess>>;
      try {
        history = await whatsappAPI.getHistoryAccess({
          leadId,
          organizationId: scope.organizationId,
          limit: pageSize,
          includeConversations: false,
          cursor: pageParam,
          signal,
        });
      } catch (error) {
        if (signal.aborted || currentCursorIdentityRef.current !== cursorIdentity) {
          throw new CancelledError({ silent: true });
        }
        if (isWhatsAppAccessUnavailable(error)) {
          setUnavailableIdentity(cursorIdentity);
          clearUnavailableWhatsAppLeadCache(queryClient, scope, leadId);
          throw error;
        }
        if (pageParam !== null && isWhatsAppMessageCursorRebaseRequired(error)
          && cursorRebasedIdentityRef.current !== cursorIdentity) {
          cursorRebasedIdentityRef.current = cursorIdentity;
          queryClient.removeQueries({ queryKey, exact: true });
          setCursorGeneration((generation) => generation + 1);
          throw new CancelledError({ silent: true });
        }
        throw error;
      }
      if (signal.aborted || currentCursorIdentityRef.current !== cursorIdentity) {
        throw new CancelledError({ silent: true });
      }
      setUnavailableIdentity(null);
      const serverMessages = history.messages as LeadMessage[];

      if (pageParam) {
        cursorRebasedIdentityRef.current = null;
        return {
          messages: serverMessages,
          nextCursor: history.nextCursor,
        };
      }

      const cached = queryClient.getQueryData<InfiniteData<LeadMessagePage>>(queryKey);
      return {
        messages: mergeWhatsAppMessagesWithLocalState(
          serverMessages,
          cached?.pages[0]?.messages,
        ),
        nextCursor: history.nextCursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: (options.enabled ?? true)
      && unavailableIdentity !== cursorIdentity
      && !!leadId
      && !!scope.organizationId
      && !!scope.userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (failureCount, error) => !isWhatsAppAccessUnavailable(error)
      && !isWhatsAppMessageCursorRebaseRequired(error) && failureCount < 3,
  });

  const messages = flattenWhatsAppMessagePages(query.data?.pages ?? []);

  return {
    ...query,
    data: messages,
    messages,
    hasOlderMessages: Boolean(query.hasNextPage),
    loadOlderMessages: query.fetchNextPage,
    isLoadingOlder: query.isFetchingNextPage,
  };
}
