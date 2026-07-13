import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { whatsappAPI, type WhatsAppMessage } from '@/lib/api/whatsapp';
import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope';
import {
  flattenWhatsAppMessagePages,
  mergeWhatsAppMessagesWithLocalState,
  whatsappQueryKeys,
} from '@/lib/whatsapp-query-cache';

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
  const queryKey = whatsappQueryKeys.leadMessages(scope, leadId ?? null, pageSize);

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<LeadMessagePage> => {
      if (!leadId || !scope.organizationId) {
        return { messages: [], nextCursor: null };
      }

      const history = await whatsappAPI.getHistoryAccess({
        leadId,
        organizationId: scope.organizationId,
        limit: pageSize,
        cursor: pageParam,
      });
      const serverMessages = history.messages as LeadMessage[];

      if (pageParam) {
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
      && !!leadId
      && !!scope.organizationId
      && !!scope.userId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
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
